require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Articolo = require('../models/Articolo');
const Fascia = require('../models/Fascia');
const Lettura = require('../models/Lettura');
const Servizio = require('../models/Servizio');
require('../models/Contatore');
require('../models/Listino');

const {
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
    calculateReadingInvoice,
    isFixedBand,
    numberOrZero,
    roundMoney,
} = require('../services/billingCalculator');

const parseArgs = () => {
    const limitIndex = process.argv.indexOf('--limit');
    return {
        limit: limitIndex === -1 ? null : Number(process.argv[limitIndex + 1]),
    };
};

const percent = (value, total) => {
    if (!total) {
        return '0.0%';
    }

    return `${((value / total) * 100).toFixed(1)}%`;
};

const closeMoney = (a, b) => Math.abs(roundMoney(a) - roundMoney(b)) <= 0.01;

const getHistoricalValue = (row, field) => {
    const value = row?.[field];
    return value === undefined || value === null || value === '' ? null : numberOrZero(value);
};

const getArticlesByCode = async () => {
    const articles = await Articolo.find({
        codice: { $in: [DEFAULT_WATER_ARTICLE_CODE, DEFAULT_FIXED_ARTICLE_CODE] },
    }).lean();

    return articles.reduce((map, article) => ({
        ...map,
        [article.codice]: article,
    }), {});
};

const getListinoId = (lettura) => String(lettura?.contatore?.listino?._id || '');

const summarizeLines = (lines) => lines.map((line) => ({
    tipo: line.tipo_tariffa,
    mc: line.metri_cubi,
    prezzo: line.prezzo,
    totale: line.valore_unitario,
}));

const buildGroups = (rows) => {
    const groups = new Map();

    rows.forEach((row) => {
        const key = String(row.lettura);
        const current = groups.get(key) || [];
        current.push(row);
        groups.set(key, current);
    });

    return [...groups.entries()];
};

const main = async () => {
    const args = parseArgs();
    await connectDB();

    const [articlesByCode, serviceRows] = await Promise.all([
        getArticlesByCode(),
        Servizio.find({ lettura: { $ne: null } }).lean(),
    ]);
    const groups = buildGroups(serviceRows)
        .slice(0, args.limit || undefined);
    const listinoBands = new Map();
    const stats = {
        groups: groups.length,
        comparable: 0,
        usageMatched: 0,
        variableTotalMatched: 0,
        skipped: 0,
        samples: [],
    };

    for (const [letturaId, rows] of groups) {
        const variableRows = rows.filter((row) => row.tipo_tariffa && !row.tipo_quota && !isFixedBand(row));
        if (variableRows.length === 0) {
            stats.skipped += 1;
            continue;
        }

        const firstRow = variableRows[0];
        const previousValue = getHistoricalValue(firstRow, 'lettura_precedente');
        const currentValue = getHistoricalValue(firstRow, 'lettura_fatturazione');
        if (previousValue === null || currentValue === null) {
            stats.skipped += 1;
            continue;
        }

        const lettura = await Lettura.findById(letturaId).populate({
            path: 'contatore',
            populate: 'listino',
        }).lean();
        const listinoId = getListinoId(lettura);
        if (!lettura || !listinoId) {
            stats.skipped += 1;
            continue;
        }

        if (!listinoBands.has(listinoId)) {
            listinoBands.set(listinoId, await Fascia.find({ listino: listinoId }).lean());
        }

        const calculation = calculateReadingInvoice({
            articlesByCode,
            contatore: lettura.contatore,
            currentValue,
            fasce: listinoBands.get(listinoId),
            lettura,
            previousValue,
        });
        const calculatedRows = calculation.lines.filter((line) => !line.tipo_quota);
        const historicalUsage = roundMoney(variableRows.reduce((total, row) => total + numberOrZero(row.metri_cubi), 0));
        const calculatedUsage = roundMoney(calculatedRows.reduce((total, row) => total + numberOrZero(row.metri_cubi), 0));
        const historicalTotal = roundMoney(variableRows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const calculatedTotal = roundMoney(calculatedRows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const usageMatched = closeMoney(historicalUsage, calculatedUsage);
        const totalMatched = closeMoney(historicalTotal, calculatedTotal);

        stats.comparable += 1;
        if (usageMatched) {
            stats.usageMatched += 1;
        }
        if (totalMatched) {
            stats.variableTotalMatched += 1;
        }
        if ((!usageMatched || !totalMatched) && stats.samples.length < 10) {
            stats.samples.push({
                lettura: letturaId,
                listino: lettura.contatore.listino.categoria,
                previousValue,
                currentValue,
                historicalUsage,
                calculatedUsage,
                historicalTotal,
                calculatedTotal,
                historicalRows: summarizeLines(variableRows),
                calculatedRows: summarizeLines(calculatedRows),
            });
        }
    }

    console.log('Verifica calcolo fatturazione');
    console.log(`Gruppi lettura analizzati: ${stats.groups}`);
    console.log(`Confrontabili: ${stats.comparable}`);
    console.log(`Consumi combacianti: ${stats.usageMatched}/${stats.comparable} (${percent(stats.usageMatched, stats.comparable)})`);
    console.log(`Totali consumo combacianti: ${stats.variableTotalMatched}/${stats.comparable} (${percent(stats.variableTotalMatched, stats.comparable)})`);
    console.log(`Saltati: ${stats.skipped}`);

    if (stats.samples.length > 0) {
        console.log('\nEsempi di differenze storiche:');
        console.log(JSON.stringify(stats.samples, null, 2));
    }

    if (stats.comparable > 0 && stats.variableTotalMatched / stats.comparable < 0.95) {
        process.exitCode = 1;
    }

    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
});
