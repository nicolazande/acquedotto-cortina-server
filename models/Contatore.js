const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const contatoreSchema = new Schema(
{
    tipo_contatore: String,
    codice: String,
    nome_cliente: String,
    seriale_interno: String,
    nome_edificio: String,
    tipo_attivita: String,
    seriale: String,
    inattivo: Boolean,
    consumo: Number,
    subentro: Boolean,
    sostituzione: Boolean,
    condominiale: Boolean,
    inizio: Date,
    scadenza: Date,
    causale: String,
    note: String,
    foto: String,
    listino: { type: Schema.Types.ObjectId, ref: 'Listino' },
    cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
    edificio: { type: Schema.Types.ObjectId, ref: 'Edificio' },
});

module.exports = mongoose.model('Contatore', contatoreSchema);
