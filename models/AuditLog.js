const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const auditChangeSchema = new Schema(
    {
        field: String,
        before: Schema.Types.Mixed,
        after: Schema.Types.Mixed,
    },
    { _id: false }
);

const auditLogSchema = new Schema(
    {
        entityType: { type: String, required: true, index: true },
        // Quasi tutte le azioni riguardano un record; alcune sono operazioni su
        // un lotto (una spedizione, un incasso registrato in blocco) e non hanno
        // un singolo record a cui appartenere. Prima erano richieste e le voci
        // di lotto venivano scartate in silenzio.
        entityId: { type: Schema.Types.ObjectId, required: false, index: true },
        action: { type: String, required: true, index: true },
        summary: String,
        actor: { type: Schema.Types.ObjectId, ref: 'User' },
        actorUsername: String,
        actorRole: String,
        changes: [auditChangeSchema],
        metadata: Schema.Types.Mixed,
    },
    {
        collection: 'audit_logs',
        timestamps: { createdAt: true, updatedAt: false },
    }
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
