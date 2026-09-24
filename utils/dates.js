const MS_PER_DAY = 86400000;

// Restituisce una Date valida oppure null: da usare quando l'assenza di data ha un significato.
const toDate = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

// Il gestionale precedente non lasciava vuote le date che non c'erano: ci scriveva
// 31/12/2099. Su una scadenza voleva dire "ancora in servizio", su un pagamento
// "non ancora pagato". Presa alla lettera e una data vera fra settant'anni, quindi
// va letta per quello che significa: nessuna data. La soglia, invece del valore
// esatto, regge anche un import che la riporti con un'ora diversa.
const DATA_IMPLAUSIBILE = new Date('2090-01-01T00:00:00.000Z');

// L'altra sentinella, all'indietro: sulle date di invio della fattura "mai
// inviata" era 01/01/1900. Nessun documento dell'acquedotto e di quell'anno.
const PRIMA_DATA_REALE = new Date('1901-01-01T00:00:00.000Z');

// Una data vera, oppure null se manca, non e valida o e una delle due sentinelle.
const dataReale = (value) => {
    const date = toDate(value);
    return date && date >= PRIMA_DATA_REALE && date < DATA_IMPLAUSIBILE ? date : null;
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

// La data senza separatori, come la vogliono i tracciati a larghezza fissa:
// 27042026. Una data assente resta una stringa vuota.
const dataCompatta = (value) => formatItalianDate(value).replace(/\//g, '');

const daysBetween = (from, to) => Math.floor((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);

// Una data oltre il giorno di oggi: per chi la scrive e nel futuro. Un incasso o
// una lettura non possono esserlo, e di solito e un errore di battitura.
//
// Si confrontano giorni di calendario, ed e il calendario italiano: le date del
// gestionale sono salvate a mezzanotte UTC, il server di produzione lavora in
// UTC e chi scrive sta in Italia. Misurando sull'ora del server, fra mezzanotte
// e le due di notte una data di oggi risultava gia domani.
const OGGI_IN_ITALIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

const giornoDi = (data) => Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());

const nelFuturo = (data) => giornoDi(data) > Date.parse(`${OGGI_IN_ITALIA.format(new Date())}T00:00:00.000Z`);

module.exports = {
    nelFuturo,
    addDays,
    DATA_IMPLAUSIBILE,
    dataCompatta,
    dataReale,
    daysBetween,
    formatItalianDate,
    getDate,
    startOfDay,
    toDate,
};
