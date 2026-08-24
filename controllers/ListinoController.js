const Listino = require('../models/Listino');
const Fascia = require('../models/Fascia');
const Contatore = require('../models/Contatore');
const { sendPaginated } = require('./utils/paginatedQuery');
const { sendServiceError } = require('./utils/controllerActions');
const { writeAuditLog } = require('../services/auditLogService');
const { anteprimaRinnovo, rinnovaTariffe } = require('../services/tariffService');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');

// Le tariffe determinano quanto pagano i clienti: ogni modifica lascia traccia.
const audit = {
        entityType: 'Listino',
        fields: ['categoria', 'descrizione'],
        label: (record) => record.categoria,
    };

// Cosa succederebbe rinnovando le tariffe per un anno: quali fasce verrebbero
// create, con quale prezzo, e se il risultato resterebbe completo.
const getRinnovo = async (req, res) => {
    try {
        res.status(200).json(await anteprimaRinnovo({
            listinoId: req.params.id,
            anno: req.query.anno || new Date().getFullYear() + 1,
            variazione: req.query.variazione,
        }));
    } catch (error) {
        sendServiceError(res, error, 'Error building tariff renewal preview');
    }
};

const applicaRinnovo = async (req, res) => {
    try {
        const esito = await rinnovaTariffe({
            listinoId: req.params.id,
            anno: req.body.anno,
            variazione: req.body.variazione,
        });

        // Le tariffe decidono quanto pagano tutti: il rinnovo lascia traccia.
        await writeAuditLog({
            action: 'listino.tariffe_rinnovate',
            entityId: esito.listino._id,
            entityType: 'Listino',
            metadata: { anno: esito.anno, variazione: esito.variazione, fasceCreate: esito.create },
            req,
            summary: `Rinnovate ${esito.create} fasce di ${esito.listino.categoria} per il ${esito.anno}`
                + (esito.variazione ? ` (${esito.variazione > 0 ? '+' : ''}${esito.variazione}%)` : ''),
        });

        res.status(201).json(esito);
    } catch (error) {
        sendServiceError(res, error, 'Error renewing tariffs', error.status || 400);
    }
};

module.exports = {
    getRinnovo,
    applicaRinnovo,
    createListino: createRecord(Listino, { audit, name: 'Listino' }),
    getListini: (req, res) => sendPaginated(Listino, req, res, {
        defaultSort: 'categoria',
        errorMessage: 'Error fetching listini',
    }),
    getListino: getRecord(Listino, { name: 'Listino' }),
    updateListino: updateRecord(Listino, { audit, name: 'Listino' }),
    // Le fasce appartengono al listino: senza di lui non hanno significato, e
    // se ne vanno con lui. I contatori invece lo bloccano.
    deleteListino: deleteRecord(Listino, { audit, cascata: true, name: 'Listino' }),
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
