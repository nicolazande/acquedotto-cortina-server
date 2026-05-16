require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Articolo = require('../models/Articolo');
const Fattura = require('../models/Fattura');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');
require('../models/Cliente');
const { calculateDelay } = require('../services/deadlineService');

const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
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
    const rows = await Servizio.aggregate([
        { $match: { fattura: { $ne: null } } },
        { $group: { _id: '$fattura', serviziImponibile: { $sum: { $ifNull: ['$valore_unitario', 0] } } } },
        {
            $lookup: {
                from: Fattura.collection.collectionName,
                localField: '_id',
                foreignField: '_id',
                as: 'fattura',
            },
        },
        { $unwind: '$fattura' },
        {
            $project: {
                _id: 1,
                anno: '$fattura.anno',
                numero: '$fattura.numero',
                fatturaImponibile: '$fattura.imponibile',
                serviziImponibile: 1,
                delta: { $subtract: [{ $ifNull: ['$fattura.imponibile', 0] }, '$serviziImponibile'] },
            },
        },
    ]);

    return rows.filter((row) => Math.abs(money(row.delta)) > 0.01);
};

const getDelayMismatches = async () => {
    const scadenze = await Scadenza.find({ scadenza: { $ne: null } }).lean();
    return scadenze
        .map((scadenza) => ({
            _id: scadenza._id,
            anno: scadenza.anno,
            numero: scadenza.numero,
            stored: Number(scadenza.ritardo || 0),
            computed: calculateDelay(scadenza),
        }))
        .filter((row) => row.stored !== row.computed);
};

const main = async () => {
    await connectDB();

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
        delayMismatches,
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
        getDelayMismatches(),
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
    console.log(`Fatture con imponibile diverso dalla somma servizi: ${totalMismatches.length}`);
    console.log(`Scadenze con ritardo non aggiornato: ${delayMismatches.length}`);

    if (totalMismatches.length) {
        console.log('\nEsempi delta imponibile:');
        console.log(sample(totalMismatches).join('\n'));
    }

    if (delayMismatches.length) {
        console.log('\nEsempi ritardi da aggiornare:');
        console.log(sample(delayMismatches).join('\n'));
    }

    await mongoose.disconnect();

    if (strict && (
        fattureSenzaScadenza
        || serviziFatturaMancante.length
        || serviziArticoloMancante.length
        || totalMismatches.length
    )) {
        process.exit(1);
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
