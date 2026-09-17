require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const connectDB = require('../../config/db');

// Un modello esiste per Mongoose solo quando qualcuno lo richiede: nel server lo
// fanno le rotte, in uno script nessuno. Senza, un `populate('listino')` muore
// con "Schema hasn't been registered for model" - e succedeva a report:anteprima.
// Si caricano tutti perche l'elenco di quali servono cambia a ogni populate.
const cartellaModelli = path.join(__dirname, '..', '..', 'models');
fs.readdirSync(cartellaModelli)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => require(path.join(cartellaModelli, file)));

// `--remoto` fa lavorare lo script sul database di produzione invece che su
// quello locale, prendendo l'indirizzo da `REMOTE_MONGODB_URI`.
//
// Sta qui e non nei singoli script perche vale per tutti, e soprattutto perche
// l'alternativa - passare l'indirizzo a mano sulla riga di comando - e il modo
// piu facile di lavorare sul database sbagliato: basta che la variabile non sia
// esportata nella shell e il comando punta altrove senza dirlo. Con l'opzione,
// invece, o funziona o si ferma, e prima di toccare qualcosa scrive dove si e
// collegato.
const preparaDestinazione = () => {
    if (!process.argv.includes('--remoto')) {
        return;
    }

    if (!process.env.REMOTE_MONGODB_URI) {
        console.error('--remoto richiede REMOTE_MONGODB_URI nel file .env');
        process.exit(1);
    }

    process.env.MONGODB_URI = process.env.REMOTE_MONGODB_URI;
    // Gli script leggono gli argomenti per posizione: l'opzione non deve
    // arrivare fino a loro travestita da nome utente.
    process.argv = process.argv.filter((argomento) => argomento !== '--remoto');
    console.log('== PRODUZIONE: si sta lavorando sul database remoto ==');
};

// Tutti gli script di manutenzione e verifica ripetevano lo stesso contorno:
// caricare le variabili d'ambiente, connettersi, eseguire, disconnettersi e
// uscire con un codice sensato in caso di errore. Alcuni dimenticavano la
// disconnessione e restavano appesi. Qui il contorno e scritto una volta sola.
const runScript = (operazione) => {
    preparaDestinazione();
    connectDB()
        .then(() => operazione())
        .then(async (esito) => {
            await mongoose.disconnect();
            // Un esito falso segnala un controllo non superato: utile in automazione.
            process.exit(esito === false ? 1 : 0);
        })
        .catch(async (errore) => {
            console.error(errore.message || errore);
            await mongoose.disconnect().catch(() => {});
            process.exit(1);
        });
};

module.exports = { runScript };
