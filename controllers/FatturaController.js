const Fattura = require('../models/Fattura');
const Cliente = require('../models/Cliente');
const Servizio = require('../models/Servizio');
const Scadenza = require('../models/Scadenza');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    sendServiceError,
} = require('./utils/controllerActions');
const { parseOptionalBoolean } = require('./utils/requestOptions');
const {
    applyFixedChargeToInvoice,
    createManualInvoice,
    createInvoiceFromReadings,
    previewBillingBatch,
    verifyInvoiceCalculation,
} = require('../services/invoiceGenerator');
const {
    assertInvoiceEditable,
    assertInvoiceEditableById,
} = require('../services/invoiceLockService');
const { getAuditLogs } = require('../services/auditLogService');
const {
    invoiceLabel,
    writeInvoiceAudit,
    writeInvoiceUpdateAudit,
} = require('../services/invoiceAuditService');
const { withComputedDelay } = require('../services/deadlineService');
const { getInvoiceControlDashboard } = require('../services/invoiceControlService');
const { deleteInvoice } = require('../services/invoiceDeletionService');
const { generateInvoicePdf } = require('../services/invoicePdf');

const invoiceStatus = (confermata) => (parseOptionalBoolean(confermata) ? 'confermata' : 'bozza');

const normalizeInvoicePayload = (body = {}) => {
    const payload = { ...body };

    if (payload.confermata !== undefined) {
        payload.confermata = parseOptionalBoolean(payload.confermata);
        payload.stato = payload.stato || invoiceStatus(payload.confermata);
    }

    return payload;
};

const withEditableInvoice = (handler, idParam, action) => async (req, res) => {
    try {
        await assertInvoiceEditableById(req.params[idParam], action);
        return handler(req, res);
    } catch (error) {
        return sendServiceError(res, error, 'Fattura confermata', error.status || 400);
    }
};

const createFattura = async (req, res) => {
    try {
        const result = await createManualInvoice(req.body);
        await writeInvoiceAudit(req, result.fattura, 'fattura.creata', `Creata ${invoiceLabel(result.fattura)}`);
        res.status(201).json(result.fattura);
    } catch (error) {
        sendServiceError(res, error, 'Error creating fattura', 400);
    }
};

const getFatture = (req, res) => sendPaginated(Fattura, req, res, {
    defaultSort: 'data_fattura',
    errorMessage: 'Error fetching fatture',
    populate: 'cliente scadenza',
});

const generateFromReadings = async (req, res) => {
    try {
        const result = await createInvoiceFromReadings({
            letture: req.body.letture || req.body.letturaIds,
            data_fattura: req.body.data_fattura,
            data_scadenza: req.body.data_scadenza,
            includeFixedCharge: parseOptionalBoolean(req.body.includeFixedCharge),
            tipo_documento: req.body.tipo_documento,
            confermata: req.body.confermata,
        });

        await writeInvoiceAudit(req, result.fattura, 'fattura.generata', `Generata ${invoiceLabel(result.fattura)}`, {
            metadata: {
                letture: result.fattura.letture?.length || result.calculations?.length || 0,
            },
        });
        res.status(201).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Error generating fattura', 400);
    }
};

const getGenerationPreview = async (req, res) => {
    try {
        const result = await previewBillingBatch({
            includeFixedCharge: parseOptionalBoolean(req.query.includeFixedCharge),
            limit: req.query.limit,
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Error fetching billing generation preview');
    }
};

const getControlDashboard = async (req, res) => {
    try {
        const result = await getInvoiceControlDashboard({
            limit: req.query.limit,
            year: req.query.year || new Date().getFullYear(),
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Error fetching fatture controls');
    }
};

const verifyCalcolo = async (req, res) => {
    try {
        const result = await verifyInvoiceCalculation(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Error verifying fattura calculation');
    }
};

const applyFixedCharge = async (req, res) => {
    try {
        const before = await Fattura.findById(req.params.id).lean();
        if (!before) {
            return res.status(404).json({ error: 'Fattura not found' });
        }
        assertInvoiceEditable(before, 'aggiungere la quota fissa');

        const result = await applyFixedChargeToInvoice(req.params.id);
        await writeInvoiceAudit(req, before, 'fattura.quota_fissa', 'Aggiunta quota fissa', {
            metadata: {
                serviziCreati: result.servizi?.length || 0,
                totals: result.totals,
            },
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Error applying fixed charge to fattura', 400);
    }
};

const downloadPdf = async (req, res) => {
    try {
        const { buffer, filename } = await generateInvoicePdf(req.params.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        res.status(200).send(buffer);
    } catch (error) {
        sendServiceError(res, error, 'Error generating fattura PDF');
    }
};

const updateFattura = async (req, res) => {
    try {
        const before = await Fattura.findById(req.params.id).lean();
        if (!before) {
            return res.status(404).json({ error: 'Fattura not found' });
        }
        assertInvoiceEditable(before, 'modificare la fattura');

        const payload = normalizeInvoicePayload(req.body);
        const after = await Fattura.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
        await writeInvoiceUpdateAudit(req, before, after, payload.confermata ? 'fattura.confermata' : 'fattura.modificata');
        return res.status(200).json(after);
    } catch (error) {
        return sendServiceError(res, error, 'Error updating fattura', error.status || 400);
    }
};

const deleteFattura = async (req, res) => {
    try {
        const result = await deleteInvoice(req.params.id);

        await writeInvoiceAudit(req, result.fattura, 'fattura.cancellata', `Cancellata ${invoiceLabel(result.fattura)}`, {
            metadata: {
                numero: result.fattura.numero,
                anno: result.fattura.anno,
                serviziCancellati: result.serviziCancellati,
                letturaSbloccate: result.letturaSbloccate,
                scadenzaCancellata: result.scadenzaCancellata,
            },
        });
        return res.status(204).send();
    } catch (error) {
        return sendServiceError(res, error, 'Error deleting fattura', error.status || 400);
    }
};

const getAuditLog = async (req, res) => {
    try {
        const logs = await getAuditLogs('Fattura', req.params.id, { limit: req.query.limit });
        res.status(200).json(logs);
    } catch (error) {
        sendServiceError(res, error, 'Error fetching fattura audit log');
    }
};

const associateCliente = associateRecords({
    field: 'cliente',
    responseKey: 'fattura',
    setOn: 'source',
    sourceModel: Fattura,
    sourceName: 'Fattura',
    sourceParam: 'fatturaId',
    targetModel: Cliente,
    targetName: 'Cliente',
    targetParam: 'clienteId',
});

const associateServizio = associateRecords({
    field: 'fattura',
    responseKey: 'servizio',
    setOn: 'target',
    sourceModel: Fattura,
    sourceName: 'Fattura',
    sourceParam: 'fatturaId',
    targetModel: Servizio,
    targetName: 'Servizio',
    targetParam: 'servizioId',
});

const associateScadenza = associateRecords({
    field: 'scadenza',
    responseKey: 'scadenza',
    responseRecord: 'target',
    setOn: 'source',
    sourceModel: Fattura,
    sourceName: 'Fattura',
    sourceParam: 'fatturaId',
    targetModel: Scadenza,
    targetName: 'Scadenza',
    targetParam: 'scadenzaId',
});

module.exports = {
    createFattura,
    getFatture,
    generateFromReadings,
    getGenerationPreview,
    getControlDashboard,
    applyFixedCharge,
    getFattura: getRecord(Fattura, { name: 'Fattura', populate: 'cliente scadenza' }),
    verifyCalcolo,
    downloadPdf,
    updateFattura,
    deleteFattura,
    getAuditLog,
    associateCliente: withEditableInvoice(associateCliente, 'fatturaId', 'associare il cliente'),
    associateServizio: withEditableInvoice(associateServizio, 'fatturaId', 'associare il servizio'),
    associateScadenza: withEditableInvoice(associateScadenza, 'fatturaId', 'associare la scadenza'),
    getServiziAssociati: getManyByField({
        Model: Servizio,
        field: 'fattura',
        populate: 'lettura articolo listino fascia',
        errorMessage: 'Error fetching servizi associati',
    }),
    getClienteAssociato: getPopulatedRelation({ Model: Fattura, name: 'Fattura', path: 'cliente' }),
    getScadenzaAssociata: getPopulatedRelation({
        Model: Fattura,
        name: 'Fattura',
        path: 'scadenza',
        transform: withComputedDelay,
    }),
};
