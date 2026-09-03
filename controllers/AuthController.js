const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { JWT_EXPIRES_IN, JWT_SECRET } = require('../config/auth');
const {
    getUserRole,
    risorsePerRuolo,
    risorseScrivibiliPerRuolo,
} = require('../config/permessi');

const MAX_ADMIN_USERS = Number.parseInt(process.env.MAX_ADMIN_USERS || '2', 10);

// Health check route
// Versione in esecuzione. Serve a rispondere in pochi secondi alla domanda
// "cosa e effettivamente pubblicato": client e server stanno su due servizi
// distinti e si aggiornano in momenti diversi. Finora non c'era modo di
// accorgersi che uno dei due era rimasto indietro, e il disallineamento si
// manifestava come un errore incomprensibile nell'interfaccia.
const { version: APP_VERSION } = require('../package.json');

const RELEASE = process.env.RENDER_GIT_COMMIT
    || process.env.SOURCE_VERSION
    || process.env.GIT_COMMIT
    || '';

const AVVIATO = new Date();

const healthCheck = (req, res) => {
    const isDatabaseConnected = mongoose.connection.readyState === 1;
    res.status(isDatabaseConnected ? 200 : 503).json({
        status: isDatabaseConnected ? 'ok' : 'degraded',
        database: isDatabaseConnected ? 'connected' : 'disconnected',
        version: APP_VERSION,
        release: RELEASE ? RELEASE.slice(0, 12) : 'sconosciuta',
        avviato: AVVIATO.toISOString(),
    });
};

// Register a new user
const register = async (req, res) => {
    const { username, password } = req.body;
    try {
        const userCount = await User.countDocuments({ role: { $ne: 'cliente' } });

        if (userCount >= MAX_ADMIN_USERS) {
            return res.status(403).json({ error: 'Registrazione disabilitata, limite utenti.' });
        }

        const user = new User({ username, password, role: 'admin' });
        await user.save();

        res.status(201).json({ message: 'Utente registrato correttamente' });
    } catch (error) {
        console.error('[Register] Error during registration:', error.message);
        res.status(400).json({ error: 'Error registering user' });
    }
};

// Login an existing user
const login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            console.warn('[Login] User not found:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.active === false) {
            return res.status(403).json({ error: 'Account disabilitato' });
        }

        const isPasswordValid = await user.comparePassword(password);

        if (!isPasswordValid) {
            console.warn('[Login] Invalid password for:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id, role: getUserRole(user) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({ token });
    } catch (error) {
        console.error('[Login] Error logging in:', error.message);
        res.status(400).json({ error: 'Error logging in' });
    }
};

// Get user profile
const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password').populate('cliente', 'ragione_sociale cognome nome codice_cliente_erp email');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            numero_telefono: user.numero_telefono,
            role: getUserRole(user),
            // Le risorse che questo ruolo puo aprire. Il client ci disegna il
            // menu e i pannelli: cosi non tiene una propria idea di chi vede
            // cosa, che col tempo direbbe altro rispetto ai permessi veri.
            risorse: risorsePerRuolo(getUserRole(user)),
            scrivibili: risorseScrivibiliPerRuolo(getUserRole(user)),
            cliente: user.cliente || null,
        });
    } catch (error) {
        console.error('[GetProfile] Error fetching profile:', error.message);
        res.status(400).json({ error: 'Error fetching profile' });
    }
};

// Update user profile
const updateProfile = async (req, res) => {
    const { username, password, email, numero_telefono } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update fields; password will be hashed by pre('save') hook
        if (username) user.username = username;
        if (password) user.password = password;
        if (email) user.email = email;
        if (numero_telefono) user.numero_telefono = numero_telefono;

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            updatedFields: { username, email, numero_telefono },
        });
    } catch (error) {
        console.error('[UpdateProfile] Error updating profile:', error.message);
        res.status(400).json({ error: 'Error updating profile' });
    }
};


module.exports = { register, login, getProfile, updateProfile, healthCheck };
