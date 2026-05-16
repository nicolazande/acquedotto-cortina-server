const toPositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSearchQuery = (Model, search) => {
    if (!search) {
        return {};
    }

    const searchRegex = { $regex: escapeRegex(search), $options: 'i' };
    const isNumeric = !Number.isNaN(Number(search));
    const isDate = !Number.isNaN(Date.parse(search));

    const conditions = Object.entries(Model.schema.paths)
        .map(([key, schemaPath]) => {
            if (schemaPath.instance === 'String') {
                return { [key]: searchRegex };
            }

            if (schemaPath.instance === 'Number' && isNumeric) {
                return { [key]: Number(search) };
            }

            if (schemaPath.instance === 'Date' && isDate) {
                return { [key]: new Date(search) };
            }

            return null;
        })
        .filter(Boolean);

    return conditions.length ? { $or: conditions } : {};
};

const getSortField = (requestedField, defaultField) => {
    if (requestedField && /^[\w.]+$/.test(requestedField)) {
        return requestedField;
    }
    return defaultField;
};

const sendPaginated = async (Model, req, res, options = {}) => {
    const {
        defaultLimit = 50,
        defaultSort = '_id',
        errorMessage = 'Error fetching records',
        populate,
        transform,
    } = options;

    try {
        const page = toPositiveInteger(req.query.page, 1);
        const limit = toPositiveInteger(req.query.limit, defaultLimit);
        const search = (req.query.search || '').trim();
        const sortField = getSortField(req.query.sortField, defaultSort);
        const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
        const skip = (page - 1) * limit;
        const query = buildSearchQuery(Model, search);

        const totalItems = await Model.countDocuments(query);
        let findQuery = Model.find(query);

        if (populate) {
            findQuery = findQuery.populate(populate);
        }

        const records = await findQuery
            .sort({ [sortField]: sortOrder })
            .skip(skip)
            .limit(limit);
        const data = transform ? records.map(transform) : records;

        res.status(200).json({
            data,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
        });
    } catch (error) {
        console.error(errorMessage, error);
        res.status(500).json({ error: errorMessage, details: error.message });
    }
};

module.exports = {
    sendPaginated,
};
