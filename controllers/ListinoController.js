const Listino = require('../models/Listino');
const Fascia = require('../models/Fascia');
const Contatore = require('../models/Contatore');
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
    createListino: createRecord(Listino, { name: 'Listino' }),
    getListini: (req, res) => sendPaginated(Listino, req, res, {
        defaultSort: 'categoria',
        errorMessage: 'Error fetching listini',
    }),
    getListino: getRecord(Listino, { name: 'Listino' }),
    updateListino: updateRecord(Listino, { name: 'Listino' }),
    deleteListino: deleteRecord(Listino, { name: 'Listino' }),
    associateFascia: associateRecords({
        field: 'listino',
        responseKey: 'fascia',
        setOn: 'target',
        sourceModel: Listino,
        sourceName: 'Listino',
        sourceParam: 'listinoId',
        targetModel: Fascia,
        targetName: 'Fascia',
        targetParam: 'fasciaId',
    }),
    getFasceAssociate: getManyByField({
        Model: Fascia,
        field: 'listino',
        errorMessage: 'Error fetching fasce associate',
    }),
    associateContatore: associateRecords({
        field: 'listino',
        responseKey: 'contatore',
        setOn: 'target',
        sourceModel: Listino,
        sourceName: 'Listino',
        sourceParam: 'listinoId',
        targetModel: Contatore,
        targetName: 'Contatore',
        targetParam: 'contatoreId',
    }),
    getContatoriAssociati: getManyByField({
        Model: Contatore,
        field: 'listino',
        errorMessage: 'Error fetching contatori associati',
    }),
};
