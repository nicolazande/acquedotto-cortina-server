// Le righe che una fattura ha, contro quelle che il calcolo dice che dovrebbe
// avere. Da qui esce la risposta a "questa fattura torna?": quali righe mancano,
// quali sono di troppo, quanto vale la differenza.
//
// Confrontare due righe non e ovvio - stesso articolo, stessa descrizione a meno
// di spazi e maiuscole, stesso importo a meno di un centesimo - e la regola deve
// essere una sola: la usano la verifica di una fattura, l'aggiunta della quota
// fissa e la generazione, e se dicessero cose diverse una fattura risulterebbe
// sbagliata a seconda di chi la guarda.

const {
    createAnnualFixedContext,
    getDate,
} = require('./annualFixedChargeService');
const {
    recordId,
    roundMoney,
} = require('./billingCalculator');
const {
    calculateReadingById,
} = require('./calcoloLettura');
const { normalizeText, sumMoneyBy } = require('../utils/values');
const { uniqueById } = require('../utils/mongo');
const { MONEY_TOLERANCE } = require('../utils/money');

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

const getMissingCalculatedLines = (servizi, calculations) => {
    const missingLines = getMissingCalculatedBillingLines(servizi, calculations);
    return missingLines.map((line) => toLineIssue(line, line.lettura));
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

module.exports = {
    calculateInvoiceReadingsFromServices,
    cleanServiceLine,
    getCalculatedTotal,
    getExtraServices,
    getFixedLines,
    getFixedServices,
    getInvoiceYear,
    getMissingCalculatedBillingLines,
    getMissingCalculatedLines,
    getReadingIdsFromServices,
    getReadingServices,
    getServicesTotal,
};
