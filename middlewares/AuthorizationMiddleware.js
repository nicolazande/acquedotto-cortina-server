const DEFAULT_ADMIN_ROLE = 'admin';

const getUserRole = (user) => user?.role || DEFAULT_ADMIN_ROLE;

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
    requireRole,
};
