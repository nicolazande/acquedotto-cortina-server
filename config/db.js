require('dotenv').config();

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        console.log('Attempting to connect to MongoDB with URI:', process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected to Atlas...');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err.message);
        process.exit(1);
    }
};

module.exports = connectDB;
