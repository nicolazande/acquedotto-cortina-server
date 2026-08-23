// Manutenzione dei campi che devono restare coerenti fra loro.
//
//   node scripts/allinea-dati.js          elenca cosa cambierebbe (sola lettura)
//   node scripts/allinea-dati.js --fix    applica le correzioni
//
// Interventi:
//   - fatture: allinea `stato` al booleano `confermata` (i due potevano divergere)
//   - scadenze: rimuove `ritardo`, che e un valore derivato e invecchia da solo
//   - scadenze: converte `saldo` in booleano dove e salvato come 1/0
//   - clienti: riporta `stampa_cortesia` ai valori dichiarati in config/delivery
//   - scadenze: cancella la data di pagamento sentinella 31/12/2099
const { runScript } = require('./utils/runScript');
const Cliente = require('../models/Cliente');
const Fattura = require('../models/Fattura');
const Scadenza = require('../models/Scadenza');
const { MODALITA_CONSEGNA, normalizzaModalita } = require('../config/delivery');
const { DATA_IMPLAUSIBILE } = require('../services/deadlineService');

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

// `saldo` arriva dall'import a volte come intero 1/0 e a volte come booleano.
// Con due tipi nello stesso campo i filtri non funzionano: Mongoose converte il
// valore della richiesta secondo lo schema (booleano) e non trova gli interi.
const normalizzaSaldo = async () => {
    const interi = await Scadenza.collection.countDocuments({ saldo: { $type: 'number' } });
    console.log('Scadenze con `saldo` salvato come numero invece che booleano:');
    console.log(`  da convertire: ${interi}`);

    if (!applica || interi === 0) {
        return;
    }

    const veri = await Scadenza.collection.updateMany({ saldo: { $in: [1] } }, { $set: { saldo: true } });
    const falsi = await Scadenza.collection.updateMany({ saldo: { $in: [0] } }, { $set: { saldo: false } });
    console.log(`  convertite: ${veri.modifiedCount + falsi.modifiedCount}`);
};

// La modalita di consegna nasceva come testo libero ("Cartacea Postale").
// Riportarla ai valori dichiarati serve perche la tendina nell'anagrafica e i
// filtri della lista possano lavorare su un insieme chiuso invece che su una
// frase. Il valore non cambia significato: cambia solo come e scritto.
const VALORI_MODALITA = MODALITA_CONSEGNA.map(({ value }) => value);

const normalizzaModalitaConsegna = async () => {
    const daNormalizzare = { stampa_cortesia: { $nin: [...VALORI_MODALITA, null] } };
    const scritture = await Cliente.collection.aggregate([
        { $match: daNormalizzare },
        { $group: { _id: '$stampa_cortesia', quanti: { $sum: 1 } } },
        { $sort: { quanti: -1 } },
    ]).toArray();

    console.log('Clienti con la modalità di consegna scritta in forma libera:');
    scritture.forEach(({ _id, quanti }) => {
        console.log(`  ${quanti.toString().padStart(5)} "${_id ?? ''}" -> ${normalizzaModalita(_id)}`);
    });

    if (!applica || scritture.length === 0) {
        if (scritture.length === 0) console.log('  nessuno');
        return;
    }

    let aggiornati = 0;
    for (const { _id } of scritture) {
        const risultato = await Cliente.collection.updateMany(
            { stampa_cortesia: _id },
            { $set: { stampa_cortesia: normalizzaModalita(_id) } }
        );
        aggiornati += risultato.modifiedCount;
    }
    console.log(`  normalizzati: ${aggiornati}`);
};

// Il gestionale precedente scriveva 31/12/2099 al posto di lasciare vuota la
// data di pagamento. Il codice la tratta gia come assente, ma finche resta nel
// database chiunque la legga fuori dal gestionale - un'esportazione, una query -
// la prende per una data vera.
const rimuoviDataPagamentoSentinella = async () => {
    const sentinella = { pagamento: { $gte: DATA_IMPLAUSIBILE } };
    const quante = await Scadenza.collection.countDocuments(sentinella);
    const saldate = await Scadenza.collection.countDocuments({ ...sentinella, saldo: true });

    console.log('Scadenze con la data di pagamento sentinella (31/12/2099):');
    console.log(`  da svuotare: ${quante}`);
    if (saldate) {
        // Sono pagate ma non si sa quando: il dato manca all'origine, e va
        // saputo invece che nascosto sotto una data inventata.
        console.log(`  di cui saldate, quindi pagate senza data nota: ${saldate}`);
    }

    if (!applica || quante === 0) {
        return;
    }

    const risultato = await Scadenza.collection.updateMany(sentinella, { $unset: { pagamento: '' } });
    console.log(`  svuotate: ${risultato.modifiedCount}`);
};

const main = async () => {
    console.log(applica ? '== APPLICO LE CORREZIONI ==\n' : '== SOLA LETTURA (usa --fix per applicare) ==\n');

    await allineaStatoFatture();
    console.log('');
    await rimuoviRitardoSalvato();
    console.log('');
    await normalizzaSaldo();
    console.log('');
    await normalizzaModalitaConsegna();
    console.log('');
    await rimuoviDataPagamentoSentinella();
};

runScript(main);
