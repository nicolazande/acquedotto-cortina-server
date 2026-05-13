const mongoose = require('mongoose');

const connectDB = async () => {
    try
    {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not configured');
        }

        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected');
    }
    catch (err)
    {
        console.error('Error connecting to MongoDB:', err.message);
        process.exit(1);
    }
};

module.exports = connectDB;
