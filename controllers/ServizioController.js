const Servizio = require('../models/Servizio');
const Lettura = require('../models/Lettura');
const Articolo = require('../models/Articolo');
const Fattura = require('../models/Fattura');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getPopulatedRelation,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');

const populate = 'lettura articolo fattura listino fascia';

module.exports = {
    createServizio: createRecord(Servizio, { name: 'Servizio' }),
    getServizi: (req, res) => sendPaginated(Servizio, req, res, {
        defaultSort: 'descrizione',
        errorMessage: 'Error fetching servizi',
        populate,
    }),
    getServizio: getRecord(Servizio, { name: 'Servizio', populate }),
    updateServizio: updateRecord(Servizio, { name: 'Servizio' }),
    deleteServizio: deleteRecord(Servizio, { name: 'Servizio' }),
    associateLettura: associateRecords({
        field: 'lettura',
        responseKey: 'servizio',
        setOn: 'source',
        sourceModel: Servizio,
        sourceName: 'Servizio',
        sourceParam: 'servizioId',
        targetModel: Lettura,
        targetName: 'Lettura',
        targetParam: 'letturaId',
    }),
    associateArticolo: associateRecords({
        field: 'articolo',
        responseKey: 'servizio',
        setOn: 'source',
        sourceModel: Servizio,
        sourceName: 'Servizio',
        sourceParam: 'servizioId',
        targetModel: Articolo,
        targetName: 'Articolo',
        targetParam: 'articoloId',
    }),
    associateFattura: associateRecords({
        field: 'fattura',
        responseKey: 'servizio',
        setOn: 'source',
        sourceModel: Servizio,
        sourceName: 'Servizio',
        sourceParam: 'servizioId',
        targetModel: Fattura,
        targetName: 'Fattura',
        targetParam: 'fatturaId',
    }),
    getLetturaAssociata: getPopulatedRelation({ Model: Servizio, name: 'Servizio', path: 'lettura' }),
    getFatturaAssociata: getPopulatedRelation({ Model: Servizio, name: 'Servizio', path: 'fattura' }),
    getArticoloAssociato: getPopulatedRelation({ Model: Servizio, name: 'Servizio', path: 'articolo' }),
};
