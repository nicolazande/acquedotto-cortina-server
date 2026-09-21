// Come esce una fattura dal gestionale.
//
// Qui dentro ci sono due cose diverse, tenute separate apposta:
//
//  - la COPIA DI CORTESIA e una scelta di chi gestisce l'acquedotto: posta,
//    email, PEC, ritiro allo sportello. Vive nel campo `stampa_cortesia` del
//    cliente, ereditato dal gestionale precedente dove valeva "Cartacea
//    Postale" per tutti e 900 i clienti;
//
//  - il CANALE DELLA FATTURA ELETTRONICA non e una scelta: lo impone il
//    destinatario. Se ha un codice SdI il file va li, se ha solo la PEC va alla
//    PEC, altrimenti resta nel cassetto fiscale con 0000000. Metterlo a tendina
//    vorrebbe dire permettere di scegliere un canale che lo SdI poi rifiuta,
//    quindi il gestionale lo deduce dai dati del cliente e basta.
//
// Tutto cio che riguarda il "dove va a finire una fattura" si cambia in questo
// file: gli altri moduli leggono da qui e non conoscono altri valori.

const { normalizeText, parseBoolean } = require('../utils/values');

// Valore che il tracciato FatturaPA vuole quando non c'e un codice SdI.
const CODICE_DESTINATARIO_ASSENTE = '0000000';

// Modalita di consegna della copia di cortesia.
//
// `automatica` distingue i canali che il gestionale puo percorrere da solo da
// quelli che restano un lavoro d'ufficio: una busta la imbuca una persona, e
// l'elenco delle buste da preparare e comunque utile averlo.
const MODALITA_CONSEGNA = [
    {
        value: 'email',
        label: 'Email',
        canale: 'email',
        automatica: true,
        descrizione: 'La fattura in PDF parte per posta elettronica.',
    },
    {
        value: 'pec',
        label: 'PEC',
        canale: 'pec',
        automatica: true,
        descrizione: 'La fattura in PDF parte alla casella PEC del cliente.',
    },
    {
        value: 'postale',
        label: 'Cartacea postale',
        canale: 'postale',
        automatica: false,
        descrizione: 'La fattura va stampata e spedita.',
    },
    {
        value: 'sportello',
        label: 'Ritiro allo sportello',
        canale: 'sportello',
        automatica: false,
        descrizione: 'La fattura va stampata e tenuta a disposizione.',
    },
    {
        value: 'nessuna',
        label: 'Nessuna copia',
        canale: 'nessuno',
        automatica: false,
        descrizione: 'Nessuna copia di cortesia: resta solo la fattura elettronica.',
    },
];

const MODALITA_PREDEFINITA = 'postale';

// Testi trovati nei dati importati, e le abbreviazioni che una persona scrive
// davvero. Servono perche il campo era libero: senza questa tabella i 900
// clienti con scritto "Cartacea Postale" non corrisponderebbero a nessuna voce.
const ALIAS_MODALITA = {
    'cartacea postale': 'postale',
    cartacea: 'postale',
    posta: 'postale',
    postale: 'postale',
    'e-mail': 'email',
    email: 'email',
    mail: 'email',
    pec: 'pec',
    sportello: 'sportello',
    ritiro: 'sportello',
    'ritiro allo sportello': 'sportello',
    nessuna: 'nessuna',
    nessuno: 'nessuna',
};

const modalitaPerValore = new Map(MODALITA_CONSEGNA.map((voce) => [voce.value, voce]));

// Riporta un testo libero a una delle modalita dichiarate sopra. Non inventa:
// se non riconosce nulla torna la modalita predefinita, che e quella con cui
// l'acquedotto ha sempre lavorato.
const normalizzaModalita = (valore) => {
    const testo = normalizeText(valore);

    if (!testo) {
        return MODALITA_PREDEFINITA;
    }

    if (modalitaPerValore.has(testo)) {
        return testo;
    }

    if (ALIAS_MODALITA[testo]) {
        return ALIAS_MODALITA[testo];
    }

    // Ultimo tentativo sulle scritture composte ("invio via email", "stampa cartacea").
    const alias = Object.keys(ALIAS_MODALITA).find((chiave) => testo.includes(chiave));
    return alias ? ALIAS_MODALITA[alias] : MODALITA_PREDEFINITA;
};

const modalitaConsegna = (cliente) => modalitaPerValore.get(normalizzaModalita(cliente?.stampa_cortesia))
    || modalitaPerValore.get(MODALITA_PREDEFINITA);

// Un codice destinatario valido e di 7 caratteri (6 per la pubblica
// amministrazione) e non e il segnaposto di chi non ne ha uno.
const codiceDestinatarioValido = (valore) => {
    const codice = String(valore || '').trim().toUpperCase();
    return /^[A-Z0-9]{6,7}$/.test(codice) && codice !== CODICE_DESTINATARIO_ASSENTE ? codice : null;
};

// Chi il tracciato non sa ancora servire. Un cliente estero ha regole proprie -
// paese e identificativo esteri, codice destinatario XXXXXXX, una procedura a
// parte per San Marino - e un ufficio pubblico vuole il formato FPA12 con il suo
// codice IPA di sei caratteri. Emettere per loro un file da privato italiano
// vorrebbe dire un documento sbagliato, anche quando lo SdI lo accettasse: meglio
// dirlo e lasciarlo emettere a parte. Restituisce il motivo, o null.
const NAZIONE_ITALIA = new Set(['', 'IT', 'ITA', 'ITALIA']);
const CODICE_DESTINATARIO_ESTERO = 'XXXXXXX';

const destinatarioNonGestito = (cliente) => {
    const nazione = String(cliente?.nazione_fatturazione || cliente?.nazione_residenza || '').trim().toUpperCase();
    const codice = String(cliente?.codice_destinatario || '').trim().toUpperCase();

    if (codice === CODICE_DESTINATARIO_ESTERO || !NAZIONE_ITALIA.has(nazione)) {
        return `cliente estero (${nazione || 'codice XXXXXXX'}): la fattura elettronica per l'estero non è ancora gestita`;
    }

    if (/^[A-Z0-9]{6}$/.test(codice)) {
        return 'ufficio della pubblica amministrazione (codice IPA): serve il formato FPA12, non ancora gestito';
    }

    return null;
};

// Il canale della fattura elettronica, dedotto dai dati del cliente nell'ordine
// che il tracciato impone.
const canaleFatturaElettronica = (cliente) => {
    const codice = codiceDestinatarioValido(cliente?.codice_destinatario);

    if (codice) {
        return {
            canale: 'sdi',
            destinatario: codice,
            etichetta: `Codice destinatario ${codice}`,
        };
    }

    const pec = String(cliente?.email_pec || '').trim();

    if (pec) {
        return {
            canale: 'pec',
            destinatario: pec,
            etichetta: `PEC ${pec}`,
        };
    }

    return {
        canale: 'cassetto',
        destinatario: CODICE_DESTINATARIO_ASSENTE,
        etichetta: 'Cassetto fiscale del cliente',
    };
};

// Se una fattura elettronica va prodotta per questo cliente.
//
// Il flag `fattura_elettronica` arriva dal gestionale precedente. L'import non lo
// leggeva - era una casella di spunta - e per mesi e risultato falso su tutti:
// dal 21/09/2026 e riletto da Gesco (897 clienti su 901 a Zuel).
// FATTURA_ELETTRONICA_PREDEFINITA lo accende per tutti senza toccare le
// anagrafiche.
const FATTURA_ELETTRONICA_PREDEFINITA = parseBoolean(process.env.FATTURA_ELETTRONICA_PREDEFINITA);

const richiedeFatturaElettronica = (cliente) => (
    cliente?.fattura_elettronica === true || FATTURA_ELETTRONICA_PREDEFINITA
);

// Dove la fattura tiene la data in cui e uscita, per ogni tipo di consegna. La
// scrive il gestionale quando una consegna e evasa, e la scriveva il gestionale
// precedente: una fattura con quella data e gia stata consegnata in quel modo, e
// non va preparata di nuovo.
const CAMPO_DATA_CONSEGNA = {
    cortesia: 'data_invio_fattura',
    elettronica: 'data_fattura_elettronica',
};

// Chi trasmette allo SdI.
//
// `intermediario` significa che il gestionale prepara il file e lo mette in
// elenco, ma l'inoltro lo fa il commercialista o il portale dell'Agenzia: e la
// situazione di oggi. Quando il canale sara deciso, si aggiunge la funzione di
// trasporto corrispondente in services/invioService.js e si cambia questa voce.
const CANALE_TRASMISSIONE_SDI = (process.env.CANALE_TRASMISSIONE_SDI || 'intermediario').trim();

// Testi dei messaggi. Stanno qui perche cambiarli e una decisione di chi scrive
// ai clienti, non una modifica al codice che li spedisce.
const testoEmailCortesia = ({ cliente, documento, scadenza, mittente }) => ({
    oggetto: `Fattura ${documento} - ${mittente.nome}`,
    testo: [
        `Gentile ${cliente},`,
        '',
        `in allegato trova la fattura ${documento}${scadenza ? ` con scadenza ${scadenza}` : ''}.`,
        '',
        'Questa copia è inviata per cortesia: la fattura valida ai fini fiscali',
        'è quella trasmessa attraverso il Sistema di Interscambio.',
        '',
        'Per qualsiasi chiarimento può rispondere a questo messaggio.',
        '',
        'Cordiali saluti',
        mittente.nome,
        mittente.recapito,
    ].filter((riga) => riga !== null).join('\n'),
});

module.exports = {
    ALIAS_MODALITA,
    CAMPO_DATA_CONSEGNA,
    CANALE_TRASMISSIONE_SDI,
    CODICE_DESTINATARIO_ASSENTE,
    MODALITA_CONSEGNA,
    MODALITA_PREDEFINITA,
    canaleFatturaElettronica,
    codiceDestinatarioValido,
    destinatarioNonGestito,
    modalitaConsegna,
    normalizzaModalita,
    richiedeFatturaElettronica,
    testoEmailCortesia,
};
