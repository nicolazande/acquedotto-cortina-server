// server/models/AuthUser.js
const mongoose = require('mongoose');

const authUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});

module.exports = mongoose.model('AuthUser', authUserSchema);
