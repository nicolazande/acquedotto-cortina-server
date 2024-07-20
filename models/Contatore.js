const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const contatoreSchema = new Schema(
{
    seriale: { type: String, required: true },
    serialeInterno: String,
    ultimaLettura: Date,
    attivo: { type: Boolean, default: true },
    condominiale: { type: Boolean, default: false },
    sostituzione: Boolean,
    subentro: Boolean,
    dataInstallazione: Date,
    dataScadenza: Date,
    foto: String,
    note: String,
    edificio: { type: Schema.Types.ObjectId, ref: 'Edificio' },
    listino: { type: Schema.Types.ObjectId, ref: 'Listino' },
    cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' }
});

module.exports = mongoose.model('Contatore', contatoreSchema);
