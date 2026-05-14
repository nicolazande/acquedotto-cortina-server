const mongoose = require('mongoose');

const noteAttachmentSchema = new mongoose.Schema(
    {
        resource: { type: String, required: true, index: true },
        recordId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        field: { type: String, default: 'note', index: true },
        filename: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true },
        data: { type: Buffer, required: true },
    },
    {
        collection: 'note_attachments',
        timestamps: true,
    }
);

noteAttachmentSchema.index({ resource: 1, recordId: 1, field: 1, createdAt: -1 });

module.exports = mongoose.model('NoteAttachment', noteAttachmentSchema);
