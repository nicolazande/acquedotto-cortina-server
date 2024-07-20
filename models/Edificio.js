const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const edificioSchema = new Schema(
{
    descrizione: String,
    indirizzo: String,
    numero: String,
    CAP: String,
    localita: String,
    provincia: String,
    nazione: String,
    attivita: String,
    postiLetto: Number,
    latitudine: Number,
    longitudine: Number,
    unitaAbitative: Number,
    catasto: String,
    foglio: String,
    PED: String,
    estensione: String,
    tipo: String,
    note: String
});

module.exports = mongoose.model('Edificio', edificioSchema);
