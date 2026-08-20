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

module.exports = {
    INVOICE_SERIES,
    invoiceCode,
};
