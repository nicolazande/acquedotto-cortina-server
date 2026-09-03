const mongoose = require('mongoose');
const { getResourceModel } = require('../config/resources');
const NoteAttachment = require('../models/NoteAttachment');
const { getUserRole, puoUsareRisorsa } = require('../config/permessi');

// Un allegato vale quanto il documento a cui e attaccato: le note su un
// contatore le puo leggere chi puo leggere quel contatore, quelle su una fattura
// no. La rotta e una sola per tutte le risorse, quindi il controllo si fa qui,
// sul nome della risorsa che arriva nell'indirizzo - altrimenti aprire gli
// allegati al letturista gli aprirebbe anche quelli delle fatture. La regola e
// la stessa che protegge le rotte, e viene da li: riscriverla qui vorrebbe dire
// due regole che un giorno diranno cose diverse.
const puoAccedere = (req, risorsa, opzioni) => puoUsareRisorsa(getUserRole(req.user), risorsa, opzioni);

const permessiInsufficienti = (res) => res.status(403).json({ error: 'Permessi insufficienti' });

const allowedAttachmentTypes = new Set([
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/plain',
]);

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

const contentTypeByExtension = Object.entries(extensionByType).reduce((types, [contentType, extension]) => ({
    ...types,
    [extension]: contentType,
}), {});

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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
        throw new Error('Attachment data is required');
    }

    const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/);
    const payloadContentType = dataUrlMatch ? dataUrlMatch[1] : contentType;
    const detectedContentType = allowedAttachmentTypes.has(payloadContentType)
        ? payloadContentType
        : getContentTypeFromFilename(filename);
    const base64Data = dataUrlMatch ? dataUrlMatch[2] : data;

    if (!allowedAttachmentTypes.has(detectedContentType)) {
        throw new Error('Unsupported attachment type');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) {
        throw new Error('Attachment data is empty');
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
                return res.status(400).json({ error: 'Invalid attachment target' });
            }

            const attachments = await NoteAttachment
                .find({ resource, recordId: recordFilter._id, field: 'note' })
                .select('-data')
                .sort({ createdAt: -1 });

            return res.status(200).json(attachments.map(serializeAttachment));
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Error fetching note attachments' });
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
                return res.status(400).json({ error: 'Invalid attachment target' });
            }

            const exists = await Model.exists(recordFilter);
            if (!exists) {
                return res.status(404).json({ error: 'Record not found' });
            }

            const { buffer, contentType } = decodeAttachmentPayload(req.body);
            const maxBytes = getMaxBytes();
            if (buffer.length > maxBytes) {
                return res.status(413).json({ error: `Attachment exceeds ${maxBytes} bytes` });
            }

            const attachment = await NoteAttachment.create({
                resource,
                recordId: recordFilter._id,
                field: 'note',
                filename: safeFilename(req.body.filename, contentType),
                contentType,
                size: buffer.length,
                data: buffer,
            });

            return res.status(201).json(serializeAttachment(attachment));
        } catch (error) {
            console.error(error);
            return res.status(400).json({ error: 'Error creating note attachment' });
        }
    }

    static async file(req, res) {
        try {
            const attachment = await NoteAttachment.findById(req.params.id);
            if (!attachment) {
                return res.status(404).json({ error: 'Attachment not found' });
            }

            if (!puoAccedere(req, attachment.resource)) {
                return permessiInsufficienti(res);
            }

            res.set('Content-Type', attachment.contentType);
            res.set('Content-Length', String(attachment.size));
            res.set('Cache-Control', 'private, max-age=3600');
            res.set('Content-Disposition', `inline; filename="${attachment.filename}"`);
            res.set('X-Content-Type-Options', 'nosniff');
            return res.send(attachment.data);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Error fetching attachment file' });
        }
    }

    static async remove(req, res) {
        try {
            // Si guarda prima di cancellare: sapere a cosa e attaccato serve a
            // decidere se chi chiede puo farlo.
            const attachment = await NoteAttachment.findById(req.params.id);
            if (!attachment) {
                return res.status(404).json({ error: 'Attachment not found' });
            }

            if (!puoAccedere(req, attachment.resource, { scrittura: true })) {
                return permessiInsufficienti(res);
            }

            await NoteAttachment.deleteOne({ _id: attachment._id });
            return res.status(204).send();
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Error deleting attachment' });
        }
    }
}

module.exports = NoteAttachmentController;
