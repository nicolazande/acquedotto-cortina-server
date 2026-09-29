// La mora: la penale che una fattura nuova addebita se il cliente ha pagato in
// ritardo la precedente - o non l'ha ancora pagata.
//
// Sta qui e non nella generazione perche serve anche all'anteprima: prima la
// penale compariva solo sulla bozza gia creata, e un giro di fatturazione con
// centinaia di scadenze aperte - pagamenti mai registrati, non clienti morosi -
// l'avrebbe messa a centinaia di clienti senza che l'anteprima lo dicesse.

const Fattura = require('../models/Fattura');
const Scadenza = require('../models/Scadenza');
const { DEFAULT_DELAY_ARTICLE_CODE, getTaxRate, recordId, roundMoney } = require('./billingCalculator');
const { calculateDelay } = require('./deadlineService');
const { FILTRO_CONFERMATE, numeroDocumento } = require('../config/invoicing');
const { createError } = require('../utils/errors');
const { toObjectId, withSession } = require('../utils/mongo');

const IMPORTO_MORA = (() => {
    const importo = Number.parseFloat(process.env.INVOICE_DELAY_FEE || '6');
    return roundMoney(Number.isFinite(importo) ? importo : 6);
})();

// Come la fattura precedente si chiama nella riga.
const riferimento = (fattura) => numeroDocumento(fattura) || undefined;

// L'ultima fattura confermata di ciascun cliente prima di una data, con la sua
// scadenza. Una bozza non conta: il cliente non l'ha mai ricevuta, e non puo
// essere in ritardo nel pagarla. Gli identificativi si convertono qui: in
// un'aggregazione Mongoose non lo fa, e un id scritto come testo non trova
// niente senza dirlo.
const fatturePrecedenti = async (clienteIds, prima, session) => {
    const clienti = clienteIds.map(toObjectId).filter(Boolean);
    const ultime = await withSession(Fattura.aggregate([
        { $match: { cliente: { $in: clienti }, data_fattura: { $lt: prima }, ...FILTRO_CONFERMATE } },
        { $sort: { data_fattura: -1, _id: -1 } },
        { $group: { _id: '$cliente', fattura: { $first: '$$ROOT' } } },
    ]), session);
    const scadenze = await withSession(Scadenza.find({
        _id: { $in: ultime.map(({ fattura }) => fattura.scadenza).filter(Boolean) },
    }), session).lean();
    const scadenzaPerId = new Map(scadenze.map((scadenza) => [String(scadenza._id), scadenza]));

    return new Map(ultime.map(({ _id, fattura }) => [
        String(_id),
        { ...fattura, scadenza: scadenzaPerId.get(String(fattura.scadenza)) || null },
    ]));
};

// La penale e dovuta se la scadenza della fattura precedente e passata senza
// pagamento, o e stata pagata dopo. Si addebita una volta sola per scadenza: un
// cliente fatturato due volte mentre la stessa scadenza resta aperta la
// pagherebbe due volte.
const moraDovuta = (precedente, dataFattura) => Boolean(
    precedente?.scadenza
    && !precedente.scadenza.mora_fatturata
    && calculateDelay(precedente.scadenza, dataFattura) > 0
);

const rigaMora = ({ article, previousInvoice }) => {
    const taxRate = getTaxRate(article);
    const codice = riferimento(previousInvoice);

    return {
        descrizione: 'Ritardo pagamento fattura precedente',
        tipo_attivita: codice ? `-${codice}` : undefined,
        metri_cubi: 1,
        prezzo: IMPORTO_MORA,
        valore_unitario: IMPORTO_MORA,
        descrizione_attivita: codice,
        articolo: article?._id || article || undefined,
        iva_percentuale: taxRate,
        aliquota_iva: taxRate,
        calcolo_snapshot: {
            articolo: article ? {
                _id: recordId(article),
                codice: article.codice,
                descrizione: article.descrizione,
                iva: article.iva,
            } : undefined,
            precedente_fattura: {
                _id: recordId(previousInvoice),
                anno: previousInvoice.anno,
                numero: previousInvoice.numero,
                data_fattura: previousInvoice.data_fattura,
            },
            scadenza: {
                _id: recordId(previousInvoice.scadenza),
                scadenza: previousInvoice.scadenza.scadenza,
                pagamento: previousInvoice.scadenza.pagamento,
                saldo: previousInvoice.scadenza.saldo,
            },
            totale_riga: IMPORTO_MORA,
            quota: 'delay',
        },
    };
};

// La riga della penale per un cliente, oppure null se non e dovuta.
// `precedente` e la voce di `fatturePrecedenti` per quel cliente.
const rigaMoraPer = ({ articlesByCode, precedente, dataFattura }) => {
    if (!moraDovuta(precedente, dataFattura)) {
        return null;
    }

    const article = articlesByCode[DEFAULT_DELAY_ARTICLE_CODE];
    if (!article) {
        throw createError('Articolo GG_DELAY mancante: impossibile calcolare il ritardo in modo sicuro');
    }

    return rigaMora({ article, previousInvoice: precedente });
};

// Come l'anteprima racconta la penale di un cliente: su quale fattura, da quanti
// giorni, quanto.
const descriviMora = (precedente, dataFattura) => ({
    importo: IMPORTO_MORA,
    fattura: riferimento(precedente) || '',
    anno: precedente.anno,
    scadenza: precedente.scadenza.scadenza,
    ritardo: calculateDelay(precedente.scadenza, dataFattura),
});

// La penale e stata messa in fattura: da qui in avanti quella scadenza non ne
// genera altre. Si segna solo quando la fattura esiste davvero: se la
// generazione fallisce, la penale non risulta addebitata.
const segnaMoraFatturata = async (riga, session) => {
    const scadenzaId = riga?.calcolo_snapshot?.scadenza?._id;
    if (!scadenzaId) {
        return;
    }

    await withSession(Scadenza.updateOne({ _id: scadenzaId }, { $set: { mora_fatturata: true } }), session);
};

module.exports = {
    IMPORTO_MORA,
    descriviMora,
    fatturePrecedenti,
    moraDovuta,
    rigaMoraPer,
    segnaMoraFatturata,
};
