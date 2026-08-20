const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/auth');

// Tutti gli esiti di autenticazione fallita rispondono 401: il client usa
// questo stato per riportare l'utente al login. Un 400 o un 404 verrebbero
// scambiati per un errore della singola richiesta e lascerebbero la sessione
// bloccata fino al ricaricamento della pagina.
const denyAccess = (res, error, reason) => res.status(401).json({ error, reason });

const AuthMiddleware = async (req, res, next) => {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return denyAccess(res, 'Access denied', 'missing_token');
    }

    const token = authHeader.slice('Bearer '.length).trim();

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
        const reason = error.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
        return denyAccess(res, 'Sessione non valida: esegui di nuovo il login', reason);
    }

    try {
        const user = await User.findById(decoded.userId);

        if (!user) {
            return denyAccess(res, 'Utente non trovato', 'user_not_found');
        }

        if (user.active === false) {
            return res.status(403).json({ error: 'Account disabilitato', reason: 'account_disabled' });
        }

        req.user = user;
        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = AuthMiddleware;
