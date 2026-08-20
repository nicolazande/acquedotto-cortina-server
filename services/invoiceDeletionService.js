const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');
const { assertInvoiceEditable } = require('./invoiceLockService');
const { runWithOptionalTransaction } = require('./transaction');
const { notFound } = require('../utils/errors');
const { recordId, uniqueById, withSession } = require('../utils/mongo');

// Cancellare una fattura senza toccare cio che le sta attorno lasciava:
// - righe servizio orfane, che puntavano a una fattura inesistente e che
//   l'API non riusciva piu a cancellare (il controllo del blocco andava in 404);
// - letture marcate "fatturata" per sempre, quindi non piu rifatturabili;
// - la scadenza generata insieme alla fattura, rimasta senza documento.
// Qui la cancellazione diventa un'operazione unica e completa.
const collectReadingIds = (fattura, servizi) => uniqueById([
    ...(fattura.letture || []),
    ...servizi.map((servizio) => servizio.lettura).filter(Boolean),
]).map((lettura) => recordId(lettura));

const deleteInvoiceInSession = async (fatturaId, session, unlock) => {
    const fattura = await withSession(Fattura.findById(fatturaId), session).lean();
    if (!fattura) {
        throw notFound('Fattura not found');
    }

    const eraConfermata = assertInvoiceEditable(fattura, 'cancellare la fattura', unlock);

    const servizi = await withSession(Servizio.find({ fattura: fatturaId }), session)
        .select('_id lettura')
        .lean();
    const letturaIds = collectReadingIds(fattura, servizi);

    if (servizi.length > 0) {
        await withSession(Servizio.deleteMany({ fattura: fatturaId }), session);
    }

    // Le letture tornano disponibili solo se non restano collegate ad altre fatture.
    let letturaSbloccate = 0;
    if (letturaIds.length > 0) {
        const ancoraCollegate = await withSession(
            Servizio.find({ lettura: { $in: letturaIds }, fattura: { $ne: null } }),
            session
        ).select('lettura').lean();
        const bloccate = new Set(ancoraCollegate.map((servizio) => recordId(servizio.lettura)));
        const daSbloccare = letturaIds.filter((id) => !bloccate.has(id));

        if (daSbloccare.length > 0) {
            const result = await withSession(
                Lettura.updateMany({ _id: { $in: daSbloccare } }, { $set: { fatturata: false } }),
                session
            );
            letturaSbloccate = result.modifiedCount || 0;
        }
    }

    // La scadenza si cancella solo se non e condivisa con altre fatture.
    let scadenzaCancellata = false;
    if (fattura.scadenza) {
        const altreFatture = await withSession(
            Fattura.find({ scadenza: fattura.scadenza, _id: { $ne: fattura._id } }),
            session
        ).select('_id').limit(1).lean();

        if (altreFatture.length === 0) {
            await withSession(Scadenza.deleteOne({ _id: fattura.scadenza }), session);
            scadenzaCancellata = true;
        }
    }

    await withSession(Fattura.deleteOne({ _id: fatturaId }), session);

    return {
        fattura,
        eraConfermata,
        serviziCancellati: servizi.length,
        letturaSbloccate,
        scadenzaCancellata,
    };
};

const deleteInvoice = (fatturaId, unlock) => runWithOptionalTransaction((session) => (
    deleteInvoiceInSession(fatturaId, session, unlock)
));

module.exports = {
    deleteInvoice,
};
