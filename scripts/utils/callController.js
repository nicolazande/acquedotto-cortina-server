// Chiamare un controller senza passare da HTTP.
//
// Gli script di verifica esercitano i controller direttamente, per controllare
// il comportamento vero - blocchi, codici di stato, messaggi - senza dover
// avviare un server. Serve quindi una finta risposta Express che, invece di
// scrivere sulla rete, restituisca quello che il controller le ha dato.
const callController = (handler, { body = {}, params = {}, query = {} } = {}) => new Promise((resolve) => {
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            resolve({ body: payload, status: this.statusCode });
        },
        send(payload) {
            resolve({ body: payload, status: this.statusCode });
        },
    };

    handler({ body, params, query, user: { username: 'verify-script', role: 'admin' } }, res);
});

// I controller registrano gli errori con console.error anche quando l'errore e
// proprio cio che il controllo si aspetta. Silenziarli tiene leggibile l'esito
// dello script: un errore stampato che non e un problema insegna a ignorarli.
const withSilencedErrors = async (azione) => {
    const originale = console.error;
    console.error = () => {};

    try {
        return await azione();
    } finally {
        console.error = originale;
    }
};

module.exports = { callController, withSilencedErrors };
