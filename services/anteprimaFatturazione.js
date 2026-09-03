// Cosa si fatturerebbe, se si fatturasse adesso. Nessuna scrittura: si legge
// quali letture sono pronte, si calcola quanto verrebbero, e si raggruppa per
// cliente - un cliente, una fattura.
//
// Serve alla pagina di generazione, che mostra i gruppi prima di crearli, e alla
// scheda del cliente. Sta fuori dalla generazione perche non crea niente: chi
// legge questo file non deve chiedersi se sta anche scrivendo.

const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Lettura = require('../models/Lettura');
const {
    buildAnnualFixedLookupCache,
    createAnnualFixedContext,
} = require('./annualFixedChargeService');
const {
    calculateReadingById,
    getArticlesByCode,
    summarizeBillablePreviews,
} = require('./calcoloLettura');
const { createError } = require('../utils/errors');
const { sumMoneyBy } = require('../utils/values');

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

module.exports = {
    previewBillingBatch,
    previewClienteBilling,
};
