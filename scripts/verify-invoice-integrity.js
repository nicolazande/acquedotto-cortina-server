// Controlli di integrita: fatture senza righe, righe orfane, totali che non
// corrispondono alla somma delle righe, scadenze scollegate, tariffe in scadenza.
//
// E un rapporto, non un test: stampa cio che trova e non fa fallire nulla.
const { runScript } = require('./utils/runScript');
const Articolo = require('../models/Articolo');
const Contatore = require('../models/Contatore');
const Fascia = require('../models/Fascia');
const Fattura = require('../models/Fattura');
const Listino = require('../models/Listino');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');
require('../models/Cliente');
const { getTaxRate } = require('../services/billingCalculator');
const { MESI_DI_PREAVVISO, analizzaCopertura, tariffeInScadenza } = require('../services/tariffService');

// Le tariffe scadono, e quando scadono la fatturazione si ferma. La regola e in
// services/tariffService, la stessa che usano la panoramica e il rinnovo: qui si
// legge soltanto.
const getCoverageProblems = async () => {
    const listini = await Listino.find({}).lean();
    const problemi = [];

    for (const listino of listini) {
        const contatori = await Contatore.countDocuments({ listino: listino._id });
        if (contatori === 0) {
            continue;
        }

        const fasce = await Fascia.find({ listino: listino._id }).lean();
        analizzaCopertura(fasce, new Date()).problemi.forEach((problema) => {
            problemi.push(`${listino.categoria} (${contatori} contatori): ${problema}`);
        });
    }

    return problemi;
};


const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const TOLERANCE = 0.02;
const strict = ['1', 'true', 'yes'].includes(String(process.env.INVOICE_VERIFY_STRICT).toLowerCase());

const sample = (items, limit = 8) => items.slice(0, limit).map((item) => JSON.stringify(item));

const countMissingReferences = async ({ from, localField, target, targetField = '_id', where = {} }) => {
    const rows = await from.aggregate([
        { $match: { [localField]: { $ne: null }, ...where } },
        {
            $lookup: {
                from: target.collection.collectionName,
                localField,
                foreignField: targetField,
                as: 'target',
            },
        },
        { $match: { target: { $size: 0 } } },
        { $project: { _id: 1, [localField]: 1 } },
    ]);

    return rows;
};

const getInvoiceTotalMismatches = async () => {
    const rows = await Servizio.find({ fattura: { $ne: null } })
        .populate('fattura articolo')
        .lean();
    const groups = new Map();

    rows.forEach((service) => {
        const fattura = service.fattura;
        if (!fattura?._id) {
            return;
        }

        const key = String(fattura._id);
        const current = groups.get(key) || {
            _id: fattura._id,
            anno: fattura.anno,
            numero: fattura.numero,
            fatturaImponibile: fattura.imponibile,
            fatturaIva: fattura.iva,
            fatturaTotale: fattura.totale_fattura,
            serviziImponibile: 0,
            serviziIva: 0,
        };
        const imponibile = money(service.valore_unitario);
        const ivaPercent = service.aliquota_iva ?? getTaxRate(service.articolo);

        current.serviziImponibile += imponibile;
        current.serviziIva += imponibile * ivaPercent / 100;
        groups.set(key, current);
    });

    return [...groups.values()]
        .map((row) => {
            const serviziImponibile = money(row.serviziImponibile);
            const serviziIva = money(row.serviziIva);
            const serviziTotale = money(serviziImponibile + serviziIva);

            return {
                ...row,
                serviziImponibile,
                serviziIva,
                serviziTotale,
                deltaImponibile: money(money(row.fatturaImponibile) - serviziImponibile),
                deltaIva: money(money(row.fatturaIva) - serviziIva),
                deltaTotale: money(money(row.fatturaTotale) - serviziTotale),
            };
        })
        .filter((row) => (
            Math.abs(row.deltaImponibile) > TOLERANCE
            || Math.abs(row.deltaIva) > TOLERANCE
            || Math.abs(row.deltaTotale) > TOLERANCE
        ));
};

// Il ritardo di una scadenza e un valore derivato: dipende da che giorno e
// oggi, non da cio che e salvato. Il controllo non confronta piu il salvato con
// il calcolato - il salvato sarebbe sbagliato il giorno dopo, e segnalava 1.261
// falsi problemi - ma verifica che nessuno lo stia di nuovo scrivendo nel
// database. Si ripulisce con `npm run maintenance:allinea-dati -- --fix`.
const getStoredDelays = () => Scadenza.collection.countDocuments({ ritardo: { $exists: true } });

const main = async () => {

    const [
        totalFatture,
        totalServizi,
        totalScadenze,
        fattureSenzaScadenza,
        fattureSenzaCliente,
        fattureSenzaServizi,
        serviziSenzaFattura,
        serviziSenzaArticolo,
        serviziFatturaMancante,
        serviziArticoloMancante,
        scadenzeNonCollegate,
        totalMismatches,
        ritardiSalvati,
        inScadenza,
        problemiCopertura,
        articoli,
    ] = await Promise.all([
        Fattura.countDocuments(),
        Servizio.countDocuments(),
        Scadenza.countDocuments(),
        Fattura.countDocuments({ scadenza: { $in: [null, undefined] } }),
        Fattura.countDocuments({ cliente: { $in: [null, undefined] } }),
        Fattura.aggregate([
            {
                $lookup: {
                    from: Servizio.collection.collectionName,
                    localField: '_id',
                    foreignField: 'fattura',
                    as: 'servizi',
                },
            },
            { $match: { servizi: { $size: 0 } } },
            { $count: 'count' },
        ]),
        Servizio.countDocuments({ fattura: { $in: [null, undefined] } }),
        Servizio.countDocuments({ fattura: { $ne: null }, articolo: { $in: [null, undefined] } }),
        countMissingReferences({ from: Servizio, localField: 'fattura', target: Fattura }),
        countMissingReferences({ from: Servizio, localField: 'articolo', target: Articolo, where: { fattura: { $ne: null } } }),
        Scadenza.aggregate([
            {
                $lookup: {
                    from: Fattura.collection.collectionName,
                    localField: '_id',
                    foreignField: 'scadenza',
                    as: 'fatture',
                },
            },
            { $match: { fatture: { $size: 0 } } },
            { $count: 'count' },
        ]),
        getInvoiceTotalMismatches(),
        getStoredDelays(),
        tariffeInScadenza(),
        getCoverageProblems(),
        Articolo.find({}).select('codice descrizione iva').lean(),
    ]);

    const invoiceWithoutServicesCount = fattureSenzaServizi[0]?.count || 0;
    const unlinkedDeadlinesCount = scadenzeNonCollegate[0]?.count || 0;

    console.log('Verifica integrita fatture');
    console.log(`Fatture: ${totalFatture}`);
    console.log(`Servizi: ${totalServizi}`);
    console.log(`Scadenze: ${totalScadenze}`);
    console.log(`Articoli: ${articoli.map((articolo) => articolo.codice).join(', ')}`);
    console.log('');
    console.log(`Fatture senza scadenza: ${fattureSenzaScadenza}`);
    console.log(`Fatture senza cliente: ${fattureSenzaCliente}`);
    console.log(`Fatture senza servizi: ${invoiceWithoutServicesCount}`);
    console.log(`Servizi senza fattura: ${serviziSenzaFattura}`);
    console.log(`Servizi fatturati senza articolo: ${serviziSenzaArticolo}`);
    console.log(`Servizi con fattura inesistente: ${serviziFatturaMancante.length}`);
    console.log(`Servizi con articolo inesistente: ${serviziArticoloMancante.length}`);
    console.log(`Scadenze non collegate a fatture: ${unlinkedDeadlinesCount}`);
    console.log(`Fatture con totali diversi dalla somma servizi: ${totalMismatches.length}`);
    console.log(`Scadenze con il ritardo salvato (valore derivato): ${ritardiSalvati}`);
    console.log(`Listini con fasce incomplete oggi: ${problemiCopertura.length}`);
    console.log(`Listini con tariffe che scadono entro ${MESI_DI_PREAVVISO} mesi: ${inScadenza.length}`);

    if (problemiCopertura.length) {
        console.log('\nFasce incomplete: su questi listini il calcolo si rifiuta di emettere.');
        problemiCopertura.forEach((p) => console.log(`  - ${p}`));
    }

    if (inScadenza.length) {
        console.log('\nDopo quella data la fatturazione di questi listini si ferma:');
        inScadenza.forEach((t) => console.log(
            `  ${t.scadeIl.toISOString().slice(0, 10)}  ${String(t.categoria).padEnd(32)} `
            + `${String(t.contatori).padStart(4)} contatori, fasce ${t.fasceInScadenza}/${t.fasceTotali}`
            + `${t.scaduto ? '  GIA SCADUTO' : ''}`
        ));
    }

    if (totalMismatches.length) {
        console.log('\nEsempi delta totali:');
        console.log(sample(totalMismatches).join('\n'));
    }

    if (strict && (
        fattureSenzaScadenza
        || serviziFatturaMancante.length
        || serviziArticoloMancante.length
        || totalMismatches.length
        || ritardiSalvati
        || inScadenza.length
        || problemiCopertura.length
    )) {
        return false;
    }
};

runScript(main);
