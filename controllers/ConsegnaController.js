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
    stampaDaConsegnare,
    xmlDaTrasmettere,
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

// Un unico PDF con le fatture da imbustare. Non cambia lo stato delle
// consegne: si stampa, si controlla, e solo dopo si dichiarano evase.
const stampa = async (req, res) => {
    try {
        const { buffer, filename, stampate, rimaste } = await stampaDaConsegnare({ limite: req.body.limite });

        await registra(req, null, 'consegna.stampata', `Stampate ${stampate} fatture da consegnare`, {
            stampate, rimaste,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        // L'intestazione dice quante ne restano fuori: il PDF da solo non
        // potrebbe raccontarlo, e chi stampa deve saperlo.
        res.setHeader('X-Consegne-Rimaste', String(rimaste));
        res.status(200).send(buffer);
    } catch (error) {
        sendServiceError(res, error, 'Error printing deliveries', error.status || 400);
    }
};

// I file XML delle fatture elettroniche ancora da trasmettere, in un archivio.
const scaricaXml = async (req, res) => {
    try {
        const { buffer, filename, quante } = await xmlDaTrasmettere({ limite: req.body.limite });

        await registra(req, null, 'consegna.xml_scaricati', `Scaricati ${quante} file XML da trasmettere`, { quante });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        res.status(200).send(buffer);
    } catch (error) {
        sendServiceError(res, error, 'Error exporting electronic invoices', error.status || 400);
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
    scaricaXml,
    stampa,
    segnaConsegnata: azione(segnaConsegnata, 'consegna.evasa', 'Evasa consegna'),
};
