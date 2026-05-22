require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const recreateSparseUniqueIndex = async (collection, name, key) => {
    const indexes = await collection.indexes();

    if (indexes.some((index) => index.name === name)) {
        await collection.dropIndex(name);
    }

    await collection.createIndex(key, {
        name,
        sparse: true,
        unique: true,
    });
};

const main = async () => {
    await connectDB();

    await recreateSparseUniqueIndex(User.collection, 'email_1', { email: 1 });
    await recreateSparseUniqueIndex(User.collection, 'numero_telefono_1', { numero_telefono: 1 });

    console.log('Indici utenti aggiornati.');
    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect();
    process.exit(1);
});
