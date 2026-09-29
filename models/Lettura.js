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

// Le letture ancora da fatturare. Il flag puo mancare del tutto sulle letture
// importate dal gestionale precedente, e vale come "no". Una regola sola per la
// generazione, l'anteprima, la panoramica e l'elenco.
const DA_FATTURARE = { $or: [{ fatturata: false }, { fatturata: { $exists: false } }] };

module.exports = mongoose.model('Lettura', letturaSchema);
module.exports.DA_FATTURARE = DA_FATTURARE;