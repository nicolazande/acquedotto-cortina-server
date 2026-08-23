const Consegna = require('../models/Consegna');
const { sendPaginated } = require('./utils/paginatedQuery');
const { sendServiceError } = require('./utils/controllerActions');
const { writeAuditLog } = require('../services/auditLogService');
const { verificaTrasporto } = require('../services/mailer');
const {
    annullaConsegna,
    anteprimaFattura,
    elaboraCoda,
    pianificaConsegne,
    riepilogo,
    rimettiInCoda,
    segnaConsegnata,
} = require('../services/deliveryService');
const { consegnaViews } = require('../config/listViews');

// Ogni operazione sulla coda lascia traccia: sapere chi ha lanciato una
// spedizione, e quante ne sono partite, e la prima domanda che ci si fa quando
// un cliente dice di non aver ricevuto nulla.
const registra = (req, consegna, action, summary, metadata) => writeAuditLog({
    action,
    entityId: consegna?._id || consegna,
    entityType: 'Consegna',
    metadata,
    req,
    summary,
});

const getConsegne = (req, res) => sendPaginated(Consegna, req, res, {
    views: consegnaViews,
    defaultSort: 'createdAt',
    errorMessage: 'Error fetching consegne',
    populate: 'cliente',
});

const getRiepilogo = async (req, res) => {
    try {
        res.status(200).json(await riepilogo());
    } catch (error) {
        sendServiceError(res, error, 'Error fetching consegne summary');
    }
};

const getAnteprima = async (req, res) => {
    try {
        res.status(200).json(await anteprimaFattura(req.params.id));
    } catch (error) {
        sendServiceError(res, error, 'Error building consegna preview');
    }
};

const pianifica = async (req, res) => {
    try {
        const esito = await pianificaConsegne({
            fatture: req.body.fatture,
            anno: req.body.anno,
            limite: req.body.limite,
        });
        await registra(req, null, 'consegna.pianificata', `Pianificate ${esito.create} consegne`, esito);
        res.status(200).json(esito);
    } catch (error) {
        sendServiceError(res, error, 'Error planning consegne', 400);
    }
};

const elabora = async (req, res) => {
    try {
        const esito = await elaboraCoda({
            limite: req.body.limite,
            tipo: req.body.tipo,
            fatture: req.body.fatture,
        });
        await registra(
            req,
            null,
            'consegna.elaborata',
            `Elaborate ${esito.elaborate} consegne: ${esito.inviate} inviate, ${esito.simulate} simulate, ${esito.errori} in errore`,
            { elaborate: esito.elaborate, inviate: esito.inviate, simulate: esito.simulate, errori: esito.errori }
        );
        res.status(200).json(esito);
    } catch (error) {
        sendServiceError(res, error, 'Error processing consegne', 400);
    }
};

const azione = (esegui, action, descrizione) => async (req, res) => {
    try {
        const consegna = await esegui(req.params.id, { note: req.body?.note });
        await registra(req, consegna, action, `${descrizione} ${consegna.documento || ''}`.trim());
        res.status(200).json(consegna);
    } catch (error) {
        sendServiceError(res, error, 'Error updating consegna', error.status || 400);
    }
};

const provaTrasporto = async (req, res) => {
    try {
        res.status(200).json(await verificaTrasporto());
    } catch (error) {
        sendServiceError(res, error, 'Error verifying mail transport');
    }
};

module.exports = {
    annulla: azione(annullaConsegna, 'consegna.annullata', 'Annullata consegna'),
    elabora,
    getAnteprima,
    getConsegne,
    getRiepilogo,
    pianifica,
    provaTrasporto,
    rimettiInCoda: azione(rimettiInCoda, 'consegna.riaccodata', 'Rimessa in coda la consegna'),
    segnaConsegnata: azione(segnaConsegnata, 'consegna.evasa', 'Evasa consegna'),
};
