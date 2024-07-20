const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const routes = require('./routes/index');
const connectDB = require('./config/db'); // Importa la funzione di connessione al database

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000', // Sostituisci con l'URL del tuo frontend React
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Metodi consentiti
    allowedHeaders: ['Content-Type', 'Authorization'], // Header consentiti
    credentials: true, // Consente l'invio di credenziali (es. cookie)
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connessione al database MongoDB Atlas
connectDB();

// Routes
app.use('/api', routes);

// Avvio del server
app.listen(port, () => 
{
    console.log(`Server is running on port: ${port}`);
});
