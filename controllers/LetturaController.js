const Lettura = require('../models/Lettura');
const Contatore = require('../models/Contatore');
const Servizio = require('../models/Servizio');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');
const { calculateReadingById } = require('../services/invoiceGenerator');

const populatedContatore = {
    path: 'contatore',
    populate: 'listino',
};

const getCalcolo = async (req, res) => {
    try {
        const calculation = await calculateReadingById(req.params.id, {
            previousValue: req.query.previousValue,
            currentValue: req.query.currentValue,
        });
        res.status(200).json(calculation);
    } catch (error) {
        console.error(error);
        res.status(error.status || 500).json({ error: error.message || 'Error calculating lettura invoice preview' });
    }
};

module.exports = {
    createLettura: createRecord(Lettura, { name: 'Lettura' }),
    getLetture: (req, res) => sendPaginated(Lettura, req, res, {
        defaultSort: 'data_lettura',
        errorMessage: 'Error fetching letture',
        populate: 'contatore',
    }),
    getLettura: getRecord(Lettura, { name: 'Lettura', populate: populatedContatore }),
    getCalcolo,
    updateLettura: updateRecord(Lettura, { name: 'Lettura' }),
    deleteLettura: deleteRecord(Lettura, { name: 'Lettura' }),
    associateContatore: associateRecords({
        field: 'contatore',
        responseKey: 'lettura',
        setOn: 'source',
        sourceModel: Lettura,
        sourceName: 'Lettura',
        sourceParam: 'letturaId',
        targetModel: Contatore,
        targetName: 'Contatore',
        targetParam: 'contatoreId',
    }),
    associateServizio: associateRecords({
        field: 'lettura',
        responseKey: 'servizio',
        setOn: 'target',
        sourceModel: Lettura,
        sourceName: 'Lettura',
        sourceParam: 'letturaId',
        targetModel: Servizio,
        targetName: 'Servizio',
        targetParam: 'servizioId',
    }),
    getContatoreAssociato: getPopulatedRelation({ Model: Lettura, name: 'Lettura', path: 'contatore' }),
    getServiziAssociati: getManyByField({
        Model: Servizio,
        field: 'lettura',
        errorMessage: 'Error fetching servizi associati',
    }),
};
