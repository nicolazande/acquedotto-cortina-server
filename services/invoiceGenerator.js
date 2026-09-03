const Articolo = require('../models/Articolo');
const Cliente = require('../models/Cliente');
const Fattura = require('../models/Fattura');
const InvoiceCounter = require('../models/InvoiceCounter');
const Lettura = require('../models/Lettura');
require('../models/Listino');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');
const {
    createAnnualFixedContext,
} = require('./annualFixedChargeService');
const { calculateDelay, ensureInvoiceDeadline, syncInvoiceDeadlineTotal } = require('./deadlineService');
const {
    DEFAULT_DELAY_ARTICLE_CODE,
    calculateTotals,
    getTaxRate,
    numberOrZero,
    recordId,
    roundMoney,
} = require('./billingCalculator');
const { INVOICE_SERIES, invoiceCode } = require('../config/invoicing');
const { prossimoNumero } = require('./counters');
const { runWithOptionalTransaction } = require('./transaction');
const { righeDellaFattura } = require('./righeFattura');
const {
    calculateReadings,
    getArticlesByCode,
    loadReading,
} = require('./calcoloLettura');
const {
    cleanServiceLine,
} = require('./confrontoRighe');
const { createError, unprocessable } = require('../utils/errors');
const { hasValue } = require('../utils/values');
const { uniqueById, withSession } = require('../utils/mongo');
const { customerLabel } = require('../utils/customer');

const DEFAULT_DELAY_FEE = Number.parseFloat(process.env.INVOICE_DELAY_FEE || '6');

const reserveInvoiceNumber = async (year, session, serie = INVOICE_SERIES) => {
    const scope = `fatture:${serie}`;
    const highestFattura = await withSession(Fattura.findOne({ anno: year, serie }), session)
        .sort({ numero: -1 })
        .limit(1)
        .select('numero')
        .lean();
    const highestNumber = highestFattura ? numberOrZero(highestFattura.numero) : 0;

    await InvoiceCounter.updateOne(
        { scope, year },
        { $max: { value: highestNumber } },
        { upsert: true, session }
    );

    return prossimoNumero({ scope, year, session });
};

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
                $or: [{ fatturata: false }, { fatturata: { $exists: false } }],
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

const buildDelayLine = ({ article, previousInvoice }) => {
    const taxRate = getTaxRate(article);
    const price = roundMoney(Number.isFinite(DEFAULT_DELAY_FEE) ? DEFAULT_DELAY_FEE : 6);
    const previousCode = hasValue(previousInvoice?.numero) ? previousInvoice.numero : previousInvoice?.codice;
    const previousCodeLabel = hasValue(previousCode) ? String(previousCode) : undefined;

    return {
        descrizione: 'Ritardo pagamento fattura precedente',
        tipo_attivita: previousCodeLabel ? `-${previousCodeLabel}` : undefined,
        metri_cubi: 1,
        prezzo: price,
        valore_unitario: price,
        descrizione_attivita: previousCodeLabel,
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
            precedente_fattura: previousInvoice ? {
                _id: recordId(previousInvoice),
                anno: previousInvoice.anno,
                numero: previousInvoice.numero,
                data_fattura: previousInvoice.data_fattura,
            } : undefined,
            scadenza: previousInvoice?.scadenza ? {
                _id: recordId(previousInvoice.scadenza),
                scadenza: previousInvoice.scadenza.scadenza,
                pagamento: previousInvoice.scadenza.pagamento,
                saldo: previousInvoice.scadenza.saldo,
            } : undefined,
            totale_riga: price,
            quota: 'delay',
        },
    };
};

const getDelayLineForCustomer = async ({ articlesByCode, clienteId, invoiceDate, session }) => {
    const previousInvoice = await withSession(Fattura.findOne({
        cliente: clienteId,
        data_fattura: { $lt: invoiceDate },
    }), session)
        .sort({ data_fattura: -1, _id: -1 })
        .populate('scadenza')
        .lean();

    if (!previousInvoice?.scadenza || calculateDelay(previousInvoice.scadenza, invoiceDate) <= 0) {
        return null;
    }

    // La penale si addebita una volta sola per scadenza. Senza questo controllo
    // un cliente fatturato due volte mentre la stessa scadenza resta aperta la
    // pagherebbe due volte, e con 694 scadenze aperte non e un caso di scuola.
    if (previousInvoice.scadenza.mora_fatturata) {
        return null;
    }

    const article = articlesByCode[DEFAULT_DELAY_ARTICLE_CODE];
    if (!article) {
        throw createError('Articolo GG_DELAY mancante: impossibile calcolare il ritardo in modo sicuro');
    }

    return {
        ...buildDelayLine({ article, previousInvoice }),
        // Da segnare sulla scadenza appena la fattura esiste davvero: se la
        // generazione fallisce, la penale non risulta addebitata.
        scadenzaDaSegnare: recordId(previousInvoice.scadenza),
    };
};

// La penale e stata messa in fattura: da qui in avanti quella scadenza non ne
// genera altre.
const segnaMoraFatturata = async (scadenzaId, session) => {
    if (!scadenzaId) {
        return;
    }

    await withSession(Scadenza.updateOne({ _id: scadenzaId }, { $set: { mora_fatturata: true } }), session);
};

const toBoolean = (value) => value === true || ['1', 'true', 'yes'].includes(String(value).toLowerCase());
const getInvoiceStatus = (confermata) => (toBoolean(confermata) ? 'confermata' : 'bozza');

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

const createManualInvoiceInSession = async (input = {}, session) => {
    const invoiceDate = input.data_fattura ? new Date(input.data_fattura) : new Date();
    const year = input.anno || invoiceDate.getFullYear();
    const serie = input.serie || INVOICE_SERIES;
    const numero = hasValue(input.numero)
        ? numberOrZero(input.numero)
        : await reserveInvoiceNumber(year, session, serie);
    const cliente = input.cliente
        ? await withSession(Cliente.findById(input.cliente), session).lean()
        : null;
    const intestatario = customerLabel(cliente);
    const confermata = toBoolean(input.confermata);
    // `articolo` guida la riga, non e un campo della fattura: va tolto prima di
    // scrivere il documento.
    const { articolo: articoloId, ...campiFattura } = input;
    const [fattura] = await Fattura.create([{
        ...campiFattura,
        tipo_documento: input.tipo_documento || 'Fattura',
        ragione_sociale: input.ragione_sociale || intestatario,
        confermata,
        stato: input.stato || getInvoiceStatus(confermata),
        origine: input.origine || 'manuale',
        anno: year,
        numero,
        serie,
        codice: input.codice || invoiceCode({ anno: year, numero, serie }),
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
        fattura,
        scadenza,
        servizio,
    };
};

const createManualInvoice = (input) => runWithOptionalTransaction((session) => (
    createManualInvoiceInSession(input, session)
));

const createInvoiceFromReadingsInSession = async ({
    confermata = false,
    data_fattura,
    data_scadenza,
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

        const readings = await Promise.all(letturaIds.map((id) => loadReading(id, session)));
        if (readings.some((lettura) => !lettura)) {
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
        const year = invoiceDate.getFullYear();
        const billingContext = createAnnualFixedContext({ invoiceDate, invoiceYear: year });
        const cliente = getClienteFromReadings(readings);
        const articlesByCode = await getArticlesByCode(session);
        const calculations = await calculateReadings(letturaIds, billingContext, {
            articlesByCode,
            includeFixedCharge,
            session,
        });

        const delayLine = await getDelayLineForCustomer({
            articlesByCode,
            clienteId: cliente._id,
            invoiceDate,
            session,
        });
        // Il riferimento alla scadenza da segnare non e un dato della riga:
        // viaggia a parte, altrimenti finirebbe salvato nel servizio.
        const scadenzaDaSegnare = delayLine?.scadenzaDaSegnare;
        const rigaMora = delayLine ? { ...delayLine, scadenzaDaSegnare: undefined } : null;
        const allLines = [
            ...calculations.flatMap((calculation) => calculation.lines),
            ...(rigaMora ? [rigaMora] : []),
        ];
        if (allLines.length === 0) {
            throw createError('Le letture selezionate non generano righe fatturabili');
        }

        const totals = calculateTotals(allLines);
        lockedReadingIds = await lockReadingsForBilling(letturaIds, session);
        const numero = await reserveInvoiceNumber(year, session, INVOICE_SERIES);

        const [fattura] = await Fattura.create([{
            tipo_documento,
            ragione_sociale: customerLabel(cliente),
            confermata: toBoolean(confermata),
            stato: getInvoiceStatus(confermata),
            origine: 'letture',
            anno: year,
            numero,
            serie: INVOICE_SERIES,
            codice: invoiceCode({ anno: year, numero, serie: INVOICE_SERIES }),
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
        await segnaMoraFatturata(scadenzaDaSegnare, session);

        return {
            fattura,
            scadenza,
            servizi: services,
            calculations,
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
