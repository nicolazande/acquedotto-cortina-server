const Fattura = require('../models/Fattura');
const Servizio = require('../models/Servizio');

const createError = (message, status = 409) => Object.assign(new Error(message), { status });

const isConfirmedInvoice = (fattura) => (
    fattura?.confermata === true
    || String(fattura?.stato || '').toLowerCase() === 'confermata'
);

const assertInvoiceEditable = (fattura, action = 'modificare') => {
    if (isConfirmedInvoice(fattura)) {
        throw createError(`Fattura confermata: non e possibile ${action}.`);
    }
};

const assertInvoiceEditableById = async (fatturaId, action) => {
    if (!fatturaId) return null;

    const fattura = await Fattura.findById(fatturaId).select('_id confermata stato').lean();
    if (!fattura) {
        throw createError('Fattura not found', 404);
    }

    assertInvoiceEditable(fattura, action);
    return fattura;
};

const assertServiceInvoiceEditable = async (servizioId, action) => {
    const servizio = await Servizio.findById(servizioId).lean();
    if (!servizio) {
        throw createError('Servizio not found', 404);
    }

    await assertInvoiceEditableById(servizio.fattura, action);
    return servizio;
};

module.exports = {
    assertInvoiceEditable,
    assertInvoiceEditableById,
    assertServiceInvoiceEditable,
    isConfirmedInvoice,
};
