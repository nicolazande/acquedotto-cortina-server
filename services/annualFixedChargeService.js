const mongoose = require('mongoose');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Servizio = require('../models/Servizio');

const withSession = (query, session) => (session ? query.session(session) : query);

const recordId = (record) => String(record?._id || record || '');

const getDate = (value) => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
};

const toObjectId = (id) => {
    const value = recordId(id);
    return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
};

const annualFixedKey = (year, contatoreId) => `${year}:${recordId(contatoreId)}`;

const createAnnualFixedContext = ({ annualFixedLookupCache, invoiceDate, invoiceYear } = {}) => {
    const date = getDate(invoiceDate);

    return {
        annualFixedKeys: new Set(),
        annualFixedLookupCache: annualFixedLookupCache || new Map(),
        invoiceDate: date,
        invoiceYear: invoiceYear || date.getFullYear(),
    };
};

const fixedServiceMatch = {
    fattura: { $ne: null },
    lettura: { $ne: null },
    $or: [
        { tipo_quota: { $nin: [null, ''] } },
        { tipo_tariffa: /fisso/i },
    ],
};

const fixedChargeProject = {
    fattura: '$fattura._id',
    data_fattura: '$fattura.data_fattura',
};

const fixedChargeLookups = [
    {
        $lookup: {
            from: Fattura.collection.collectionName,
            localField: 'fattura',
            foreignField: '_id',
            as: 'fattura',
        },
    },
    { $unwind: '$fattura' },
    {
        $lookup: {
            from: Lettura.collection.collectionName,
            localField: 'lettura',
            foreignField: '_id',
            as: 'lettura',
        },
    },
    { $unwind: '$lettura' },
];

const fixedChargePipeline = ({ contatoreId, includeCounter = false, year } = {}) => [
    { $match: fixedServiceMatch },
    ...fixedChargeLookups,
    ...(year ? [{ $match: { 'fattura.anno': year } }] : []),
    ...(contatoreId ? [{ $match: { 'lettura.contatore': contatoreId } }] : []),
    {
        $project: {
            ...fixedChargeProject,
            ...(includeCounter ? {
                anno: '$fattura.anno',
                contatore: '$lettura.contatore',
            } : {}),
        },
    },
];

const getAnnualFixedCharges = async ({ cache, contatoreId, session, year }) => {
    const counterObjectId = toObjectId(contatoreId);
    if (!counterObjectId || !year) {
        return [];
    }

    const key = annualFixedKey(year, contatoreId);
    if (cache?.has(key)) {
        return cache.get(key);
    }
    if (cache?.complete) {
        return [];
    }

    const rows = await withSession(Servizio.aggregate(fixedChargePipeline({
        contatoreId: counterObjectId,
        year,
    })), session);

    cache?.set(key, rows);
    return rows;
};

const hasPreviousAnnualFixedCharge = async ({ beforeDate, cache, contatoreId, excludeInvoiceId, session, year }) => {
    const invoiceDate = getDate(beforeDate);
    const excluded = recordId(excludeInvoiceId);
    const rows = await getAnnualFixedCharges({ cache, contatoreId, session, year });

    return rows.some((row) => {
        const sameInvoice = excluded && recordId(row.fattura) === excluded;
        return !sameInvoice && getDate(row.data_fattura) <= invoiceDate;
    });
};

const buildAnnualFixedLookupCache = async () => {
    const rows = await Servizio.aggregate(fixedChargePipeline({ includeCounter: true }));
    const cache = new Map();

    rows.forEach((row) => {
        const key = annualFixedKey(row.anno, row.contatore);
        const fixedCharges = cache.get(key) || [];

        fixedCharges.push({
            fattura: row.fattura,
            data_fattura: row.data_fattura,
        });
        cache.set(key, fixedCharges);
    });
    cache.complete = true;

    return cache;
};

module.exports = {
    annualFixedKey,
    buildAnnualFixedLookupCache,
    createAnnualFixedContext,
    getDate,
    hasPreviousAnnualFixedCharge,
};
