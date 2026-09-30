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

// Il numero arriva con la conferma: una bozza non ne ha, ne serie ne codice,
// cosi cancellarla non lascia buchi nella numerazione. Una fattura riportata a
// bozza tiene il numero che aveva, perche puo essere gia uscita. Lo storico
// importato ha sempre un numero.
const haNumero = (fattura) => Number(fattura?.numero) > 0;

// Come si chiama un documento: 2026/A/12 per quelli emessi da qui, anno/numero
// per quelli importati, che una serie non ce l'hanno. Una bozza non ha ancora un
// nome: stringa vuota, e chi lo mostra dice "bozza".
const numeroDocumento = (fattura) => {
    if (!haNumero(fattura)) {
        return '';
    }

    return invoiceCode(fattura) || [fattura.anno, fattura.numero].filter(Boolean).join('/');
};

// Una fattura confermata: la spunta o lo stato. Il modello li tiene allineati,
// ma chi scrive senza passare dal modello - l'import da Gesco, con pymongo -
// ne scrive uno solo, e guardare solo `stato` faceva sparire le confermate
// importate sia dalle bozze sia dalle confermate. Decide il blocco delle
// modifiche, la consegna, il portale, la mora e gli elenchi; i filtri sono la
// stessa regola scritta per il database, ed e l'unico modo di chiederlo.
const isConfirmedInvoice = (fattura) => (
    fattura?.confermata === true
    || String(fattura?.stato || '').toLowerCase() === 'confermata'
);
const CONFERMATA = [{ confermata: true }, { stato: /^confermata$/i }];
const FILTRO_CONFERMATE = { $or: CONFERMATA };
const FILTRO_BOZZE = { $nor: CONFERMATA };

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

// Chi paga con l'addebito in conto: chi ci ha dato l'IBAN. E la regola
// dell'ufficio - "i clienti che hanno l'IBAN vanno direttamente in banca" - e
// non il termine scritto in anagrafica: "Addebito in conto a scadenza" c'era su
// 25 clienti, l'IBAN su 111, e agli altri la fattura diceva bonifico mentre la
// banca addebitava. Il termine resta, e dice quando si paga.
const pagaConAddebito = (cliente) => Boolean(String(cliente?.iban || '').trim());

// Come il cliente paga, nel codice del tracciato: addebito SDD o bonifico. Il
// PDF dice lo stesso con le parole (`drawPayment`). C'era anche "contanti", che
// il PDF non conosceva e che nessun cliente ha mai avuto.
const modalitaPagamentoXml = (cliente) => (pagaConAddebito(cliente) ? 'MP19' : 'MP05');

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
    FILTRO_BOZZE,
    FILTRO_CONFERMATE,
    FILTRO_EMESSE_DAL_GESTIONALE,
    emessaDalGestionale,
    giorniDelTermine,
    haNumero,
    isConfirmedInvoice,
    modalitaPagamentoXml,
    pagaConAddebito,
    INVOICE_SERIES,
    invoiceCode,
    naturaPerIva,
    numeroDocumento,
    tipoDocumentoXml,
};
