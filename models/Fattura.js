const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const fatturaSchema = new Schema(
    {
        tipo_documento: { type: String, required: false },
        ragione_sociale: { type: String, required: false },
        confermata: { type: Boolean, required: false },
        anno: { type: Number, required: false },
        numero: { type: Number, required: false },
        data_fattura: { type: Date, required: false },
        codice: { type: String, required: false },
        // Serie di numerazione. Le fatture importate dal gestionale precedente
        // non ne hanno una: il loro `numero` non e un progressivo di fattura ma
        // un codice cliente (arriva a 6343 in ogni anno). I documenti emessi da
        // questo gestionale usano una serie propria, con progressivo pulito che
        // riparte da 1 ogni anno.
        serie: { type: String, required: false },
        destinazione: { type: String, required: false },
        imponibile: { type: Number, required: false },
        iva: { type: Number, required: false },
        sconto_imponibile: { type: Number, required: false },
        totale_fattura: { type: Number, required: false },
        data_fattura_elettronica: { type: Date, required: false },
        data_invio_fattura: { type: Date, required: false },
        tipo_pagamento: { type: String, required: false },
        nome_cliente: { type: String, required: false },
        // Unica verita sullo stato del documento. Il campo booleano `confermata`
        // resta per compatibilita con i dati storici e con il client, ma viene
        // tenuto allineato automaticamente: prima i due potevano divergere.
        stato: { type: String, required: false, enum: ['bozza', 'confermata'], default: 'bozza' },
        origine: { type: String, required: false, default: 'manuale' },
        cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
        scadenza: { type: Schema.Types.ObjectId, ref: 'Scadenza' }
    },
    {
        collection: 'fatture',
        timestamps: true
    }
);

// Allinea i due campi che descrivono lo stesso stato, qualunque sia quello
// valorizzato dal chiamante.
const allineaStato = (documento) => {
    if (!documento) return;

    const haStato = documento.stato === 'bozza' || documento.stato === 'confermata';
    const haConfermata = typeof documento.confermata === 'boolean';

    if (haStato) {
        documento.confermata = documento.stato === 'confermata';
        return;
    }

    if (haConfermata) {
        documento.stato = documento.confermata ? 'confermata' : 'bozza';
    }
};

fatturaSchema.pre('save', function normalizzaStato(next) {
    allineaStato(this);
    next();
});

fatturaSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function normalizzaStatoUpdate(next) {
    const update = this.getUpdate() || {};
    const set = update.$set || update;

    if (set.stato !== undefined || set.confermata !== undefined) {
        allineaStato(set);
        this.setUpdate(update.$set ? { ...update, $set: set } : set);
    }

    next();
});

fatturaSchema.index({ anno: 1, numero: 1 });
// Garanzia di unicita sui soli documenti emessi da questo gestionale: sullo
// storico non e applicabile, perche 2.745 fatture condividono la coppia
// (anno, numero) ereditata dall'import.
fatturaSchema.index(
    { anno: 1, serie: 1, numero: 1 },
    { unique: true, partialFilterExpression: { serie: { $type: 'string' } } }
);
fatturaSchema.index({ cliente: 1, data_fattura: -1 });
fatturaSchema.index({ scadenza: 1 });
fatturaSchema.index({ data_fattura: -1 });

module.exports = mongoose.model('Fattura', fatturaSchema);
