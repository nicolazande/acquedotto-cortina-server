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
    CODICI_ARTICOLO_DEL_CALCOLO,
    calculateReadingInvoice,
    numberOrZero,
} = require('./billingCalculator');
const { createError, notFound } = require('../utils/errors');
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
        codice: { $in: CODICI_ARTICOLO_DEL_CALCOLO },
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

// Una lettura come la vuole il calcolo: con il contatore, e del contatore il
// listino e il cliente.
const CON_CONTATORE = { path: 'contatore', populate: ['listino', 'cliente'] };

const loadReading = (id, session) => withSession(Lettura.findById(id), session).populate(CON_CONTATORE).lean();

// Piu letture con una lettura sola del database, nell'ordine chiesto. Quelle che
// non esistono mancano: chi chiama confronta le quantita.
const loadReadings = async (ids, session) => {
    const letture = await withSession(Lettura.find({ _id: { $in: ids } }), session).populate(CON_CONTATORE).lean();
    const perId = new Map(letture.map((lettura) => [String(lettura._id), lettura]));
    return ids.map((id) => perId.get(String(id))).filter(Boolean);
};

// Le fasce di un listino, lette una volta sola per giro: in un'anteprima o nei
// controlli centinaia di letture condividono pochi listini. `fascePerListino` e
// la memoria del giro; senza, si leggono ogni volta.
const fasceDelListino = async (listinoId, { fascePerListino, session }) => {
    const chiave = String(listinoId);
    if (fascePerListino?.has(chiave)) {
        return fascePerListino.get(chiave);
    }

    const fasce = await withSession(Fascia.find({ listino: listinoId }), session).lean();
    fascePerListino?.set(chiave, fasce);
    return fasce;
};

// Il calcolo di una lettura gia caricata (CON_CONTATORE). Le letture al database
// si fanno una dopo l'altra: dentro una transazione due operazioni insieme sulla
// stessa sessione non sono ammesse. Le fatture gia collegate alla lettura si
// cercano solo se chieste (`conFattureCollegate`): servono alla scheda della
// lettura, non a chi fattura o controlla centinaia di letture.
const calcolaLettura = async (lettura, options = {}) => {
    const { session } = options;

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
    const fasce = await fasceDelListino(lettura.contatore.listino._id, options);
    const articlesByCode = options.articlesByCode || await getArticlesByCode(session);
    const linkedInvoices = options.conFattureCollegate ? await getLinkedInvoicesForReading(lettura._id, session) : [];
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

const calculateReadingById = async (letturaId, options = {}) => {
    const lettura = await loadReading(letturaId, options.session);
    if (!lettura) {
        throw notFound('Lettura non trovata.');
    }

    return calcolaLettura(lettura, options);
};

module.exports = {
    CON_CONTATORE,
    calcolaLettura,
    calculateReadingById,
    getArticlesByCode,
    loadReadings,
    summarizeBillablePreviews,
};
