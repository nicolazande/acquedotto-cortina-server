const Edificio = require('../models/Edificio');
const Contatore = require('../models/Contatore');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getRecord,
    sendServiceError,
    updateRecord,
} = require('./utils/controllerActions');

// Tutti gli edifici che stanno su una mappa, senza paginazione.
//
// L'elenco e paginato, e la mappa mostrava percio soltanto gli edifici della
// pagina aperta: chi deve organizzare un giro di letture per zona vedeva
// cinquanta punti su centosettanta e non poteva sapere cosa mancava. Sono
// centosettanta record di quattro campi, una manciata di kB: si mandano tutti.
// Una latitudine sta fra -90 e 90, una longitudine fra -180 e 180: fuori di li
// non e un punto sbagliato, non e un punto. Un edificio importato con la
// longitudine 12142838 invece di 12.142838 - il punto decimale perso per strada
// - obbligava la mappa a inquadrare mezzo pianeta, e degli altri centosessanta
// non si vedeva piu niente. Restano fuori dalla mappa e contati fra quelli
// senza posizione, che e cio che sono finche qualcuno non li corregge.
const getMappa = async (req, res) => {
    try {
        const edifici = await Edificio.find({
            latitudine: { $nin: [null, 0], $gte: -90, $lte: 90 },
            longitudine: { $nin: [null, 0], $gte: -180, $lte: 180 },
        })
            .select('descrizione nome_edificio indirizzo latitudine longitudine')
            .sort({ descrizione: 1 })
            .lean();

        // Quanti restano fuori dalla mappa va detto, non nascosto: sono edifici
        // che esistono e che qualcuno dovra pur andare a leggere. Si ricava per
        // differenza invece di ripetere al negativo le condizioni qui sopra:
        // due filtri scritti a mano possono divergere, una sottrazione no.
        const totale = await Edificio.countDocuments();

        res.status(200).json({ data: edifici, senzaPosizione: totale - edifici.length });
    } catch (error) {
        sendServiceError(res, error, 'Error fetching mappa edifici');
    }
};

module.exports = {
    createEdificio: createRecord(Edificio, { name: 'Edificio' }),
    getMappa,
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
