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
const { badRequest, conflict } = require('../utils/errors');
const { escapeRegex, parseBoolean } = require('../utils/values');
const { calculateReadingById } = require('../services/calcoloLettura');
const { misuraCambiata } = require('../services/misuraLettura');
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

// Una lettura che una fattura usa resta com'e: la fattura ne ha preso la misura,
// e la lettura dopo parte da li. Toglierle lo stato "fatturata" la rimetterebbe
// fra quelle da fatturare, e il cliente pagherebbe due volte. Se ne correggono
// le note; per il resto va prima cancellata la fattura, che la libera. Una
// lettura che nessuna fattura usa - quella d'installazione di un contatore, che
// si segna fatturata perche non si fatturi - resta libera.
const perLaModifica = async (body, req) => {
    const corpo = controllaData(body);

    if (!(await Servizio.exists({ lettura: req.params.id }))) {
        return corpo;
    }

    const esistente = await Lettura.findById(req.params.id).lean();
    const tornaDaFatturare = Object.hasOwn(corpo, 'fatturata') && !parseBoolean(corpo.fatturata);

    if (tornaDaFatturare || misuraCambiata(esistente, corpo).length) {
        throw conflict('Lettura usata da una fattura: valore, data, contatore e stato di fatturazione non si '
            + 'cambiano più. Per correggerli va prima cancellata la fattura che la usa.');
    }

    return corpo;
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
        sendServiceError(res, error, 'Calcolo della lettura non riuscito.');
    }
};

module.exports = {
    createLettura: createRecord(Lettura, { name: 'Lettura', mapBody: controllaData }),
    getLetture: (req, res) => sendPaginated(Lettura, req, res, {
        views: letturaViews,
        defaultSort: 'data_lettura',
        errorMessage: 'Elenco delle letture non disponibile.',
        populate: contatoreConCliente,
        ricercaCollegata: letturePerNomeCliente,
    }),
    getLettura: getRecord(Lettura, { name: 'Lettura', populate: populatedContatore }),
    getCalcolo,
    updateLettura: updateRecord(Lettura, { name: 'Lettura', mapBody: perLaModifica }),
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
        errorMessage: 'Righe di fattura della lettura non disponibili.',
    }),
};
