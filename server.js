require('dotenv').config();

const express = require('express');
const cors = require('cors');
const routes = require('./routes/index');
const connectDB = require('./config/db');

const app = express();
const port = process.env.PORT || 5000;

const defaultOrigins = [
    'http://localhost:3000',
    'https://main--acquedotto-cortina-client.netlify.app',
    'https://acquedotto-cortina-client.netlify.app',
];

const allowedOrigins = (process.env.CLIENT_ORIGINS || defaultOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

connectDB();

app.use('/api', routes);

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});
