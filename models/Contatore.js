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
        condominiale: Boolean,
        inizio: Date,
        scadenza: Date,
        causale: String,
        note: String,
        foto: String,
        // Il contatore che questo ha preso il posto: sostituito perche guasto o
        // scaduto, oppure passato a un altro intestatario. E l'unico dato della
        // tracciabilita che non fosse gia in archivio - matricole, date, lettura
        // di chiusura e motivo ci sono gia - e senza di lui la storia di un punto
        // di fornitura si spezza a ogni cambio.
        precedente: { type: Schema.Types.ObjectId, ref: 'Contatore' },
        listino: { type: Schema.Types.ObjectId, ref: 'Listino' },
        cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
        edificio: { type: Schema.Types.ObjectId, ref: 'Edificio' },
    },
    {
        collection: 'contatori'
    }
);

contatoreSchema.index({ cliente: 1 });
contatoreSchema.index({ edificio: 1 });
contatoreSchema.index({ listino: 1 });
contatoreSchema.index({ nome_cliente: 1 });

module.exports = mongoose.model('Contatore', contatoreSchema);
