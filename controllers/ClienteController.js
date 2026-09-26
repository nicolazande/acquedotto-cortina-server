const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const User = require('../models/User');
const { sendPaginated } = require('./utils/paginatedQuery');
const { getUserRole } = require('../config/permessi');
const { soloCampiPerLetturista } = require('../utils/customer');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    sendServiceError,
    updateRecord,
} = require('./utils/controllerActions');
const { invoiceGenerationOptions, parseOptionalBoolean } = require('./utils/requestOptions');
const { createInvoiceFromReadings } = require('../services/invoiceGenerator');
const { previewClienteBilling } = require('../services/anteprimaFatturazione');
const { writeAuditLog } = require('../services/auditLogService');
const { clienteViews } = require('../config/listViews');
const { badRequest, notFound } = require('../utils/errors');

const serializePortalUser = (user) => ({
    id: user._id,
    username: user.username,
    email: user.email || '',
    role: user.role,
    active: user.active !== false,
    cliente: user.cliente,
});

const findPortalUser = (clienteId) => User.findOne({ role: 'cliente', cliente: clienteId });

const normalizeUsername = (username) => String(username || '').trim();

const normalizeEmail = (email) => {
    if (email === undefined) return undefined;
    const value = String(email || '').trim();
    return value || undefined;
};

const validatePortalPassword = (password) => {
    if (!password || String(password).length < User.LUNGHEZZA_MINIMA_PASSWORD) {
        throw badRequest(`La password temporanea deve avere almeno ${User.LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
    }
};

const clienteNonTrovato = () => notFound('Cliente non trovato.');

// Chi legge i contatori vede di un cliente solo cio che gli serve per trovarlo.
// Il taglio si fa qui, nelle due sole vie da cui un cliente esce intero: se
// restasse al client sarebbe un trucco visivo, non una protezione.
const perChiGuarda = (req) => (record) => (
    getUserRole(req.user) === 'letturista' ? soloCampiPerLetturista(record) : record
);

const getClienti = (req, res) => sendPaginated(Cliente, req, res, {
    views: clienteViews,
    defaultSort: 'nome',
    errorMessage: 'Elenco dei clienti non disponibile.',
    transform: perChiGuarda(req),
});

const getCliente = async (req, res) => {
    try {
        const cliente = await Cliente.findById(req.params.id).orFail(clienteNonTrovato).lean();

        return res.status(200).json(perChiGuarda(req)(cliente));
    } catch (error) {
        return sendServiceError(res, error, 'Scheda del cliente non disponibile.');
    }
};

const getFatturazionePreview = async (req, res) => {
    try {
        const result = await previewClienteBilling(req.params.id, {
            includeFixedCharge: parseOptionalBoolean(req.query.includeFixedCharge),
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Anteprima della fatturazione del cliente non disponibile.');
    }
};

const generateFattura = async (req, res) => {
    try {
        const preview = await previewClienteBilling(req.params.id);
        const requestedIds = req.body.letture || req.body.letturaIds;
        const letture = requestedIds?.length
            ? requestedIds
            : preview.previews
                .filter((item) => !item.error && item.lines?.length)
                .map((item) => item.lettura._id);

        const result = await createInvoiceFromReadings({ letture, ...invoiceGenerationOptions(req.body) });

        await writeAuditLog({
            action: 'fattura.generata',
            entityId: result.fattura?._id,
            entityType: 'Fattura',
            metadata: { cliente: req.params.id, letture: letture.length },
            req,
            summary: 'Generata fattura da scheda cliente',
        });
        res.status(201).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Generazione della fattura non riuscita.', 400);
    }
};

const getPortalUser = async (req, res) => {
    try {
        const user = await findPortalUser(req.params.id).select('-password').lean();
        return res.status(200).json(user ? serializePortalUser(user) : null);
    } catch (error) {
        return sendServiceError(res, error, 'Account del portale non disponibile.');
    }
};

const createPortalUser = async (req, res) => {
    try {
        const cliente = await Cliente.findById(req.params.id).orFail(clienteNonTrovato).lean();

        const existingUser = await findPortalUser(cliente._id).select('_id username').lean();
        if (existingUser) {
            return res.status(409).json({ error: 'Questo cliente ha gia un account portale' });
        }

        const { email, password, username } = req.body;
        const normalizedUsername = normalizeUsername(username);
        if (!normalizedUsername || !password) {
            return res.status(400).json({ error: 'Username e password sono obbligatori' });
        }
        validatePortalPassword(password);

        const user = new User({
            active: true,
            cliente: cliente._id,
            email: normalizeEmail(email),
            password,
            role: 'cliente',
            username: normalizedUsername,
        });
        await user.save();

        return res.status(201).json(serializePortalUser(user));
    } catch (error) {
        return sendServiceError(res, error, 'Account del portale non creato.', 400);
    }
};

const updatePortalUser = async (req, res) => {
    try {
        const user = await findPortalUser(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Account portale non trovato' });
        }

        if (req.body.username !== undefined) {
            const username = normalizeUsername(req.body.username);
            if (!username) {
                return res.status(400).json({ error: 'Username obbligatorio' });
            }
            user.username = username;
        }

        if (req.body.email !== undefined) {
            user.email = normalizeEmail(req.body.email);
        }

        if (req.body.password !== undefined) {
            validatePortalPassword(req.body.password);
            user.password = req.body.password;
        }

        if (req.body.active !== undefined) {
            user.active = parseOptionalBoolean(req.body.active);
        }

        await user.save();
        return res.status(200).json(serializePortalUser(user));
    } catch (error) {
        return sendServiceError(res, error, 'Modifica dell’account del portale non riuscita.', 400);
    }
};

module.exports = {
    createCliente: createRecord(Cliente, { name: 'Cliente' }),
    getClienti,
    getCliente,
    getFatturazionePreview,
    generateFattura,
    getPortalUser,
    createPortalUser,
    updatePortalUser,
    updateCliente: updateRecord(Cliente, { name: 'Cliente' }),
    deleteCliente: deleteRecord(Cliente, { name: 'Cliente' }),
    associateContatore: associateRecords({
        field: 'cliente',
        responseKey: 'contatore',
        setOn: 'target',
        sourceModel: Cliente,
        sourceName: 'Cliente',
        sourceParam: 'clienteId',
        targetModel: Contatore,
        targetName: 'Contatore',
        targetParam: 'contatoreId',
    }),
    associateFattura: associateRecords({
        field: 'cliente',
        responseKey: 'fattura',
        setOn: 'target',
        sourceModel: Cliente,
        sourceName: 'Cliente',
        sourceParam: 'clienteId',
        targetModel: Fattura,
        targetName: 'Fattura',
        targetParam: 'fatturaId',
    }),
    getContatoriAssociati: getManyByField({
        Model: Contatore,
        field: 'cliente',
        errorMessage: 'Contatori del cliente non disponibili.',
    }),
    getFattureAssociate: getManyByField({
        Model: Fattura,
        field: 'cliente',
        errorMessage: 'Fatture del cliente non disponibili.',
    }),
};
