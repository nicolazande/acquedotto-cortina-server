const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const listinoSchema = new Schema(
{
    categoria: { type: String, required: true },
    descrizione: { type: String, required: true },
});

module.exports = mongoose.model('Listino', listinoSchema);