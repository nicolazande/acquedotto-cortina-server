// Rete di sicurezza per le rotte: senza questi middleware una richiesta a un
// percorso inesistente riceveva l'HTML di default di Express e un errore non
// gestito poteva arrivare al client come pagina di stack trace.
const notFoundHandler = (req, res) => {
    res.status(404).json({ error: `Endpoint non trovato: ${req.method} ${req.originalUrl}` });
};

const isCorsError = (error) => error?.message === 'Origin not allowed by CORS';

// Express riconosce l'handler degli errori dalla firma a quattro argomenti:
// `next` deve restare anche se non viene chiamato.
const errorHandler = (error, req, res, next) => {
    if (isCorsError(error)) {
        return res.status(403).json({ error: 'Origine non consentita', reason: 'cors_origin' });
    }

    const status = error.status || error.statusCode || 500;

    if (status >= 500) {
        console.error(`[${req.method} ${req.originalUrl}]`, error);
    }

    return res.status(status).json({
        error: status >= 500 ? 'Errore interno del server' : error.message,
        ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { details: error.message } : {}),
    });
};

module.exports = {
    errorHandler,
    notFoundHandler,
};
