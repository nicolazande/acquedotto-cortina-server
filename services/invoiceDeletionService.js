const Consegna = require('../models/Consegna');
const Fattura = require('../models/Fattura');
const InvoiceCounter = require('../models/InvoiceCounter');
const Lettura = require('../models/Lettura');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');
const { getReadingIdsFromServices } = require('./confrontoRighe');
const { assertInvoiceEditable } = require('./invoiceLockService');
const { scopeDellaSerie } = require('./counters');
const { runWithOptionalTransaction } = require('./transaction');
const { notFound } = require('../utils/errors');
const { recordId, withSession } = require('../utils/mongo');

// Cancellare una fattura senza toccare cio che le sta attorno lasciava:
// - righe servizio orfane, che puntavano a una fattura inesistente e che
//   l'API non riusciva piu a cancellare (il controllo del blocco andava in 404);
// - letture marcate "fatturata" per sempre, quindi non piu rifatturabili;
// - la scadenza generata insieme alla fattura, rimasta senza documento;
// - le consegne in coda per un documento che non esiste piu, che avrebbero
//   continuato a comparire fra le fatture da recapitare.
// Qui la cancellazione diventa un'operazione unica e completa.
// Il numero di una fattura cancellata si puo dare alla prossima solo se il
// documento non e mai uscito di qui: altrimenti due documenti diversi, uno gia in
// mano al cliente o allo SdI, avrebbero lo stesso numero.
//
// Uscito vuol dire: una consegna evasa davvero (una simulata non e partita), un
// file XML gia prodotto - qualcuno puo averlo caricato sul portale dello SdI senza
// dirlo al gestionale - o una data di invio scritta sulla fattura, anche a mano.
// Lo storico importato non ha serie, e i suoi numeri non sono un progressivo.
const numeroRiusabile = ({ fattura, consegne = [] }) => {
    if (!fattura?.serie || !fattura?.anno || !(Number(fattura.numero) > 0)) {
        return false;
    }

    if (fattura.data_invio_fattura || fattura.data_fattura_elettronica) {
        return false;
    }

    return !consegne.some((consegna) => (
        (consegna.stato === 'inviata' && !consegna.simulata)
        || (consegna.tipo === 'elettronica' && Boolean(consegna.progressivo))
    ));
};

// Se la fattura cancellata aveva l'ultimo numero della serie, il contatore torna al
// numero piu alto rimasto e la prossima fattura riprende da li. Prima il contatore
// andava solo avanti: due fatture di prova cancellate facevano partire la prima
// vera dal numero 3.
//
// Solo se era proprio l'ultima. Una fattura in mezzo lascia un buco, che non si
// chiude senza rinumerare quelle dopo. Il confronto sul valore del contatore rende
// l'operazione sicura anche se, nel frattempo, un'altra generazione ha gia preso il
// numero successivo: in quel caso non si tocca niente.
const liberaUltimoNumero = async (fattura, session) => {
    const piuAlta = await withSession(Fattura.findOne({ anno: fattura.anno, serie: fattura.serie }), session)
        .sort({ numero: -1 })
        .select('numero')
        .lean();

    const esito = await InvoiceCounter.updateOne(
        { scope: scopeDellaSerie(fattura.serie), year: fattura.anno, value: Number(fattura.numero) },
        { $set: { value: Number(piuAlta?.numero) || 0 } },
        { session }
    );

    return esito.modifiedCount > 0;
};

const deleteInvoiceInSession = async (fatturaId, session, unlock) => {
    const fattura = await withSession(Fattura.findById(fatturaId), session).lean();
    if (!fattura) {
        throw notFound('Fattura not found');
    }

    const eraConfermata = assertInvoiceEditable(fattura, 'cancellare la fattura', unlock);

    const servizi = await withSession(Servizio.find({ fattura: fatturaId }), session)
        .select('_id lettura calcolo_snapshot')
        .lean();
    const letturaIds = getReadingIdsFromServices(servizi).map(recordId);

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

    // Se la fattura portava la penale per il ritardo, la scadenza che l'aveva
    // generata torna addebitabile: altrimenti resterebbe marcata come "mora gia
    // fatturata" per una mora che non esiste piu.
    const scadenzeDaLiberare = servizi
        .filter((servizio) => servizio.calcolo_snapshot?.quota === 'delay')
        .map((servizio) => servizio.calcolo_snapshot?.scadenza?._id)
        .filter(Boolean);

    if (scadenzeDaLiberare.length > 0) {
        await withSession(
            Scadenza.updateMany({ _id: { $in: scadenzeDaLiberare } }, { $unset: { mora_fatturata: '' } }),
            session
        );
    }

    // Prima di cancellarle, le consegne dicono se il documento e gia uscito: e
    // l'unico modo di sapere se il suo numero si puo riusare.
    const consegneDelDocumento = await withSession(Consegna.find({ fattura: fatturaId }), session)
        .select('tipo stato simulata progressivo')
        .lean();
    const riusabile = numeroRiusabile({ fattura, consegne: consegneDelDocumento });

    // Le consegne appartengono al documento: senza di lui non hanno significato.
    const consegne = await withSession(Consegna.deleteMany({ fattura: fatturaId }), session);

    await withSession(Fattura.deleteOne({ _id: fatturaId }), session);

    const numeroLiberato = riusabile ? await liberaUltimoNumero(fattura, session) : false;

    return {
        fattura,
        eraConfermata,
        serviziCancellati: servizi.length,
        letturaSbloccate,
        scadenzaCancellata,
        consegneCancellate: consegne.deletedCount || 0,
        moreLiberate: scadenzeDaLiberare.length,
        numeroLiberato,
    };
};

const deleteInvoice = (fatturaId, unlock) => runWithOptionalTransaction((session) => (
    deleteInvoiceInSession(fatturaId, session, unlock)
));

module.exports = {
    deleteInvoice,
    numeroRiusabile,
};
