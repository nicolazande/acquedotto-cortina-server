const DEFAULT_WATER_ARTICLE_CODE = 'ACQUA';
const DEFAULT_FIXED_ARTICLE_CODE = 'ACQUAF';
const DEFAULT_FIXED_QUOTA = 'Q.Fissa';

const numberOrZero = (value) => {
    const number = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
};

const roundMoney = (value) => Math.round((numberOrZero(value) + Number.EPSILON) * 100) / 100;

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const recordId = (record) => String(record?._id || record || '');

const pickSnapshotFields = (record, fields) => {
    if (!record) {
        return undefined;
    }

    return fields.reduce((snapshot, field) => {
        if (record[field] !== undefined && record[field] !== null) {
            return { ...snapshot, [field]: record[field] };
        }
        return snapshot;
    }, { _id: recordId(record) });
};

const getDateValue = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const isInValidity = (band, date) => {
    if (!date) {
        return true;
    }

    const start = getDateValue(band.inizio);
    const end = getDateValue(band.scadenza);

    return (!start || date >= start) && (!end || date <= end);
};

const isFixedBand = (band) => normalizeText(band.tipo).includes('fisso');

const getRangeLowerBound = (band) => {
    const min = numberOrZero(band.min);
    return min > 0 ? min - 1 : min;
};

const getBandQuantity = (consumption, band) => {
    const lowerBound = getRangeLowerBound(band);
    const max = numberOrZero(band.max);
    const upperBound = max > 0 ? max : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(consumption, upperBound) - lowerBound);
};

const containsValue = (band, value) => {
    const lowerBound = getRangeLowerBound(band);
    const max = numberOrZero(band.max);
    const upperBound = max > 0 ? max : Number.POSITIVE_INFINITY;
    return value > lowerBound && value <= upperBound;
};

const sortBands = (bands) => [...bands].sort((a, b) => {
    const fixedDelta = Number(isFixedBand(a)) - Number(isFixedBand(b));
    if (fixedDelta !== 0) {
        return fixedDelta;
    }

    return numberOrZero(a.min) - numberOrZero(b.min)
        || numberOrZero(a.max) - numberOrZero(b.max)
        || normalizeText(a.tipo).localeCompare(normalizeText(b.tipo));
});

const getApplicableBands = (bands, { date, listinoId } = {}) => sortBands(
    bands.filter((band) => {
        const sameListino = !listinoId || recordId(band.listino) === recordId(listinoId);
        return sameListino && isInValidity(band, getDateValue(date));
    })
);

const getArticleByCode = (articlesByCode, code) => articlesByCode?.[code] || null;

const getTaxRate = (articleOrTax) => {
    const source = typeof articleOrTax === 'string' ? articleOrTax : articleOrTax?.iva;
    const match = String(source || '').match(/(\d+(?:[,.]\d+)?)\s*%/);
    return match ? numberOrZero(match[1]) : 0;
};

const createLine = ({
    article,
    band,
    contatore,
    currentValue,
    lettura,
    previousValue,
    quantity,
    type,
}) => {
    const unitPrice = numberOrZero(band.prezzo);
    const total = roundMoney(quantity * unitPrice);
    const taxRate = getTaxRate(article);
    const listinoLabel = contatore?.listino?.categoria || contatore?.listino?.descrizione || '';
    const listino = contatore?.listino;

    return {
        descrizione: `Spesa Acqua ${listinoLabel}`.trim(),
        tipo_tariffa: band.tipo,
        tipo_attivita: contatore?.tipo_attivita,
        metri_cubi: quantity,
        prezzo: unitPrice,
        valore_unitario: total,
        tipo_quota: type === 'fixed' ? DEFAULT_FIXED_QUOTA : undefined,
        lettura_precedente: String(previousValue),
        lettura_fatturazione: String(currentValue),
        data_lettura: lettura?.data_lettura,
        descrizione_attivita: contatore?.tipo_attivita,
        lettura: lettura?._id,
        articolo: article?._id || article || undefined,
        listino: listino?._id || listino || undefined,
        fascia: band?._id || band || undefined,
        articolo_dettaglio: article || undefined,
        iva_percentuale: taxRate,
        aliquota_iva: taxRate,
        calcolo_snapshot: {
            articolo: pickSnapshotFields(article, ['codice', 'descrizione', 'iva']),
            fascia: pickSnapshotFields(band, ['tipo', 'min', 'max', 'prezzo', 'inizio', 'scadenza']),
            listino: pickSnapshotFields(listino, ['categoria', 'descrizione']),
            contatore: pickSnapshotFields(contatore, ['codice', 'seriale', 'seriale_interno', 'tipo_attivita']),
            lettura: {
                _id: recordId(lettura),
                data_lettura: lettura?.data_lettura,
                valore_precedente: previousValue,
                valore_attuale: currentValue,
            },
            quantita: quantity,
            prezzo_unitario: unitPrice,
            totale_riga: total,
            quota: type,
        },
    };
};

const calculateTotals = (lines) => {
    const imponibile = roundMoney(lines.reduce((total, line) => total + numberOrZero(line.valore_unitario), 0));
    const iva = roundMoney(lines.reduce((total, line) => (
        total + (numberOrZero(line.valore_unitario) * numberOrZero(line.iva_percentuale) / 100)
    ), 0));

    return {
        imponibile,
        iva,
        totale_fattura: roundMoney(imponibile + iva),
    };
};

const getFixedBandsToBill = (fixedBands, consumption) => {
    if (fixedBands.length <= 1) {
        return fixedBands;
    }

    const matchingBands = fixedBands.filter((band) => containsValue(band, consumption));
    return matchingBands.length > 0 ? matchingBands : fixedBands.slice(0, 1);
};

const calculateReadingInvoice = ({
    articlesByCode,
    contatore,
    currentValue,
    fasce,
    lettura,
    previousValue = 0,
}) => {
    const startValue = numberOrZero(previousValue);
    const endValue = numberOrZero(currentValue ?? lettura?.consumo);
    const billableConsumption = Math.max(0, roundMoney(endValue - startValue));
    const applicableBands = getApplicableBands(fasce, {
        date: lettura?.data_lettura,
        listinoId: contatore?.listino,
    });
    const waterArticle = getArticleByCode(articlesByCode, DEFAULT_WATER_ARTICLE_CODE);
    const fixedArticle = getArticleByCode(articlesByCode, DEFAULT_FIXED_ARTICLE_CODE) || waterArticle;
    const lines = [];

    applicableBands
        .filter((band) => !isFixedBand(band) && numberOrZero(band.prezzo) >= 0)
        .forEach((band) => {
            const quantity = roundMoney(getBandQuantity(billableConsumption, band));
            if (quantity <= 0) {
                return;
            }

            lines.push(createLine({
                article: waterArticle,
                band,
                contatore,
                currentValue: endValue,
                lettura,
                previousValue: startValue,
                quantity,
                type: 'variable',
            }));
        });

    getFixedBandsToBill(applicableBands.filter((band) => isFixedBand(band) && numberOrZero(band.prezzo) >= 0), billableConsumption)
        .forEach((band) => {
            lines.push(createLine({
                article: fixedArticle,
                band,
                contatore,
                currentValue: endValue,
                lettura,
                previousValue: startValue,
                quantity: 1,
                type: 'fixed',
            }));
        });

    return {
        previousValue: startValue,
        currentValue: endValue,
        billableConsumption,
        lines: lines.map((line, index) => ({ riga: index + 1, ...line })),
        totals: calculateTotals(lines),
    };
};

module.exports = {
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
    calculateReadingInvoice,
    calculateTotals,
    getApplicableBands,
    getBandQuantity,
    getTaxRate,
    isFixedBand,
    numberOrZero,
    roundMoney,
};
