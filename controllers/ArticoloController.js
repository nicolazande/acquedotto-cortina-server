const Articolo = require('../models/Articolo');
const Servizio = require('../models/Servizio');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');

module.exports = {
    createArticolo: createRecord(Articolo, { name: 'Articolo' }),
    getArticoli: (req, res) => sendPaginated(Articolo, req, res, {
        defaultSort: 'descrizione',
        errorMessage: 'Error fetching articoli',
    }),
    getArticolo: getRecord(Articolo, { name: 'Articolo' }),
    updateArticolo: updateRecord(Articolo, { name: 'Articolo' }),
    deleteArticolo: deleteRecord(Articolo, { name: 'Articolo' }),
    associateServizio: associateRecords({
        field: 'articolo',
        responseKey: 'servizio',
        setOn: 'target',
        sourceModel: Articolo,
        sourceName: 'Articolo',
        sourceParam: 'articoloId',
        targetModel: Servizio,
        targetName: 'Servizio',
        targetParam: 'servizioId',
    }),
    getServiziAssociati: getManyByField({
        Model: Servizio,
        field: 'articolo',
        errorMessage: 'Error fetching servizi associati',
    }),
};
