const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { JWT_EXPIRES_IN, JWT_SECRET } = require('../config/auth');
const {
    getUserRole,
    risorsePerRuolo,
    risorseScrivibiliPerRuolo,
} = require('../config/permessi');
const { sendServiceError } = require('./utils/controllerActions');
const { badRequest, notFound } = require('../utils/errors');

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

// Gli account non si registrano da soli: li crea chi ha accesso al database, con
// `npm run maintenance:password`. Una registrazione pubblica creava un
// amministratore finche gli account interni erano meno di due - bastava
// cancellarne qualcuno perche chiunque potesse diventarlo.

// Nome e password arrivano come testo e basta: un oggetto nel corpo della
// richiesta ({"$regex": "^a"}) diventerebbe un operatore di MongoDB, e
// permetterebbe di sondare quali nomi esistono.
const CREDENZIALI_NON_VALIDE = 'Credenziali non valide.';

const login = async (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    try {
        const user = await User.findOne({ username });
        if (!user) {
            console.warn('[Login] Utente inesistente:', username);
            return res.status(401).json({ error: CREDENZIALI_NON_VALIDE });
        }
        if (user.active === false) {
            return res.status(403).json({ error: 'Account disabilitato.' });
        }

        if (!(await user.comparePassword(password))) {
            console.warn('[Login] Password sbagliata per:', username);
            return res.status(401).json({ error: CREDENZIALI_NON_VALIDE });
        }

        const token = jwt.sign({ userId: user._id, role: getUserRole(user) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ token });
    } catch (error) {
        return sendServiceError(res, error, 'Accesso non riuscito.');
    }
};

const utenteNonTrovato = () => notFound('Utente non trovato.');

const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('-password')
            .populate('cliente', 'ragione_sociale cognome nome codice_cliente_erp email')
            .orFail(utenteNonTrovato);

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
        sendServiceError(res, error, 'Profilo non disponibile.');
    }
};

const updateProfile = async (req, res) => {
    const { username, password, email, numero_telefono } = req.body;
    try {
        const user = await User.findById(req.user._id).orFail(utenteNonTrovato);

        if (password && String(password).length < User.LUNGHEZZA_MINIMA_PASSWORD) {
            throw badRequest(`La password deve avere almeno ${User.LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
        }

        // La password la cifra il gancio del modello, al salvataggio.
        if (username) user.username = username;
        if (password) user.password = password;
        if (email) user.email = email;
        if (numero_telefono) user.numero_telefono = numero_telefono;

        await user.save();

        res.json({
            message: 'Profilo aggiornato.',
            updatedFields: { username, email, numero_telefono },
        });
    } catch (error) {
        sendServiceError(res, error, 'Profilo non aggiornato.', 400);
    }
};

module.exports = { login, getProfile, updateProfile, healthCheck };
