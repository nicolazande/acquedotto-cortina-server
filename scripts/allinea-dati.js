// Manutenzione dei campi che devono restare coerenti fra loro.
//
//   node scripts/allinea-dati.js          elenca cosa cambierebbe (sola lettura)
//   node scripts/allinea-dati.js --fix    applica le correzioni
//
// Interventi:
//   - fatture: allinea `stato` al booleano `confermata` (i due potevano divergere)
//   - scadenze: rimuove `ritardo`, che e un valore derivato e invecchia da solo
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Fattura = require('../models/Fattura');
const Scadenza = require('../models/Scadenza');

const applica = process.argv.includes('--fix');

const allineaStatoFatture = async () => {
    const daBozza = { $or: [{ confermata: { $ne: true } }, { confermata: { $exists: false } }], stato: { $ne: 'bozza' } };
    const daConfermata = { confermata: true, stato: { $ne: 'confermata' } };

    const bozze = await Fattura.countDocuments(daBozza);
    const confermate = await Fattura.countDocuments(daConfermata);
    console.log('Fatture con stato non allineato a confermata:');
    console.log(`  da portare a "confermata": ${confermate}`);
    console.log(`  da portare a "bozza":      ${bozze}`);

    if (!applica || (bozze + confermate) === 0) {
        return;
    }

    // updateMany diretto sulla collection: il calcolo e gia stato fatto qui sopra
    // e non servono i hook del modello.
    const a = await Fattura.collection.updateMany(daConfermata, { $set: { stato: 'confermata' } });
    const b = await Fattura.collection.updateMany(daBozza, { $set: { stato: 'bozza' } });
    console.log(`  aggiornate: ${a.modifiedCount + b.modifiedCount}`);
};

const rimuoviRitardoSalvato = async () => {
    const conRitardo = await Scadenza.collection.countDocuments({ ritardo: { $exists: true } });
    console.log('Scadenze con il campo derivato `ritardo` ancora salvato:');
    console.log(`  da ripulire: ${conRitardo}`);

    if (!applica || conRitardo === 0) {
        return;
    }

    const risultato = await Scadenza.collection.updateMany(
        { ritardo: { $exists: true } },
        { $unset: { ritardo: '' } }
    );
    console.log(`  ripulite: ${risultato.modifiedCount}`);
};

const main = async () => {
    await connectDB();
    console.log(applica ? '== APPLICO LE CORREZIONI ==\n' : '== SOLA LETTURA (usa --fix per applicare) ==\n');

    await allineaStatoFatture();
    console.log('');
    await rimuoviRitardoSalvato();

    await mongoose.disconnect();
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
