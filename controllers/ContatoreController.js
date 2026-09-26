const Contatore = require('../models/Contatore');
const Cliente = require('../models/Cliente');
const Edificio = require('../models/Edificio');
const Listino = require('../models/Listino');
const Lettura = require('../models/Lettura');
const { sendPaginated } = require('./utils/paginatedQuery');
const { storiaContatore } = require('../services/counterHistoryService');
const { CAMPI_PER_LETTURISTA } = require('../utils/customer');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    sendServiceError,
    updateRecord,
} = require('./utils/controllerActions');

const { contatoreViews } = require('../config/listViews');

// Il cliente arriva ridotto a cio che identifica: la scheda del contatore mostra
// `nome_cliente`, che e gia salvato, e il resto lo chiede alla sua risorsa. Cosi
// un elenco di contatori non si porta dietro IBAN e dati fiscali di novecento
// persone.
const populate = [
    { path: 'edificio' },
    { path: 'listino' },
    { path: 'cliente', select: CAMPI_PER_LETTURISTA.join(' ') },
];

const getStoria = async (req, res) => {
    try {
        res.status(200).json(await storiaContatore(req.params.id));
    } catch (error) {
        sendServiceError(res, error, 'Storia del contatore non disponibile.', error.status || 400);
    }
};

module.exports = {
    getStoria,
    createContatore: createRecord(Contatore, { name: 'Contatore' }),
    getContatori: (req, res) => sendPaginated(Contatore, req, res, {
        views: contatoreViews,
        defaultSort: 'nome_cliente',
        errorMessage: 'Elenco dei contatori non disponibile.',
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
        errorMessage: 'Letture del contatore non disponibili.',
    }),
    getClienteAssociato: getPopulatedRelation({ Model: Contatore, name: 'Contatore', path: 'cliente' }),
};
