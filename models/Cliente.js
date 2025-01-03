const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const clienteSchema = new Schema(
    {
        ragione_sociale: String,
        cognome: String,
        nome: String,
        sesso: String,
        socio: { type: Boolean, default: false },
        quote: Number,
        con_commerciali: String,
        data_nascita: Date,
        comune_nascita: String,
        provincia_nascita: String,
        indirizzo_residenza: String,
        numero_residenza: String,
        cap_residenza: String,
        localita_residenza: String,
        provincia_residenza: String,
        nazione_residenza: String,
        destinazione_fatturazione: String,
        indirizzo_fatturazione: String,
        numero_fatturazione: String,
        cap_fatturazione: String,
        localita_fatturazione: String,
        provincia_fatturazione: String,
        nazione_fatturazione: String,
        codice_fiscale: String,
        partita_iva: String,
        stampa_cortesia: String,
        telefono: String,
        cellulare: String,
        cellulare2: String,
        email: String,
        pagamento: String,
        data_mandato_sdd: Date,
        email_pec: String,
        codice_destinatario: String,
        fattura_elettronica:  { type: Boolean, default: false },
        codice_cliente_erp: String,
        iban: String,
        note: String,
    },
    {
        collection: 'clienti'
    }
);

module.exports = mongoose.model('Cliente', clienteSchema);
