const {
    hasValue,
    normalizeText,
    numberOrZero,
    roundMoney,
    sumMoneyBy,
} = require('../utils/values');
const {
    MONEY_TOLERANCE,
    applyRateToLines,
    fromCents,
    multiplyCents,
    sumCents,
    toCents,
} = require('../utils/money');
const { toDate } = require('../utils/dates');
const { recordId } = require('../utils/mongo');
const { unprocessable } = require('../utils/errors');

const DEFAULT_WATER_ARTICLE_CODE = 'ACQUA';
const DEFAULT_FIXED_ARTICLE_CODE = 'ACQUAF';
const DEFAULT_CONDOMINIUM_ARTICLE_CODE = 'COND';
const DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE = 'CONDF';
const DEFAULT_DELAY_ARTICLE_CODE = 'GG_DELAY';
const DEFAULT_FIXED_QUOTA = 'Q.Fissa';

const createCalculationError = (message) => unprocessable(message);

const pickSnapshotFields = (record, fields) => {
    if (!record) {
        return undefined;
    }

    const snapshot = { _id: recordId(record) };
    fields.forEach((field) => {
        if (record[field] !== undefined && record[field] !== null) {
            snapshot[field] = record[field];
        }
    });

    return snapshot;
};

const isInValidity = (band, date) => {
    if (!date) {
        return true;
    }

    const start = toDate(band.inizio);
    const end = toDate(band.scadenza);

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

// Una tariffa resta in vigore finche non ne arriva una nuova.
//
// Le fasce hanno una data di scadenza, ma quella data dice "questo prezzo vale
// fino a qui", non "dopo di me non si fattura piu". Nella realta il consiglio
// approva una tariffa e quella si applica finche non ne delibera un'altra:
// quasi tutte le fasce in archivio scadono il 31/12/2026 e senza proroga il
// 1 gennaio la fatturazione si fermerebbe su 1.059 contatori.
//
// La proroga riempie solo i buchi: una fascia scaduta viene ripresa se il suo
// scaglione non e coperto da nessuna fascia ancora valida. Cosi appena si
// inserisce la tariffa nuova, quella vince, e due prezzi non possono mai
// applicarsi allo stesso metro cubo.
// Dove comincia e dove finisce una fascia. Una regola sola, perche la usano in
// due per scopi opposti: qui per fatturare, e in tariffService per dire se le
// fasce coprono tutto il consumo. Scritte due volte potrebbero divergere, e
// allora il controllo direbbe che le tariffe vanno bene mentre il calcolo si
// rifiuta di emettere - o, peggio, il contrario.
const limiteInferiore = (fascia) => (numberOrZero(fascia.min) > 0 ? numberOrZero(fascia.min) - 1 : 0);
const limiteSuperiore = (fascia) => (numberOrZero(fascia.max) > 0 ? numberOrZero(fascia.max) : Infinity);

const siSovrappongono = (una, altra) => (
    isFixedBand(una) === isFixedBand(altra)
    && limiteInferiore(una) < limiteSuperiore(altra)
    && limiteInferiore(altra) < limiteSuperiore(una)
);

const fasceProrogate = (candidate, valide) => {
    // La versione piu recente di ogni scaglione: se una fascia e stata
    // rinnovata piu volte in passato, vale l'ultima.
    const perRecenza = [...candidate].sort(
        (a, b) => (toDate(b.scadenza)?.getTime() || 0) - (toDate(a.scadenza)?.getTime() || 0)
    );
    const prorogate = [];

    perRecenza.forEach((band) => {
        const occupato = [...valide, ...prorogate].some((altra) => siSovrappongono(band, altra));
        if (!occupato) {
            prorogate.push(band);
        }
    });

    return prorogate;
};

const getApplicableBands = (bands, { date, listinoId } = {}) => {
    const delListino = bands.filter(
        (band) => !listinoId || recordId(band.listino) === recordId(listinoId)
    );
    const quando = toDate(date);
    const valide = delListino.filter((band) => isInValidity(band, quando));

    if (!quando) {
        return sortBands(valide);
    }

    const scadute = delListino.filter((band) => {
        const fine = toDate(band.scadenza);
        const inizio = toDate(band.inizio);
        return fine && fine < quando && (!inizio || inizio <= quando);
    });

    return sortBands([...valide, ...fasceProrogate(scadute, valide)]);
};

const getArticleByCode = (articlesByCode, code) => articlesByCode?.[code] || null;

const isSplitCondominiumCounter = (contatore) => {
    const counterType = normalizeText(contatore?.tipo_contatore);
    const activity = normalizeText(contatore?.tipo_attivita);

    return activity === 'utenza condominiale' && counterType.includes('ripartit');
};

const getWaterArticles = (articlesByCode, contatore) => {
    if (isSplitCondominiumCounter(contatore)) {
        return {
            fixedArticle: getArticleByCode(articlesByCode, DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE),
            waterArticle: getArticleByCode(articlesByCode, DEFAULT_CONDOMINIUM_ARTICLE_CODE),
        };
    }

    return {
        fixedArticle: getArticleByCode(articlesByCode, DEFAULT_FIXED_ARTICLE_CODE),
        waterArticle: getArticleByCode(articlesByCode, DEFAULT_WATER_ARTICLE_CODE),
    };
};

const getListinoLabel = (contatore) => (
    contatore?.listino?.categoria
    || contatore?.listino?.descrizione
    || 'listino'
);

const assertArticle = (article, code, context) => {
    if (!article) {
        throw createCalculationError(`Articolo ${code} mancante: impossibile calcolare ${context} in modo sicuro`);
    }
};

const assertConsumptionCoverage = ({ consumption, fixedBands, lines, listinoLabel, variableBands }) => {
    if (consumption <= 0) {
        return;
    }

    if (variableBands.length === 0 && fixedBands.length > 0) {
        return;
    }

    if (variableBands.length === 0) {
        throw createCalculationError(`Il listino ${listinoLabel} non ha fasce consumo valide per questa data`);
    }

    const billedConsumption = roundMoney(lines
        .filter((line) => !line.tipo_quota)
        .reduce((total, line) => total + numberOrZero(line.metri_cubi), 0));

    if (Math.abs(billedConsumption - consumption) > MONEY_TOLERANCE) {
        throw createCalculationError(
            `Il listino ${listinoLabel} copre ${billedConsumption} mc su ${consumption} mc: aggiorna le fasce prima di generare la fattura`
        );
    }
};

const getTaxRate = (articleOrTax) => {
    const source = typeof articleOrTax === 'string' ? articleOrTax : articleOrTax?.iva;
    const match = String(source || '').match(/(\d+(?:[,.]\d+)?)\s*%/);
    return match ? numberOrZero(match[1]) : 0;
};

const getLineTaxRate = (line) => {
    const storedRate = line.iva_percentuale ?? line.aliquota_iva;

    if (hasValue(storedRate)) {
        return numberOrZero(storedRate);
    }

    return getTaxRate(line.articolo_dettaglio || line.articolo);
};

// La quota fissa vale il prezzo della fascia a prescindere dalla quantita;
// le righe a consumo moltiplicano i metri cubi per il prezzo unitario.
const getLineTotal = ({ quantity, type, unitPrice }) => {
    const prezzoCents = toCents(unitPrice);

    if (type === 'fixed') {
        return fromCents(prezzoCents);
    }

    return fromCents(multiplyCents(prezzoCents, quantity));
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
    const total = getLineTotal({ quantity, type, unitPrice });
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

// Imponibile e imposta si calcolano in centesimi interi. L'IVA mantiene il
// criterio storico, cioe una sola approssimazione sul totale invece che una per
// riga, ma la somma non porta piu con se l'errore della virgola mobile.
const calculateTotals = (lines) => {
    const imponibileCents = sumCents(lines, (line) => line.valore_unitario);
    const ivaCents = applyRateToLines(lines.map((line) => ({
        cents: toCents(line.valore_unitario),
        rate: getLineTaxRate(line),
    })));

    return {
        imponibile: fromCents(imponibileCents),
        iva: fromCents(ivaCents),
        totale_fattura: fromCents(imponibileCents + ivaCents),
    };
};

const getFixedChargeBands = (fixedBands, consumption) => {
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
    includeFixedCharge = true,
    lettura,
    previousValue = 0,
}) => {
    const startValue = numberOrZero(previousValue);
    const endValue = numberOrZero(currentValue ?? lettura?.consumo);

    // Un contatore non torna indietro. Se la lettura e piu bassa della
    // precedente, il contatore e stato sostituito o azzerato, oppure e una
    // cifra sbagliata: in tutti e tre i casi la decisione e di una persona.
    // Prima il consumo veniva semplicemente portato a zero, quindi il cliente
    // compariva pronto da fatturare e usciva una fattura senza consumi, senza
    // che nulla dicesse perche.
    if (endValue < startValue) {
        throw createCalculationError(
            `La lettura ${endValue} e piu bassa della precedente ${startValue}: `
            + 'il contatore e stato sostituito o la cifra e sbagliata'
        );
    }

    const billableConsumption = roundMoney(endValue - startValue);
    const applicableBands = getApplicableBands(fasce, {
        date: lettura?.data_lettura,
        listinoId: contatore?.listino,
    });
    const listinoLabel = getListinoLabel(contatore);
    const { waterArticle, fixedArticle } = getWaterArticles(articlesByCode, contatore);
    const variableBands = applicableBands.filter((band) => !isFixedBand(band) && numberOrZero(band.prezzo) >= 0);
    const applicableFixedBands = applicableBands.filter((band) => isFixedBand(band) && numberOrZero(band.prezzo) >= 0);
    const availableFixedBands = getFixedChargeBands(applicableFixedBands, billableConsumption);
    const fixedBands = includeFixedCharge ? availableFixedBands : [];
    const lines = [];

    if (variableBands.length > 0) {
        assertArticle(waterArticle, isSplitCondominiumCounter(contatore) ? DEFAULT_CONDOMINIUM_ARTICLE_CODE : DEFAULT_WATER_ARTICLE_CODE, 'i consumi');
    }
    if (fixedBands.length > 0) {
        assertArticle(fixedArticle, isSplitCondominiumCounter(contatore) ? DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE : DEFAULT_FIXED_ARTICLE_CODE, 'la quota fissa');
    }

    variableBands.forEach((band) => {
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

    fixedBands.forEach((band) => {
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

    assertConsumptionCoverage({
        consumption: billableConsumption,
        fixedBands: applicableFixedBands,
        lines,
        listinoLabel,
        variableBands,
    });

    return {
        previousValue: startValue,
        currentValue: endValue,
        billableConsumption,
        lines: lines.map((line, index) => ({ riga: index + 1, ...line })),
        totals: calculateTotals(lines),
        fixedCharge: {
            available: availableFixedBands.length > 0,
            applied: fixedBands.length > 0,
            estimatedTotal: sumMoneyBy(availableFixedBands, (band) => band.prezzo),
            total: sumMoneyBy(fixedBands, (band) => band.prezzo),
        },
    };
};

module.exports = {
    DEFAULT_CONDOMINIUM_ARTICLE_CODE,
    DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
    DEFAULT_DELAY_ARTICLE_CODE,
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
    calculateReadingInvoice,
    calculateTotals,
    getApplicableBands,
    getBandQuantity,
    getLineTaxRate,
    getTaxRate,
    isFixedBand,
    limiteInferiore,
    limiteSuperiore,
    numberOrZero,
    recordId,
    roundMoney,
};
