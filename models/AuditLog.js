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
        entityId: { type: Schema.Types.ObjectId, required: true, index: true },
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
