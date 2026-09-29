// "Questa fattura torna?" e "aggiungici la quota fissa che manca".
//
// Due cose che stanno insieme perche guardano lo stesso scarto: la verifica lo
// racconta, la quota fissa ne chiude una parte. Entrambe leggono le righe salvate
// e le confrontano con il calcolo (`confrontoRighe`), e nessuna delle due crea
// documenti: l'aggiunta di una riga passa dal generatore, che resta l'unico a
// scrivere fatture e a rifarne i totali.

const Fattura = require('../models/Fattura');
const Servizio = require('../models/Servizio');
const {
    hasAnnualFixedCharge,
} = require('./annualFixedChargeService');
const {
    numberOrZero,
    roundMoney,
} = require('./billingCalculator');
const {
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
} = require('./confrontoRighe');
const { assertInvoiceEditable } = require('./invoiceLockService');
const { runWithOptionalTransaction } = require('./transaction');
const { righeConOrigine } = require('./righeFattura');
const { MONEY_TOLERANCE } = require('../utils/money');
const { createError, notFound } = require('../utils/errors');
const { sumMoneyBy } = require('../utils/values');
const { withSession } = require('../utils/mongo');
const { ricalcolaTotaliFattura } = require('./invoiceGenerator');

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

const applyFixedChargeToInvoiceInSession = async (fatturaId, session, unlock) => {
    const fattura = await withSession(Fattura.findById(fatturaId).populate('cliente scadenza'), session);
    if (!fattura) {
        throw notFound('Fattura non trovata.');
    }
    assertInvoiceEditable(fattura, 'aggiungere la quota fissa', unlock);

    const servizi = await righeConOrigine(fatturaId, session);
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
    // Le righe sono gia scritte: i totali si rifanno da quelle, con l'unica
    // funzione che lo sa fare.
    const totals = await ricalcolaTotaliFattura(fattura._id, session);
    Object.assign(fattura, totals);

    return {
        fattura,
        servizi: createdServices,
        totals,
    };
};

const applyFixedChargeToInvoice = (fatturaId, unlock) => runWithOptionalTransaction((session) => (
    applyFixedChargeToInvoiceInSession(fatturaId, session, unlock)
));

// `options.fattura` e la fattura gia letta, con cliente e scadenza: i controlli
// ne verificano centinaia e le hanno gia in mano.
const verifyInvoiceCalculation = async (fatturaId, options = {}) => {
    const fattura = options.fattura || await Fattura.findById(fatturaId).populate('cliente scadenza').lean();
    if (!fattura) {
        throw notFound('Fattura non trovata.');
    }

    const servizi = await righeConOrigine(fatturaId);
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
            deltaFattura,
            serviziCoerenti: Math.abs(deltaLetture) <= MONEY_TOLERANCE,
            fatturaCoerente: Math.abs(deltaFattura) <= MONEY_TOLERANCE,
        },
    };
};

module.exports = {
    applyFixedChargeToInvoice,
    verifyInvoiceCalculation,
};
