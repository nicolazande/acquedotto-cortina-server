const Fattura = require('../models/Fattura');
const Cliente = require('../models/Cliente');
const Servizio = require('../models/Servizio');
const Scadenza = require('../models/Scadenza');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    deleteRecord,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');
const {
    createManualInvoice,
    createInvoiceFromReadings,
    previewBillingBatch,
    verifyInvoiceCalculation,
} = require('../services/invoiceGenerator');
const { withComputedDelay } = require('../services/deadlineService');
const { generateInvoicePdf } = require('../services/invoicePdf');

const handleError = (res, error, message, status = 500) => {
    console.error(error);
    res.status(error.status || status).json({ error: error.message || message });
};

const createFattura = async (req, res) => {
    try {
        const result = await createManualInvoice(req.body);
        res.status(201).json(result.fattura);
    } catch (error) {
        handleError(res, error, 'Error creating fattura', 400);
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
            tipo_documento: req.body.tipo_documento,
            confermata: req.body.confermata,
        });

        res.status(201).json(result);
    } catch (error) {
        handleError(res, error, 'Error generating fattura', 400);
    }
};

const getGenerationPreview = async (req, res) => {
    try {
        const result = await previewBillingBatch({ limit: req.query.limit });
        res.status(200).json(result);
    } catch (error) {
        handleError(res, error, 'Error fetching billing generation preview');
    }
};

const verifyCalcolo = async (req, res) => {
    try {
        const result = await verifyInvoiceCalculation(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        handleError(res, error, 'Error verifying fattura calculation');
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
        handleError(res, error, 'Error generating fattura PDF');
    }
};

module.exports = {
    createFattura,
    getFatture,
    generateFromReadings,
    getGenerationPreview,
    getFattura: getRecord(Fattura, { name: 'Fattura', populate: 'cliente scadenza' }),
    verifyCalcolo,
    downloadPdf,
    updateFattura: updateRecord(Fattura, { name: 'Fattura' }),
    deleteFattura: deleteRecord(Fattura, { name: 'Fattura' }),
    associateCliente: associateRecords({
        field: 'cliente',
        responseKey: 'fattura',
        setOn: 'source',
        sourceModel: Fattura,
        sourceName: 'Fattura',
        sourceParam: 'fatturaId',
        targetModel: Cliente,
        targetName: 'Cliente',
        targetParam: 'clienteId',
    }),
    associateServizio: associateRecords({
        field: 'fattura',
        responseKey: 'servizio',
        setOn: 'target',
        sourceModel: Fattura,
        sourceName: 'Fattura',
        sourceParam: 'fatturaId',
        targetModel: Servizio,
        targetName: 'Servizio',
        targetParam: 'servizioId',
    }),
    associateScadenza: associateRecords({
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
    }),
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
