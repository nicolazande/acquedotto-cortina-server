const { diffFields, writeAuditLog } = require('../../services/auditLogService');
const { assertCancellabile, cancellaACascata } = require('../../services/referentialIntegrity');

const lowerFirst = (value) => value.charAt(0).toLowerCase() + value.slice(1);

// Tracciamento delle modifiche per le risorse che lo richiedono. Fino a ora era
// registrato solo cio che riguardava le fatture: chi cambiava il prezzo di una
// fascia - cioe quanto pagano tutti - non lasciava alcuna traccia.
const auditRecord = async ({ action, audit, after, before, metadata, record, req, summary }) => {
    if (!audit) {
        return;
    }

    await writeAuditLog({
        action: `${audit.entityType.toLowerCase()}.${action}`,
        changes: before && after ? diffFields(before, after, audit.fields || []) : [],
        entityId: record?._id,
        entityType: audit.entityType,
        metadata,
        req,
        summary: summary || `${audit.entityType} ${action}`,
    });
};

const describe = (audit, record) => (
    audit?.label ? audit.label(record) : String(record?._id || '')
);

// Due modi di rispondere a un errore, e la differenza conta.
//
// `sendError` e per i CRUD generati: il messaggio dell'errore non viene mai
// mostrato al client a meno che l'errore non porti con se uno status, cioe a
// meno che non sia un errore scritto da noi (utils/errors.js). Cosi un errore
// del driver o di Mongoose non finisce nell'interfaccia con dentro nomi di
// campi, indici o frammenti di query.
//
// `sendServiceError` e per i gestori scritti a mano attorno ai servizi, dove il
// messaggio e in italiano ed e esattamente cio che l'utente deve leggere
// ("Il listino X copre 120 mc su 135 mc").
const sendError = (res, error, fallbackMessage, fallbackStatus = 500) => {
    console.error(error);
    res.status(error.status || fallbackStatus).json({
        error: error.status ? error.message : fallbackMessage,
    });
};

const sendServiceError = (res, error, fallbackMessage, fallbackStatus = 500) => {
    console.error(error);
    res.status(error.status || fallbackStatus).json({
        error: error.message || fallbackMessage,
    });
};

const applyPopulate = (query, populate) => (populate ? query.populate(populate) : query);

const createRecord = (Model, { audit, name, mapBody = (body) => body, transform = (record) => record }) => (
    async (req, res) => {
        try {
            const record = await Model.create(mapBody(req.body));
            await auditRecord({
                action: 'creato', audit, record, req, summary: `Creato ${lowerFirst(name)} ${describe(audit, record)}`,
            });
            res.status(201).json(transform(record));
        } catch (error) {
            sendError(res, error, `Error creating ${lowerFirst(name)}`, 400);
        }
    }
);

const getRecord = (Model, { name, populate, transform = (record) => record }) => (
    async (req, res) => {
        try {
            const record = await applyPopulate(Model.findById(req.params.id), populate);
            if (!record) {
                return res.status(404).json({ error: `${name} not found` });
            }
            return res.status(200).json(transform(record));
        } catch (error) {
            return sendError(res, error, `Error fetching ${lowerFirst(name)}`);
        }
    }
);

const updateRecord = (Model, { audit, name, mapBody = (body) => body, transform = (record) => record }) => (
    async (req, res) => {
        try {
            // Il valore precedente serve per registrare cosa e cambiato davvero.
            const before = audit ? await Model.findById(req.params.id).lean() : null;
            const record = await Model.findByIdAndUpdate(req.params.id, mapBody(req.body), {
                new: true,
                runValidators: true,
            });
            if (!record) {
                return res.status(404).json({ error: `${name} not found` });
            }
            await auditRecord({
                action: 'modificato',
                audit,
                after: record.toObject ? record.toObject() : record,
                before,
                record,
                req,
                summary: `Modificato ${lowerFirst(name)} ${describe(audit, record)}`,
            });
            return res.status(200).json(transform(record));
        } catch (error) {
            return sendError(res, error, `Error updating ${lowerFirst(name)}`, 400);
        }
    }
);

// Ogni cancellazione passa di qui, quindi il controllo dei legami vale per
// tutte le risorse senza che nessun controller debba ricordarselo. Le fatture
// fanno storia a se: la loro cancellazione ha una cascata piu ampia e vive in
// invoiceDeletionService.
const deleteRecord = (Model, { audit, cascata = false, name }) => (
    async (req, res) => {
        try {
            const record = await Model.findById(req.params.id);
            if (!record) {
                return res.status(404).json({ error: `${name} not found` });
            }

            await assertCancellabile(Model.modelName, record._id, `${name} ${describe(audit, record)}`.trim());
            const aCascata = cascata ? await cancellaACascata(Model.modelName, record._id) : {};
            await Model.deleteOne({ _id: record._id });
            await auditRecord({
                action: 'cancellato', audit, record, req, summary: `Cancellato ${lowerFirst(name)} ${describe(audit, record)}`,
                metadata: Object.keys(aCascata).length ? { cancellatiACascata: aCascata } : undefined,
            });
            // 204 non prevede corpo nella risposta.
            return res.status(204).send();
        } catch (error) {
            return sendError(res, error, `Error deleting ${lowerFirst(name)}`);
        }
    }
);

const associateRecords = ({
    field,
    responseKey,
    responseRecord,
    setOn = 'source',
    sourceModel,
    sourceName,
    sourceParam,
    targetModel,
    targetName,
    targetParam,
}) => (
    async (req, res) => {
        try {
            const [source, target] = await Promise.all([
                sourceModel.findById(req.params[sourceParam]),
                targetModel.findById(req.params[targetParam]),
            ]);

            if (!source || !target) {
                return res.status(404).json({ error: `${sourceName} or ${targetName} not found` });
            }

            const savedRecord = setOn === 'source' ? source : target;
            const linkedRecord = setOn === 'source' ? target : source;
            savedRecord[field] = linkedRecord._id;
            await savedRecord.save();

            const bodyRecord = responseRecord === 'source'
                ? source
                : responseRecord === 'target'
                    ? target
                    : savedRecord;

            return res.status(200).json({
                message: `${targetName} associated to ${sourceName}`,
                [responseKey || lowerFirst(bodyRecord.constructor.modelName)]: bodyRecord,
            });
        } catch (error) {
            return sendError(res, error, `Error associating ${lowerFirst(targetName)} to ${lowerFirst(sourceName)}`);
        }
    }
);

const getPopulatedRelation = ({ Model, name, path, transform = (record) => record }) => (
    async (req, res) => {
        try {
            const record = await Model.findById(req.params.id).populate(path);
            if (!record) {
                return res.status(404).json({ error: `${name} not found` });
            }
            const relation = record[path];
            return res.status(200).json(relation ? transform(relation) : null);
        } catch (error) {
            return sendError(res, error, `Error fetching ${path} associato`);
        }
    }
);

const getManyByField = ({ Model, field, idParam = 'id', populate, errorMessage }) => (
    async (req, res) => {
        try {
            const records = await applyPopulate(Model.find({ [field]: req.params[idParam] }), populate);
            res.status(200).json(records);
        } catch (error) {
            sendError(res, error, errorMessage || `Error fetching ${field} records`);
        }
    }
);

// Il rifiuto di toccare una fattura gia emessa. Il controllo da cui arriva
// cambia - c'e chi parte dalla fattura e chi da una sua riga - ma cio che legge
// l'utente e sempre lo stesso, e un messaggio visibile non deve poter divergere
// fra due file.
const rifiutaFatturaConfermata = (res, error) => sendServiceError(
    res,
    error,
    'Fattura confermata',
    error.status || 400
);

module.exports = {
    rifiutaFatturaConfermata,
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    sendServiceError,
    updateRecord,
};
