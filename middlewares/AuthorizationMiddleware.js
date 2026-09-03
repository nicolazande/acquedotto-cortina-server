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
    anchePerLetturista,
    getUserRole,
    requireAdmin: requireRole('admin'),
    requireCustomer: requireRole('cliente'),
};
