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

const authRoutes = require('./routes/authRoutes');
app.use('/api', authRoutes);

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});
