const Fascia = require('../models/Fascia');
const Listino = require('../models/Listino');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getPopulatedRelation,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');

module.exports = {
    createFascia: createRecord(Fascia, { name: 'Fascia' }),
    getFasce: (req, res) => sendPaginated(Fascia, req, res, {
        defaultSort: 'tipo',
        errorMessage: 'Error fetching fasce',
        populate: 'listino',
    }),
    getFascia: getRecord(Fascia, { name: 'Fascia', populate: 'listino' }),
    updateFascia: updateRecord(Fascia, { name: 'Fascia' }),
    deleteFascia: deleteRecord(Fascia, { name: 'Fascia' }),
    associateListino: associateRecords({
        field: 'listino',
        responseKey: 'fascia',
        setOn: 'source',
        sourceModel: Fascia,
        sourceName: 'Fascia',
        sourceParam: 'fasciaId',
        targetModel: Listino,
        targetName: 'Listino',
        targetParam: 'listinoId',
    }),
    getListinoAssociato: getPopulatedRelation({ Model: Fascia, name: 'Fascia', path: 'listino' }),
};
