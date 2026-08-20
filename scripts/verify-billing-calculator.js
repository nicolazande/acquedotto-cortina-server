// Confronta il calcolatore con i dati storici: rifattura ogni lettura gia
// fatturata e segnala gli scostamenti.
//
// E un rapporto, non un test: stampa cio che trova e non fa fallire nulla.
const { runScript } = require('./utils/runScript');
const Articolo = require('../models/Articolo');
const Fascia = require('../models/Fascia');
const Lettura = require('../models/Lettura');
const Servizio = require('../models/Servizio');
require('../models/Contatore');
require('../models/Listino');

const {
    DEFAULT_CONDOMINIUM_ARTICLE_CODE,
    DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
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
        verbose: process.argv.includes('--verbose')
            || ['1', 'true', 'yes'].includes(String(process.env.BILLING_VERIFY_VERBOSE).toLowerCase()),
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
        codice: {
            $in: [
                DEFAULT_WATER_ARTICLE_CODE,
                DEFAULT_FIXED_ARTICLE_CODE,
                DEFAULT_CONDOMINIUM_ARTICLE_CODE,
                DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
            ],
        },
    }).lean();

    return Object.fromEntries(articles.map((article) => [article.codice, article]));
};

const getListinoId = (lettura) => String(lettura?.contatore?.listino?._id || '');

const summarizeLines = (lines) => lines.map((line) => ({
    articolo: line.articolo?.codice || line.articolo_dettaglio?.codice,
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

    const [articlesByCode, serviceRows] = await Promise.all([
        getArticlesByCode(),
        Servizio.find({ lettura: { $ne: null } }).populate('articolo').lean(),
    ]);
    const groups = buildGroups(serviceRows)
        .slice(0, args.limit || undefined);
    const listinoBands = new Map();
    const stats = {
        groups: groups.length,
        comparable: 0,
        usageMatched: 0,
        variableTotalMatched: 0,
        fixedTotalMatched: 0,
        lineTotalMatched: 0,
        articleMatched: 0,
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
        const fixedRows = rows.filter((row) => row.tipo_quota || isFixedBand(row));
        const calculatedFixedRows = calculation.lines.filter((line) => line.tipo_quota);
        const historicalUsage = roundMoney(variableRows.reduce((total, row) => total + numberOrZero(row.metri_cubi), 0));
        const calculatedUsage = roundMoney(calculatedRows.reduce((total, row) => total + numberOrZero(row.metri_cubi), 0));
        const historicalTotal = roundMoney(variableRows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const calculatedTotal = roundMoney(calculatedRows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const historicalFixedTotal = roundMoney(fixedRows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const calculatedFixedTotal = roundMoney(calculatedFixedRows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const historicalLineTotal = roundMoney(rows.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const calculatedLineTotal = roundMoney(calculation.lines.reduce((total, row) => total + numberOrZero(row.valore_unitario), 0));
        const historicalArticles = [...new Set(rows.map((row) => row.articolo?.codice).filter(Boolean))].sort();
        const calculatedArticles = [...new Set(calculation.lines.map((row) => row.articolo_dettaglio?.codice).filter(Boolean))].sort();
        const usageMatched = closeMoney(historicalUsage, calculatedUsage);
        const totalMatched = closeMoney(historicalTotal, calculatedTotal);
        const fixedMatched = closeMoney(historicalFixedTotal, calculatedFixedTotal);
        const lineTotalMatched = closeMoney(historicalLineTotal, calculatedLineTotal);
        const articlesMatched = historicalArticles.join('|') === calculatedArticles.join('|');

        stats.comparable += 1;
        if (usageMatched) {
            stats.usageMatched += 1;
        }
        if (totalMatched) {
            stats.variableTotalMatched += 1;
        }
        if (fixedMatched) {
            stats.fixedTotalMatched += 1;
        }
        if (lineTotalMatched) {
            stats.lineTotalMatched += 1;
        }
        if (articlesMatched) {
            stats.articleMatched += 1;
        }
        if ((!usageMatched || !totalMatched || !fixedMatched || !lineTotalMatched || !articlesMatched) && stats.samples.length < 10) {
            stats.samples.push({
                lettura: letturaId,
                listino: lettura.contatore.listino.categoria,
                tipoContatore: lettura.contatore.tipo_contatore,
                tipoAttivita: lettura.contatore.tipo_attivita,
                previousValue,
                currentValue,
                historicalUsage,
                calculatedUsage,
                historicalTotal,
                calculatedTotal,
                historicalFixedTotal,
                calculatedFixedTotal,
                historicalLineTotal,
                calculatedLineTotal,
                historicalArticles,
                calculatedArticles,
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
    console.log(`Totali quota fissa combacianti: ${stats.fixedTotalMatched}/${stats.comparable} (${percent(stats.fixedTotalMatched, stats.comparable)})`);
    console.log(`Totali righe combacianti: ${stats.lineTotalMatched}/${stats.comparable} (${percent(stats.lineTotalMatched, stats.comparable)})`);
    console.log(`Articoli combacianti: ${stats.articleMatched}/${stats.comparable} (${percent(stats.articleMatched, stats.comparable)})`);
    console.log(`Saltati: ${stats.skipped}`);

    if (stats.samples.length > 0) {
        console.log(`Differenze storiche campionate: ${stats.samples.length} (usa --verbose per il dettaglio JSON)`);
        if (args.verbose) {
            console.log(JSON.stringify(stats.samples, null, 2));
        }
    }

    if (stats.comparable > 0 && (
        stats.variableTotalMatched / stats.comparable < 0.95
        || stats.articleMatched / stats.comparable < 0.95
    )) {
        process.exitCode = 1;
    }

};

runScript(main);
