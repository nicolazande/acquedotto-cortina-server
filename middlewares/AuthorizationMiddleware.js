// I guardiani delle rotte: prendono la regola da `config/permessi` e la
// applicano alla richiesta HTTP. Qui non si decide chi puo cosa, si decide solo
// come rispondere a chi non puo - 403, e sempre lo stesso messaggio.
const {
    RISORSE_DEL_LETTURISTA,
    getUserRole,
    percorsoConcesso,
    puoUsareRisorsa,
} = require('../config/permessi');

const permessiInsufficienti = (res) => res.status(403).json({ error: 'Permessi insufficienti' });

const requireRole = (...roles) => (req, res, next) => (
    roles.includes(getUserRole(req.user)) ? next() : permessiInsufficienti(res)
);

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
        const scrittura = req.method !== 'GET';
        const puo = puoUsareRisorsa(ruolo, risorsa, { scrittura })
            && (ruolo === 'admin' || percorsoConcesso(req.path, permesso.relazioni));

        return puo ? next() : permessiInsufficienti(res);
    };
};

module.exports = {
    anchePerLetturista,
    requireAdmin: requireRole('admin'),
    requireCustomer: requireRole('cliente'),
};
