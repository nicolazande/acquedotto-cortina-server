const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const letturaSchema = new Schema(
    {
        id_lettura: { type: String, required: false }, //ridondante
        data_lettura: { type: Date, required: false },
        unita_misura: { type: String, required: false },
        consumo: { type: Number, required: false },
        fatturata: { type: Boolean, default: false },
        tipo: { type: String, required: false },
        note: { type: String, required: false },
        contatore: { type: Schema.Types.ObjectId, ref: 'Contatore' }
    },
    {
        collection: 'letture'
    }
);

module.exports = mongoose.model('Lettura', letturaSchema);