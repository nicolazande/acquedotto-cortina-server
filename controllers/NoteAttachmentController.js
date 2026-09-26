const mongoose = require('mongoose');
const { getResourceModel } = require('../config/resources');
const NoteAttachment = require('../models/NoteAttachment');
const { getUserRole, puoUsareRisorsa } = require('../config/permessi');
const { dimentica, leggi, riponi } = require('../services/archivioFile');
const { badRequest, createError, notFound } = require('../utils/errors');
const { parsePositiveInteger } = require('../utils/values');
const { sendServiceError } = require('./utils/controllerActions');

// Un allegato vale quanto il documento a cui e attaccato: le note su un
// contatore le puo leggere chi puo leggere quel contatore, quelle su una fattura
// no. La rotta e una sola per tutte le risorse, quindi il controllo si fa qui,
// sul nome della risorsa che arriva nell'indirizzo - altrimenti aprire gli
// allegati al letturista gli aprirebbe anche quelli delle fatture. La regola e
// la stessa che protegge le rotte, e viene da li: riscriverla qui vorrebbe dire
// due regole che un giorno diranno cose diverse.
const puoAccedere = (req, risorsa, opzioni) => puoUsareRisorsa(getUserRole(req.user), risorsa, opzioni);

const permessiInsufficienti = (res) => res.status(403).json({ error: 'Permessi insufficienti' });

// I tipi di file che si possono allegare, con l'estensione che prende il nome
// del file salvato: un elenco solo, da cui vengono anche i tipi ammessi.
const extensionByType = {
    'application/msword': 'doc',
    'application/pdf': 'pdf',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'text/csv': 'csv',
    'text/plain': 'txt',
};

const allowedAttachmentTypes = new Set(Object.keys(extensionByType));

const contentTypeByExtension = Object.fromEntries(
    Object.entries(extensionByType).map(([contentType, extension]) => [extension, contentType])
);

const getMaxBytes = () => parsePositiveInteger(process.env.ATTACHMENT_MAX_BYTES, 6 * 1024 * 1024);

const serializeAttachment = (attachment) => ({
    _id: attachment._id,
    resource: attachment.resource,
    recordId: attachment.recordId,
    field: attachment.field,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
});

const getRecordFilter = (recordId) => {
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
        return null;
    }

    return { _id: new mongoose.Types.ObjectId(recordId) };
};

const getContentTypeFromFilename = (filename = '') => {
    const extension = String(filename).split('.').pop()?.toLowerCase();
    return extension ? contentTypeByExtension[extension] : null;
};

const decodeAttachmentPayload = ({ data, contentType, filename }) => {
    if (!data || typeof data !== 'string') {
        throw badRequest('Manca il contenuto dell’allegato.');
    }

    const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/);
    const payloadContentType = dataUrlMatch ? dataUrlMatch[1] : contentType;
    const detectedContentType = allowedAttachmentTypes.has(payloadContentType)
        ? payloadContentType
        : getContentTypeFromFilename(filename);
    const base64Data = dataUrlMatch ? dataUrlMatch[2] : data;

    if (!allowedAttachmentTypes.has(detectedContentType)) {
        throw badRequest(`Tipo di file non ammesso: si allegano ${[...new Set(Object.values(extensionByType))].join(', ')}.`);
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) {
        throw badRequest('L’allegato è vuoto.');
    }

    return { buffer, contentType: detectedContentType };
};

const safeFilename = (filename, contentType) => {
    const fallbackExtension = extensionByType[contentType] || 'bin';
    const cleaned = String(filename || `allegato.${fallbackExtension}`)
        .replace(/[^\w.\- ]+/g, '')
        .trim();

    return cleaned || `allegato.${fallbackExtension}`;
};

const allegatoNonTrovato = () => notFound('Allegato non trovato.');

class NoteAttachmentController {
    static async list(req, res) {
        try {
            const { resource, recordId } = req.params;

            if (!puoAccedere(req, resource)) {
                return permessiInsufficienti(res);
            }

            const Model = getResourceModel(resource);
            const recordFilter = getRecordFilter(recordId);

            if (!Model || !recordFilter) {
                return res.status(400).json({ error: 'Scheda a cui allegare non valida.' });
            }

            const attachments = await NoteAttachment
                .find({ resource, recordId: recordFilter._id, field: 'note' })
                .select('-data')
                .sort({ createdAt: -1 });

            return res.status(200).json(attachments.map(serializeAttachment));
        } catch (error) {
            return sendServiceError(res, error, 'Allegati non disponibili.');
        }
    }

    static async create(req, res) {
        try {
            if (!puoAccedere(req, req.params.resource, { scrittura: true })) {
                return permessiInsufficienti(res);
            }

            const { resource, recordId } = req.params;
            const Model = getResourceModel(resource);
            const recordFilter = getRecordFilter(recordId);

            if (!Model || !recordFilter) {
                return res.status(400).json({ error: 'Scheda a cui allegare non valida.' });
            }

            if (!(await Model.exists(recordFilter))) {
                throw notFound('Scheda non trovata.');
            }

            const { buffer, contentType } = decodeAttachmentPayload(req.body);
            const maxBytes = getMaxBytes();
            if (buffer.length > maxBytes) {
                const mega = String(Number((maxBytes / (1024 * 1024)).toFixed(1))).replace('.', ',');
                throw createError(`L’allegato è troppo grande: il massimo è ${mega} MB.`, 413);
            }

            const filename = safeFilename(req.body.filename, contentType);
            // I byte vanno riposti prima: se l'archivio non risponde non deve
            // restare una scheda che punta a un file che non esiste.
            const contenuto = await riponi({ buffer, contentType, filename });
            const attachment = await NoteAttachment.create({
                resource,
                recordId: recordFilter._id,
                field: 'note',
                filename,
                contentType,
                size: buffer.length,
                ...contenuto,
            });

            return res.status(201).json(serializeAttachment(attachment));
        } catch (error) {
            return sendServiceError(res, error, 'Allegato non salvato.', 400);
        }
    }

    static async file(req, res) {
        try {
            const attachment = await NoteAttachment.findById(req.params.id).orFail(allegatoNonTrovato);

            if (!puoAccedere(req, attachment.resource)) {
                return permessiInsufficienti(res);
            }

            // Il file lo serve sempre il gestionale, anche quando i byte stanno
            // fuori: cosi il controllo dei permessi qui sopra continua a valere e
            // l'archivio resta privato, senza indirizzi pubblici indovinabili.
            const byte = await leggi(attachment);

            res.set('Content-Type', attachment.contentType);
            res.set('Content-Length', String(byte.length));
            res.set('Cache-Control', 'private, max-age=3600');
            res.set('Content-Disposition', `inline; filename="${attachment.filename}"`);
            res.set('X-Content-Type-Options', 'nosniff');
            return res.send(byte);
        } catch (error) {
            return sendServiceError(res, error, 'File dell’allegato non disponibile.');
        }
    }

    static async remove(req, res) {
        try {
            // Si guarda prima di cancellare: sapere a cosa e attaccato serve a
            // decidere se chi chiede puo farlo.
            const attachment = await NoteAttachment.findById(req.params.id).orFail(allegatoNonTrovato);

            if (!puoAccedere(req, attachment.resource, { scrittura: true })) {
                return permessiInsufficienti(res);
            }

            await NoteAttachment.deleteOne({ _id: attachment._id });
            // Il file dopo la scheda, e senza far fallire la cancellazione: un
            // byte rimasto nell'archivio costa un millesimo, una scheda che non
            // si cancella e un difetto che l'utente vede.
            await dimentica(attachment);
            return res.status(204).send();
        } catch (error) {
            return sendServiceError(res, error, 'Allegato non cancellato.');
        }
    }
}

module.exports = NoteAttachmentController;
