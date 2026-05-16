const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');
const {
    createInvoiceFromReadings,
    previewClienteBilling,
} = require('../services/invoiceGenerator');

const handleError = (res, error, message, status = 500) => {
    console.error(error);
    res.status(error.status || status).json({ error: error.message || message });
};

const getClienti = (req, res) => sendPaginated(Cliente, req, res, {
    defaultSort: 'nome',
    errorMessage: 'Error fetching clienti',
});

const getFatturazionePreview = async (req, res) => {
    try {
        const result = await previewClienteBilling(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        handleError(res, error, 'Error fetching cliente billing preview');
    }
};

const generateFattura = async (req, res) => {
    try {
        const preview = await previewClienteBilling(req.params.id);
        const requestedIds = req.body.letture || req.body.letturaIds;
        const letture = requestedIds?.length
            ? requestedIds
            : preview.previews
                .filter((item) => !item.error && item.lines?.length)
                .map((item) => item.lettura._id);

        const result = await createInvoiceFromReadings({
            letture,
            data_fattura: req.body.data_fattura,
            data_scadenza: req.body.data_scadenza,
            tipo_documento: req.body.tipo_documento,
            confermata: req.body.confermata,
        });

        res.status(201).json(result);
    } catch (error) {
        handleError(res, error, 'Error generating cliente fattura', 400);
    }
};

module.exports = {
    createCliente: createRecord(Cliente, { name: 'Cliente' }),
    getClienti,
    getCliente: getRecord(Cliente, { name: 'Cliente' }),
    getFatturazionePreview,
    generateFattura,
    updateCliente: updateRecord(Cliente, { name: 'Cliente' }),
    deleteCliente: deleteRecord(Cliente, { name: 'Cliente' }),
    associateContatore: associateRecords({
        field: 'cliente',
        responseKey: 'contatore',
        setOn: 'target',
        sourceModel: Cliente,
        sourceName: 'Cliente',
        sourceParam: 'clienteId',
        targetModel: Contatore,
        targetName: 'Contatore',
        targetParam: 'contatoreId',
    }),
    associateFattura: associateRecords({
        field: 'cliente',
        responseKey: 'fattura',
        setOn: 'target',
        sourceModel: Cliente,
        sourceName: 'Cliente',
        sourceParam: 'clienteId',
        targetModel: Fattura,
        targetName: 'Fattura',
        targetParam: 'fatturaId',
    }),
    getContatoriAssociati: getManyByField({
        Model: Contatore,
        field: 'cliente',
        errorMessage: 'Error fetching contatori associati',
    }),
    getFattureAssociate: getManyByField({
        Model: Fattura,
        field: 'cliente',
        errorMessage: 'Error fetching fatture associate',
    }),
};
