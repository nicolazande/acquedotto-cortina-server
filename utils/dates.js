const MS_PER_DAY = 86400000;

// Restituisce una Date valida oppure null: da usare quando l'assenza di data ha un significato.
const toDate = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

// Restituisce sempre una Date: valori assenti o non validi diventano "adesso".
const getDate = (value) => toDate(value) || new Date();

// Mezzanotte UTC: le date del gestionale sono salvate come mezzanotte UTC,
// quindi tutti i confronti fra giorni passano da qui.
const startOfDay = (value) => {
    const date = toDate(value);
    if (!date) {
        return null;
    }

    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const addDays = (value, days) => {
    const date = startOfDay(value) || startOfDay(new Date());
    date.setUTCDate(date.getUTCDate() + days);
    return date;
};

const daysBetween = (from, to) => Math.floor((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);

const getYear = (value) => getDate(value).getFullYear();

module.exports = {
    addDays,
    daysBetween,
    getDate,
    getYear,
    startOfDay,
    toDate,
};
