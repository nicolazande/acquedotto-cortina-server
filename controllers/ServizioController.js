const Servizio = require('../models/Servizio');
const Lettura = require('../models/Lettura');
const Articolo = require('../models/Articolo');
const Fattura = require('../models/Fattura');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    getPopulatedRelation,
    getRecord,
    sendServiceError,
} = require('./utils/controllerActions');
const {
    assertInvoiceEditableById,
    assertServiceInvoiceEditable,
    unlockOptions,
} = require('../services/invoiceLockService');
const {
    writeServiceAudit,
    writeServiceUpdateAudit,
} = require('../services/invoiceAuditService');
const { ricalcolaTotaliFattura } = require('../services/invoiceGenerator');

const populate = 'lettura articolo fattura listino fascia';

const createServizio = async (req, res) => {
    try {
        await assertInvoiceEditableById(req.body.fattura, 'aggiungere righe servizio', unlockOptions(req));
        const { sbloccoConfermato, ...dati } = req.body;
        const servizio = await Servizio.create(dati);
        // I totali della fattura sono la somma delle righe: ogni volta che le
        // righe cambiano vanno rifatti, altrimenti il documento dice una cifra
        // e le sue righe un'altra.
        await ricalcolaTotaliFattura(servizio.fattura);
        await writeServiceAudit(req, servizio, 'fattura.servizio_creato', 'Creata riga servizio');
        res.status(201).json(servizio);
    } catch (error) {
        sendServiceError(res, error, 'Error creating servizio', error.status || 400);
    }
};

const updateServizio = async (req, res) => {
    try {
        const before = await assertServiceInvoiceEditable(req.params.id, 'modificare righe servizio', unlockOptions(req));
        await assertInvoiceEditableById(req.body.fattura, 'spostare righe servizio', unlockOptions(req));
        const { sbloccoConfermato, ...dati } = req.body;
        const after = await Servizio.findByIdAndUpdate(req.params.id, dati, { new: true }).lean();

        // Se la riga cambia importo, o passa a un'altra fattura, tornano i conti
        // di entrambe.
        await ricalcolaTotaliFattura(after?.fattura);
        if (before?.fattura && String(before.fattura) !== String(after?.fattura)) {
            await ricalcolaTotaliFattura(before.fattura);
        }

        await writeServiceUpdateAudit(req, before, after);
        res.status(200).json(after);
    } catch (error) {
        sendServiceError(res, error, 'Error updating servizio', error.status || 400);
    }
};

const deleteServizio = async (req, res) => {
    try {
        const servizio = await assertServiceInvoiceEditable(req.params.id, 'cancellare righe servizio', unlockOptions(req));
        await Servizio.deleteOne({ _id: req.params.id });
        await ricalcolaTotaliFattura(servizio.fattura);
        await writeServiceAudit(req, servizio, 'fattura.servizio_cancellato', 'Cancellata riga servizio');
        res.status(204).send();
    } catch (error) {
        sendServiceError(res, error, 'Error deleting servizio', error.status || 400);
    }
};

const associateLettura = associateRecords({
    field: 'lettura',
    responseKey: 'servizio',
    setOn: 'source',
    sourceModel: Servizio,
    sourceName: 'Servizio',
    sourceParam: 'servizioId',
    targetModel: Lettura,
    targetName: 'Lettura',
    targetParam: 'letturaId',
});

const associateArticolo = associateRecords({
    field: 'articolo',
    responseKey: 'servizio',
    setOn: 'source',
    sourceModel: Servizio,
    sourceName: 'Servizio',
    sourceParam: 'servizioId',
    targetModel: Articolo,
    targetName: 'Articolo',
    targetParam: 'articoloId',
});

const associateFattura = associateRecords({
    field: 'fattura',
    responseKey: 'servizio',
    setOn: 'source',
    sourceModel: Servizio,
    sourceName: 'Servizio',
    sourceParam: 'servizioId',
    targetModel: Fattura,
    targetName: 'Fattura',
    targetParam: 'fatturaId',
});

const withEditableServiceInvoice = (handler, action) => async (req, res) => {
    try {
        await assertServiceInvoiceEditable(req.params.servizioId, action, unlockOptions(req));
        return handler(req, res);
    } catch (error) {
        return sendServiceError(res, error, 'Fattura confermata', error.status || 400);
    }
};

const associateFatturaSafely = async (req, res) => {
    try {
        await assertServiceInvoiceEditable(req.params.servizioId, 'spostare righe servizio', unlockOptions(req));
        await assertInvoiceEditableById(req.params.fatturaId, 'associare righe servizio', unlockOptions(req));
        return associateFattura(req, res);
    } catch (error) {
        return sendServiceError(res, error, 'Fattura confermata', error.status || 400);
    }
};

module.exports = {
    createServizio,
    getServizi: (req, res) => sendPaginated(Servizio, req, res, {
        defaultSort: 'descrizione',
        errorMessage: 'Error fetching servizi',
        populate,
    }),
    getServizio: getRecord(Servizio, { name: 'Servizio', populate }),
    updateServizio,
    deleteServizio,
    associateLettura: withEditableServiceInvoice(associateLettura, 'modificare righe servizio'),
    associateArticolo: withEditableServiceInvoice(associateArticolo, 'modificare righe servizio'),
    associateFattura: associateFatturaSafely,
    getLetturaAssociata: getPopulatedRelation({ Model: Servizio, name: 'Servizio', path: 'lettura' }),
    getFatturaAssociata: getPopulatedRelation({ Model: Servizio, name: 'Servizio', path: 'fattura' }),
    getArticoloAssociato: getPopulatedRelation({ Model: Servizio, name: 'Servizio', path: 'articolo' }),
};
