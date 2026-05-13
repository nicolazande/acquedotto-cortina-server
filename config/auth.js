const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not configured. Set it in the hosting provider environment variables.');
}

module.exports = {
    JWT_SECRET,
};
