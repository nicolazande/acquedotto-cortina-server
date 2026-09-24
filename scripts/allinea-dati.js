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
//   - fatture: collega al cliente quelle rimaste senza, se la ragione sociale e
//     di un solo cliente
//   - consegne: rimette in coda quelle chiuse da una prova di invio e toglie il
//     campo `simulata`, che non si scrive piu
const { runScript } = require('./utils/runScript');
const Cliente = require('../models/Cliente');
const Consegna = require('../models/Consegna');
const Contatore = require('../models/Contatore');
const Edificio = require('../models/Edificio');
const User = require('../models/User');
const Fattura = require('../models/Fattura');
const Scadenza = require('../models/Scadenza');
const { MODALITA_CONSEGNA, normalizzaModalita } = require('../config/delivery');
const { DATA_IMPLAUSIBILE, formatItalianDate } = require('../utils/dates');

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

// Il nome dell'edificio arriva dall'archivio come testo (`nome_edificio`), e per
// una parte dei contatori il collegamento vero non e mai stato scritto: sulla
// scheda si legge "CASA DIMAI.FLORO" ma la relazione Edificio resta vuota, e chi
// va a leggere i contatori non li trova sulla mappa. Si collega solo quando la
// risposta e certa: un unico edificio con quel nome, e gli altri contatori con
// lo stesso nome - gia collegati - puntano tutti li. Gli ambigui restano fuori e
// vengono elencati, perche indovinare l'edificio sbagliato manda l'operatore in
// un altro posto.
const senzaAccenti = (testo) => String(testo || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

const collegaContatoriAlLoroEdificio = async () => {
    const edifici = await Edificio.find().select('descrizione').lean();
    const perNome = new Map();
    edifici.forEach((e) => {
        const nome = senzaAccenti(e.descrizione);
        if (!nome) return;
        if (!perNome.has(nome)) perNome.set(nome, []);
        perNome.get(nome).push(e);
    });

    const contatori = await Contatore.find().select('seriale codice nome_edificio edificio').lean();

    // Come sono gia collegati i contatori che portano lo stesso nome.
    const gia = new Map();
    contatori.forEach((c) => {
        if (!c.edificio) return;
        const nome = senzaAccenti(c.nome_edificio);
        if (!nome) return;
        if (!gia.has(nome)) gia.set(nome, new Set());
        gia.get(nome).add(String(c.edificio));
    });

    const daCollegare = [];
    const ambigui = [];
    contatori
        .filter((c) => !c.edificio && senzaAccenti(c.nome_edificio))
        .forEach((c) => {
            const nome = senzaAccenti(c.nome_edificio);
            const candidati = perNome.get(nome) || [];
            const conferme = gia.get(nome);
            const concorde = !conferme || (conferme.size === 1 && candidati.length === 1 && conferme.has(String(candidati[0]._id)));
            if (candidati.length === 1 && concorde) daCollegare.push({ c, edificio: candidati[0] });
            else ambigui.push({ c, candidati, conferme });
        });

    console.log('Contatori senza edificio collegato:');
    console.log(`  da collegare (nome univoco e concorde): ${daCollegare.length}`);
    console.log(`  da sistemare a mano: ${ambigui.length}`);
    ambigui.forEach(({ c, candidati, conferme }) =>
        console.log(`    ${c.seriale || c.codice} "${c.nome_edificio}": ${candidati.length} edifici con quel nome, ${conferme ? conferme.size : 0} destinazioni fra i gia collegati`));

    if (!applica || daCollegare.length === 0) {
        return;
    }

    for (const { c, edificio } of daCollegare) {
        await Contatore.collection.updateOne({ _id: c._id }, { $set: { edificio: edificio._id } });
    }
    console.log(`  collegati: ${daCollegare.length}`);
};

// L'import collega una fattura al suo cliente cercando nome e cognome identici.
// Quando non combaciano la fattura resta senza cliente: a Campo 371 su 1.469, a
// Zuel 121. Tutte pero portano la ragione sociale di un solo cliente, e quella
// basta. Si collega solo quando il cliente e uno; se sono di piu, o nessuno, la
// fattura resta com'e e viene elencata, perche un collegamento sbagliato manda
// il documento e i solleciti alla persona sbagliata.
const collegaFattureSenzaCliente = async () => {
    const chiave = (testo) => String(testo || '').trim().replace(/\s+/g, ' ').toUpperCase();

    const perRagioneSociale = new Map();
    const clienti = await Cliente.find({}, { ragione_sociale: 1 }).lean();
    clienti.forEach((cliente) => {
        const k = chiave(cliente.ragione_sociale);
        if (k) perRagioneSociale.set(k, [...(perRagioneSociale.get(k) || []), cliente._id]);
    });

    const senzaCliente = await Fattura.find({ cliente: null }, { ragione_sociale: 1, anno: 1, numero: 1 }).lean();
    const daCollegare = [];
    const daDecidere = [];
    senzaCliente.forEach((fattura) => {
        const trovati = perRagioneSociale.get(chiave(fattura.ragione_sociale)) || [];
        if (trovati.length === 1) {
            daCollegare.push({ fattura, cliente: trovati[0] });
        } else {
            daDecidere.push({ fattura, quanti: trovati.length });
        }
    });

    console.log('Fatture senza cliente:');
    console.log(`  da collegare (ragione sociale di un solo cliente): ${daCollegare.length}`);
    console.log(`  da decidere a mano: ${daDecidere.length}`);
    daDecidere.slice(0, 10).forEach(({ fattura, quanti }) => console.log(
        `    ${fattura.anno}/${fattura.numero ?? '-'} "${fattura.ragione_sociale || ''}": `
        + `${quanti ? `${quanti} clienti con quella ragione sociale` : 'nessun cliente con quella ragione sociale'}`
    ));

    if (!applica || daCollegare.length === 0) {
        return;
    }

    await Fattura.collection.bulkWrite(daCollegare.map(({ fattura, cliente }) => ({
        updateOne: { filter: { _id: fattura._id, cliente: null }, update: { $set: { cliente } } },
    })));
    console.log(`  collegate: ${daCollegare.length}`);
};

// Fino al 21/09/2026 una prova di invio - senza posta attiva, o deviata
// sull'indirizzo di prova - chiudeva la consegna come inviata, con
// `simulata: true`: il cliente non aveva ricevuto niente, ma la consegna non
// tornava piu in coda e a posta attiva non sarebbe partita. Ora una prova la
// lascia in coda. Quelle chiuse cosi ci tornano, con l'esito della prova sulla
// riga; il campo resta su tutte le altre con valore falso e non dice piu niente.
const riapriConsegneProvate = async () => {
    const provate = await Consegna.collection
        .find({ simulata: true, stato: 'inviata' }, { projection: { data_invio: 1, documento: 1, intestatario: 1 } })
        .toArray();
    const conIlCampo = await Consegna.collection.countDocuments({ simulata: { $exists: true } });

    console.log('Consegne chiuse da una prova di invio:');
    console.log(`  da rimettere in coda: ${provate.length}`);
    provate.forEach((consegna) => console.log(`    ${consegna.documento || consegna._id} ${consegna.intestatario || ''}`));
    console.log(`  con il campo \`simulata\` da togliere: ${conIlCampo}`);

    // Ogni consegna provata ha il campo: se non c'e su nessuna, non c'e niente da fare.
    if (!applica || conIlCampo === 0) {
        return;
    }

    // Il recapito si toglie: una prova deviata aveva scritto l'indirizzo di
    // prova al posto di quello del cliente. Lo riscrive il prossimo Prepara, e
    // senza recapito un invio anticipato finisce in errore invece che altrove.
    for (const consegna of provate) {
        await Consegna.collection.updateOne({ _id: consegna._id }, {
            $set: {
                stato: 'in_coda',
                note: `Prova del ${formatItalianDate(consegna.data_invio)}: il cliente non l'ha ricevuta. Resta in coda.`,
                ultimo_tentativo: consegna.data_invio,
            },
            $unset: { data_invio: '', destinatario: '', riferimento: '', allegati: '' },
        });
    }
    const ripulite = await Consegna.collection.updateMany({ simulata: { $exists: true } }, { $unset: { simulata: '' } });
    console.log(`  rimesse in coda: ${provate.length}, campo tolto: ${ripulite.modifiedCount}`);
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
    console.log('');
    await collegaContatoriAlLoroEdificio();
    console.log('');
    await collegaFattureSenzaCliente();
    console.log('');
    await riapriConsegneProvate();
};

runScript(main);
