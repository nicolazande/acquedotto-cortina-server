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

module.exports = {
    getUserRole,
    requireAdmin: requireRole('admin'),
    requireCustomer: requireRole('cliente'),
};
