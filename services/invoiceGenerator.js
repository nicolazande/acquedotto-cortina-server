const mongoose = require('mongoose');
const Articolo = require('../models/Articolo');
const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fascia = require('../models/Fascia');
const Fattura = require('../models/Fattura');
const InvoiceCounter = require('../models/InvoiceCounter');
const Lettura = require('../models/Lettura');
const Servizio = require('../models/Servizio');
const { ensureInvoiceDeadline } = require('./deadlineService');
const {
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
    calculateReadingInvoice,
    calculateTotals,
    numberOrZero,
    roundMoney,
} = require('./billingCalculator');

const createError = (message, status = 400) => Object.assign(new Error(message), { status });

const uniqueById = (records) => {
    const seen = new Set();
    return records.filter((record) => {
        const key = String(record?._id || record || '');
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';
const withSession = (query, session) => (session ? query.session(session) : query);
const sumMoneyBy = (records, getter) => roundMoney(
    records.reduce((total, record) => total + numberOrZero(getter(record)), 0)
);
const isBillablePreview = (preview) => !preview.error && preview.lines?.length;
const getTransactionErrorMessage = (error) => [
    error?.message,
    error?.cause?.message,
    error?.errorLabels?.join(' '),
].filter(Boolean).join(' ');

const isTransactionUnsupported = (error) => /Transaction numbers are only allowed|replica set member|transactions?.*not supported/i
    .test(getTransactionErrorMessage(error));

const getCustomerLabel = (cliente) => (
    cliente?.ragione_sociale
    || [cliente?.cognome, cliente?.nome].filter(Boolean).join(' ').trim()
    || ''
);

const reserveInvoiceNumber = async (year, session) => {
    const highestFattura = await withSession(Fattura.findOne({ anno: year }), session)
        .sort({ numero: -1 })
        .limit(1)
        .select('numero')
        .lean();
    const highestNumber = highestFattura ? numberOrZero(highestFattura.numero) : -1;

    await InvoiceCounter.updateOne(
        { scope: 'fatture', year },
        { $max: { value: highestNumber } },
        { upsert: true, session }
    );

    const counter = await InvoiceCounter.findOneAndUpdate(
        { scope: 'fatture', year },
        { $inc: { value: 1 } },
        {
            new: true,
            session,
            upsert: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return counter.value;
};

const runWithOptionalTransaction = async (operation) => {
    const session = await mongoose.startSession();

    try {
        try {
            let result;
            await session.withTransaction(async () => {
                result = await operation(session);
            });
            return result;
        } catch (error) {
            if (!isTransactionUnsupported(error)) {
                throw error;
            }
            return operation(null);
        }
    } finally {
        await session.endSession();
    }
};

const getPreviousReading = (lettura, session) => {
    const contatoreId = lettura.contatore?._id || lettura.contatore;
    const query = {
        _id: { $ne: lettura._id },
        contatore: contatoreId,
    };
    let sort = { _id: -1 };

    if (lettura.data_lettura) {
        query.data_lettura = { $lt: lettura.data_lettura };
        sort = { data_lettura: -1, _id: -1 };
    }

    return withSession(Lettura.findOne(query), session).sort(sort).lean();
};

const getArticlesByCode = async (session) => {
    const articles = await withSession(Articolo.find({
        codice: { $in: [DEFAULT_WATER_ARTICLE_CODE, DEFAULT_FIXED_ARTICLE_CODE] },
    }), session).lean();

    return articles.reduce((map, article) => ({
        ...map,
        [article.codice]: article,
    }), {});
};

const getLinkedInvoicesForReading = async (letturaId, session) => {
    const services = await withSession(Servizio.find({ lettura: letturaId }), session).populate({
        path: 'fattura',
        populate: 'scadenza',
    }).lean();

    return uniqueById(services.map((service) => service.fattura).filter(Boolean));
};

const loadReading = (id, session) => withSession(Lettura.findById(id), session).populate({
    path: 'contatore',
    populate: ['listino', 'cliente'],
}).lean();

const calculateReadingById = async (letturaId, options = {}) => {
    const { session } = options;
    const lettura = await loadReading(letturaId, session);
    if (!lettura) {
        throw createError('Lettura not found', 404);
    }

    if (!lettura.contatore?.listino) {
        throw createError('La lettura deve avere un contatore con listino associato');
    }

    const previousReading = await getPreviousReading(lettura, session);
    const previousValue = hasValue(options.previousValue)
        ? options.previousValue
        : previousReading?.consumo || 0;
    const currentValue = hasValue(options.currentValue)
        ? options.currentValue
        : lettura.consumo;
    const [fasce, articlesByCode, linkedInvoices] = await Promise.all([
        withSession(Fascia.find({ listino: lettura.contatore.listino._id }), session).lean(),
        getArticlesByCode(session),
        getLinkedInvoicesForReading(lettura._id, session),
    ]);
    const calculation = calculateReadingInvoice({
        articlesByCode,
        contatore: lettura.contatore,
        currentValue,
        fasce,
        lettura,
        previousValue,
    });

    return {
        lettura,
        contatore: lettura.contatore,
        previousReading,
        linkedInvoices,
        ...calculation,
    };
};

const getClienteFromReadings = (readings) => {
    const clientes = uniqueById(readings.map((lettura) => lettura.contatore?.cliente).filter(Boolean));

    if (clientes.length !== 1) {
        throw createError('Le letture selezionate devono appartenere allo stesso cliente');
    }

    return clientes[0];
};

const cleanServiceLine = (line, fatturaId, riga) => ({
    riga,
    descrizione: line.descrizione,
    tipo_tariffa: line.tipo_tariffa,
    tipo_attivita: line.tipo_attivita,
    metri_cubi: line.metri_cubi,
    prezzo: line.prezzo,
    valore_unitario: line.valore_unitario,
    tipo_quota: line.tipo_quota,
    seriale_condominio: line.seriale_condominio,
    lettura_precedente: line.lettura_precedente,
    lettura_fatturazione: line.lettura_fatturazione,
    data_lettura: line.data_lettura,
    descrizione_attivita: line.descrizione_attivita,
    lettura: line.lettura,
    articolo: line.articolo,
    listino: line.listino,
    fascia: line.fascia,
    aliquota_iva: line.aliquota_iva,
    calcolo_snapshot: line.calcolo_snapshot,
    fattura: fatturaId,
});

const toBoolean = (value) => value === true || ['1', 'true', 'yes'].includes(String(value).toLowerCase());
const getInvoiceStatus = (confermata) => (toBoolean(confermata) ? 'confermata' : 'bozza');

const createManualInvoiceInSession = async (input = {}, session) => {
    const invoiceDate = input.data_fattura ? new Date(input.data_fattura) : new Date();
    const year = input.anno || invoiceDate.getFullYear();
    const numero = hasValue(input.numero) ? numberOrZero(input.numero) : await reserveInvoiceNumber(year, session);
    const cliente = input.cliente
        ? await withSession(Cliente.findById(input.cliente), session).lean()
        : null;
    const customerLabel = getCustomerLabel(cliente);
    const confermata = toBoolean(input.confermata);
    const [fattura] = await Fattura.create([{
        ...input,
        tipo_documento: input.tipo_documento || 'Fattura',
        ragione_sociale: input.ragione_sociale || customerLabel,
        confermata,
        stato: input.stato || getInvoiceStatus(confermata),
        origine: input.origine || 'manuale',
        anno: year,
        numero,
        codice: input.codice || `${year}-${String(numero).padStart(4, '0')}`,
        data_fattura: invoiceDate,
        nome_cliente: input.nome_cliente || customerLabel,
        cliente: cliente?._id || input.cliente,
        scadenza: input.scadenza || undefined,
    }], { session });
    const scadenza = await ensureInvoiceDeadline({
        cliente,
        dueDate: input.data_scadenza,
        fattura,
        session,
    });

    return {
        fattura,
        scadenza,
    };
};

const createManualInvoice = (input) => runWithOptionalTransaction((session) => (
    createManualInvoiceInSession(input, session)
));

const createInvoiceFromReadingsInSession = async ({
    confermata = false,
    data_fattura,
    data_scadenza,
    letture,
    tipo_documento = 'Fattura',
}, session) => {
    const letturaIds = [...new Set((letture || []).filter(Boolean).map(String))];
    if (letturaIds.length === 0) {
        throw createError('Seleziona almeno una lettura da fatturare');
    }

    const readings = await Promise.all(letturaIds.map((id) => loadReading(id, session)));
    if (readings.some((lettura) => !lettura)) {
        throw createError('Una o piu letture non esistono', 404);
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

    const cliente = getClienteFromReadings(readings);
    const calculations = await Promise.all(letturaIds.map((id) => calculateReadingById(id, { session })));
    const invoiceDate = data_fattura ? new Date(data_fattura) : new Date();
    const year = invoiceDate.getFullYear();
    const numero = await reserveInvoiceNumber(year, session);
    const allLines = calculations.flatMap((calculation) => calculation.lines);
    if (allLines.length === 0) {
        throw createError('Le letture selezionate non generano righe fatturabili');
    }

    const totals = calculateTotals(allLines);
    if (session) {
        const lockResult = await Lettura.updateMany(
            {
                _id: { $in: letturaIds },
                $or: [{ fatturata: false }, { fatturata: { $exists: false } }],
            },
            { fatturata: true },
            { session }
        );

        if (lockResult.modifiedCount !== letturaIds.length) {
            throw createError('Almeno una lettura selezionata risulta gia fatturata', 409);
        }
    }

    const [fattura] = await Fattura.create([{
        tipo_documento,
        ragione_sociale: getCustomerLabel(cliente),
        confermata: toBoolean(confermata),
        stato: getInvoiceStatus(confermata),
        origine: 'letture',
        anno: year,
        numero,
        codice: `${year}-${String(numero).padStart(4, '0')}`,
        data_fattura: invoiceDate,
        imponibile: totals.imponibile,
        iva: totals.iva,
        totale_fattura: totals.totale_fattura,
        nome_cliente: getCustomerLabel(cliente),
        cliente: cliente._id,
        letture: letturaIds,
    }], { session });
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

    if (!session) {
        await Lettura.updateMany({ _id: { $in: letturaIds } }, { fatturata: true });
    }

    return {
        fattura,
        scadenza,
        servizi: services,
        calculations,
    };
};

const createInvoiceFromReadings = (input) => runWithOptionalTransaction((session) => (
    createInvoiceFromReadingsInSession(input, session)
));

const previewClienteBilling = async (clienteId) => {
    const cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) {
        throw createError('Cliente not found', 404);
    }

    const contatori = await Contatore.find({ cliente: clienteId }).populate('listino cliente').lean();
    const letture = await Lettura.find({
        contatore: { $in: contatori.map((contatore) => contatore._id) },
        $or: [{ fatturata: false }, { fatturata: { $exists: false } }],
    }).sort({ data_lettura: 1, _id: 1 }).lean();
    const previews = [];

    for (const lettura of letture) {
        try {
            previews.push(await calculateReadingById(lettura._id));
        } catch (error) {
            previews.push({ lettura, error: error.message });
        }
    }

    const billablePreviews = previews.filter(isBillablePreview);

    return {
        cliente,
        contatori,
        previews,
        totals: {
            letture: billablePreviews.length,
            imponibile: sumMoneyBy(billablePreviews, (preview) => preview.totals.imponibile),
            iva: sumMoneyBy(billablePreviews, (preview) => preview.totals.iva),
            totale_fattura: sumMoneyBy(billablePreviews, (preview) => preview.totals.totale_fattura),
        },
    };
};

const getOrCreateBillingGroup = (groups, cliente) => {
    const key = String(cliente?._id || '');
    if (!groups.has(key)) {
        groups.set(key, {
            cliente,
            previews: [],
            anomalies: [],
        });
    }
    return groups.get(key);
};

const toBillingGroupSummary = (group) => {
    const billablePreviews = group.previews.filter(isBillablePreview);

    return {
        cliente: group.cliente,
        previews: group.previews,
        anomalies: group.anomalies,
        totals: {
            letture: billablePreviews.length,
            imponibile: sumMoneyBy(billablePreviews, (preview) => preview.totals.imponibile),
            iva: sumMoneyBy(billablePreviews, (preview) => preview.totals.iva),
            totale_fattura: sumMoneyBy(billablePreviews, (preview) => preview.totals.totale_fattura),
        },
    };
};

const previewBillingBatch = async ({ limit = 500 } = {}) => {
    const maxReadings = Math.min(Math.max(Number.parseInt(limit, 10) || 500, 1), 2000);
    const letture = await Lettura.find({
        $or: [{ fatturata: false }, { fatturata: { $exists: false } }],
    })
        .sort({ data_lettura: 1, _id: 1 })
        .limit(maxReadings)
        .populate({
            path: 'contatore',
            populate: ['cliente', 'listino'],
        })
        .lean();
    const groups = new Map();
    const globalAnomalies = [];

    for (const lettura of letture) {
        const cliente = lettura.contatore?.cliente;

        if (!cliente?._id) {
            globalAnomalies.push({
                lettura: lettura._id,
                message: 'Lettura senza cliente collegato al contatore',
            });
            continue;
        }

        const group = getOrCreateBillingGroup(groups, cliente);

        try {
            group.previews.push(await calculateReadingById(lettura._id));
        } catch (error) {
            group.anomalies.push({
                lettura,
                contatore: lettura.contatore,
                message: error.message,
            });
        }
    }

    const clienti = [...groups.values()].map(toBillingGroupSummary);
    const readyGroups = clienti.filter((group) => group.totals.letture > 0);

    return {
        limit: maxReadings,
        scannedReadings: letture.length,
        hasMore: letture.length === maxReadings,
        clienti,
        anomalies: globalAnomalies,
        totals: {
            clienti: readyGroups.length,
            letture: readyGroups.reduce((total, group) => total + group.totals.letture, 0),
            imponibile: sumMoneyBy(readyGroups, (group) => group.totals.imponibile),
            iva: sumMoneyBy(readyGroups, (group) => group.totals.iva),
            totale_fattura: sumMoneyBy(readyGroups, (group) => group.totals.totale_fattura),
            anomalie: globalAnomalies.length + clienti.reduce((total, group) => total + group.anomalies.length, 0),
        },
    };
};

const verifyInvoiceCalculation = async (fatturaId) => {
    const fattura = await Fattura.findById(fatturaId).populate('cliente scadenza').lean();
    if (!fattura) {
        throw createError('Fattura not found', 404);
    }

    const servizi = await Servizio.find({ fattura: fatturaId }).populate('lettura articolo listino fascia').lean();
    const letturaIds = uniqueById(servizi.map((servizio) => servizio.lettura).filter(Boolean)).map((lettura) => lettura._id);
    const calculations = [];

    for (const letturaId of letturaIds) {
        const relatedRows = servizi.filter((servizio) => String(servizio.lettura?._id) === String(letturaId));
        const firstRow = relatedRows[0] || {};
        calculations.push(await calculateReadingById(letturaId, {
            previousValue: firstRow.lettura_precedente,
            currentValue: firstRow.lettura_fatturazione,
        }));
    }

    const storicoImponibile = sumMoneyBy(servizi, (servizio) => servizio.valore_unitario);
    const calcolatoImponibile = sumMoneyBy(calculations, (calculation) => calculation.totals.imponibile);
    const deltaServizi = roundMoney(storicoImponibile - calcolatoImponibile);
    const deltaFattura = roundMoney(numberOrZero(fattura.imponibile) - storicoImponibile);

    return {
        fattura,
        servizi,
        calculations,
        summary: {
            letture: letturaIds.length,
            righe: servizi.length,
            storicoImponibile,
            calcolatoImponibile,
            fatturaImponibile: roundMoney(fattura.imponibile),
            deltaServizi,
            deltaFattura,
            serviziCoerenti: Math.abs(deltaServizi) <= 0.01,
            fatturaCoerente: Math.abs(deltaFattura) <= 0.01,
        },
    };
};

module.exports = {
    calculateReadingById,
    createManualInvoice,
    createInvoiceFromReadings,
    previewBillingBatch,
    previewClienteBilling,
    verifyInvoiceCalculation,
};
