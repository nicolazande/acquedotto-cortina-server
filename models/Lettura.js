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

// La ricerca della lettura precedente (contatore + data) e il filtro sulle letture
// ancora da fatturare sono nel percorso caldo della generazione fatture.
letturaSchema.index({ contatore: 1, data_lettura: -1 });
letturaSchema.index({ fatturata: 1, data_lettura: 1 });
letturaSchema.index({ data_lettura: -1 });

module.exports = mongoose.model('Lettura', letturaSchema);