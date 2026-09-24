// Serie di numerazione dei documenti emessi da questo gestionale.
//
// Perche una serie separata: nelle fatture importate prima del 17/09/2026 il
// campo `numero` non e il numero del documento ma il civico dell'indirizzo, per
// un difetto dell'import, e la coppia (anno, numero) si ripete su centinaia di
// documenti. Agganciare la numerazione nuova a quei valori significherebbe
// partire da numeri arbitrari e non poter garantire l'unicita.
// Con una serie dedicata il progressivo riparte da 1 ogni anno, resta univoco e
// non entra mai in conflitto con lo storico.
const { normalizeText } = require('../utils/values');

const INVOICE_SERIES = (process.env.INVOICE_SERIES || 'A').trim().toUpperCase();

// Identificativo del documento mostrato al cliente e usato nel PDF.
const invoiceCode = ({ anno, numero, serie }) => (
    serie ? `${anno}/${serie}/${numero}` : ''
);

// Le fatture emesse da questo gestionale hanno una serie, quelle importate dal
// programma precedente no: e l'unico segno che le distingue, e vale ovunque
// serva saperlo - la numerazione, la coda delle consegne. Il filtro e la stessa
// regola scritta per il database: stanno insieme perche non divergano.
const emessaDalGestionale = (fattura) => Boolean(fattura?.serie);
const FILTRO_EMESSE_DAL_GESTIONALE = { serie: { $type: 'string', $ne: '' } };

// Una fattura confermata: la spunta o lo stato, che il modello tiene allineati.
// Decide sia il blocco delle modifiche sia se la fattura si puo consegnare.
const isConfirmedInvoice = (fattura) => (
    fattura?.confermata === true
    || String(fattura?.stato || '').toLowerCase() === 'confermata'
);

// Tipo di documento nel tracciato. Il campo `tipo_documento` e testo libero
// nell'anagrafica importata, ma assume solo due valori: "Fattura" su 3.467
// documenti e "Nota di Credito" su 5. Emettere una nota di credito come TD01
// significa dichiarare una fattura: il documento viene accettato dallo SdI e
// resta sbagliato, che e il caso peggiore.
const TIPI_DOCUMENTO = {
    fattura: 'TD01',
    'nota di credito': 'TD04',
    'nota credito': 'TD04',
    'nota di accredito': 'TD04',
    'nota di debito': 'TD05',
    'nota debito': 'TD05',
};

// Restituisce il codice del tracciato, oppure null se il testo non corrisponde
// a nulla di conosciuto. Un tipo non riconosciuto non viene ricondotto alla
// fattura per comodita: meglio non emettere che emettere un documento che
// dichiara di essere cio che non e.
const tipoDocumentoXml = (testo) => {
    const voce = normalizeText(testo);

    if (!voce) {
        // Nessun documento importato ha il campo vuoto; se un giorno capitasse,
        // il documento e una fattura: e cio che crea il gestionale per difetto.
        return 'TD01';
    }

    return TIPI_DOCUMENTO[voce] || null;
};

// Corrispondenza fra il testo IVA scritto sull'articolo e la "natura" richiesta
// dal tracciato per le righe senza imposta. Il tracciato non accetta una riga a
// zero senza natura, e indicarne una sbagliata rende la fattura non conforme:
// per questo la corrispondenza e esplicita e configurabile, non indovinata.
const NATURE_IVA = {
    'esente art.15': 'N1',
    'art.26': 'N2.2',
    'ni90': 'N3.5',
};

const naturaPerIva = (testoIva) => {
    const testo = String(testoIva || '').toLowerCase();
    const voce = Object.keys(NATURE_IVA).find((chiave) => testo.includes(chiave));
    return voce ? NATURE_IVA[voce] : null;
};

// Come il cliente paga, nel codice del tracciato. Si legge dal termine scritto
// sulla sua anagrafica: i 25 clienti in addebito hanno "Addebito in conto a
// scadenza", per tutti gli altri vale il bonifico.
const MODALITA_PAGAMENTO = [
    { riconosce: /addebito|sdd|rid|sepa/i, codice: 'MP19' },
    { riconosce: /contant/i, codice: 'MP01' },
];

const MODALITA_PREDEFINITA_XML = 'MP05';

const modalitaPagamentoXml = (cliente) => {
    const testo = String(cliente?.pagamento || '');
    return MODALITA_PAGAMENTO.find((modalita) => modalita.riconosce.test(testo))?.codice
        || MODALITA_PREDEFINITA_XML;
};

// Quanti giorni passano fra la fattura e la sua scadenza, secondo il termine di
// pagamento scritto sul documento. Prima erano trenta per tutti: una fattura per
// un acconto gia incassato nasceva con trenta giorni di attesa davanti.
// Si riconosce dal testo perche l'archivio ha scritture diverse per la stessa
// cosa ("30 Giorni data fattura", "60 giorni data fattura").
const GIORNI_PER_TERMINE = [
    { riconosce: /vista\s*fattura|rimessa\s*diretta|contant/i, giorni: 0 },
    { riconosce: /(\d+)\s*giorni/i, giorni: null },
];

const giorniDelTermine = (tipoPagamento) => {
    const testo = String(tipoPagamento || '');

    const voce = GIORNI_PER_TERMINE.find((termine) => termine.riconosce.test(testo));
    if (!voce) {
        return null;
    }

    if (voce.giorni !== null) {
        return voce.giorni;
    }

    return Number.parseInt(testo.match(voce.riconosce)[1], 10);
};

module.exports = {
    FILTRO_EMESSE_DAL_GESTIONALE,
    emessaDalGestionale,
    giorniDelTermine,
    isConfirmedInvoice,
    modalitaPagamentoXml,
    INVOICE_SERIES,
    invoiceCode,
    naturaPerIva,
    tipoDocumentoXml,
};
