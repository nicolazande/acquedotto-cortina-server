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
//   - utenti: scrive il ruolo dove manca, perche un ruolo assente non deve
//     dipendere da un valore di ripiego nel codice
//   - edifici: rimette il punto decimale nelle coordinate che l'hanno perso
//   - contatori: collega ogni contatore a quello che ha sostituito
const { runScript } = require('./utils/runScript');
const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Edificio = require('../models/Edificio');
const User = require('../models/User');
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

// Un utente senza `role` funzionava lo stesso, perche il controllo dei permessi
// ripiegava su "admin" quando il campo mancava. E il ripiego sbagliato: un
// account del portale che per qualunque motivo perdesse il campo diventerebbe
// amministratore. Il ripiego va tolto dal codice, ma prima il ruolo va scritto
// davvero sugli account che non ce l'hanno, altrimenti smetterebbero di entrare.
//
// Chi ha un cliente collegato e un accesso al portale, gli altri sono
// amministratori: e esattamente il permesso che hanno oggi.
const scriviRuoloUtenti = async () => {
    const senzaRuolo = { $or: [{ role: { $exists: false } }, { role: null }] };
    const utenti = await User.find(senzaRuolo).select('username cliente').lean();

    console.log('Utenti senza il ruolo scritto sul record:');
    console.log(`  da sistemare: ${utenti.length}`);
    utenti.forEach((utente) => console.log(
        `    ${utente.username} -> ${utente.cliente ? 'cliente' : 'admin'}`
    ));

    if (!applica || utenti.length === 0) {
        return;
    }

    const portale = utenti.filter((utente) => utente.cliente).map((utente) => utente._id);
    const amministratori = utenti.filter((utente) => !utente.cliente).map((utente) => utente._id);

    if (portale.length > 0) {
        await User.collection.updateMany({ _id: { $in: portale } }, { $set: { role: 'cliente' } });
    }
    if (amministratori.length > 0) {
        await User.collection.updateMany({ _id: { $in: amministratori } }, { $set: { role: 'admin' } });
    }
    console.log(`  scritti: ${utenti.length}`);
};

// Cortina sta attorno a 46.53 N, 12.14 E. Un edificio importato con
// longitudine 12142838 invece di 12.142838 ha perso il punto decimale per
// strada: sulla mappa finisce dall'altra parte del mondo e trascina con se
// l'inquadratura di tutti gli altri.
const ATTORNO_A = { latitudine: 46.53, longitudine: 12.14 };
const SCARTO_MASSIMO = 0.5;

const rimettiIlPuntoDecimale = (valore, atteso) => {
    let candidato = Math.abs(valore);

    // Si divide per dieci finche non si torna nell'intorno giusto: e l'unica
    // correzione possibile senza inventare dati, perche le cifre ci sono tutte
    // ed e solo la virgola a mancare.
    for (let tentativi = 0; tentativi < 12; tentativi += 1) {
        if (Math.abs(candidato - atteso) <= SCARTO_MASSIMO) {
            return valore < 0 ? -candidato : candidato;
        }
        candidato /= 10;
    }

    return null;
};

const correggiCoordinateEdifici = async () => {
    const edifici = await Edificio.find({
        latitudine: { $nin: [null, 0] },
        longitudine: { $nin: [null, 0] },
    }).select('descrizione nome_edificio latitudine longitudine').lean();

    const fuori = edifici
        .map((edificio) => {
            const latitudine = rimettiIlPuntoDecimale(edificio.latitudine, ATTORNO_A.latitudine);
            const longitudine = rimettiIlPuntoDecimale(edificio.longitudine, ATTORNO_A.longitudine);
            const sbagliata = Math.abs(edificio.latitudine - ATTORNO_A.latitudine) > SCARTO_MASSIMO
                || Math.abs(edificio.longitudine - ATTORNO_A.longitudine) > SCARTO_MASSIMO;
            return sbagliata ? { edificio, latitudine, longitudine } : null;
        })
        .filter(Boolean);

    console.log('Edifici con coordinate fuori dalla zona di Cortina:');
    console.log(`  trovati: ${fuori.length}`);
    fuori.forEach(({ edificio, latitudine, longitudine }) => console.log(
        `    ${edificio.descrizione || edificio.nome_edificio || edificio._id}: `
        + `${edificio.latitudine}, ${edificio.longitudine} -> `
        + (latitudine && longitudine ? `${latitudine}, ${longitudine}` : 'non correggibile, da rilevare')
    ));

    const correggibili = fuori.filter((voce) => voce.latitudine && voce.longitudine);

    if (!applica || correggibili.length === 0) {
        return;
    }

    for (const { edificio, latitudine, longitudine } of correggibili) {
        await Edificio.collection.updateOne({ _id: edificio._id }, { $set: { latitudine, longitudine } });
    }
    console.log(`  corretti: ${correggibili.length}`);
};

// La storia di un punto di fornitura: quale contatore ha preso il posto di quale.
//
// Nell'archivio importato il legame esiste in una sola forma verificabile: il
// contatore che sostituisce un altro porta nel seriale interno il codice del
// predecessore, scritto "<codice>_2". Quella e una dichiarazione del gestionale
// precedente, non una deduzione, e si ricostruisce senza margine di errore.
//
// I subentri - stessa matricola, intestatario diverso - non hanno un legame
// scritto da nessuna parte: ricavarli dall'ordine delle date sembra funzionare e
// non funziona. Provato: su 138 coppie dichiarate da Gesco ne indovinava 117,
// ne sbagliava 21 e ne inventava altre 46. Un collegamento sbagliato racconta
// una storia falsa, che e peggio di una storia mancante, quindi qui non si
// indovina: si elencano i candidati e li conferma una persona.
const collegaContatoriSostituiti = async () => {
    const contatori = await Contatore.find().select('codice seriale seriale_interno cliente precedente').lean();
    const perCodice = new Map(contatori.map((c) => [String(c.codice), c]));

    const dichiarati = contatori
        .map((c) => {
            const corrisponde = String(c.seriale_interno || '').match(/^(\d+)_\d+$/);
            const vecchio = corrisponde && perCodice.get(corrisponde[1]);
            return vecchio && String(vecchio._id) !== String(c._id) ? { c, vecchio } : null;
        })
        .filter(Boolean)
        .filter(({ c, vecchio }) => String(c.precedente || '') !== String(vecchio._id));

    console.log('Contatori che dichiarano di aver sostituito un altro:');
    console.log(`  da collegare: ${dichiarati.length}`);
    dichiarati.forEach(({ c, vecchio }) => console.log(`    ${c.codice} ha sostituito ${vecchio.codice}`));

    // I subentri restano da confermare a mano: si contano soltanto.
    const perSeriale = new Map();
    contatori.forEach((c) => {
        const seriale = String(c.seriale || '').trim();
        if (!seriale) return;
        if (!perSeriale.has(seriale)) perSeriale.set(seriale, []);
        perSeriale.get(seriale).push(c);
    });
    const daConfermare = [...perSeriale.values()].filter((gruppo) => gruppo.length > 1).length;
    console.log(`  matricole condivise da piu contatori (subentri da confermare a mano): ${daConfermare}`);

    if (!applica || dichiarati.length === 0) {
        return;
    }

    for (const { c, vecchio } of dichiarati) {
        await Contatore.collection.updateOne({ _id: c._id }, { $set: { precedente: vecchio._id } });
    }
    console.log(`  collegati: ${dichiarati.length}`);
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
    console.log('');
    await scriviRuoloUtenti();
    console.log('');
    await correggiCoordinateEdifici();
    console.log('');
    await collegaContatoriSostituiti();
};

runScript(main);
