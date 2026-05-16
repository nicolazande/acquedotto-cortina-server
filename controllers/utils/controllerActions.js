const lowerFirst = (value) => value.charAt(0).toLowerCase() + value.slice(1);

const sendError = (res, error, fallbackMessage, fallbackStatus = 500) => {
    console.error(error);
    res.status(error.status || fallbackStatus).json({
        error: error.status ? error.message : fallbackMessage,
    });
};

const applyPopulate = (query, populate) => (populate ? query.populate(populate) : query);

const createRecord = (Model, { name, mapBody = (body) => body, transform = (record) => record }) => (
    async (req, res) => {
        try {
            const record = await Model.create(mapBody(req.body));
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

const updateRecord = (Model, { name, mapBody = (body) => body, transform = (record) => record }) => (
    async (req, res) => {
        try {
            const record = await Model.findByIdAndUpdate(req.params.id, mapBody(req.body), { new: true });
            if (!record) {
                return res.status(404).json({ error: `${name} not found` });
            }
            return res.status(200).json(transform(record));
        } catch (error) {
            return sendError(res, error, `Error updating ${lowerFirst(name)}`, 400);
        }
    }
);

const deleteRecord = (Model, { name }) => (
    async (req, res) => {
        try {
            const record = await Model.findByIdAndDelete(req.params.id);
            if (!record) {
                return res.status(404).json({ error: `${name} not found` });
            }
            return res.status(204).json({ message: `${name} deleted` });
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

module.exports = {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    updateRecord,
};
