const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const edificioSchema = new Schema(
    {
        descrizione: String,
        indirizzo: String,
        numero: String,
        cap: String,
        localita: String,
        provincia: String,
        nazione: String,
        attivita: String,
        posti_letto: Number,
        latitudine: Number,
        longitudine: Number,
        unita_abitative: Number,
        catasto: String,
        foglio: String,
        ped: String,
        estensione: String,
        tipo: String,
        note: String
    },
    {
        collection: 'edifici'
    }
);

module.exports = mongoose.model('Edificio', edificioSchema);
