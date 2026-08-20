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

// Le tariffe determinano quanto pagano i clienti: ogni modifica lascia traccia.
const audit = {
        entityType: 'Fascia',
        fields: ['tipo', 'min', 'max', 'prezzo', 'inizio', 'scadenza', 'listino'],
        label: (record) => `${record.tipo} ${record.min}-${record.max} a ${record.prezzo}`,
    };

module.exports = {
    createFascia: createRecord(Fascia, { audit, name: 'Fascia' }),
    getFasce: (req, res) => sendPaginated(Fascia, req, res, {
        defaultSort: 'tipo',
        errorMessage: 'Error fetching fasce',
        populate: 'listino',
    }),
    getFascia: getRecord(Fascia, { name: 'Fascia', populate: 'listino' }),
    updateFascia: updateRecord(Fascia, { audit, name: 'Fascia' }),
    deleteFascia: deleteRecord(Fascia, { audit, name: 'Fascia' }),
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
