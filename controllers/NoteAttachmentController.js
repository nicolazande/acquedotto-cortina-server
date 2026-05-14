const mongoose = require('mongoose');
const NoteAttachment = require('../models/NoteAttachment');
const Articolo = require('../models/Articolo');
const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Edificio = require('../models/Edificio');
const Fascia = require('../models/Fascia');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Listino = require('../models/Listino');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');

const resourceModels = {
    articoli: Articolo,
    clienti: Cliente,
    contatori: Contatore,
    edifici: Edificio,
    fasce: Fascia,
    fatture: Fattura,
    letture: Lettura,
    listini: Listino,
    scadenze: Scadenza,
    servizi: Servizio,
};

const allowedImageTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
]);

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

const getResourceModel = (resource) => resourceModels[resource];

const getRecordFilter = (recordId) => {
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
        return null;
    }

    return { _id: new mongoose.Types.ObjectId(recordId) };
};

const decodeImagePayload = ({ data, contentType }) => {
    if (!data || typeof data !== 'string') {
        throw new Error('Image data is required');
    }

    const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/);
    const detectedContentType = dataUrlMatch ? dataUrlMatch[1] : contentType;
    const base64Data = dataUrlMatch ? dataUrlMatch[2] : data;

    if (!allowedImageTypes.has(detectedContentType)) {
        throw new Error('Unsupported image type');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) {
        throw new Error('Image data is empty');
    }

    return { buffer, contentType: detectedContentType };
};

const safeFilename = (filename, contentType) => {
    const fallbackExtension = contentType.split('/')[1] || 'jpg';
    const cleaned = String(filename || `allegato.${fallbackExtension}`)
        .replace(/[^\w.\- ]+/g, '')
        .trim();

    return cleaned || `allegato.${fallbackExtension}`;
};

class NoteAttachmentController {
    static async list(req, res) {
        try {
            const { resource, recordId } = req.params;
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

            const { buffer, contentType } = decodeImagePayload(req.body);
            const maxBytes = getMaxBytes();
            if (buffer.length > maxBytes) {
                return res.status(413).json({ error: `Image exceeds ${maxBytes} bytes` });
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

            res.set('Content-Type', attachment.contentType);
            res.set('Content-Length', String(attachment.size));
            res.set('Cache-Control', 'private, max-age=3600');
            res.set('Content-Disposition', `inline; filename="${attachment.filename}"`);
            return res.send(attachment.data);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Error fetching attachment file' });
        }
    }

    static async remove(req, res) {
        try {
            const deleted = await NoteAttachment.findByIdAndDelete(req.params.id);
            if (!deleted) {
                return res.status(404).json({ error: 'Attachment not found' });
            }

            return res.status(204).send();
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Error deleting attachment' });
        }
    }
}

module.exports = NoteAttachmentController;
