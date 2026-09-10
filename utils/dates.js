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

// Data leggibile da una persona (31/12/2026). Una data assente o non valida
// diventa stringa vuota: nei documenti e nei messaggi non deve mai comparire
// "Invalid Date".
//
// Si legge in UTC, non con `toLocaleDateString`, che usa il fuso della
// macchina: le date del gestionale sono mezzanotte UTC, e su un server a ovest
// di Greenwich mezzanotte del 25 e ancora il 24 sera. Stampava il giorno prima
// sulle fatture, sulle scadenze e sulle letture - qui non si formatta una data
// e un'ora, si scrive un giorno di calendario deciso altrove.
const due = (numero) => String(numero).padStart(2, '0');

const formatItalianDate = (value) => {
    const date = toDate(value);
    if (!date) {
        return '';
    }

    return `${due(date.getUTCDate())}/${due(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
};

const daysBetween = (from, to) => Math.floor((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);

module.exports = {
    addDays,
    daysBetween,
    formatItalianDate,
    getDate,
    startOfDay,
    toDate,
};
