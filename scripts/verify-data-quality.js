// Validazione dei dati: non solo "il riferimento esiste", ma "il valore ha senso".
//
//   npm run report:dati               # database locale
//   npm run report:dati -- --remoto   # produzione, in sola lettura
//
// E un rapporto, non una correzione: per ogni regola dice quanti record la
// violano e ne mostra qualcuno. Le regole vengono dai difetti trovati davvero -
// fatture con il numero del civico, scadenze condivise fra due documenti, copie
// di cortesia rimesse in coda per fatture gia spedite - cosi la prossima volta se
// ne accorge uno script invece di una persona.
const mongoose = require('mongoose');
const { runScript } = require('./utils/runScript');
const { codiceDestinatarioValido, CAMPO_DATA_CONSEGNA } = require('../config/delivery');
const { codiceFiscaleValido, partitaIvaValida } = require('../utils/codiciFiscali');
const { dataReale } = require('../utils/dates');
const { toCents } = require('../utils/money');

const ESEMPI = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const db = () => mongoose.connection.db;
const tutti = (nome, filtro = {}, campi = {}) => db().collection(nome).find(filtro, { projection: campi }).toArray();

const risultati = [];

const regola = (area, descrizione, trovati, etichetta) => {
    risultati.push({ area, descrizione, quanti: trovati.length, esempi: trovati.slice(0, ESEMPI).map(etichetta) });
};

const nomeCliente = (cliente) => cliente?.ragione_sociale || `${cliente?.cognome || ''} ${cliente?.nome || ''}`.trim();

const controllaClienti = async (clienti) => {
    const etichetta = (c) => `${nomeCliente(c)} (${c.codice_fiscale || c.partita_iva || 'senza codici'})`;

    regola('clienti', 'codice fiscale che non supera il controllo',
        clienti.filter((c) => c.codice_fiscale && !codiceFiscaleValido(c.codice_fiscale)), etichetta);
    regola('clienti', 'partita IVA che non supera il controllo',
        clienti.filter((c) => c.partita_iva && !partitaIvaValida(c.partita_iva)), etichetta);
    regola('clienti', 'in fattura elettronica ma senza codice fiscale ne partita IVA',
        clienti.filter((c) => c.fattura_elettronica && !c.codice_fiscale && !c.partita_iva), etichetta);
    regola('clienti', 'codice destinatario di forma non valida',
        clienti.filter((c) => c.codice_destinatario
            && !['0000000', 'XXXXXXX'].includes(String(c.codice_destinatario).trim().toUpperCase())
            && !codiceDestinatarioValido(c.codice_destinatario)),
        (c) => `${nomeCliente(c)}: "${c.codice_destinatario}"`);
    regola('clienti', 'email che non sembra un indirizzo',
        clienti.filter((c) => c.email && !EMAIL.test(String(c.email).trim())), (c) => `${nomeCliente(c)}: "${c.email}"`);
    regola('clienti', 'PEC che non sembra un indirizzo',
        clienti.filter((c) => c.email_pec && !EMAIL.test(String(c.email_pec).trim())), (c) => `${nomeCliente(c)}: "${c.email_pec}"`);

    const perCodice = new Map();
    clienti.filter((c) => c.codice_fiscale).forEach((c) => {
        const chiave = String(c.codice_fiscale).trim().toUpperCase();
        perCodice.set(chiave, [...(perCodice.get(chiave) || []), c]);
    });
    regola('clienti', 'stesso codice fiscale su piu schede',
        [...perCodice.values()].filter((gruppo) => gruppo.length > 1),
        (gruppo) => `${gruppo[0].codice_fiscale}: ${gruppo.map(nomeCliente).join(' / ')}`);
};

const controllaContatori = async (contatori, clientiPerId, listiniPerId) => {
    const etichetta = (c) => `${c.seriale || 'senza matricola'} (${c.nome_cliente || ''})`;

    regola('contatori', 'senza cliente', contatori.filter((c) => !c.cliente || !clientiPerId.has(String(c.cliente))), etichetta);
    regola('contatori', 'senza matricola', contatori.filter((c) => !String(c.seriale || '').trim()), etichetta);
    regola('contatori', 'inizio del contratto dopo la sua fine',
        contatori.filter((c) => dataReale(c.inizio) && dataReale(c.scadenza) && dataReale(c.inizio) > dataReale(c.scadenza)),
        etichetta);
    regola('contatori', 'senza listino', contatori.filter((c) => !c.listino), etichetta);
    regola('contatori', 'listino di una categoria diversa dal tipo di attivita',
        contatori.filter((c) => {
            const listino = listiniPerId.get(String(c.listino));
            return listino && c.tipo_attivita && listino.categoria !== c.tipo_attivita;
        }),
        (c) => `${etichetta(c)}: ${c.tipo_attivita} -> listino ${listiniPerId.get(String(c.listino))?.categoria}`);
};

const controllaLetture = async (letture, contatoriPerId, lettureFatturate) => {
    const etichetta = (l) => `${contatoriPerId.get(String(l.contatore))?.seriale || '?'} del ${dataReale(l.data_lettura)?.toISOString().slice(0, 10) || '?'}`;

    regola('letture', 'senza contatore', letture.filter((l) => !contatoriPerId.has(String(l.contatore))), etichetta);

    const perContatore = new Map();
    letture.forEach((l) => perContatore.set(String(l.contatore), [...(perContatore.get(String(l.contatore)) || []), l]));

    const doppie = [];
    const indietro = [];
    perContatore.forEach((gruppo) => {
        const ordinate = gruppo
            .filter((l) => dataReale(l.data_lettura))
            .sort((a, b) => a.data_lettura - b.data_lettura);
        ordinate.forEach((lettura, indice) => {
            const precedente = ordinate[indice - 1];
            if (!precedente) return;
            if (precedente.data_lettura.getTime() === lettura.data_lettura.getTime()
                && precedente.consumo === lettura.consumo) {
                doppie.push(lettura);
            } else if (Number(lettura.consumo) < Number(precedente.consumo)) {
                indietro.push(lettura);
            }
        });
    });

    regola('letture', 'stessa lettura registrata due volte (stesso giorno, stesso indice)', doppie, etichetta);
    regola('letture', "indice che torna indietro rispetto alla lettura prima (contatore sostituito o errore)", indietro, etichetta);
    regola('letture', 'usate in una fattura ma segnate come da fatturare',
        letture.filter((l) => lettureFatturate.has(String(l._id)) && !l.fatturata), etichetta);
};

const controllaFatture = async (fatture, clientiPerId, scadenzePerId) => {
    const etichetta = (f) => `${f.anno}/${f.serie ? `${f.serie}/` : ''}${f.numero} ${f.ragione_sociale || ''}`;

    regola('fatture', 'senza cliente', fatture.filter((f) => !f.cliente || !clientiPerId.has(String(f.cliente))), etichetta);
    regola('fatture', 'senza data', fatture.filter((f) => !dataReale(f.data_fattura)), etichetta);
    regola('fatture', 'senza numero', fatture.filter((f) => f.numero === null || f.numero === undefined), etichetta);
    regola('fatture', 'stato e spunta "confermata" che non dicono la stessa cosa',
        fatture.filter((f) => (f.stato === 'confermata') !== Boolean(f.confermata)), etichetta);

    const perNumero = new Map();
    fatture.forEach((f) => {
        const chiave = `${f.anno}|${f.serie || ''}|${f.numero}`;
        perNumero.set(chiave, [...(perNumero.get(chiave) || []), f]);
    });
    regola('fatture', 'stesso anno, serie e numero su piu documenti',
        [...perNumero.values()].filter((gruppo) => gruppo.length > 1), (gruppo) => `${etichetta(gruppo[0])} (x${gruppo.length})`);

    const conScadenza = fatture.filter((f) => f.scadenza && scadenzePerId.has(String(f.scadenza)));
    regola('fatture', 'importo della scadenza diverso dal totale della fattura',
        conScadenza.filter((f) => toCents(scadenzePerId.get(String(f.scadenza)).totale) !== toCents(f.totale_fattura)),
        (f) => `${etichetta(f)}: fattura ${f.totale_fattura}, scadenza ${scadenzePerId.get(String(f.scadenza)).totale}`);
    regola('fatture', 'collegate alla scadenza di un altro documento',
        conScadenza.filter((f) => !f.serie && (() => {
            const s = scadenzePerId.get(String(f.scadenza));
            return s.anno !== f.anno || s.numero !== f.numero;
        })()),
        (f) => `${etichetta(f)} -> scadenza ${scadenzePerId.get(String(f.scadenza)).anno}/${scadenzePerId.get(String(f.scadenza)).numero}`);

    const perScadenza = new Map();
    conScadenza.forEach((f) => perScadenza.set(String(f.scadenza), [...(perScadenza.get(String(f.scadenza)) || []), f]));
    regola('fatture', 'piu fatture sulla stessa scadenza',
        [...perScadenza.values()].filter((gruppo) => gruppo.length > 1), (gruppo) => gruppo.map(etichetta).join(' + '));
};

const controllaScadenze = async (scadenze, fattureConScadenza) => {
    const etichetta = (s) => `${s.anno}/${s.numero} ${s.cognome || ''} ${s.nome || ''}`.trim();

    regola('scadenze', 'saldate senza data di pagamento',
        scadenze.filter((s) => s.saldo === true && !dataReale(s.pagamento)), etichetta);
    regola('scadenze', 'con una data di pagamento ma non saldate',
        scadenze.filter((s) => s.saldo !== true && dataReale(s.pagamento)), etichetta);
    regola('scadenze', '"saldo" scritto come numero invece che si/no',
        scadenze.filter((s) => typeof s.saldo !== 'boolean'), etichetta);
    regola('scadenze', 'che nessuna fattura richiama',
        scadenze.filter((s) => !fattureConScadenza.has(String(s._id))), etichetta);
};

const controllaConsegne = async (consegne, fatturePerId) => {
    const etichetta = (c) => `${c.documento || '?'} ${c.tipo}/${c.canale} (${c.stato})`;

    regola('consegne', 'di una fattura che non esiste', consegne.filter((c) => !fatturePerId.has(String(c.fattura))), etichetta);
    regola('consegne', 'aperte per una fattura gia consegnata in quel modo',
        consegne.filter((c) => ['in_coda', 'errore'].includes(c.stato)
            && dataReale(fatturePerId.get(String(c.fattura))?.[CAMPO_DATA_CONSEGNA[c.tipo]])),
        etichetta);

    const perChiave = new Map();
    consegne.forEach((c) => {
        const chiave = `${c.fattura}|${c.tipo}`;
        perChiave.set(chiave, [...(perChiave.get(chiave) || []), c]);
    });
    regola('consegne', 'due consegne dello stesso tipo per la stessa fattura',
        [...perChiave.values()].filter((gruppo) => gruppo.length > 1), (gruppo) => etichetta(gruppo[0]));
};

const controllaUtenti = async (utenti, clientiPerId) => {
    regola('utenti', 'senza ruolo', utenti.filter((u) => !u.role), (u) => u.username);
    regola('utenti', 'accesso cliente che punta a un cliente inesistente',
        utenti.filter((u) => u.cliente && !clientiPerId.has(String(u.cliente))), (u) => u.username);
};

const perId = (documenti) => new Map(documenti.map((d) => [String(d._id), d]));

const main = async () => {
    console.log(`Validazione dei dati: database "${db().databaseName}"`);

    const [clienti, contatori, listini, letture, fatture, scadenze, servizi, consegne, utenti] = await Promise.all([
        tutti('clienti'),
        tutti('contatori'),
        tutti('listini', {}, { categoria: 1 }),
        tutti('letture', {}, { contatore: 1, data_lettura: 1, consumo: 1, fatturata: 1 }),
        tutti('fatture'),
        tutti('scadenze'),
        tutti('servizi', {}, { fattura: 1, lettura: 1 }),
        tutti('consegne'),
        tutti('utenti', {}, { username: 1, role: 1, cliente: 1 }),
    ]);

    const clientiPerId = perId(clienti);
    const contatoriPerId = perId(contatori);
    const scadenzePerId = perId(scadenze);
    const fatturePerId = perId(fatture);
    const lettureFatturate = new Set(servizi.filter((s) => s.lettura).map((s) => String(s.lettura)));
    const fattureConScadenza = new Set(fatture.filter((f) => f.scadenza).map((f) => String(f.scadenza)));

    await controllaClienti(clienti);
    await controllaContatori(contatori, clientiPerId, perId(listini));
    await controllaLetture(letture, contatoriPerId, lettureFatturate);
    await controllaFatture(fatture, clientiPerId, scadenzePerId);
    await controllaScadenze(scadenze, fattureConScadenza);
    await controllaConsegne(consegne, fatturePerId);
    await controllaUtenti(utenti, clientiPerId);

    let area = null;
    risultati.forEach(({ area: corrente, descrizione, quanti, esempi }) => {
        if (corrente !== area) {
            console.log(`\n== ${corrente}`);
            area = corrente;
        }
        console.log(`  ${quanti === 0 ? 'ok ' : '!! '} ${descrizione}: ${quanti}`);
        esempi.forEach((esempio) => console.log(`        ${esempio}`));
    });

    const problemi = risultati.filter((r) => r.quanti > 0).length;
    console.log(`\n${risultati.length} regole controllate, ${problemi} con qualcosa da guardare.`);
    return true;
};

runScript(main);
