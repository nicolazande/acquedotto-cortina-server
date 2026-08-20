const Fattura = require('../models/Fattura');
const Servizio = require('../models/Servizio');
const { conflict, notFound } = require('../utils/errors');
const { parseBoolean } = require('../utils/values');

const isConfirmedInvoice = (fattura) => (
    fattura?.confermata === true
    || String(fattura?.stato || '').toLowerCase() === 'confermata'
);

// Una fattura confermata resta protetta, ma il blocco puo essere superato con
// una conferma esplicita di chi opera. Non e un permesso silenzioso: chi passa
// `sbloccoConfermato` sta dichiarando di voler intervenire su un documento gia
// emesso, e l'operazione viene registrata come tale nel giornale delle modifiche.
const assertInvoiceEditable = (fattura, action = 'modificare', { sbloccoConfermato = false } = {}) => {
    if (!isConfirmedInvoice(fattura)) {
        return false;
    }

    // parseBoolean e non la semplice veridicita: una stringa come 'no' o 'false'
    // e veritiera in JavaScript e sbloccherebbe un documento gia emesso.
    if (!parseBoolean(sbloccoConfermato)) {
        throw conflict(`Fattura confermata: non e possibile ${action}.`);
    }

    // Segnala al chiamante che sta operando su un documento confermato.
    return true;
};

const findInvoiceLock = (fatturaId) => Fattura.findById(fatturaId).select('_id confermata stato').lean();

// Usata quando si *assegna* una fattura a una riga: la fattura deve esistere,
// altrimenti si creerebbe un riferimento verso il nulla.
const assertInvoiceEditableById = async (fatturaId, action, options) => {
    if (!fatturaId) return null;

    const fattura = await findInvoiceLock(fatturaId);
    if (!fattura) {
        throw notFound('Fattura not found');
    }

    assertInvoiceEditable(fattura, action, options);
    return fattura;
};

// Usata sulle righe gia esistenti: se la fattura referenziata non esiste piu, la
// riga e orfana e non c'e nulla da bloccare. Prima veniva sollevato un 404 che
// rendeva quelle righe impossibili da modificare e da cancellare.
const assertServiceInvoiceEditable = async (servizioId, action, options) => {
    const servizio = await Servizio.findById(servizioId).lean();
    if (!servizio) {
        throw notFound('Servizio not found');
    }

    if (servizio.fattura) {
        const fattura = await findInvoiceLock(servizio.fattura);
        if (fattura) {
            assertInvoiceEditable(fattura, action, options);
        }
    }

    return servizio;
};

// La conferma arriva dal corpo della richiesta o dalla querystring, cosi vale
// anche per le operazioni senza corpo (cancellazione, associazioni).
const unlockOptions = (req) => ({
    sbloccoConfermato: parseBoolean(req?.body?.sbloccoConfermato ?? req?.query?.sbloccoConfermato),
});

module.exports = {
    assertInvoiceEditable,
    unlockOptions,
    assertInvoiceEditableById,
    assertServiceInvoiceEditable,
    isConfirmedInvoice,
};
