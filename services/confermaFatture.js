// La conferma di una fattura: il momento in cui il documento riceve il suo
// numero, smette di essere modificabile e diventa consegnabile.
//
// E l'unico punto in cui si assegna un numero. La scheda della fattura conferma
// una bozza alla volta, i controlli le confermano in blocco dopo un giro di
// fatturazione: passano entrambi da qui, cosi la regola e una sola.

const Fattura = require('../models/Fattura');
const Scadenza = require('../models/Scadenza');
const { FILTRO_CONFERMATE, isConfirmedInvoice } = require('../config/invoicing');
const { assegnaNumero, haNumeroDiSerie } = require('./numerazioneFatture');
const { runWithOptionalTransaction } = require('./transaction');
const { conflict, notFound } = require('../utils/errors');
const { withSession } = require('../utils/mongo');

// `modifiche` sono i campi salvati insieme alla conferma, quando la si da dalla
// scheda: la data scelta li decide anche l'anno e il numero.
const confermaInSessione = async ({ id, modifiche = {}, session }) => {
    const fattura = await withSession(Fattura.findById(id), session)
        .lean()
        .orFail(() => notFound('Fattura non trovata.'));

    if (isConfirmedInvoice(fattura)) {
        throw conflict('La fattura è già confermata.');
    }

    // Una fattura riportata a bozza tiene il numero che aveva: puo essere gia
    // uscita, e un secondo numero farebbe due documenti dello stesso. Vale per
    // i numeri della serie di questo gestionale: il "numero" di una bozza
    // importata e il civico dell'indirizzo, e non la numera. Una bozza senza
    // data prende quella di oggi, e la conserva: e la data del numero.
    const data_fattura = modifiche.data_fattura || fattura.data_fattura || new Date();
    const numerazione = haNumeroDiSerie(fattura)
        ? {}
        : { ...(await assegnaNumero({ data_fattura, session })), data_fattura };

    // Il filtro sullo stato protegge da due conferme contemporanee della stessa
    // bozza: la seconda non trova piu niente da confermare, e il numero che
    // aveva calcolato non finisce su nessun documento.
    const confermata = await Fattura.findOneAndUpdate(
        { _id: id, $nor: [FILTRO_CONFERMATE] },
        { $set: { ...modifiche, ...numerazione, confermata: true, stato: 'confermata' } },
        { new: true, session }
    ).lean();

    if (!confermata) {
        throw conflict('La fattura è stata confermata nel frattempo.');
    }

    // La scadenza porta anno, serie e numero del documento: e cosi che la si
    // riconosce fra le posizioni da incassare. Solo se e sua: una scadenza
    // collegata a mano a piu fatture porta gia il nome di un'altra.
    if (numerazione.numero && confermata.scadenza) {
        const condivisa = await withSession(
            Fattura.exists({ scadenza: confermata.scadenza, _id: { $ne: confermata._id } }),
            session
        );
        if (!condivisa) {
            await withSession(Scadenza.updateOne(
                { _id: confermata.scadenza },
                { $set: { anno: numerazione.anno, serie: numerazione.serie, numero: numerazione.numero } }
            ), session);
        }
    }

    return confermata;
};

const confermaFattura = (id, modifiche) => runWithOptionalTransaction((session) => (
    confermaInSessione({ id, modifiche, session })
));

// Le bozze di un giro di fatturazione, confermate insieme. I numeri seguono la
// data della fattura e poi l'ordine in cui le bozze sono nate, che e l'ordine
// della generazione. Ognuna ha la sua transazione: una bozza che non si puo
// confermare - una data piu vecchia dell'ultima numerata - resta bozza con il
// suo motivo, e le altre vanno avanti.
const confermaFatture = async (ids = []) => {
    const bozze = await Fattura.find({ _id: { $in: ids }, $nor: [FILTRO_CONFERMATE] })
        .sort({ data_fattura: 1, createdAt: 1, _id: 1 })
        .select('_id ragione_sociale nome_cliente')
        .lean();
    const confermate = [];
    const rifiutate = [];

    for (const bozza of bozze) {
        try {
            confermate.push(await confermaFattura(bozza._id));
        } catch (error) {
            if (!error.status) {
                console.error('Conferma della fattura non riuscita:', error);
            }
            rifiutate.push({
                fattura: bozza._id,
                intestatario: bozza.ragione_sociale || bozza.nome_cliente || '',
                motivo: error.status ? error.message : 'Errore imprevisto: riprova.',
            });
        }
    }

    // Quelle chieste che non erano bozze: gia confermate, o non piu esistenti.
    return { confermate, rifiutate, saltate: new Set(ids.map(String)).size - bozze.length };
};

module.exports = {
    confermaFattura,
    confermaFatture,
    confermaInSessione,
};
