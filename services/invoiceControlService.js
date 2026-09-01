const Fattura = require('../models/Fattura');
const { buildAnnualFixedLookupCache } = require('./annualFixedChargeService');
const { isConfirmedInvoice } = require('./invoiceLockService');
const { verifyInvoiceCalculation } = require('./invoiceGenerator');
const { customerLabel } = require('../utils/customer');

const MONEY_TOLERANCE = 0.01;
const isNonZero = (value) => Math.abs(Number(value) || 0) > MONEY_TOLERANCE;

const getControlsQuery = ({ limit, year } = {}) => ({
    limit: Math.min(Number(limit) || 150, 500),
    query: Number.isFinite(Number(year)) ? { anno: Number(year) } : {},
    year: Number.isFinite(Number(year)) ? Number(year) : null,
});

const createSummary = (year) => ({
    anno: year,
    controllate: 0,
    confermate: 0,
    bozze: 0,
    senzaCliente: 0,
    senzaScadenza: 0,
    scostamentoFattura: 0,
    scostamentoListino: 0,
    quotaFissaApplicabile: 0,
    erroriCalcolo: 0,
});

const getCustomerLabel = (fattura) => customerLabel(fattura.cliente, fattura) || undefined;

const createIssue = (fattura, type, severity, message, extra = {}) => ({
    _id: `${fattura._id}-${type}`,
    fatturaId: fattura._id,
    type,
    severity,
    message,
    anno: fattura.anno,
    numero: fattura.numero,
    data_fattura: fattura.data_fattura,
    cliente: fattura.cliente,
    clienteLabel: getCustomerLabel(fattura),
    imponibile: fattura.imponibile,
    totale_fattura: fattura.totale_fattura,
    confermata: fattura.confermata,
    stato: fattura.stato,
    ...extra,
});

const inspectInvoice = async (fattura, annualFixedLookupCache) => {
    const issues = [];
    const counters = createSummary(null);

    if (isConfirmedInvoice(fattura)) counters.confermate = 1;
    else counters.bozze = 1;

    if (!fattura.cliente) {
        counters.senzaCliente = 1;
        issues.push(createIssue(fattura, 'cliente', 'danger', 'Cliente mancante'));
    }

    if (!fattura.scadenza) {
        counters.senzaScadenza = 1;
        issues.push(createIssue(fattura, 'scadenza', 'warning', 'Scadenza mancante'));
    }

    try {
        const verification = await verifyInvoiceCalculation(fattura._id, { annualFixedLookupCache });
        const calculation = verification.summary;

        // Che il totale corrisponda alle righe vale per qualunque fattura: e
        // aritmetica, non tariffa. Era chiesto solo a quelle nate da letture, e
        // cosi una fattura scritta a mano poteva portare un totale che le sue
        // stesse righe non giustificano senza che nessuno lo dicesse - ed e
        // esattamente il documento che lo SdI rifiuta.
        if (!calculation.fatturaCoerente) {
            counters.scostamentoFattura = 1;
            issues.push(createIssue(fattura, 'totale', 'danger', 'Totale fattura diverso dalle righe servizio', {
                delta: calculation.deltaFattura,
            }));
        }

        // I due controlli che seguono confrontano le righe con il listino, e un
        // listino c'e solo dove c'e una lettura: su una fattura scritta a mano -
        // un rimborso, la vendita di un contatore - non avrebbero senso, e
        // chiederli produrrebbe allarmi che non si possono risolvere.
        if (calculation.letture > 0 && calculation.quotaFissaApplicabile) {
            counters.quotaFissaApplicabile = 1;
            issues.push(createIssue(fattura, 'quota-fissa', 'warning', 'Quota fissa applicabile non presente', {
                delta: calculation.quotaFissaMancante,
            }));
        }

        if (calculation.letture > 0 && isNonZero(calculation.deltaServizi)) {
            counters.scostamentoListino = 1;
            issues.push(createIssue(fattura, 'listino', 'info', 'Righe salvate diverse dalla stima listino', {
                delta: calculation.deltaServizi,
            }));
        }
    } catch (error) {
        counters.erroriCalcolo = 1;
        issues.push(createIssue(fattura, 'calcolo', 'danger', error.message || 'Calcolo non verificabile'));
    }

    return { counters, issues };
};

const addCounters = (target, source) => {
    Object.keys(target).forEach((key) => {
        if (typeof target[key] === 'number' && key !== 'anno') {
            target[key] += source[key] || 0;
        }
    });
};

const getInvoiceControlDashboard = async (options = {}) => {
    const { limit, query, year } = getControlsQuery(options);
    const fatture = await Fattura.find(query)
        .sort({ data_fattura: -1, numero: -1, _id: -1 })
        .limit(limit)
        .populate('cliente scadenza')
        .lean();
    const annualFixedLookupCache = await buildAnnualFixedLookupCache();
    const summary = createSummary(year);
    const issues = [];
    summary.controllate = fatture.length;

    for (const fattura of fatture) {
        const result = await inspectInvoice(fattura, annualFixedLookupCache);
        addCounters(summary, result.counters);
        issues.push(...result.issues);
    }

    return {
        issues: issues.slice(0, limit),
        summary,
    };
};

module.exports = {
    getInvoiceControlDashboard,
};
