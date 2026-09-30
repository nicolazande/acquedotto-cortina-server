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
const { eRigaDiQuotaFissa } = require('./billingCalculator');
const { righeConOrigine } = require('./righeFattura');
const { stessoImporto } = require('../utils/money');
const { createError, notFound } = require('../utils/errors');
const { numberOrZero, roundMoney, sumMoneyBy } = require('../utils/values');
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

// I problemi di calcolo di una fattura, dal piu grave. Il totale contro le righe
// vale per qualunque fattura: e aritmetica, e un totale che le righe non
// giustificano e il documento che lo SdI rifiuta. Quota fissa e listino solo
// dove c'e una lettura, e contano solo le righe delle letture: la mora o una
// riga scritta a mano non vengono dal listino. E una regola sola per la pagina
// Controlli, che ne fa le sue segnalazioni, e per la scheda della fattura, che
// mostra la prima: la scheda prima rifaceva il conto a modo suo, e ogni fattura
// con la mora risultava "conguaglio" li e pulita nei controlli.
const problemiDelCalcolo = (summary) => [
    !summary.fatturaCoerente && {
        tipo: 'totale',
        gravita: 'danger',
        contatore: 'scostamentoFattura',
        messaggio: 'Totale fattura diverso dalle righe servizio',
        spiegazione: 'Il totale salvato non coincide con le righe: va corretto prima di inviare o ristampare, lo SdI rifiuterebbe il file.',
        delta: summary.deltaFattura,
    },
    summary.letture > 0 && summary.quotaFissaApplicabile && {
        tipo: 'quota-fissa',
        gravita: 'warning',
        contatore: 'quotaFissaApplicabile',
        messaggio: 'Quota fissa applicabile non presente',
        spiegazione: 'La quota fissa annuale si può applicare ma la fattura non la contiene: si aggiunge dalla casella qui sotto.',
        delta: summary.quotaFissaMancante,
    },
    summary.letture > 0 && !summary.serviziCoerenti && {
        tipo: 'listino',
        gravita: 'info',
        contatore: 'scostamentoListino',
        messaggio: 'Righe salvate diverse dalla stima listino',
        spiegazione: 'Le righe delle letture non tornano con il listino: una tariffa storica, o una correzione fatta a mano.',
        delta: summary.deltaLetture,
    },
].filter(Boolean);

const ESITO_COERENTE = {
    tipo: 'coerente',
    gravita: 'ok',
    messaggio: 'Coerente',
    spiegazione: 'La fattura salvata coincide con il calcolo: le righe delle letture tornano con il listino.',
    delta: 0,
};

// `options.fattura` e la fattura gia letta, con cliente e scadenza: i controlli
// ne verificano centinaia e le hanno gia in mano. `annualFixedLookupCache` e
// `fascePerListino` sono le memorie del giro (services/calcoloLettura.js).
const verifyInvoiceCalculation = async (fatturaId, options = {}) => {
    const fattura = options.fattura || await Fattura.findById(fatturaId).populate('cliente scadenza').lean();
    if (!fattura) {
        throw notFound('Fattura non trovata.');
    }

    const servizi = await righeConOrigine(fatturaId);
    const { calculations, letturaIds } = await calculateInvoiceReadingsFromServices({
        annualFixedLookupCache: options.annualFixedLookupCache,
        fascePerListino: options.fascePerListino,
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
        missingLines.filter(eRigaDiQuotaFissa),
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
    const fixedChargeMissing = missingFixedTotal > 0 && !stessoImporto(missingFixedTotal, 0);

    const summary = {
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
        serviziCoerenti: stessoImporto(deltaLetture, 0),
        fatturaCoerente: stessoImporto(deltaFattura, 0),
    };

    return {
        fattura,
        servizi,
        calculations,
        missingLines,
        // L'esito e il problema piu grave, o "coerente".
        summary: { ...summary, esito: problemiDelCalcolo(summary)[0] || ESITO_COERENTE },
    };
};

module.exports = {
    ESITO_COERENTE,
    applyFixedChargeToInvoice,
    problemiDelCalcolo,
    verifyInvoiceCalculation,
};
