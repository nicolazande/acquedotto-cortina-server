const mongoose = require('mongoose');

// Applica la sessione solo quando esiste: su MongoDB standalone le transazioni
// non sono disponibili e le stesse funzioni girano con session = null.
const withSession = (query, session) => (session ? query.session(session) : query);

// Accetta sia un documento popolato sia un id grezzo.
const recordId = (record) => String(record?._id || record || '');

const toObjectId = (id) => {
    const value = recordId(id);
    return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(recordId(id));

const uniqueById = (records) => {
    const seen = new Set();
    return records.filter((record) => {
        const key = recordId(record);
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

module.exports = {
    isValidObjectId,
    recordId,
    toObjectId,
    uniqueById,
    withSession,
};
