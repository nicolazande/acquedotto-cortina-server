const AuditLog = require('../models/AuditLog');
const { getUserRole } = require('../config/permessi');

const normalizeValue = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (value?._id) return String(value._id);
    if (typeof value === 'object' && value.toString && value.constructor?.name === 'ObjectId') {
        return String(value);
    }
    return value;
};

const valueChanged = (before, after) => (
    JSON.stringify(normalizeValue(before)) !== JSON.stringify(normalizeValue(after))
);

const diffFields = (before = {}, after = {}, fields = []) => fields
    .filter((field) => valueChanged(before[field], after[field]))
    .map((field) => ({
        field,
        before: normalizeValue(before[field]),
        after: normalizeValue(after[field]),
    }));

const actorFromRequest = (req) => {
    const user = req?.user;

    return {
        actor: user?._id,
        actorRole: user ? getUserRole(user) : undefined,
        actorUsername: user?.username,
    };
};

const writeAuditLog = async ({
    action,
    changes = [],
    entityId,
    entityType,
    metadata,
    req,
    summary,
}) => {
    // Un'operazione su un lotto non ha un record a cui appartenere: bastano il
    // tipo e l'azione. Senza questa distinzione le voci di lotto sparivano.
    if (!entityType || !action) {
        return null;
    }

    return AuditLog.create({
        ...actorFromRequest(req),
        action,
        changes,
        entityId,
        entityType,
        metadata,
        summary,
    });
};

const getAuditLogs = (entityType, entityId, { limit = 50 } = {}) => AuditLog.find({ entityType, entityId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();

module.exports = {
    diffFields,
    getAuditLogs,
    writeAuditLog,
};
