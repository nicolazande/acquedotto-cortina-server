const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const invoiceCounterSchema = new Schema(
    {
        scope: { type: String, required: true },
        year: { type: Number, required: true },
        value: { type: Number, required: true, default: -1 },
    },
    {
        collection: 'invoice_counters',
        timestamps: true,
    }
);

invoiceCounterSchema.index({ scope: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('InvoiceCounter', invoiceCounterSchema);
