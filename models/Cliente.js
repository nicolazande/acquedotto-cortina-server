const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { MODALITA_PREDEFINITA, normalizzaModalita } = require('../config/delivery');

// La modalita di consegna era un campo libero: nei dati importati vale
// "Cartacea Postale" su tutti i clienti. Normalizzarla in scrittura fa si che
// da qui in avanti esistano solo i valori dichiarati in config/delivery.js,
// senza dover ripulire lo storico prima di poterla usare.
const normalizzaCortesia = (valore) => (
    valore === undefined || valore === null ? valore : normalizzaModalita(valore)
);

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
        stampa_cortesia: { type: String, set: normalizzaCortesia, default: MODALITA_PREDEFINITA },
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

// Ordinamenti predefiniti della lista clienti.
clienteSchema.index({ cognome: 1, nome: 1 });
clienteSchema.index({ ragione_sociale: 1 });

module.exports = mongoose.model('Cliente', clienteSchema);
