// Serie di numerazione dei documenti emessi da questo gestionale.
//
// Perche una serie separata: nelle fatture importate il campo `numero` non e un
// progressivo di fattura ma un codice cliente, e la coppia (anno, numero) si
// ripete su 2.745 documenti. Agganciare la numerazione nuova a quei valori
// significherebbe partire da numeri arbitrari e non poter garantire l'unicita.
// Con una serie dedicata il progressivo riparte da 1 ogni anno, resta univoco e
// non entra mai in conflitto con lo storico.
const INVOICE_SERIES = (process.env.INVOICE_SERIES || 'A').trim().toUpperCase();

// Identificativo del documento mostrato al cliente e usato nel PDF.
const invoiceCode = ({ anno, numero, serie }) => (
    serie ? `${anno}/${serie}/${numero}` : ''
);

// Dati del cedente per la fattura elettronica. Sono gli stessi che compaiono sul
// PDF, qui in forma strutturata perche il tracciato XML li vuole separati.
const CEDENTE = {
    denominazione: process.env.INVOICE_COMPANY_NAME
        || 'COOPERATIVA DI GESTIONE ACQUEDOTTO ZUEL DI SOPRA',
    partitaIva: process.env.INVOICE_VAT_NUMBER || '00296800253',
    codiceFiscale: process.env.INVOICE_TAX_CODE || '00296800253',
    // RF01 e il regime ordinario. Va confermato da chi tiene la contabilita:
    // un regime sbagliato rende la fattura non conforme.
    regimeFiscale: process.env.INVOICE_TAX_REGIME || 'RF01',
    indirizzo: process.env.INVOICE_ADDRESS || 'Pian de Lago, 64',
    cap: process.env.INVOICE_ZIP || '32043',
    comune: process.env.INVOICE_CITY || "Cortina d'Ampezzo",
    provincia: process.env.INVOICE_PROVINCE || 'BL',
    nazione: 'IT',
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

module.exports = {
    CEDENTE,
    INVOICE_SERIES,
    NATURE_IVA,
    invoiceCode,
    naturaPerIva,
};
