const { fromCents, sumCents, toCents } = require('./money');

const TRUTHY_VALUES = ['1', 'true', 'yes', 'y', 'on', 'si'];

const numberOrZero = (value) => {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
};

// Arrotondamento commerciale a due decimali: passa dai centesimi interi, quindi
// segue il valore decimale scritto e non la sua approssimazione binaria.
const roundMoney = (value) => fromCents(toCents(value));

// Somma esatta: gli addendi diventano centesimi prima di essere sommati, cosi
// non si accumula errore lungo la somma.
const sumMoneyBy = (records, getter) => fromCents(sumCents(records, getter));

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const isEmptyValue = (value) => !hasValue(value);

const parseBoolean = (value) => TRUTHY_VALUES.includes(String(value).trim().toLowerCase());

const parseOptionalBoolean = (value) => {
    if (isEmptyValue(value)) {
        return undefined;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    return parseBoolean(value);
};

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Toglie accenti e segni diacritici lasciando la lettera: "Alverà" diventa
// "Alvera". Serve dove un testo finisce in un tracciato o in un confronto che gli
// accenti non li conosce: la fattura elettronica, il PDF, l'Anagrafe Tributaria.
const senzaAccenti = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizeText = (value) => senzaAccenti(String(value || '').toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
    escapeRegex,
    hasValue,
    isEmptyValue,
    normalizeText,
    numberOrZero,
    parseBoolean,
    parseOptionalBoolean,
    parsePositiveInteger,
    roundMoney,
    senzaAccenti,
    sumMoneyBy,
};
