const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const invoiceCounterSchema = new Schema(
    {
        scope: { type: String, required: true },
        year: { type: Number, required: true },
        value: { type: Number, required: true, default: -1 },
        // Il numero piu alto uscito dal gestionale fra quelli poi cancellati. Un
        // numero uscito non torna libero: cancellata la fattura, resterebbe solo il
        // contatore a sapere che era stato usato. Vale per i contatori delle serie
        // di fatture; per gli altri resta a zero.
        ultimo_uscito: { type: Number, default: 0 },
    },
    {
        collection: 'invoice_counters',
        timestamps: true,
    }
);

invoiceCounterSchema.index({ scope: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('InvoiceCounter', invoiceCounterSchema);
