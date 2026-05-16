const Contatore = require('../models/Contatore');
const Cliente = require('../models/Cliente');
const Edificio = require('../models/Edificio');
const Listino = require('../models/Listino');
const Lettura = require('../models/Lettura');
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

const populate = 'edificio listino cliente';

module.exports = {
    createContatore: createRecord(Contatore, { name: 'Contatore' }),
    getContatori: (req, res) => sendPaginated(Contatore, req, res, {
        defaultSort: 'nome_cliente',
        errorMessage: 'Error fetching contatori',
        populate,
    }),
    getContatore: getRecord(Contatore, { name: 'Contatore', populate }),
    updateContatore: updateRecord(Contatore, { name: 'Contatore' }),
    deleteContatore: deleteRecord(Contatore, { name: 'Contatore' }),
    associateCliente: associateRecords({
        field: 'cliente',
        responseKey: 'contatore',
        setOn: 'source',
        sourceModel: Contatore,
        sourceName: 'Contatore',
        sourceParam: 'contatoreId',
        targetModel: Cliente,
        targetName: 'Cliente',
        targetParam: 'clienteId',
    }),
    associateEdificio: associateRecords({
        field: 'edificio',
        responseKey: 'contatore',
        setOn: 'source',
        sourceModel: Contatore,
        sourceName: 'Contatore',
        sourceParam: 'contatoreId',
        targetModel: Edificio,
        targetName: 'Edificio',
        targetParam: 'edificioId',
    }),
    associateListino: associateRecords({
        field: 'listino',
        responseKey: 'contatore',
        setOn: 'source',
        sourceModel: Contatore,
        sourceName: 'Contatore',
        sourceParam: 'contatoreId',
        targetModel: Listino,
        targetName: 'Listino',
        targetParam: 'listinoId',
    }),
    associateLettura: associateRecords({
        field: 'contatore',
        responseKey: 'lettura',
        setOn: 'target',
        sourceModel: Contatore,
        sourceName: 'Contatore',
        sourceParam: 'contatoreId',
        targetModel: Lettura,
        targetName: 'Lettura',
        targetParam: 'letturaId',
    }),
    getListinoAssociato: getPopulatedRelation({ Model: Contatore, name: 'Contatore', path: 'listino' }),
    getEdificioAssociato: getPopulatedRelation({ Model: Contatore, name: 'Contatore', path: 'edificio' }),
    getLettureAssociate: getManyByField({
        Model: Lettura,
        field: 'contatore',
        errorMessage: 'Error fetching letture associate',
    }),
    getClienteAssociato: getPopulatedRelation({ Model: Contatore, name: 'Contatore', path: 'cliente' }),
};
