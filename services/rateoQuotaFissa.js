// Quanta parte della quota fissa spetta all'anno che si sta fatturando.
//
// La quota fissa copre l'anno solare: un contatore attivo da gennaio a dicembre
// la paga intera. Se pero e stato attivato o cessato in corso d'anno, ne paga la
// parte proporzionale ai giorni di servizio - deciso cosi dall'acquedotto, e da
// applicare d'ora in avanti: lo storico resta com'e stato fatturato.
//
// Si contano i giorni effettivi e non i mesi perche il rapporto sia esatto: un
// contatore cessato il 10 settembre ha avuto acqua per 253 giorni su 365, non
// per "nove mesi". A giorni, chi cessa il 1 e chi cessa il 30 dello stesso mese
// non pagano la stessa cifra.
//
// L'anno di riferimento e quello della lettura, che e anche quello della
// fattura: il contatore si legge una volta l'anno, fra ottobre e novembre.

// Il gestionale precedente non lasciava vuota la data di fine: ci scriveva
// 31/12/2099 per dire "ancora in servizio". Presa alla lettera darebbe un
// contatore attivo per settant'anni, il che va bene - non riduce niente - ma
// tanto vale riconoscerla e trattarla come "nessuna fine".
const ANNO_IMPLAUSIBILE = 2090;

const aData = (valore) => {
    if (!valore) return null;
    const data = valore instanceof Date ? valore : new Date(valore);
    return Number.isNaN(data.getTime()) ? null : data;
};

const inizioAnno = (anno) => new Date(Date.UTC(anno, 0, 1));
const fineAnno = (anno) => new Date(Date.UTC(anno, 11, 31));

const aMezzanotte = (data) => new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));

const giorniFra = (dal, al) => Math.round((al - dal) / 86400000) + 1;

// La frazione di anno in cui il contatore e stato in servizio: 1 se tutto
// l'anno, 0 se mai. Fuori da questi estremi non puo andare.
const frazioneDiAnno = ({ inizio, fine, anno }) => {
    const primo = inizioAnno(anno);
    const ultimo = fineAnno(anno);

    const attivazione = aData(inizio);
    const cessazione = aData(fine);

    const da = attivazione && aMezzanotte(attivazione) > primo ? aMezzanotte(attivazione) : primo;
    const a = cessazione && cessazione.getUTCFullYear() < ANNO_IMPLAUSIBILE && aMezzanotte(cessazione) < ultimo
        ? aMezzanotte(cessazione)
        : ultimo;

    if (a < da) {
        // Attivato dopo la fine dell'anno, o cessato prima che cominciasse.
        return 0;
    }

    const giorniDiServizio = giorniFra(da, a);
    const giorniDellAnno = giorniFra(primo, ultimo);

    return giorniDiServizio / giorniDellAnno;
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
