const mongoose = require('mongoose');

const DEFAULT_DB_NAME = 'acquedotto-zuel';

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value) => ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());

const getDatabaseNameFromUri = (mongoUri) => {
    try {
        const parsedUri = new URL(mongoUri);
        const dbName = decodeURIComponent(parsedUri.pathname.replace(/^\/+/, ''));
        return dbName || null;
    } catch (error) {
        return null;
    }
};

const setBooleanOption = (options, optionName, envName) => {
    const value = process.env[envName];
    if (value !== undefined && value.trim() !== '') {
        options[optionName] = parseBoolean(value);
    }
};

const getMongoConnectionOptions = (mongoUri) => {
    const dbName = process.env.MONGODB_DB || getDatabaseNameFromUri(mongoUri) || DEFAULT_DB_NAME;
    const options = {
        dbName,
        serverSelectionTimeoutMS: parsePositiveInteger(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10000),
        socketTimeoutMS: parsePositiveInteger(process.env.MONGODB_SOCKET_TIMEOUT_MS, 45000),
        maxPoolSize: parsePositiveInteger(process.env.MONGODB_MAX_POOL_SIZE, 10),
    };

    setBooleanOption(options, 'tls', 'MONGODB_TLS');
    setBooleanOption(options, 'tlsAllowInvalidCertificates', 'MONGODB_TLS_ALLOW_INVALID_CERTIFICATES');
    setBooleanOption(options, 'directConnection', 'MONGODB_DIRECT_CONNECTION');

    return options;
};

const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI is not configured');
        }

        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(mongoUri, getMongoConnectionOptions(mongoUri));
        console.log(`MongoDB connected to database "${mongoose.connection.name}"`);
    } catch (err) {
        console.error('Error connecting to MongoDB:', err.message);
        process.exit(1);
    }
};

module.exports = connectDB;
module.exports.getMongoConnectionOptions = getMongoConnectionOptions;
