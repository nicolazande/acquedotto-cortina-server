require('dotenv').config();

const express = require('express');
const cors = require('cors');
const routes = require('./routes/index');
const connectDB = require('./config/db');
const { errorHandler, notFoundHandler } = require('./middlewares/ErrorMiddleware');
const { parseBoolean } = require('./utils/values');

const app = express();
const port = process.env.PORT || 5000;
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';

const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://main--acquedotto-cortina-client.netlify.app',
    'https://acquedotto-cortina-client.netlify.app',
];

const allowedOrigins = (process.env.CLIENT_ORIGINS || defaultOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
const allowAnyOrigin = allowedOrigins.includes('*');

const corsOptions = {
    origin: (origin, callback) => {
        const normalizedOrigin = origin && origin.replace(/\/+$/, '');
        if (!origin || allowAnyOrigin || allowedOrigins.includes(normalizedOrigin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: !allowAnyOrigin,
};

if (parseBoolean(process.env.TRUST_PROXY)) {
    app.set('trust proxy', 1);
}

app.use(cors(corsOptions));
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
    await connectDB();

    app.listen(port, () => {
        console.log(`Server is running on port: ${port}`);
    });
};

// Un errore asincrono non gestito terminerebbe il processo Node senza spiegazioni:
// meglio registrarlo e lasciare che il gestore del deploy decida cosa fare.
process.on('unhandledRejection', (reason) => {
    console.error('Promise non gestita:', reason);
});

startServer();

module.exports = app;
