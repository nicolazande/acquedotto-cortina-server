// Verifica dove la quota fissa annuale e applicabile, gia applicata o mancante.
//
// E un rapporto, non un test: stampa cio che trova e non fa fallire nulla.
const { runScript } = require('./utils/runScript');
const Fattura = require('../models/Fattura');
require('../models/Articolo');
require('../models/Cliente');
require('../models/Contatore');
require('../models/Fascia');
require('../models/Lettura');
require('../models/Listino');
require('../models/Scadenza');
require('../models/Servizio');

const { buildAnnualFixedLookupCache } = require('../services/annualFixedChargeService');
const { roundMoney } = require('../services/billingCalculator');
const { verifyInvoiceCalculation } = require('../services/invoiceGenerator');

const TOLERANCE = 0.01;

const parseArgs = () => {
    const yearIndex = process.argv.indexOf('--year');

    return {
        strict: process.argv.includes('--strict'),
        verbose: process.argv.includes('--verbose'),
        year: yearIndex === -1 ? null : Number(process.argv[yearIndex + 1]),
    };
};

const isNonZero = (value) => Math.abs(roundMoney(value)) > TOLERANCE;

const createStats = () => ({
    checked: 0,
    errors: [],
    extraLines: 0,
    fixedApplicable: [],
    fixedBlocked: 0,
    fixedMissing: 0,
    fixedPresent: 0,
    noReadings: 0,
    total: 0,
});

const invoiceLabel = (verification) => ({
    fattura: verification.fattura._id,
    anno: verification.fattura.anno,
    numero: verification.fattura.numero,
    codice: verification.fattura.codice,
    cliente: verification.fattura.ragione_sociale || verification.fattura.nome_cliente,
    conguagli: verification.summary.extraImponibile,
    fissoMancante: verification.summary.quotaFissaMancante,
    blocco: verification.summary.quotaFissaBlocco,
});

const main = async () => {
    const args = parseArgs();

    const query = args.year ? { anno: args.year } : {};
    const fatture = await Fattura.find(query)
        .sort({ anno: 1, numero: 1, _id: 1 })
        .select('_id anno numero codice')
        .lean();
    const annualFixedLookupCache = await buildAnnualFixedLookupCache();
    const stats = createStats();
    stats.total = fatture.length;

    for (const fattura of fatture) {
        try {
            const verification = await verifyInvoiceCalculation(fattura._id, { annualFixedLookupCache });
            const { summary } = verification;

            if (summary.letture === 0) {
                stats.noReadings += 1;
                continue;
            }

            stats.checked += 1;
            if (summary.quotaFissaPresente) {
                stats.fixedPresent += 1;
            }
            if (isNonZero(summary.extraImponibile)) {
                stats.extraLines += 1;
            }
            if (isNonZero(summary.quotaFissaMancante)) {
                stats.fixedMissing += 1;
            }
            if (summary.quotaFissaApplicabile) {
                stats.fixedApplicable.push(invoiceLabel(verification));
            } else if (isNonZero(summary.quotaFissaMancante)) {
                stats.fixedBlocked += 1;
            }
        } catch (error) {
            stats.errors.push({
                fattura: fattura._id,
                anno: fattura.anno,
                numero: fattura.numero,
                message: error.message,
            });
        }
    }

    console.log('Verifica azione quota fissa');
    console.log(`Fatture lette: ${stats.total}`);
    console.log(`Fatture con letture verificate: ${stats.checked}`);
    console.log(`Fatture senza letture collegate: ${stats.noReadings}`);
    console.log(`Fatture con quota fissa salvata: ${stats.fixedPresent}`);
    console.log(`Fatture dove il listino corrente calcola una quota fissa diversa/mancante: ${stats.fixedMissing}`);
    console.log(`Fatture con quota fissa aggiungibile da UI: ${stats.fixedApplicable.length}`);
    console.log(`Fatture con quota fissa diversa/mancante ma non aggiungibile: ${stats.fixedBlocked}`);
    console.log(`Fatture con righe extra/conguagli: ${stats.extraLines}`);
    console.log(`Errori verifica: ${stats.errors.length}`);

    if (stats.fixedApplicable.length > 0) {
        console.log('\nEsempi quota fissa aggiungibile:');
        console.log(JSON.stringify(stats.fixedApplicable.slice(0, args.verbose ? 50 : 10), null, 2));
    }

    if (stats.errors.length > 0) {
        console.log('\nEsempi errori:');
        console.log(JSON.stringify(stats.errors.slice(0, args.verbose ? 50 : 10), null, 2));
    }

    // Restituire false segnala l'esito negativo: disconnessione e codice
    // di uscita sono compito di runScript.
    return !(args.strict && stats.errors.length > 0);
};

runScript(main);
