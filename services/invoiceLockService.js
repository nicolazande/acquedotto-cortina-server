const Fattura = require('../models/Fattura');
const Servizio = require('../models/Servizio');
const { conflict, notFound } = require('../utils/errors');

const isConfirmedInvoice = (fattura) => (
    fattura?.confermata === true
    || String(fattura?.stato || '').toLowerCase() === 'confermata'
);

const assertInvoiceEditable = (fattura, action = 'modificare') => {
    if (isConfirmedInvoice(fattura)) {
        throw conflict(`Fattura confermata: non e possibile ${action}.`);
    }
};

const findInvoiceLock = (fatturaId) => Fattura.findById(fatturaId).select('_id confermata stato').lean();

// Usata quando si *assegna* una fattura a una riga: la fattura deve esistere,
// altrimenti si creerebbe un riferimento verso il nulla.
const assertInvoiceEditableById = async (fatturaId, action) => {
    if (!fatturaId) return null;

    const fattura = await findInvoiceLock(fatturaId);
    if (!fattura) {
        throw notFound('Fattura not found');
    }

    assertInvoiceEditable(fattura, action);
    return fattura;
};

// Usata sulle righe gia esistenti: se la fattura referenziata non esiste piu, la
// riga e orfana e non c'e nulla da bloccare. Prima veniva sollevato un 404 che
// rendeva quelle righe impossibili da modificare e da cancellare.
const assertServiceInvoiceEditable = async (servizioId, action) => {
    const servizio = await Servizio.findById(servizioId).lean();
    if (!servizio) {
        throw notFound('Servizio not found');
    }

    if (servizio.fattura) {
        const fattura = await findInvoiceLock(servizio.fattura);
        if (fattura) {
            assertInvoiceEditable(fattura, action);
        }
    }

    return servizio;
};

module.exports = {
    assertInvoiceEditable,
    assertInvoiceEditableById,
    assertServiceInvoiceEditable,
    isConfirmedInvoice,
};
