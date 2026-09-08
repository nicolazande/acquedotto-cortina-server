const mongoose = require('mongoose');

const noteAttachmentSchema = new mongoose.Schema(
    {
        resource: { type: String, required: true, index: true },
        recordId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        field: { type: String, default: 'note', index: true },
        filename: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true },
        // I byte stanno qui oppure in un archivio a oggetti, mai in tutti e due:
        // `data` per quelli salvati nel database, `chiave` per quelli riposti
        // fuori. Vecchi e nuovi convivono senza migrazioni - un allegato caricato
        // prima di accendere l'archivio continua a leggersi da qui.
        data: { type: Buffer, required: false },
        chiave: { type: String, required: false },
    },
    {
        collection: 'note_attachments',
        timestamps: true,
    }
);

noteAttachmentSchema.index({ resource: 1, recordId: 1, field: 1, createdAt: -1 });

module.exports = mongoose.model('NoteAttachment', noteAttachmentSchema);
