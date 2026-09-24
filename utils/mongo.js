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

const vuoto = (valore) => valore === undefined || valore === null;

// I soli campi valorizzati: e cio che si scrive in un documento nuovo.
const soloValorizzati = (campi) => Object.fromEntries(Object.entries(campi).filter(([, valore]) => !vuoto(valore)));

// Un aggiornamento che scrive i campi valorizzati e toglie quelli vuoti.
// Mongoose scarta i valori undefined di un $set invece di cancellare il campo:
// scritto in quel modo, un problema risolto restava sulla riga per sempre.
const setOrUnset = (campi) => {
    const pieni = soloValorizzati(campi);
    const vuoti = Object.keys(campi).filter((campo) => vuoto(campi[campo]));

    // Il database rifiuta un operatore vuoto: ciascuno c'e solo se serve.
    return {
        ...(Object.keys(pieni).length ? { $set: pieni } : {}),
        ...(vuoti.length ? { $unset: Object.fromEntries(vuoti.map((campo) => [campo, ''])) } : {}),
    };
};

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
    recordId,
    setOrUnset,
    soloValorizzati,
    toObjectId,
    uniqueById,
    withSession,
};
