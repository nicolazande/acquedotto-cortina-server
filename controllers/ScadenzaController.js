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
const { delayAggregation, withComputedDelay } = require('../services/deadlineService');
const { sendServiceError } = require('./utils/controllerActions');
const { writeAuditLog } = require('../services/auditLogService');
const { annullaPagamenti, registraPagamenti } = require('../services/paymentService');
const { scadenzaViews } = require('../config/listViews');
const { formatItalianDate } = require('../utils/dates');

// Registrare un incasso e toccare il denaro: resta traccia sia della singola
// scadenza - per rispondere a "perche questa risulta pagata?" - sia
// dell'operazione nel suo insieme, per rispondere a "cosa ho fatto stamattina?".
const registraNelGiornale = async ({ req, action, scadenze, summary, metadata }) => {
    await writeAuditLog({ action: `${action}.lotto`, entityType: 'Scadenza', metadata, req, summary });

    await Promise.all(scadenze.map((scadenza) => writeAuditLog({
        action,
        entityId: scadenza._id,
        entityType: 'Scadenza',
        metadata,
        req,
        summary,
    })));
};

const registraIncassi = async (req, res) => {
    try {
        const esito = await registraPagamenti({
            scadenze: req.body.scadenze,
            pagamento: req.body.pagamento,
        });

        if (esito.registrate > 0) {
            await registraNelGiornale({
                req,
                action: 'scadenza.incassata',
                scadenze: esito.scadenze,
                summary: `Registrato l'incasso di ${esito.registrate} scadenze del ${formatItalianDate(esito.pagamento)}`,
                metadata: { quante: esito.registrate, totale: esito.totale, pagamento: esito.pagamento },
            });
        }

        res.status(200).json(esito);
    } catch (error) {
        sendServiceError(res, error, 'Error registering payments', error.status || 400);
    }
};

const annullaIncassi = async (req, res) => {
    try {
        const esito = await annullaPagamenti({ scadenze: req.body.scadenze });

        if (esito.annullate > 0) {
            await registraNelGiornale({
                req,
                action: 'scadenza.incasso_annullato',
                scadenze: esito.scadenze,
                summary: `Annullato l'incasso di ${esito.annullate} scadenze`,
                metadata: { quante: esito.annullate, totale: esito.totale },
            });
        }

        res.status(200).json(esito);
    } catch (error) {
        sendServiceError(res, error, 'Error cancelling payments', error.status || 400);
    }
};

module.exports = {
    registraIncassi,
    annullaIncassi,
    createScadenza: createRecord(Scadenza, {
        name: 'Scadenza',
        mapBody: withComputedDelay,
        transform: withComputedDelay,
    }),
    getScadenze: (req, res) => sendPaginated(Scadenza, req, res, {
        addFields: { ritardo: delayAggregation() },
        views: scadenzaViews,
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
