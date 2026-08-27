const Articolo = require('../models/Articolo');
const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fascia = require('../models/Fascia');
const Fattura = require('../models/Fattura');
const InvoiceCounter = require('../models/InvoiceCounter');
const Lettura = require('../models/Lettura');
require('../models/Listino');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');
const {
    annualFixedKey,
    buildAnnualFixedLookupCache,
    createAnnualFixedContext,
    getDate,
    hasAnnualFixedCharge,
    hasPreviousAnnualFixedCharge,
} = require('./annualFixedChargeService');
const { calculateDelay, ensureInvoiceDeadline, syncInvoiceDeadlineTotal } = require('./deadlineService');
const {
    DEFAULT_CONDOMINIUM_ARTICLE_CODE,
    DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
    DEFAULT_DELAY_ARTICLE_CODE,
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
    calculateReadingInvoice,
    calculateTotals,
    getTaxRate,
    numberOrZero,
    recordId,
    roundMoney,
} = require('./billingCalculator');
const { assertInvoiceEditable } = require('./invoiceLockService');
const { INVOICE_SERIES, invoiceCode } = require('../config/invoicing');
const { runWithOptionalTransaction } = require('./transaction');
const { createError } = require('../utils/errors');
const { hasValue, normalizeText, sumMoneyBy } = require('../utils/values');
const { uniqueById, withSession } = require('../utils/mongo');
const { customerLabel } = require('../utils/customer');

const DEFAULT_DELAY_FEE = Number.parseFloat(process.env.INVOICE_DELAY_FEE || '6');
const MONEY_TOLERANCE = 0.01;

const isBillablePreview = (preview) => !preview.error && preview.lines?.length;
const summarizeBillablePreviews = (previews) => {
    const billablePreviews = previews.filter(isBillablePreview);

    return {
        letture: billablePreviews.length,
        imponibile: sumMoneyBy(billablePreviews, (preview) => preview.totals.imponibile),
        iva: sumMoneyBy(billablePreviews, (preview) => preview.totals.iva),
        totale_fattura: sumMoneyBy(billablePreviews, (preview) => preview.totals.totale_fattura),
    };
};
const getCustomerLabel = (cliente) => customerLabel(cliente);

const isCondominiumSplitCounter = (contatore) => {
    const counterType = normalizeText(contatore?.tipo_contatore);
    const activity = normalizeText(contatore?.tipo_attivita);
    const share = numberOrZero(contatore?.consumo);
    const hasSplitShare = share > 0 && Math.abs(share - 100) > 0.001;

    return (
        counterType.includes('condominiale') && (
            counterType.includes('utenze private')
            || counterType.includes('virtuale')
            || counterType.includes('ripartit')
            || hasSplitShare
        )
    ) || (
        activity === 'utenza condominiale' && counterType.includes('ripartit')
    );
};

// Il progressivo si calcola sulla sola serie corrente: prima veniva preso il
// massimo fra tutte le fatture dell'anno, storico compreso, e le fatture nuove
// ereditavano un numero derivato da codici cliente (2761, 2835, ...).
// Su un anno senza documenti il primo numero era inoltre 0, perche il contatore
// parte da -1: ora la prima fattura di una serie e la numero 1.
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

    const counter = await InvoiceCounter.findOneAndUpdate(
        { scope, year },
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
        codice: {
            $in: [
                DEFAULT_WATER_ARTICLE_CODE,
                DEFAULT_FIXED_ARTICLE_CODE,
                DEFAULT_CONDOMINIUM_ARTICLE_CODE,
                DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
                DEFAULT_DELAY_ARTICLE_CODE,
            ],
        },
    }), session).lean();

    return Object.fromEntries(articles.map((article) => [article.codice, article]));
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

const calculateReadings = async (letturaIds, context, options = {}) => {
    const calculations = [];

    for (const id of letturaIds) {
        calculations.push(await calculateReadingById(id, {
            ...context,
            ...options,
        }));
    }

    return calculations;
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

const calculateReadingById = async (letturaId, options = {}) => {
    const { session } = options;
    const lettura = await loadReading(letturaId, session);
    if (!lettura) {
        throw createError('Lettura not found', 404);
    }

    if (!lettura.contatore?.listino) {
        throw createError('La lettura deve avere un contatore con listino associato');
    }

    if (!options.allowCondominiumSplit && isCondominiumSplitCounter(lettura.contatore)) {
        throw createError(
            'Questa lettura usa un riparto condominiale: va calcolata con le quote del contatore condominiale prima di generare la fattura automatica.',
            422
        );
    }

    const previousReading = await getPreviousReading(lettura, session);
    const previousValue = hasValue(options.previousValue)
        ? options.previousValue
        : previousReading?.consumo || 0;
    const currentValue = hasValue(options.currentValue)
        ? options.currentValue
        : lettura.consumo;
    const invoiceDate = getDate(options.invoiceDate || lettura.data_lettura);
    const invoiceYear = options.invoiceYear || invoiceDate.getFullYear();
    const fixedKey = annualFixedKey(invoiceYear, lettura.contatore._id);
    const fixedSkippedByRequest = options.includeFixedCharge === false;
    const fixedAlreadySelected = options.annualFixedKeys?.has(fixedKey) === true;
    const fixedAlreadyBilled = await hasPreviousAnnualFixedCharge({
        beforeDate: invoiceDate,
        cache: options.annualFixedLookupCache,
        contatoreId: lettura.contatore._id,
        excludeInvoiceId: options.excludeInvoiceId,
        session,
        year: invoiceYear,
    });
    const includeFixedCharge = !fixedSkippedByRequest && !fixedAlreadySelected && !fixedAlreadyBilled;
    const [fasce, articlesByCode, linkedInvoices] = await Promise.all([
        withSession(Fascia.find({ listino: lettura.contatore.listino._id }), session).lean(),
        options.articlesByCode || getArticlesByCode(session),
        getLinkedInvoicesForReading(lettura._id, session),
    ]);
    const calculation = calculateReadingInvoice({
        articlesByCode,
        contatore: lettura.contatore,
        currentValue,
        fasce,
        includeFixedCharge,
        lettura,
        previousValue,
    });
    const shouldReserveFixedKey = calculation.lines.some((line) => line.tipo_quota)
        || (
            fixedSkippedByRequest
            && calculation.fixedCharge.available
            && !fixedAlreadyBilled
            && !fixedAlreadySelected
        );

    if (shouldReserveFixedKey) {
        options.annualFixedKeys?.add(fixedKey);
    }

    return {
        lettura,
        contatore: lettura.contatore,
        previousReading,
        linkedInvoices,
        ...calculation,
        fixedCharge: {
            ...calculation.fixedCharge,
            alreadyBilled: fixedAlreadyBilled,
            alreadySelected: fixedAlreadySelected,
            skippedByRequest: fixedSkippedByRequest,
            selected: includeFixedCharge,
        },
        fixedChargeAlreadyBilled: fixedAlreadyBilled || fixedAlreadySelected,
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

const getArticleCode = (line) => line.articolo_dettaglio?.codice || line.articolo?.codice || '';
const sameMoney = (left, right) => Math.abs(roundMoney(left) - roundMoney(right)) <= MONEY_TOLERANCE;
const sameLineText = (left, right) => normalizeText(left || '') === normalizeText(right || '');

const isSameBillingLine = (service, line) => (
    sameLineText(getArticleCode(service), getArticleCode(line))
    && sameLineText(service.tipo_tariffa, line.tipo_tariffa)
    && sameLineText(service.tipo_quota, line.tipo_quota)
    && sameMoney(service.metri_cubi, line.metri_cubi)
    && sameMoney(service.prezzo, line.prezzo)
    && sameMoney(service.valore_unitario, line.valore_unitario)
);

const toLineIssue = (line, lettura) => ({
    articolo: getArticleCode(line),
    tipo_tariffa: line.tipo_tariffa,
    tipo_quota: line.tipo_quota,
    metri_cubi: line.metri_cubi,
    prezzo: line.prezzo,
    valore_unitario: line.valore_unitario,
    lettura: lettura?._id || lettura,
});

const getMissingCalculatedLines = (servizi, calculations) => {
    const missingLines = getMissingCalculatedBillingLines(servizi, calculations);
    return missingLines.map((line) => toLineIssue(line, line.lettura));
};

const getMissingCalculatedBillingLines = (servizi, calculations) => {
    const unusedServices = [...servizi];
    const missingLines = [];

    calculations.forEach((calculation) => {
        calculation.lines.forEach((line) => {
            const matchIndex = unusedServices.findIndex((service) => isSameBillingLine(service, line));

            if (matchIndex === -1) {
                missingLines.push({
                    ...line,
                    lettura: line.lettura || calculation.lettura?._id || calculation.lettura,
                });
                return;
            }

            unusedServices.splice(matchIndex, 1);
        });
    });

    return missingLines;
};

const groupServicesByReading = (servizi) => servizi.reduce((groups, servizio) => {
    const key = recordId(servizio.lettura);
    if (!key) {
        return groups;
    }

    const rows = groups.get(key) || [];
    rows.push(servizio);
    groups.set(key, rows);

    return groups;
}, new Map());

const getInvoiceYear = (fattura) => fattura.anno || getDate(fattura.data_fattura).getFullYear();
const getReadingIdsFromServices = (servizi) => uniqueById(
    servizi.map((servizio) => servizio.lettura).filter(Boolean)
).map((lettura) => lettura._id || lettura);
const getReadingServices = (servizi) => servizi.filter((servizio) => servizio.lettura);
const getExtraServices = (servizi) => servizi.filter((servizio) => !servizio.lettura);
const isFixedChargeLine = (line) => Boolean(line.tipo_quota) || normalizeText(line.tipo_tariffa).includes('fisso');
const getFixedServices = (servizi) => servizi.filter(isFixedChargeLine);
const getFixedLines = (lines) => lines.filter(isFixedChargeLine);
const getServicesTotal = (servizi) => sumMoneyBy(servizi, (servizio) => servizio.valore_unitario);
const getCalculatedTotal = (calculations) => sumMoneyBy(
    calculations,
    (calculation) => calculation.totals.imponibile
);

const calculateInvoiceReadingsFromServices = async ({
    annualFixedLookupCache,
    fattura,
    includeFixedCharge = true,
    servizi,
    session,
}) => {
    const invoiceDate = getDate(fattura.data_fattura);
    const billingContext = createAnnualFixedContext({
        annualFixedLookupCache,
        invoiceDate,
        invoiceYear: getInvoiceYear(fattura),
    });
    const letturaIds = getReadingIdsFromServices(servizi);
    const serviziByReading = groupServicesByReading(servizi);
    const calculations = [];

    for (const letturaId of letturaIds) {
        const [firstRow = {}] = serviziByReading.get(recordId(letturaId)) || [];
        calculations.push(await calculateReadingById(letturaId, {
            allowCondominiumSplit: true,
            excludeInvoiceId: fattura._id,
            includeFixedCharge,
            session,
            ...billingContext,
            previousValue: firstRow.lettura_precedente,
            currentValue: firstRow.lettura_fatturazione,
        }));
    }

    return {
        calculations,
        letturaIds,
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
        serie,
        codice: input.codice || invoiceCode({ anno: year, numero, serie }),
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
            ragione_sociale: getCustomerLabel(cliente),
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
            nome_cliente: getCustomerLabel(cliente),
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

const previewClienteBilling = async (clienteId, { includeFixedCharge = true } = {}) => {
    const cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) {
        throw createError('Cliente not found', 404);
    }

    const contatori = await Contatore.find({ cliente: clienteId }).populate('listino cliente').lean();
    const letture = await Lettura.find({
        contatore: { $in: contatori.map((contatore) => contatore._id) },
        $or: [{ fatturata: false }, { fatturata: { $exists: false } }],
    }).sort({ data_lettura: 1, _id: 1 }).lean();
    // Gli articoli si leggono una volta sola invece che per ogni lettura.
    // Qui non si precarica l'intera cache delle quote fisse annuali: per un solo
    // cliente l'aggregazione completa costerebbe piu di quanto faccia risparmiare,
    // e la cache incrementale per contatore/anno basta.
    const articlesByCode = await getArticlesByCode();
    const billingContext = createAnnualFixedContext();
    const previews = [];

    for (const lettura of letture) {
        try {
            previews.push(await calculateReadingById(lettura._id, {
                ...billingContext,
                articlesByCode,
                includeFixedCharge,
            }));
        } catch (error) {
            previews.push({ lettura, error: error.message });
        }
    }

    return {
        cliente,
        contatori,
        previews,
        totals: summarizeBillablePreviews(previews),
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
    return {
        cliente: group.cliente,
        previews: group.previews,
        anomalies: group.anomalies,
        totals: summarizeBillablePreviews(group.previews),
    };
};

const previewBillingBatch = async ({ includeFixedCharge = true, limit = 500 } = {}) => {
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
    const [articlesByCode, annualFixedLookupCache] = await Promise.all([
        getArticlesByCode(),
        buildAnnualFixedLookupCache(),
    ]);
    const groups = new Map();
    const globalAnomalies = [];
    const billingContext = createAnnualFixedContext({ annualFixedLookupCache });

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
            group.previews.push(await calculateReadingById(lettura._id, {
                ...billingContext,
                articlesByCode,
                includeFixedCharge,
            }));
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

const getFixedChargeBlockReason = async ({
    annualFixedLookupCache,
    calculations,
    excludeInvoiceId,
    fattura,
    session,
}) => {
    if (fattura.scadenza?.saldo) {
        return 'La fattura risulta pagata: non modificare righe e totale.';
    }

    for (const calculation of calculations) {
        if (!calculation.fixedCharge?.available) {
            continue;
        }

        const alreadyBilled = await hasAnnualFixedCharge({
            cache: annualFixedLookupCache,
            contatoreId: calculation.contatore?._id,
            excludeInvoiceId,
            session,
            year: getInvoiceYear(fattura),
        });

        if (alreadyBilled) {
            return 'La quota fissa risulta gia applicata a una fattura dello stesso anno.';
        }
    }

    return '';
};

const recalculateInvoiceTotals = async ({ fattura, lines, session }) => {
    const totals = calculateTotals(lines);

    Object.assign(fattura, totals);
    await Fattura.updateOne(
        { _id: fattura._id },
        { $set: totals },
        { session }
    );
    await syncInvoiceDeadlineTotal({ fattura, session });

    return totals;
};

const applyFixedChargeToInvoiceInSession = async (fatturaId, session, unlock) => {
    const fattura = await withSession(Fattura.findById(fatturaId).populate('cliente scadenza'), session);
    if (!fattura) {
        throw createError('Fattura not found', 404);
    }
    assertInvoiceEditable(fattura, 'aggiungere la quota fissa', unlock);

    const servizi = await withSession(
        Servizio.find({ fattura: fatturaId }).populate('lettura articolo listino fascia'),
        session
    ).lean();
    const serviziLettura = getReadingServices(servizi);
    const serviziFisso = getFixedServices(serviziLettura);

    if (serviziFisso.length > 0) {
        throw createError('La quota fissa e gia presente in questa fattura', 409);
    }

    const letturaIds = getReadingIdsFromServices(serviziLettura);
    if (letturaIds.length === 0) {
        throw createError('La fattura non ha letture collegate a cui applicare la quota fissa', 422);
    }

    const { calculations } = await calculateInvoiceReadingsFromServices({
        fattura,
        includeFixedCharge: true,
        servizi,
        session,
    });

    const blockReason = await getFixedChargeBlockReason({
        calculations,
        excludeInvoiceId: fattura._id,
        fattura,
        session,
    });
    if (blockReason) {
        throw createError(blockReason, 409);
    }

    const fixedLines = getFixedLines(getMissingCalculatedBillingLines(servizi, calculations));
    if (fixedLines.length === 0) {
        throw createError('Nessuna quota fissa applicabile con il listino corrente', 422);
    }

    const firstNewRow = Math.max(0, ...servizi.map((servizio) => numberOrZero(servizio.riga))) + 1;
    const createdServices = await Servizio.insertMany(
        fixedLines.map((line, index) => cleanServiceLine(line, fattura._id, firstNewRow + index)),
        { session }
    );
    const totals = await recalculateInvoiceTotals({
        fattura,
        lines: [...servizi, ...fixedLines],
        session,
    });

    return {
        fattura,
        servizi: createdServices,
        totals,
    };
};

const applyFixedChargeToInvoice = (fatturaId, unlock) => runWithOptionalTransaction((session) => (
    applyFixedChargeToInvoiceInSession(fatturaId, session, unlock)
));

const verifyInvoiceCalculation = async (fatturaId, options = {}) => {
    const fattura = await Fattura.findById(fatturaId).populate('cliente scadenza').lean();
    if (!fattura) {
        throw createError('Fattura not found', 404);
    }

    const servizi = await Servizio.find({ fattura: fatturaId }).populate('lettura articolo listino fascia').lean();
    const { calculations, letturaIds } = await calculateInvoiceReadingsFromServices({
        annualFixedLookupCache: options.annualFixedLookupCache,
        fattura,
        servizi,
    });

    const serviziLettura = getReadingServices(servizi);
    const serviziExtra = getExtraServices(servizi);
    const serviziFisso = getFixedServices(serviziLettura);
    const storicoImponibile = getServicesTotal(servizi);
    const lettureImponibile = getServicesTotal(serviziLettura);
    const extraImponibile = getServicesTotal(serviziExtra);
    const quotaFissaImponibile = getServicesTotal(serviziFisso);
    const calcolatoImponibile = getCalculatedTotal(calculations);
    const deltaLetture = roundMoney(lettureImponibile - calcolatoImponibile);
    const deltaServizi = roundMoney(storicoImponibile - calcolatoImponibile);
    const deltaFattura = roundMoney(numberOrZero(fattura.imponibile) - storicoImponibile);
    const missingLines = getMissingCalculatedLines(servizi, calculations);
    const missingFixedTotal = sumMoneyBy(
        missingLines.filter((line) => line.tipo_quota),
        (line) => line.valore_unitario
    );
    const fixedChargeBlockReason = serviziFisso.length > 0
        ? 'La quota fissa e gia presente in questa fattura.'
        : await getFixedChargeBlockReason({
            annualFixedLookupCache: options.annualFixedLookupCache,
            calculations,
            excludeInvoiceId: fattura._id,
            fattura,
        });
    const fixedChargeMissing = missingFixedTotal > MONEY_TOLERANCE;

    return {
        fattura,
        servizi,
        calculations,
        missingLines,
        summary: {
            letture: letturaIds.length,
            righe: servizi.length,
            righeCalcolate: calculations.reduce((total, calculation) => total + calculation.lines.length, 0),
            righeCalcolateMancanti: missingLines.length,
            quotaFissaPresente: serviziFisso.length > 0,
            quotaFissaImponibile,
            quotaFissaApplicabile: serviziFisso.length === 0 && fixedChargeMissing && !fixedChargeBlockReason,
            quotaFissaBlocco: fixedChargeBlockReason || (fixedChargeMissing ? '' : 'Nessuna quota fissa applicabile con il listino corrente.'),
            quotaFissaMancante: missingFixedTotal,
            storicoImponibile,
            lettureImponibile,
            extraImponibile,
            calcolatoImponibile,
            fatturaImponibile: roundMoney(fattura.imponibile),
            deltaLetture,
            deltaServizi,
            deltaFattura,
            serviziCoerenti: Math.abs(deltaLetture) <= MONEY_TOLERANCE,
            fatturaCoerente: Math.abs(deltaFattura) <= MONEY_TOLERANCE,
        },
    };
};

module.exports = {
    getReadingIdsFromServices,
    applyFixedChargeToInvoice,
    calculateReadingById,
    createManualInvoice,
    createInvoiceFromReadings,
    previewBillingBatch,
    previewClienteBilling,
    verifyInvoiceCalculation,
};
