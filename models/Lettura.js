const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const letturaSchema = new Schema(
    {
        id_lettura: { type: String }, //ridondante
        data_lettura: { type: Date, required: true },
        unita_misura: { type: String, required: true },
        consumo: { type: Number, required: true },
        fatturata: { type: Boolean, default: false },
        tipo: { type: String, required: true },
        note: { type: String, required: false },
        contatore: { type: Schema.Types.ObjectId, ref: 'Contatore' }
    },
    {
        collection: 'letture'
    }
);

module.exports = mongoose.model('Lettura', letturaSchema);