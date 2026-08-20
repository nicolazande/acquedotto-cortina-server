const { escapeRegex, parsePositiveInteger: toPositiveInteger } = require('../../utils/values');
const { badRequest } = require('../../utils/errors');

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

// Viste predefinite: ogni lista dichiara un insieme di filtri con un nome, e il
// client li richiede con ?vista=<nome>. Tenere le condizioni qui, invece che
// lasciarle comporre al client, evita che l'interfaccia possa interrogare campi
// arbitrari e rende le viste verificabili.
const getViewFilter = (views, requestedView) => {
    if (!requestedView) {
        return null;
    }

    const view = views && views[requestedView];

    // Una vista sconosciuta non va ignorata: il chiamante crede di vedere un
    // elenco filtrato e riceverebbe invece tutti i record, senza alcun segnale.
    // Meglio un errore esplicito, che rende evidente uno scarto fra client e server.
    if (!view) {
        throw badRequest(`Vista non riconosciuta: ${requestedView}`);
    }

    return typeof view === 'function' ? view() : view;
};

const combineFilters = (searchQuery, viewFilter) => {
    if (!viewFilter) {
        return searchQuery;
    }

    if (!searchQuery || Object.keys(searchQuery).length === 0) {
        return viewFilter;
    }

    // $and tiene separate le due condizioni: la ricerca usa gia $or al suo interno
    // e fonderle sullo stesso livello ne cambierebbe il significato.
    return { $and: [searchQuery, viewFilter] };
};

const getSortField = (requestedField, defaultField) => {
    if (requestedField && /^[\w.]+$/.test(requestedField)) {
        return requestedField;
    }
    return defaultField;
};

// Alcune liste ordinano su valori derivati (per esempio il ritardo di una scadenza,
// che dipende da oggi e non dal dato salvato). In quel caso la query passa da una
// aggregazione che calcola i campi prima di ordinare, cosi l'ordinamento coincide
// con quello che la tabella mostra davvero.
const findWithComputedFields = async ({
    Model, addFields, limit, populate, query, skip, sort,
}) => {
    const records = await Model.aggregate([
        { $match: query },
        { $addFields: addFields },
        { $sort: sort },
        { $skip: skip },
        { $limit: limit },
    ]);

    return populate ? Model.populate(records, populate) : records;
};

const findRecords = ({ Model, limit, populate, query, skip, sort }) => {
    const findQuery = populate ? Model.find(query).populate(populate) : Model.find(query);
    return findQuery.sort(sort).skip(skip).limit(limit);
};

const sendPaginated = async (Model, req, res, options = {}) => {
    const {
        addFields,
        defaultLimit = 50,
        defaultSort = '_id',
        errorMessage = 'Error fetching records',
        populate,
        transform,
        views,
    } = options;

    try {
        const page = toPositiveInteger(req.query.page, 1);
        const limit = toPositiveInteger(req.query.limit, defaultLimit);
        const search = (req.query.search || '').trim();
        const sortField = getSortField(req.query.sortField, defaultSort);
        const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
        const skip = (page - 1) * limit;
        const query = combineFilters(buildSearchQuery(Model, search), getViewFilter(views, req.query.vista));
        const sort = { [sortField]: sortOrder };

        const totalItems = await Model.countDocuments(query);
        const records = await (addFields
            ? findWithComputedFields({ Model, addFields, limit, populate, query, skip, sort })
            : findRecords({ Model, limit, populate, query, skip, sort }));
        const data = transform ? records.map(transform) : records;

        res.status(200).json({
            data,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }

        console.error(errorMessage, error);
        return res.status(500).json({ error: errorMessage, details: error.message });
    }
};

module.exports = {
    combineFilters,
    getViewFilter,
    sendPaginated,
};
