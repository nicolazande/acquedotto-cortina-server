// Quanto costa una lettura: si prende l'indice precedente, si applicano le fasce
// del listino e la quota fissa dovuta, e ne esce l'elenco delle righe con i loro
// importi. Non scrive niente: e il calcolo, e basta.
//
// Sta in un modulo suo perche lo usano tutti - la creazione delle fatture, le
// anteprime, la verifica di una fattura gia emessa - e perche e la parte che si
// vuole poter leggere senza attraversare la generazione dei documenti.

const Articolo = require('../models/Articolo');
const Fascia = require('../models/Fascia');
const Lettura = require('../models/Lettura');
const Servizio = require('../models/Servizio');
const {
    annualFixedKey,
    getDate,
    hasPreviousAnnualFixedCharge,
} = require('./annualFixedChargeService');
const {
    DEFAULT_CONDOMINIUM_ARTICLE_CODE,
    DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
    DEFAULT_DELAY_ARTICLE_CODE,
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
    calculateReadingInvoice,
    numberOrZero,
} = require('./billingCalculator');
const { createError } = require('../utils/errors');
const { hasValue, normalizeText, sumMoneyBy } = require('../utils/values');
const { uniqueById, withSession } = require('../utils/mongo');

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

module.exports = {
    calculateReadingById,
    calculateReadings,
    getArticlesByCode,
    loadReading,
    summarizeBillablePreviews,
};
