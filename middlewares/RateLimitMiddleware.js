const { parsePositiveInteger } = require('../utils/values');

// Freno ai tentativi ripetuti sul login. Senza, si potevano provare password
// all'infinito alla massima velocita: con due soli account amministratore gli
// username sono pochi e facilmente indovinabili.
//
// Il conteggio sta in memoria: basta per una singola istanza e non aggiunge
// dipendenze. Con piu istanze dietro un bilanciatore andrebbe spostato su un
// archivio condiviso.
const FINESTRA_MS = parsePositiveInteger(process.env.LOGIN_WINDOW_MS, 15 * 60 * 1000);
const MAX_TENTATIVI = parsePositiveInteger(process.env.LOGIN_MAX_ATTEMPTS, 10);
const PULIZIA_OGNI_MS = 5 * 60 * 1000;

const tentativi = new Map();

const chiave = (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase()}`;

const scaduto = (voce, adesso) => adesso - voce.primoTentativo > FINESTRA_MS;

// Le voci vecchie non vanno lasciate crescere all'infinito.
const pulisci = (adesso) => {
    for (const [k, voce] of tentativi) {
        if (scaduto(voce, adesso)) {
            tentativi.delete(k);
        }
    }
};

let ultimaPulizia = Date.now();

const rateLimitLogin = (req, res, next) => {
    const adesso = Date.now();

    if (adesso - ultimaPulizia > PULIZIA_OGNI_MS) {
        pulisci(adesso);
        ultimaPulizia = adesso;
    }

    const k = chiave(req);
    const voce = tentativi.get(k);

    if (voce && !scaduto(voce, adesso) && voce.conteggio >= MAX_TENTATIVI) {
        const attesaSecondi = Math.ceil((FINESTRA_MS - (adesso - voce.primoTentativo)) / 1000);
        res.setHeader('Retry-After', attesaSecondi);
        return res.status(429).json({
            error: 'Troppi tentativi di accesso: riprova piu tardi',
            reason: 'too_many_attempts',
            retryAfter: attesaSecondi,
        });
    }

    // Un accesso riuscito azzera il conteggio: a fallire e solo chi sbaglia.
    res.on('finish', () => {
        if (res.statusCode < 400) {
            tentativi.delete(k);
            return;
        }

        if (res.statusCode === 401) {
            const corrente = tentativi.get(k);
            if (!corrente || scaduto(corrente, adesso)) {
                tentativi.set(k, { conteggio: 1, primoTentativo: adesso });
            } else {
                corrente.conteggio += 1;
            }
        }
    });

    return next();
};

module.exports = {
    MAX_TENTATIVI,
    rateLimitLogin,
    // esposto per i test
    _tentativi: tentativi,
};
