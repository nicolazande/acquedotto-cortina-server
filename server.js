const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db'); // Importa la funzione di connessione al database

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connessione al database MongoDB Atlas
connectDB();

// Routes
const userRoutes = require('./routes/userRoutes');
app.use('/api', userRoutes);

// Route di debug
app.get('/api/debug', (req, res) => {
    res.send('Server is running and reachable');
});

// Route di catch-all per gestire le rotte non definite
app.use((req, res, next) => {
    res.status(404).send('404: Not Found');
});

// Gestione degli errori
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('500: Internal Server Error');
});

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});
