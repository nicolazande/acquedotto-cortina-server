const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const letturaSchema = new Schema(
{
    cliente: { type: String }, //ridondante
    tipo: { type: String, required: true },
    data: { type: Date, required: true },
    valore: { type: Number, required: true },
    UdM: { type: String, required: true },
    fatturata: { type: Boolean, default: false },
    note: String,
    contatore: { type: Schema.Types.ObjectId, ref: 'Contatore' }
});

module.exports = mongoose.model('Lettura', letturaSchema);