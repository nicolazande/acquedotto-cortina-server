const DEFAULT_TOKEN_TTL = '8h';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// Durata della sessione: senza refresh token un valore troppo basso costringe
// l'operatore a rifare il login nel mezzo di una fatturazione.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || DEFAULT_TOKEN_TTL;

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not configured. Set it in the hosting provider environment variables.');
}

module.exports = {
    JWT_EXPIRES_IN,
    JWT_SECRET,
};
