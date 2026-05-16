const Edificio = require('../models/Edificio');
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
    createEdificio: createRecord(Edificio, { name: 'Edificio' }),
    getEdifici: (req, res) => sendPaginated(Edificio, req, res, {
        defaultSort: 'descrizione',
        errorMessage: 'Error fetching edifici',
    }),
    getEdificio: getRecord(Edificio, { name: 'Edificio' }),
    updateEdificio: updateRecord(Edificio, { name: 'Edificio' }),
    deleteEdificio: deleteRecord(Edificio, { name: 'Edificio' }),
    associateContatore: associateRecords({
        field: 'edificio',
        responseKey: 'contatore',
        setOn: 'target',
        sourceModel: Edificio,
        sourceName: 'Edificio',
        sourceParam: 'edificioId',
        targetModel: Contatore,
        targetName: 'Contatore',
        targetParam: 'contatoreId',
    }),
    getContatoriAssociati: getManyByField({
        Model: Contatore,
        field: 'edificio',
        idParam: 'edificioId',
        populate: 'cliente',
        errorMessage: 'Error fetching contatori associati',
    }),
};
