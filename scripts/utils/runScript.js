require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../../config/db');

// Tutti gli script di manutenzione e verifica ripetevano lo stesso contorno:
// caricare le variabili d'ambiente, connettersi, eseguire, disconnettersi e
// uscire con un codice sensato in caso di errore. Alcuni dimenticavano la
// disconnessione e restavano appesi. Qui il contorno e scritto una volta sola.
const runScript = (operazione) => {
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
