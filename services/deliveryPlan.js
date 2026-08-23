// Dove deve andare una fattura, deciso senza toccare il database.
//
// Il modulo risponde a una sola domanda: dato un cliente e una fattura, quali
// consegne servono, su quale canale, verso quale recapito, e cosa manca perche
// possano partire. Nessuna scrittura, nessun invio: cosi le regole si possono
// verificare con i test e riusare sia per l'anteprima nell'interfaccia sia per
// la coda vera.

const {
    CANALE_TRASMISSIONE_SDI,
    canaleFatturaElettronica,
    modalitaConsegna,
    richiedeFatturaElettronica,
} = require('../config/delivery');
const { customerLabel } = require('../utils/customer');
const { invoiceCode } = require('../config/invoicing');

// Controllo volutamente permissivo: serve a intercettare i campi rimasti vuoti
// o con del testo al posto dell'indirizzo, non a validare le RFC.
const EMAIL_PLAUSIBILE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const testo = (valore) => String(valore ?? '').trim();

const primoValorizzato = (...valori) => valori.map(testo).find(Boolean) || '';

// L'indirizzo di spedizione: quello di fatturazione quando c'e, altrimenti la
// residenza. E lo stesso criterio usato dal PDF della fattura.
const indirizzoPostale = (cliente) => {
    const via = primoValorizzato(cliente?.indirizzo_fatturazione, cliente?.indirizzo_residenza);
    const numero = primoValorizzato(cliente?.numero_fatturazione, cliente?.numero_residenza);
    const cap = primoValorizzato(cliente?.cap_fatturazione, cliente?.cap_residenza);
    const localita = primoValorizzato(cliente?.localita_fatturazione, cliente?.localita_residenza);

    if (!via || !localita) {
        return '';
    }

    return [[via, numero].filter(Boolean).join(' '), [cap, localita].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' - ');
};

const recapitoEmail = (valore, etichetta) => {
    const indirizzo = testo(valore);

    if (!indirizzo) {
        return { destinatario: '', problema: `Il cliente non ha ${etichetta}.` };
    }

    if (!EMAIL_PLAUSIBILE.test(indirizzo)) {
        return { destinatario: indirizzo, problema: `${etichetta} del cliente non sembra un indirizzo valido.` };
    }

    return { destinatario: indirizzo, problema: null };
};

// La copia di cortesia: e la scelta registrata sul cliente.
const consegnaCortesia = (cliente) => {
    const modalita = modalitaConsegna(cliente);

    if (modalita.canale === 'nessuno') {
        return null;
    }

    const base = {
        tipo: 'cortesia',
        canale: modalita.canale,
        modalita: modalita.value,
        automatico: modalita.automatica,
    };

    if (modalita.canale === 'email') {
        return { ...base, ...recapitoEmail(cliente?.email, 'un indirizzo email') };
    }

    if (modalita.canale === 'pec') {
        return { ...base, ...recapitoEmail(cliente?.email_pec, 'una casella PEC') };
    }

    if (modalita.canale === 'postale') {
        const indirizzo = indirizzoPostale(cliente);
        return {
            ...base,
            destinatario: indirizzo,
            problema: indirizzo ? null : 'Il cliente non ha un indirizzo di spedizione.',
        };
    }

    return { ...base, destinatario: 'Ritiro allo sportello', problema: null };
};

// La fattura elettronica: il canale lo impone il destinatario, non l'operatore.
const consegnaElettronica = (cliente) => {
    if (!richiedeFatturaElettronica(cliente)) {
        return null;
    }

    const { canale, destinatario, etichetta } = canaleFatturaElettronica(cliente);

    return {
        tipo: 'elettronica',
        canale,
        destinatario,
        etichetta,
        // Finche la trasmissione passa da un intermediario il gestionale prepara
        // il file e lo mette in elenco, ma non lo inoltra: e una scelta di
        // configurazione, non un limite del codice.
        automatico: CANALE_TRASMISSIONE_SDI !== 'intermediario',
        problema: null,
        nota: CANALE_TRASMISSIONE_SDI === 'intermediario'
            ? 'Trasmissione affidata a un intermediario: il file va scaricato e inoltrato.'
            : null,
    };
};

// Motivi per cui una fattura non e ancora pronta per essere consegnata.
// Sono errori sul documento, non sul recapito: valgono per tutti i canali.
const ostacoliDocumento = ({ cliente, fattura }) => {
    const ostacoli = [];

    if (!cliente) {
        ostacoli.push('La fattura non ha un cliente collegato.');
    }

    if (fattura && fattura.stato !== 'confermata' && fattura.confermata !== true) {
        ostacoli.push('La fattura è ancora una bozza: va confermata prima di consegnarla.');
    }

    return ostacoli;
};

// Il piano completo di una fattura: cosa deve partire, dove, e cosa lo blocca.
const pianoConsegne = ({ cliente, fattura }) => {
    const ostacoli = ostacoliDocumento({ cliente, fattura });
    const consegne = ostacoli.length
        ? []
        : [consegnaCortesia(cliente), consegnaElettronica(cliente)].filter(Boolean);

    return {
        fattura: fattura?._id,
        cliente: cliente?._id,
        // Le fatture importate non hanno serie: per loro l'etichetta resta
        // anno/numero, che e come compaiono nello storico.
        documento: invoiceCode(fattura || {}) || [fattura?.anno, fattura?.numero].filter(Boolean).join('/'),
        intestatario: customerLabel(cliente, fattura),
        ostacoli,
        consegne,
        pronta: ostacoli.length === 0 && consegne.some((consegna) => !consegna.problema),
    };
};

module.exports = {
    indirizzoPostale,
    pianoConsegne,
};
