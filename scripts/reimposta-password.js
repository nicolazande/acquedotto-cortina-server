// Reimposta la password di un utente.
//
//   node scripts/reimposta-password.js <username> <nuova password>
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

const main = async () => {
    const [username, password] = process.argv.slice(2);

    if (!username || !password) {
        console.log('Uso: node scripts/reimposta-password.js <username> <nuova password>');
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

    const utente = await User.findOne({ username });
    if (!utente) {
        console.error(`Utente "${username}" non trovato.`);
        return false;
    }

    utente.password = password;
    await utente.save();

    console.log(`Password di "${username}" reimpostata (ruolo: ${utente.role || 'admin'}).`);
    console.log('Cambiala dal gestionale, in Admin, appena rientri.');
    return true;
};

runScript(main);
