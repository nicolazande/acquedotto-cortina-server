const { RESOURCE_NAMES } = require('../config/resources');

// Chi puo fare cosa.
//
// Il ruolo si legge dal record dell'utente e basta. Prima, quando il campo
// mancava, si ripiegava su "admin": comodo per gli account nati prima che il
// ruolo esistesse, ma è il ripiego sbagliato. Un permesso non deve mai nascere
// dall'assenza di un dato, altrimenti un account del portale che perdesse il
// campo - un import, una modifica a mano - diventerebbe amministratore.
//
// Gli account senza ruolo vanno sistemati sul database, non nel codice:
// `npm run maintenance:allinea-dati -- --fix` lo scrive guardando se l'account
// e collegato a un cliente.
const getUserRole = (user) => user?.role || null;

const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(getUserRole(req.user))) {
        return res.status(403).json({ error: 'Permessi insufficienti' });
    }

    return next();
};

// Le risorse che il letturista puo toccare, quali anche scrivere, e quali
// relazioni puo seguire da una scheda all'altra. Sta qui perche serve in tre
// punti che devono restare d'accordo: il montaggio delle rotte, gli allegati -
// che ereditano il permesso di cio a cui sono attaccati - e l'elenco che il
// client usa per disegnare menu e pannelli.
//
// `relazioni` non e un dettaglio: sotto `/clienti` vivono anche
// `/:id/fatture` e `/:id/fatturazione`, sotto `/letture` anche `/:id/servizi` e
// `/:id/calcolo`. Aprire la risorsa senza dire quali sotto-rotte apre avrebbe
// dato a chi legge i contatori le fatture, gli importi e le righe di prezzo -
// nascoste nel menu ma raggiungibili scrivendo l'indirizzo.
const RISORSE_DEL_LETTURISTA = {
    edifici: { scrittura: false, relazioni: ['contatori'] },
    contatori: { scrittura: false, relazioni: ['cliente', 'edificio', 'letture', 'storia'] },
    clienti: { scrittura: false, relazioni: ['contatori'] },
    letture: { scrittura: true, relazioni: ['contatore'] },
};

// Cosa puo toccare chi sta guardando. E l'unico elenco: il server ci decide i
// permessi e il client ci disegna il menu e i pannelli, invece di tenere una
// propria idea di chi vede cosa che col tempo direbbe altro.
const risorsePerRuolo = (ruolo) => {
    if (ruolo === 'admin') {
        return RESOURCE_NAMES;
    }

    if (ruolo === 'letturista') {
        return Object.keys(RISORSE_DEL_LETTURISTA);
    }

    // Il cliente non passa da queste risorse: ha il suo portale.
    return [];
};

// E quali di quelle puo anche cambiare. Il client ci nasconde i pulsanti che
// aprono una modifica: un "Elimina" che risponde 403 e peggio di un "Elimina"
// che non c'e.
const risorseScrivibiliPerRuolo = (ruolo) => {
    if (ruolo === 'admin') {
        return RESOURCE_NAMES;
    }

    if (ruolo === 'letturista') {
        return Object.entries(RISORSE_DEL_LETTURISTA)
            .filter(([, permesso]) => permesso.scrittura)
            .map(([nome]) => nome);
    }

    return [];
};

// Dentro la risorsa il letturista arriva all'elenco, alla singola scheda e alle
// relazioni dichiarate. Tutto il resto e chiuso, quindi una sotto-rotta aggiunta
// domani nasce chiusa anche qui, come le risorse nuove sotto `requireAdmin`.
const percorsoConcesso = (percorso, relazioni) => {
    const parti = percorso.split('/').filter(Boolean);

    if (parti.length <= 1) {
        return true; // l'elenco, o una scheda sola
    }

    return parti.length === 2 && relazioni.includes(parti[1]);
};

// Il guardiano di una risorsa aperta a chi va in giro a leggere i contatori.
// Legge dalla tabella qui sopra, cosi il permesso e scritto in un posto solo e
// il montaggio dice soltanto di quale risorsa si tratta.
//
// Non e un sistema di permessi: sono quattro risorse e due ruoli. Se un giorno i
// ruoli saranno sei, quello sara il momento di estrarlo - non prima.
const anchePerLetturista = (risorsa) => {
    const permesso = RISORSE_DEL_LETTURISTA[risorsa];

    if (!permesso) {
        throw new Error(`Risorsa non prevista per il letturista: ${risorsa}`);
    }

    return (req, res, next) => {
        const ruolo = getUserRole(req.user);

        if (ruolo === 'admin') {
            return next();
        }

        const puo = ruolo === 'letturista'
            && (permesso.scrittura || req.method === 'GET')
            && percorsoConcesso(req.path, permesso.relazioni);

        return puo ? next() : res.status(403).json({ error: 'Permessi insufficienti' });
    };
};

module.exports = {
    RISORSE_DEL_LETTURISTA,
    risorsePerRuolo,
    risorseScrivibiliPerRuolo,
    anchePerLetturista,
    getUserRole,
    requireAdmin: requireRole('admin'),
    requireCustomer: requireRole('cliente'),
};
