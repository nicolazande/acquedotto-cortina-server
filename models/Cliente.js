const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const clienteSchema = new Schema(
{
    ragioneSociale: String,
    nome: String,
    cognome: String,
    sesso: String,
    socio: { type: Boolean, default: false },
    dataNascita: Date,
    comuneNascita: String,
    provinciaNascita: String,
    indirizzoResidenza: String,
    numeroResidenza: String,
    capResidenza: String,
    localitaResidenza: String,
    provinciaResidenza: String,
    nazioneResidenza: String,
    destinazioneFatturazione: String,
    indirizzoFatturazione: String,
    numeroFatturazione: String,
    capFatturazione: String,
    localitaFatturazione: String,
    provinciaFatturazione: String,
    nazioneFatturazione: String,
    codiceFiscale: String,
    telefono: String,
    email: String,
    pagamento: String,
    codiceDestinatario: String,
    fatturaElettronica: String,
    codiceERP: String,
    IBAN: String,
    note: String,
    quote: Number
});

module.exports = mongoose.model('Cliente', clienteSchema);
