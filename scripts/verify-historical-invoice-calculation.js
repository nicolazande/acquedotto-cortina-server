const { runScript } = require('./utils/runScript');
const mongoose = require('mongoose');
const Fattura = require('../models/Fattura');
require('../models/Articolo');
require('../models/Cliente');
require('../models/Contatore');
require('../models/Fascia');
require('../models/Lettura');
require('../models/Listino');
require('../models/Servizio');

const { buildAnnualFixedLookupCache } = require('../services/annualFixedChargeService');
const { verifyInvoiceCalculation } = require('../services/invoiceGenerator');
const { roundMoney } = require('../services/billingCalculator');

const parseArgs = () => {
    const limitIndex = process.argv.indexOf('--limit');
    const yearIndex = process.argv.indexOf('--year');

    return {
        limit: limitIndex === -1 ? null : Number(process.argv[limitIndex + 1]),
        strict: process.argv.includes('--strict')
            || ['1', 'true', 'yes'].includes(String(process.env.HISTORICAL_BILLING_STRICT).toLowerCase()),
        verbose: process.argv.includes('--verbose'),
        year: yearIndex === -1 ? null : Number(process.argv[yearIndex + 1]),
    };
};

const percent = (value, total) => (
    total ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'
);

const createBucket = () => ({
    checked: 0,
    errors: 0,
    extraServiceInvoices: 0,
    matched: 0,
    mismatches: 0,
    noReadings: 0,
    total: 0,
});

const getBucket = (map, key) => {
    if (!map.has(key)) {
        map.set(key, createBucket());
    }
    return map.get(key);
};

const getMismatchKind = (verification) => {
    const missingFixedTotal = roundMoney(verification.summary.quotaFissaMancante);
    const deltaLettureFisso = verification.summary.deltaLetture;

    if (missingFixedTotal > 0 && Math.abs(roundMoney(deltaLettureFisso + missingFixedTotal)) <= 0.01) {
        return 'quota fissa non presente nella fattura storica';
    }

    if (verification.missingLines.some((line) => line.tipo_quota)) {
        return 'quota fissa diversa dal listino';
    }

    return 'consumi/fasce diversi dal listino';
};

const summarizeMismatch = (verification) => ({
    fattura: verification.fattura._id,
    anno: verification.fattura.anno,
    numero: verification.fattura.numero,
    codice: verification.fattura.codice,
    cliente: verification.fattura.ragione_sociale || verification.fattura.nome_cliente,
    motivo: getMismatchKind(verification),
    imponibileFattura: verification.summary.fatturaImponibile,
    imponibileRigheLettura: verification.summary.lettureImponibile,
    imponibileListino: verification.summary.calcolatoImponibile,
    delta: verification.summary.deltaLetture,
    righeExtraNonLettura: verification.summary.extraImponibile,
    righeFattura: verification.summary.righe,
    righeListino: verification.summary.righeCalcolate,
});

const main = async () => {
    const args = parseArgs();

    const query = args.year ? { anno: args.year } : {};
    const fatture = await Fattura.find(query)
        .sort({ anno: 1, numero: 1, _id: 1 })
        .select('_id anno numero codice')
        .limit(args.limit || 0)
        .lean();
    const stats = {
        checked: 0,
        errors: [],
        extraServiceInvoices: 0,
        matched: 0,
        mismatches: [],
        noReadings: 0,
        total: fatture.length,
    };
    const byYear = new Map();
    const annualFixedLookupCache = await buildAnnualFixedLookupCache();

    for (const fattura of fatture) {
        const yearBucket = getBucket(byYear, String(fattura.anno || 'senza anno'));
        yearBucket.total += 1;

        try {
            const verification = await verifyInvoiceCalculation(fattura._id, { annualFixedLookupCache });

            if (verification.summary.letture === 0) {
                stats.noReadings += 1;
                yearBucket.noReadings += 1;
                continue;
            }

            stats.checked += 1;
            yearBucket.checked += 1;
            if (Math.abs(verification.summary.extraImponibile) > 0.01) {
                stats.extraServiceInvoices += 1;
                yearBucket.extraServiceInvoices += 1;
            }

            const readingDelta = verification.summary.deltaLetture;

            if (Math.abs(readingDelta) <= 0.01) {
                stats.matched += 1;
                yearBucket.matched += 1;
            } else {
                stats.mismatches.push(summarizeMismatch(verification));
                yearBucket.mismatches += 1;
            }
        } catch (error) {
            stats.errors.push({
                fattura: fattura._id,
                anno: fattura.anno,
                numero: fattura.numero,
                message: error.message,
            });
            yearBucket.errors += 1;
        }
    }

    const mismatchByKind = stats.mismatches.reduce((map, item) => ({
        ...map,
        [item.motivo]: (map[item.motivo] || 0) + 1,
    }), {});

    console.log('Verifica fatture storiche vs letture + listino + fisso corrente');
    console.log(`Fatture lette: ${stats.total}`);
    console.log(`Fatture con letture verificate: ${stats.checked}`);
    console.log(`Fatture senza letture collegate: ${stats.noReadings}`);
    console.log(`Fatture con letture + fisso combacianti: ${stats.matched}/${stats.checked} (${percent(stats.matched, stats.checked)})`);
    console.log(`Fatture non combacianti: ${stats.mismatches.length}`);
    console.log(`Fatture con righe extra non lettura: ${stats.extraServiceInvoices}`);
    console.log(`Errori verifica: ${stats.errors.length}`);

    console.log('\nRiepilogo per anno:');
    [...byYear.entries()]
        .sort(([left], [right]) => Number(left) - Number(right))
        .forEach(([year, bucket]) => {
            console.log([
                year,
                `lette ${bucket.total}`,
                `verificate ${bucket.checked}`,
                `ok ${bucket.matched}/${bucket.checked} (${percent(bucket.matched, bucket.checked)})`,
                `non ok ${bucket.mismatches}`,
                `senza letture ${bucket.noReadings}`,
                `extra ${bucket.extraServiceInvoices}`,
                `errori ${bucket.errors}`,
            ].join(' | '));
        });

    if (Object.keys(mismatchByKind).length) {
        console.log('\nDifferenze per motivo:');
        Object.entries(mismatchByKind)
            .sort((a, b) => b[1] - a[1])
            .forEach(([kind, count]) => console.log(`${kind}: ${count}`));
    }

    if (stats.mismatches.length) {
        console.log('\nEsempi fatture non combacianti:');
        console.log(JSON.stringify(stats.mismatches.slice(0, args.verbose ? 50 : 10), null, 2));
    }

    if (stats.errors.length) {
        console.log('\nEsempi errori:');
        console.log(JSON.stringify(stats.errors.slice(0, args.verbose ? 50 : 10), null, 2));
    }

    await mongoose.disconnect();

    if (args.strict && (stats.mismatches.length > 0 || stats.errors.length > 0)) {
        process.exit(1);
    }
};

runScript(main);
