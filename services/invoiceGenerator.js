const Articolo = require('../models/Articolo');
const Cliente = require('../models/Cliente');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const { DA_FATTURARE } = require('../models/Lettura');
require('../models/Listino');
const Servizio = require('../models/Servizio');
const {
    createAnnualFixedContext,
} = require('./annualFixedChargeService');
const { ensureInvoiceDeadline, syncInvoiceDeadlineTotal } = require('./deadlineService');
const {
    calculateTotals,
    getTaxRate,
    numberOrZero,
    roundMoney,
} = require('./billingCalculator');
const { confermaInSessione } = require('./confermaFatture');
const { isConfirmedInvoice } = require('../config/invoicing');
const { fatturePrecedenti, rigaMoraPer, segnaMoraFatturata } = require('./mora');
const { quoteCondominiali } = require('./ripartoCondominiale');
const { runWithOptionalTransaction } = require('./transaction');
const { righeDellaFattura } = require('./righeFattura');
const {
    calcolaLettura,
    getArticlesByCode,
    loadReadings,
} = require('./calcoloLettura');
const {
    cleanServiceLine,
} = require('./confrontoRighe');
const { createError, unprocessable } = require('../utils/errors');
const { uniqueById, withSession } = require('../utils/mongo');
const { parseBoolean } = require('../utils/values');
const { customerLabel } = require('../utils/customer');

const releaseReadingsForBilling = async (letturaIds) => {
    if (!letturaIds.length) {
        return;
    }

    await Lettura.updateMany(
        { _id: { $in: letturaIds } },
        { $set: { fatturata: false } }
    );
};

const rollbackGeneratedInvoice = async ({ fatturaId, lockedReadingIds }) => {
    try {
        if (fatturaId) {
            await Servizio.deleteMany({ fattura: fatturaId });
            await Fattura.deleteOne({ _id: fatturaId });
        }
        await releaseReadingsForBilling(lockedReadingIds);
    } catch (cleanupError) {
        console.error('Rollback generazione fattura non completato:', cleanupError);
    }
};

const lockReadingsForBilling = async (letturaIds, session) => {
    const lockedIds = [];

    for (const letturaId of letturaIds) {
        const locked = await withSession(Lettura.findOneAndUpdate(
            {
                _id: letturaId,
                ...DA_FATTURARE,
            },
            { $set: { fatturata: true } },
            { new: true }
        ), session).select('_id').lean();

        if (!locked) {
            if (!session) {
                await releaseReadingsForBilling(lockedIds);
            }
            throw createError('Almeno una lettura selezionata risulta gia fatturata', 409);
        }

        lockedIds.push(letturaId);
    }

    return lockedIds;
};

const getClienteFromReadings = (readings) => {
    const clientes = uniqueById(readings.map((lettura) => lettura.contatore?.cliente).filter(Boolean));

    if (clientes.length !== 1) {
        throw createError('Le letture selezionate devono appartenere allo stesso cliente');
    }

    return clientes[0];
};


// I totali della fattura sono la somma delle sue righe, e devono restare tali
// per sempre: aggiungerne una dalla scheda lasciava imponibile, IVA e totale
// fermi ai valori del giorno in cui la fattura era nata. Un documento i cui
// totali non tornano con le righe viene rifiutato dallo SdI, e il rapporto di
// integrita lo segnala.
//
// Si passa dalla stessa funzione della fatturazione automatica: non esiste un
// secondo modo di sommare una fattura.
const ricalcolaTotaliFattura = async (fatturaId, session) => {
    if (!fatturaId) {
        return null;
    }

    const righe = await righeDellaFattura(fatturaId, session);
    const totali = calculateTotals(righe.map((riga) => ({
        valore_unitario: riga.valore_unitario,
        iva_percentuale: riga.aliquota_iva,
        articolo: riga.articolo,
    })));

    await withSession(Fattura.updateOne({ _id: fatturaId }, { $set: totali }), session);

    // La scadenza porta l'importo da incassare: se resta indietro, il documento
    // dice una cifra e la posizione da incassare un'altra. E il motivo per cui
    // questa deve restare l'unica funzione che rifa i totali - quando erano due,
    // una sola delle due allineava la scadenza.
    const fattura = await withSession(Fattura.findById(fatturaId), session).select('scadenza totale_fattura').lean();
    await syncInvoiceDeadlineTotal({ fattura, session });

    return totali;
};

// Una fattura scritta a mano - un rimborso, un allacciamento, la vendita di un
// contatore - nasceva senza righe: il totale era un numero digitato e basta.
// Ma una fattura senza righe non si puo trasmettere (l'XML la rifiuta), il
// controllo di integrita la segnala, e l'aliquota restava da indovinare.
//
// Scegliendo l'articolo si ottiene tutto: la riga esiste, l'aliquota e quella
// che l'articolo dichiara - 10% sull'acqua, 22% su un contatore venduto, esente
// sulla mora - e i totali si calcolano con la stessa funzione della
// fatturazione automatica invece di essere scritti a mano.
const creaRigaManuale = async ({ articoloId, imponibile, descrizione }, fatturaId, session) => {
    const articolo = await withSession(Articolo.findById(articoloId), session).lean();

    if (!articolo) {
        throw unprocessable('Articolo non trovato: impossibile creare la riga della fattura.');
    }

    const [servizio] = await Servizio.create([{
        riga: 1,
        descrizione: descrizione || articolo.descrizione || articolo.codice,
        valore_unitario: roundMoney(numberOrZero(imponibile)),
        prezzo: roundMoney(numberOrZero(imponibile)),
        articolo: articolo._id,
        aliquota_iva: getTaxRate(articolo),
        fattura: fatturaId,
    }], { session });

    return { servizio, totali: await ricalcolaTotaliFattura(fatturaId, session) };
};

// Una fattura nasce sempre bozza, senza numero: il numero lo da la conferma
// (services/confermaFatture.js). Chi la crea gia confermata passa di li nella
// stessa transazione: se la conferma non e possibile non resta niente. Senza
// transazioni (il database di sviluppo) resta la bozza.
const createManualInvoiceInSession = async (input = {}, session) => {
    const invoiceDate = input.data_fattura ? new Date(input.data_fattura) : new Date();
    const cliente = input.cliente
        ? await withSession(Cliente.findById(input.cliente), session).lean()
        : null;
    const intestatario = customerLabel(cliente);
    // `articolo` guida la riga e non e un campo della fattura. Stato, anno,
    // numero, serie e codice li decidono la data e la conferma, non la maschera.
    const {
        articolo: articoloId,
        confermata,
        stato,
        anno,
        numero,
        serie,
        codice,
        ...campiFattura
    } = input;
    const [fattura] = await Fattura.create([{
        ...campiFattura,
        tipo_documento: input.tipo_documento || 'Fattura',
        ragione_sociale: input.ragione_sociale || intestatario,
        stato: 'bozza',
        origine: input.origine || 'manuale',
        anno: invoiceDate.getUTCFullYear(),
        data_fattura: invoiceDate,
        nome_cliente: input.nome_cliente || intestatario,
        cliente: cliente?._id || input.cliente,
        scadenza: input.scadenza || undefined,
    }], { session });
    let servizio = null;
    if (articoloId) {
        const esito = await creaRigaManuale({
            articoloId,
            imponibile: input.imponibile,
            descrizione: input.descrizione,
        }, fattura._id, session);
        servizio = esito.servizio;
        // I totali vengono dalla riga: e la riga il documento, non il numero
        // che qualcuno ha digitato accanto.
        Object.assign(fattura, esito.totali);
    }

    const scadenza = await ensureInvoiceDeadline({
        cliente,
        dueDate: input.data_scadenza,
        fattura,
        session,
    });

    return {
        fattura: isConfirmedInvoice({ confermata: confermata === true || parseBoolean(confermata), stato })
            ? await confermaInSessione({ id: fattura._id, session })
            : fattura,
        scadenza,
        servizio,
    };
};

const createManualInvoice = (input) => runWithOptionalTransaction((session) => (
    createManualInvoiceInSession(input, session)
));

// Le letture di un cliente diventano una bozza: righe calcolate, mora se
// dovuta, scadenza. Il numero arriva con la conferma.
const createInvoiceFromReadingsInSession = async ({
    data_fattura,
    data_scadenza,
    includeDelay = false,
    includeFixedCharge = true,
    letture,
    tipo_documento = 'Fattura',
}, session) => {
    let createdFatturaId = null;
    let lockedReadingIds = [];

    const letturaIds = [...new Set((letture || []).filter(Boolean).map(String))];

    try {
        if (letturaIds.length === 0) {
            throw createError('Seleziona almeno una lettura da fatturare');
        }

        const readings = await loadReadings(letturaIds, session);
        if (readings.length !== letturaIds.length) {
            throw createError('Una o più letture non esistono', 404);
        }

        if (readings.some((lettura) => lettura.fatturata)) {
            throw createError('Almeno una lettura selezionata risulta gia fatturata', 409);
        }

        const alreadyLinked = await withSession(
            Servizio.find({ lettura: { $in: letturaIds }, fattura: { $ne: null } }),
            session
        ).limit(1).lean();
        if (alreadyLinked.length > 0) {
            throw createError('Almeno una lettura selezionata e gia collegata a una fattura', 409);
        }

        const invoiceDate = data_fattura ? new Date(data_fattura) : new Date();
        const year = invoiceDate.getUTCFullYear();
        const billingContext = createAnnualFixedContext({ invoiceDate, invoiceYear: year });
        const cliente = getClienteFromReadings(readings);
        const articlesByCode = await getArticlesByCode(session);
        const calculations = [];
        for (const lettura of readings) {
            calculations.push(await calcolaLettura(lettura, {
                ...billingContext,
                articlesByCode,
                includeFixedCharge,
                session,
            }));
        }

        // Le utenze di un edificio con il contatore condominiale pagano anche la
        // loro parte del consumo comune.
        const quote = await quoteCondominiali({
            articlesByCode,
            cliente,
            contatori: uniqueById(readings.map((lettura) => lettura.contatore)),
            dataFattura: invoiceDate,
            session,
        });

        // La mora entra solo se la si chiede: gli incassi si registrano nel
        // programma di contabilita, e con i pagamenti non registrati colpirebbe
        // chi ha pagato. Chi chiama senza dirlo non la aggiunge.
        const precedenti = includeDelay !== true
            ? new Map()
            : await fatturePrecedenti([cliente._id], invoiceDate, session);
        const rigaMora = rigaMoraPer({
            articlesByCode,
            precedente: precedenti.get(String(cliente._id)),
            dataFattura: invoiceDate,
        });
        const allLines = [
            ...calculations.flatMap((calculation) => calculation.lines),
            ...quote.flatMap((quota) => quota.lines),
            ...(rigaMora ? [rigaMora] : []),
        ];
        if (allLines.length === 0) {
            throw createError('Le letture selezionate non generano righe fatturabili');
        }

        const totals = calculateTotals(allLines);
        lockedReadingIds = await lockReadingsForBilling(letturaIds, session);

        const [fattura] = await Fattura.create([{
            tipo_documento,
            ragione_sociale: customerLabel(cliente),
            stato: 'bozza',
            origine: 'letture',
            anno: year,
            data_fattura: invoiceDate,
            imponibile: totals.imponibile,
            iva: totals.iva,
            totale_fattura: totals.totale_fattura,
            nome_cliente: customerLabel(cliente),
            cliente: cliente._id,
        }], { session });
        createdFatturaId = fattura._id;

        const services = await Servizio.insertMany(
            allLines.map((line, index) => cleanServiceLine(line, fattura._id, index + 1)),
            { session }
        );
        const scadenza = await ensureInvoiceDeadline({
            cliente,
            dueDate: data_scadenza,
            fattura,
            session,
        });
        await segnaMoraFatturata(rigaMora, session);
        // La lettura del condominiale e entrata in fattura: non e piu fra quelle
        // da fatturare. Le altre utenze la trovano lo stesso, perche la loro
        // parte si cerca fra le loro fatture e non su questo segno.
        if (quote.length > 0) {
            await withSession(Lettura.updateMany(
                { _id: { $in: quote.map((quota) => quota.lettura._id) } },
                { $set: { fatturata: true } }
            ), session);
        }

        return {
            fattura,
            scadenza,
            servizi: services,
            calculations: [...calculations, ...quote],
        };
    } catch (error) {
        if (!session) {
            await rollbackGeneratedInvoice({ fatturaId: createdFatturaId, lockedReadingIds });
        }
        throw error;
    }
};

const createInvoiceFromReadings = (input) => runWithOptionalTransaction((session) => (
    createInvoiceFromReadingsInSession(input, session)
));

module.exports = {
    createInvoiceFromReadings,
    createManualInvoice,
    ricalcolaTotaliFattura,
};
