// Gli account del gestionale, da riga di comando.
//
//   node scripts/reimposta-password.js <username> <password> [ruolo]
//
// Senza ruolo reimposta la password di un utente che esiste gia. Con il ruolo
// crea l'account se manca, o ne cambia il ruolo se c'e: e l'unica via per fare
// un letturista, perche la registrazione dal gestionale crea sempre un
// amministratore e nessuna schermata permette di scegliere.
//
// Le password sono cifrate con bcrypt e non si possono recuperare: quando una
// si dimentica, l'unica strada e sostituirla. Lo script assegna la nuova
// password al modello e lascia cifrare al hook del documento, cosi il valore
// scritto e identico a quello che produrrebbe una registrazione.
//
// Serve accesso diretto al database, quindi non concede nulla che chi lo esegue
// non possa gia fare: e uno strumento di manutenzione, non una scorciatoia.
const { runScript } = require('./utils/runScript');
const User = require('../models/User');

const LUNGHEZZA_MINIMA = 8;
const RUOLI = User.schema.path('role').enumValues;

const main = async () => {
    const [username, password, ruolo] = process.argv.slice(2);

    if (ruolo && !RUOLI.includes(ruolo)) {
        console.error(`Ruolo sconosciuto: "${ruolo}". Quelli previsti sono ${RUOLI.join(', ')}.`);
        return false;
    }

    if (!username || !password) {
        console.log('Uso: node scripts/reimposta-password.js <username> <password> [ruolo]');
        console.log(`Ruoli: ${RUOLI.join(', ')}. Indicandone uno, l'account viene creato se non esiste.`);
        console.log('\nUtenti presenti:');
        const utenti = await User.find({}).select('username role active').sort({ username: 1 }).lean();
        utenti.forEach((utente) => console.log(
            `  ${String(utente.username).padEnd(20)} ${utente.role || 'admin'}${utente.active === false ? ' (disattivato)' : ''}`
        ));
        return false;
    }

    if (password.length < LUNGHEZZA_MINIMA) {
        console.error(`La password deve avere almeno ${LUNGHEZZA_MINIMA} caratteri.`);
        return false;
    }

    const esistente = await User.findOne({ username });

    if (!esistente && !ruolo) {
        console.error(`Utente "${username}" non trovato. Per crearlo, indica anche il ruolo.`);
        return false;
    }

    const utente = esistente || new User({ username, role: ruolo, active: true });
    utente.password = password;
    if (ruolo) {
        utente.role = ruolo;
    }
    await utente.save();

    console.log(esistente
        ? `Password di "${username}" reimpostata (ruolo: ${utente.role}).`
        : `Creato l'account "${username}" con ruolo ${utente.role}.`);
    console.log('Cambiala dal gestionale, in Admin, appena rientri.');
    return true;
};

runScript(main);
