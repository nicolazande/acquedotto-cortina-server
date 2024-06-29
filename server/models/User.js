// server/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    surname: { type: String, required: true },
    phone: { type: String, required: true },
    meterReading: { type: String, required: true }
});

module.exports = mongoose.model('User', userSchema);
