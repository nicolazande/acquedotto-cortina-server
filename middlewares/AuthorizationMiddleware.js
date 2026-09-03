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

// Le risorse che il letturista puo toccare, e quali anche scrivere. Sta qui
// perche serve in due punti che devono restare d'accordo: il montaggio delle
// rotte e gli allegati, che ereditano il permesso di cio a cui sono attaccati.
const RISORSE_DEL_LETTURISTA = {
    edifici: { scrittura: false },
    contatori: { scrittura: false },
    clienti: { scrittura: false },
    letture: { scrittura: true },
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

// Le risorse che servono a chi va in giro a leggere i contatori. Senza
// `scrittura` puo soltanto guardarle: registra letture, non modifica anagrafiche.
//
// Non e un sistema di permessi: sono tre risorse e due ruoli, e una tabella
// dichiarativa costerebbe piu di quanto renda. Se un giorno i ruoli saranno sei,
// quello sara il momento di estrarla - non prima.
const anchePerLetturista = ({ scrittura = false } = {}) => (req, res, next) => {
    const ruolo = getUserRole(req.user);

    if (ruolo === 'admin' || (ruolo === 'letturista' && (scrittura || req.method === 'GET'))) {
        return next();
    }

    return res.status(403).json({ error: 'Permessi insufficienti' });
};

module.exports = {
    RISORSE_DEL_LETTURISTA,
    risorsePerRuolo,
    anchePerLetturista,
    getUserRole,
    requireAdmin: requireRole('admin'),
    requireCustomer: requireRole('cliente'),
};
