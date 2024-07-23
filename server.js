const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const routes = require('./routes/index');
const connectDB = require('./config/db'); // Importa la funzione di connessione al database

const app = express();
const port = process.env.PORT || 5000;

/* configurazione coors */
const corsOptions = 
{
    origin: 
    [
        'http://localhost:3000',
        'https://main--acquedotto-cortina-client.netlify.app',
        'https://acquedotto-cortina-client.netlify.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};

/* middleware */
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* connessione al database MongoDB Atlas */
connectDB();

/* rotte */
app.use('/api', routes);

/* avvio del server */
app.listen(port, () =>
{
    console.log(`Server is running on port: ${port}`);
});
