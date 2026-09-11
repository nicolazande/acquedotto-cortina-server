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
// aprile a dicembre. E la stessa regola con cui il gestionale precedente contava
// i mesi delle utenze nuove nell'elenco per l'Anagrafe Tributaria.
//
// Una conseguenza da sapere: su un subentro il mese del cambio lo pagano tutti e
// due, chi esce e chi entra.
//
// L'anno di riferimento e quello della lettura, che e anche quello della
// fattura: il contatore si legge una volta l'anno, fra ottobre e novembre.

// Il gestionale precedente non lasciava vuota la data di fine: ci scriveva
// 31/12/2099 per dire "ancora in servizio". Presa alla lettera darebbe un
// contatore attivo per settant'anni, il che va bene - non riduce niente - ma
// tanto vale riconoscerla e trattarla come "nessuna fine".
const ANNO_IMPLAUSIBILE = 2090;

const MESI_DELL_ANNO = 12;

const aData = (valore) => {
    if (!valore) return null;
    const data = valore instanceof Date ? valore : new Date(valore);
    return Number.isNaN(data.getTime()) ? null : data;
};

// Il mese di una data contato dal gennaio dell'anno di riferimento: gennaio e 0,
// dicembre 11. Una data di un altro anno cade fuori da quell'intervallo, prima o
// dopo, ed e cosi che si riconosce.
const meseNellAnno = (data, anno) => (
    (data.getUTCFullYear() - anno) * MESI_DELL_ANNO + data.getUTCMonth()
);

// La frazione di anno in cui il contatore e stato in servizio, in dodicesimi: 1
// se tutto l'anno, 0 se mai. Fuori da questi estremi non puo andare.
const frazioneDiAnno = ({ inizio, fine, anno }) => {
    const attivazione = aData(inizio);
    const cessazione = aData(fine);

    const primoMese = attivazione ? Math.max(meseNellAnno(attivazione, anno), 0) : 0;
    const ultimoMese = cessazione && cessazione.getUTCFullYear() < ANNO_IMPLAUSIBILE
        ? Math.min(meseNellAnno(cessazione, anno), MESI_DELL_ANNO - 1)
        : MESI_DELL_ANNO - 1;

    if (ultimoMese < primoMese) {
        // Attivato dopo la fine dell'anno, o cessato prima che cominciasse.
        return 0;
    }

    return (ultimoMese - primoMese + 1) / MESI_DELL_ANNO;
};

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
    frazioneDiAnno,
    rateoQuotaFissa,
};
