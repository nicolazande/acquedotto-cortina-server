const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const User = require('../models/User');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getRecord,
    sendServiceError,
    updateRecord,
} = require('./utils/controllerActions');
const { parseOptionalBoolean } = require('./utils/requestOptions');
const {
    createInvoiceFromReadings,
    previewClienteBilling,
} = require('../services/invoiceGenerator');
const { writeAuditLog } = require('../services/auditLogService');
const { clienteViews } = require('../config/listViews');

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
    if (!password || String(password).length < 8) {
        const error = new Error('La password temporanea deve avere almeno 8 caratteri');
        error.status = 400;
        throw error;
    }
};

const getClienti = (req, res) => sendPaginated(Cliente, req, res, {
    views: clienteViews,
    defaultSort: 'nome',
    errorMessage: 'Error fetching clienti',
});

const getFatturazionePreview = async (req, res) => {
    try {
        const result = await previewClienteBilling(req.params.id, {
            includeFixedCharge: parseOptionalBoolean(req.query.includeFixedCharge),
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Error fetching cliente billing preview');
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

        const result = await createInvoiceFromReadings({
            letture,
            data_fattura: req.body.data_fattura,
            data_scadenza: req.body.data_scadenza,
            includeFixedCharge: parseOptionalBoolean(req.body.includeFixedCharge),
            tipo_documento: req.body.tipo_documento,
            confermata: req.body.confermata,
        });

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
        sendServiceError(res, error, 'Error generating cliente fattura', 400);
    }
};

const getPortalUser = async (req, res) => {
    try {
        const user = await findPortalUser(req.params.id).select('-password').lean();
        return res.status(200).json(user ? serializePortalUser(user) : null);
    } catch (error) {
        return sendServiceError(res, error, 'Error fetching cliente portal user');
    }
};

const createPortalUser = async (req, res) => {
    try {
        const cliente = await Cliente.findById(req.params.id).lean();
        if (!cliente) {
            return res.status(404).json({ error: 'Cliente not found' });
        }

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
        return sendServiceError(res, error, 'Error creating cliente portal user', 400);
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
        return sendServiceError(res, error, 'Error updating cliente portal user', 400);
    }
};

module.exports = {
    createCliente: createRecord(Cliente, { name: 'Cliente' }),
    getClienti,
    getCliente: getRecord(Cliente, { name: 'Cliente' }),
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
        errorMessage: 'Error fetching contatori associati',
    }),
    getFattureAssociate: getManyByField({
        Model: Fattura,
        field: 'cliente',
        errorMessage: 'Error fetching fatture associate',
    }),
};
