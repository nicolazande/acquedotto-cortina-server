const Lettura = require('../models/Lettura');
const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Servizio = require('../models/Servizio');
const { sendPaginated } = require('./utils/paginatedQuery');
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
const { parseOptionalBoolean } = require('./utils/requestOptions');
const { nelFuturo, toDate } = require('../utils/dates');
const { badRequest } = require('../utils/errors');
const { escapeRegex } = require('../utils/values');
const { calculateReadingById } = require('../services/calcoloLettura');
const { letturaViews } = require('../config/listViews');

const populatedContatore = {
    path: 'contatore',
    populate: 'listino',
};

// Chi legge le letture ragiona per persona, non per matricola: nell'elenco deve
// vedere di chi e il contatore. Il cliente arriva popolando la catena, cosi il
// nome resta quello vero e non una copia che invecchia.
const contatoreConCliente = {
    path: 'contatore',
    select: 'codice seriale cliente edificio',
    populate: { path: 'cliente', select: 'ragione_sociale cognome nome' },
};

// Cercare "Ghedina" fra le letture deve trovare le letture dei suoi contatori.
// Si parte dai clienti che corrispondono, si prendono i loro contatori e si
// filtrano le letture su quelli.
const letturePerNomeCliente = async (testo) => {
    const come = { $regex: escapeRegex(testo), $options: 'i' };
    const clienti = await Cliente.find({
        $or: [{ ragione_sociale: come }, { cognome: come }, { nome: come }],
    }).select('_id').lean();

    if (clienti.length === 0) {
        return null;
    }

    const contatori = await Contatore.find({ cliente: { $in: clienti.map((c) => c._id) } })
        .select('_id')
        .lean();

    return contatori.length > 0 ? { contatore: { $in: contatori.map((c) => c._id) } } : null;
};

// Una lettura porta la data in cui e stata fatta. Una data nel futuro e un
// errore di battitura - un anno scritto 20266 - e scritta a mano dal letturista
// capita: salvata, diventerebbe la lettura piu recente del contatore, e la
// fatturazione la userebbe come lettura attuale.
const controllaData = (body) => {
    const data = toDate(body?.data_lettura);

    if (data && nelFuturo(data)) {
        throw badRequest('La data della lettura non può essere nel futuro.');
    }

    return body;
};

const getCalcolo = async (req, res) => {
    try {
        const calculation = await calculateReadingById(req.params.id, {
            includeFixedCharge: parseOptionalBoolean(req.query.includeFixedCharge),
            previousValue: req.query.previousValue,
            currentValue: req.query.currentValue,
        });
        res.status(200).json(calculation);
    } catch (error) {
        sendServiceError(res, error, 'Error calculating lettura invoice preview');
    }
};

module.exports = {
    createLettura: createRecord(Lettura, { name: 'Lettura', mapBody: controllaData }),
    getLetture: (req, res) => sendPaginated(Lettura, req, res, {
        views: letturaViews,
        defaultSort: 'data_lettura',
        errorMessage: 'Error fetching letture',
        populate: contatoreConCliente,
        ricercaCollegata: letturePerNomeCliente,
    }),
    getLettura: getRecord(Lettura, { name: 'Lettura', populate: populatedContatore }),
    getCalcolo,
    updateLettura: updateRecord(Lettura, { name: 'Lettura', mapBody: controllaData }),
    deleteLettura: deleteRecord(Lettura, { name: 'Lettura' }),
    associateContatore: associateRecords({
        field: 'contatore',
        responseKey: 'lettura',
        setOn: 'source',
        sourceModel: Lettura,
        sourceName: 'Lettura',
        sourceParam: 'letturaId',
        targetModel: Contatore,
        targetName: 'Contatore',
        targetParam: 'contatoreId',
    }),
    associateServizio: associateRecords({
        field: 'lettura',
        responseKey: 'servizio',
        setOn: 'target',
        sourceModel: Lettura,
        sourceName: 'Lettura',
        sourceParam: 'letturaId',
        targetModel: Servizio,
        targetName: 'Servizio',
        targetParam: 'servizioId',
    }),
    getContatoreAssociato: getPopulatedRelation({ Model: Lettura, name: 'Lettura', path: 'contatore' }),
    getServiziAssociati: getManyByField({
        Model: Servizio,
        field: 'lettura',
        errorMessage: 'Error fetching servizi associati',
    }),
};
