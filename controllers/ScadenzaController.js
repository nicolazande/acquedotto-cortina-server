const Scadenza = require('../models/Scadenza');
const Fattura = require('../models/Fattura');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');
const { withComputedDelay } = require('../services/deadlineService');

module.exports = {
    createScadenza: createRecord(Scadenza, {
        name: 'Scadenza',
        mapBody: withComputedDelay,
        transform: withComputedDelay,
    }),
    getScadenze: (req, res) => sendPaginated(Scadenza, req, res, {
        defaultLimit: 100,
        defaultSort: 'scadenza',
        errorMessage: 'Error fetching scadenze',
        transform: withComputedDelay,
    }),
    getScadenza: getRecord(Scadenza, { name: 'Scadenza', transform: withComputedDelay }),
    updateScadenza: updateRecord(Scadenza, {
        name: 'Scadenza',
        mapBody: withComputedDelay,
        transform: withComputedDelay,
    }),
    deleteScadenza: deleteRecord(Scadenza, { name: 'Scadenza' }),
    associateFattura: associateRecords({
        field: 'scadenza',
        responseKey: 'scadenza',
        responseRecord: 'source',
        setOn: 'target',
        sourceModel: Scadenza,
        sourceName: 'Scadenza',
        sourceParam: 'scadenzaId',
        targetModel: Fattura,
        targetName: 'Fattura',
        targetParam: 'fatturaId',
    }),
    getFatturaAssociata: async (req, res) => {
        try {
            const fattura = await Fattura.findOne({ scadenza: req.params.id });
            res.status(200).json(fattura);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura associata' });
        }
    },
};
