// Quanta parte della quota fissa spetta all'anno che si sta fatturando.
//
// La quota fissa copre l'anno solare della lettura, dal 1 gennaio al 31
// dicembre, a prescindere da quando la lettura e stata fatta: un contatore in
// servizio tutto l'anno la paga intera. Se e stato attivato o cessato in corso
// d'anno ne paga i mesi di servizio, in dodicesimi. Cosi l'ha chiesto
// l'acquedotto, e vale d'ora in avanti: lo storico resta com'e stato fatturato.
//
// Il mese in cui si comincia e quello in cui si cessa contano interi, e il giorno
// del mese non conta: chi cessa il 10 settembre ha avuto l'acqua anche a
// settembre e paga nove mesi, chi entra il 27 aprile ne paga nove anche lui, da
// aprile a dicembre. E la regola con cui il gestionale precedente contava i mesi
// delle utenze nuove per l'Anagrafe Tributaria, e quella delle sue ultime
// fatture: Siorpaes, cessata ad aprile 2026, ha pagato 4/12 della quota.
//
// Una conseguenza da sapere: su un subentro il mese del cambio lo pagano tutti e
// due, chi esce e chi entra.
//
// L'anno di riferimento e quello della lettura, che e anche quello della
// fattura: il contatore si legge una volta l'anno, fra ottobre e novembre.

const { dataReale, toDate } = require('../utils/dates');

const MESI_DELL_ANNO = 12;

// Il mese di una data contato dal gennaio dell'anno di riferimento: gennaio e 0,
// dicembre 11. Una data di un altro anno cade fuori da quell'intervallo, prima o
// dopo, ed e cosi che si riconosce.
const meseNellAnno = (data, anno) => (
    (data.getUTCFullYear() - anno) * MESI_DELL_ANNO + data.getUTCMonth()
);

// I mesi interi di servizio dentro l'anno, da 0 a 12. Serve alla quota fissa e
// all'Anagrafe Tributaria, che li scrive nel tracciato: la regola e una sola.
// Una fine assente, o la data-sentinella del gestionale precedente, vuol dire
// "ancora in servizio".
const mesiDiServizio = ({ inizio, fine, anno }) => {
    const attivazione = toDate(inizio);
    const cessazione = dataReale(fine);

    const primoMese = attivazione ? Math.max(meseNellAnno(attivazione, anno), 0) : 0;
    const ultimoMese = cessazione
        ? Math.min(meseNellAnno(cessazione, anno), MESI_DELL_ANNO - 1)
        : MESI_DELL_ANNO - 1;

    // Attivato dopo la fine dell'anno, o cessato prima che cominciasse: zero.
    return Math.max(ultimoMese - primoMese + 1, 0);
};

// La frazione di anno in cui il contatore e stato in servizio, in dodicesimi.
const frazioneDiAnno = (periodo) => mesiDiServizio(periodo) / MESI_DELL_ANNO;

// La frazione da applicare alla quota fissa di un contatore, per la lettura che
// si sta fatturando. Un contatore senza date - o attivo tutto l'anno - paga
// intero, che e come si e sempre fatturato.
const rateoQuotaFissa = ({ contatore, anno }) => {
    if (!anno) {
        return 1;
    }

    return frazioneDiAnno({ inizio: contatore?.inizio, fine: contatore?.scadenza, anno });
};

module.exports = {
    MESI_DELL_ANNO,
    frazioneDiAnno,
    mesiDiServizio,
    rateoQuotaFissa,
};
