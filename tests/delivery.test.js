const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CODICE_DESTINATARIO_ASSENTE,
    MODALITA_CONSEGNA,
    canaleFatturaElettronica,
    codiceDestinatarioValido,
    modalitaConsegna,
    normalizzaModalita,
} = require('../config/delivery');
const { FATTURA_IN_BOZZA, aggiornamentoCoda, indirizzoPostale, pianoConsegne } = require('../services/deliveryPlan');

const cliente = (campi = {}) => ({
    _id: 'cliente-1',
    cognome: 'Rossi',
    nome: 'Ada',
    indirizzo_residenza: 'Via Roma',
    numero_residenza: '3',
    cap_residenza: '32043',
    localita_residenza: "Cortina d'Ampezzo",
    ...campi,
});

const fattura = (campi = {}) => ({
    _id: 'fattura-1',
    anno: 2026,
    numero: 1,
    serie: 'A',
    stato: 'confermata',
    ...campi,
});

const consegnaDi = (piano, tipo) => piano.consegne.find((consegna) => consegna.tipo === tipo);

// --- modalita di consegna ---------------------------------------------------

test('la modalita scritta dal gestionale precedente viene riconosciuta', () => {
    // Tutti e 900 i clienti importati hanno questo testo nel campo libero.
    assert.equal(normalizzaModalita('Cartacea Postale'), 'postale');
    assert.equal(normalizzaModalita('CARTACEA POSTALE'), 'postale');
    assert.equal(normalizzaModalita('  cartacea  postale '), 'postale');
});

test('le abbreviazioni comuni finiscono sulla modalita giusta', () => {
    assert.equal(normalizzaModalita('E-Mail'), 'email');
    assert.equal(normalizzaModalita('mail'), 'email');
    assert.equal(normalizzaModalita('PEC'), 'pec');
    assert.equal(normalizzaModalita('ritiro'), 'sportello');
});

test('un campo vuoto o incomprensibile non inventa una modalita', () => {
    // Meglio la modalita con cui l'acquedotto ha sempre lavorato che una scelta
    // arbitraria: una fattura stampata di troppo si butta, una mail no.
    assert.equal(normalizzaModalita(''), 'postale');
    assert.equal(normalizzaModalita(null), 'postale');
    assert.equal(normalizzaModalita('boh'), 'postale');
});

test('ogni modalita dichiarata resta stabile se normalizzata di nuovo', () => {
    MODALITA_CONSEGNA.forEach(({ value }) => {
        assert.equal(normalizzaModalita(value), value);
    });
});

test('solo email e PEC sono canali automatici', () => {
    const automatiche = MODALITA_CONSEGNA.filter((voce) => voce.automatica).map((voce) => voce.value);
    assert.deepEqual(automatiche, ['email', 'pec']);
});

test('la modalita del cliente arriva dal campo stampa_cortesia', () => {
    assert.equal(modalitaConsegna(cliente({ stampa_cortesia: 'email' })).canale, 'email');
    assert.equal(modalitaConsegna(cliente()).canale, 'postale');
});

// --- canale della fattura elettronica ---------------------------------------

test('il codice destinatario segnaposto non vale come codice', () => {
    assert.equal(codiceDestinatarioValido('0000000'), null);
    assert.equal(codiceDestinatarioValido(''), null);
    assert.equal(codiceDestinatarioValido('ABC'), null);
    assert.equal(codiceDestinatarioValido('m5uxcr1'), 'M5UXCR1');
});

test('con un codice SdI il file va al codice, non alla PEC', () => {
    const canale = canaleFatturaElettronica({ codice_destinatario: 'M5UXCR1', email_pec: 'ada@pec.it' });
    assert.equal(canale.canale, 'sdi');
    assert.equal(canale.destinatario, 'M5UXCR1');
});

test('senza codice SdI si usa la PEC', () => {
    const canale = canaleFatturaElettronica({ codice_destinatario: '0000000', email_pec: 'ada@pec.it' });
    assert.equal(canale.canale, 'pec');
    assert.equal(canale.destinatario, 'ada@pec.it');
});

test('senza codice e senza PEC resta il cassetto fiscale', () => {
    const canale = canaleFatturaElettronica({});
    assert.equal(canale.canale, 'cassetto');
    assert.equal(canale.destinatario, CODICE_DESTINATARIO_ASSENTE);
});

// --- indirizzo di spedizione ------------------------------------------------

test("l'indirizzo di fatturazione ha la precedenza sulla residenza", () => {
    const indirizzo = indirizzoPostale(cliente({
        indirizzo_fatturazione: 'Via Cadore',
        numero_fatturazione: '10',
        cap_fatturazione: '32100',
        localita_fatturazione: 'Belluno',
    }));

    assert.equal(indirizzo, 'Via Cadore 10 - 32100 Belluno');
});

test('un indirizzo senza localita non e un indirizzo', () => {
    assert.equal(indirizzoPostale({ indirizzo_residenza: 'Via Roma' }), '');
    assert.equal(indirizzoPostale({}), '');
});

// --- piano di consegna ------------------------------------------------------

test('una bozza non si consegna', () => {
    const piano = pianoConsegne({ cliente: cliente(), fattura: fattura({ stato: 'bozza' }) });

    assert.equal(piano.pronta, false);
    assert.equal(piano.consegne.length, 0);
    assert.match(piano.ostacoli[0], /bozza/);
});

test('una fattura senza cliente non ha destinatario possibile', () => {
    const piano = pianoConsegne({ cliente: null, fattura: fattura() });

    assert.equal(piano.pronta, false);
    assert.match(piano.ostacoli[0], /cliente/);
});

test('la copia postale e prevista ma non parte da sola', () => {
    const piano = pianoConsegne({ cliente: cliente(), fattura: fattura() });
    const cortesia = consegnaDi(piano, 'cortesia');

    assert.equal(cortesia.canale, 'postale');
    assert.equal(cortesia.automatico, false);
    assert.equal(cortesia.problema, null);
    assert.equal(piano.documento, '2026/A/1');
    assert.equal(piano.intestatario, 'Rossi Ada');
});

test('la copia per email parte da sola quando il recapito c’è', () => {
    const piano = pianoConsegne({
        cliente: cliente({ stampa_cortesia: 'email', email: 'ada@rossi.it' }),
        fattura: fattura(),
    });
    const cortesia = consegnaDi(piano, 'cortesia');

    assert.equal(cortesia.canale, 'email');
    assert.equal(cortesia.automatico, true);
    assert.equal(cortesia.destinatario, 'ada@rossi.it');
    assert.equal(cortesia.problema, null);
});

test('la modalita email senza indirizzo viene segnalata, non ignorata', () => {
    // Il caso e concreto: solo un quarto dei clienti ha una email in anagrafica.
    const piano = pianoConsegne({ cliente: cliente({ stampa_cortesia: 'email' }), fattura: fattura() });
    const cortesia = consegnaDi(piano, 'cortesia');

    assert.equal(cortesia.destinatario, '');
    assert.match(cortesia.problema, /email/);
    assert.equal(piano.pronta, false);
});

test('un indirizzo email malformato non viene dato per buono', () => {
    const piano = pianoConsegne({
        cliente: cliente({ stampa_cortesia: 'email', email: 'da chiedere' }),
        fattura: fattura(),
    });

    assert.match(consegnaDi(piano, 'cortesia').problema, /valido/);
});

test('chi non vuole la copia di cortesia non entra in coda', () => {
    const piano = pianoConsegne({ cliente: cliente({ stampa_cortesia: 'nessuna' }), fattura: fattura() });

    assert.equal(consegnaDi(piano, 'cortesia'), undefined);
});

test('la fattura elettronica si prepara solo per chi la riceve', () => {
    const senza = pianoConsegne({ cliente: cliente(), fattura: fattura() });
    assert.equal(consegnaDi(senza, 'elettronica'), undefined);

    const con = pianoConsegne({
        cliente: cliente({ fattura_elettronica: true, codice_destinatario: 'M5UXCR1' }),
        fattura: fattura(),
    });
    assert.equal(consegnaDi(con, 'elettronica').canale, 'sdi');
});

test('finche trasmette un intermediario la fattura elettronica non parte da sola', () => {
    const piano = pianoConsegne({
        cliente: cliente({ fattura_elettronica: true, codice_destinatario: 'M5UXCR1' }),
        fattura: fattura(),
    });
    const elettronica = consegnaDi(piano, 'elettronica');

    assert.equal(elettronica.automatico, false);
    assert.match(elettronica.nota, /intermediario/);
});

test('i due canali convivono e sono indipendenti', () => {
    const piano = pianoConsegne({
        cliente: cliente({
            stampa_cortesia: 'email',
            email: 'ada@rossi.it',
            fattura_elettronica: true,
            email_pec: 'ada@pec.it',
        }),
        fattura: fattura(),
    });

    assert.equal(piano.consegne.length, 2);
    assert.equal(consegnaDi(piano, 'cortesia').destinatario, 'ada@rossi.it');
    assert.equal(consegnaDi(piano, 'elettronica').destinatario, 'ada@pec.it');
});

// --- consegne gia fatte -----------------------------------------------------

test('una fattura gia trasmessa allo SdI non si prepara di nuovo', () => {
    // Quasi tutte le fatture importate da Gesco sono gia state trasmesse:
    // rimetterle in coda voleva dire rischiare di ritrasmetterle.
    const piano = pianoConsegne({
        cliente: cliente({ fattura_elettronica: true, codice_destinatario: 'TULURSB' }),
        fattura: fattura({ data_fattura_elettronica: new Date('2025-12-05') }),
    });

    assert.equal(consegnaDi(piano, 'elettronica'), undefined);
    assert.deepEqual(piano.giaConsegnate.map((fatta) => fatta.tipo), ['elettronica']);
});

test('una copia gia spedita non si ristampa', () => {
    const piano = pianoConsegne({
        cliente: cliente({ stampa_cortesia: 'postale' }),
        fattura: fattura({ data_invio_fattura: new Date('2025-12-05') }),
    });

    assert.equal(consegnaDi(piano, 'cortesia'), undefined);
});

test('la data 01/01/1900 del vecchio programma vuol dire "mai inviata"', () => {
    const piano = pianoConsegne({
        cliente: cliente({ fattura_elettronica: true, codice_destinatario: 'TULURSB' }),
        fattura: fattura({ data_fattura_elettronica: new Date('1900-01-01T00:00:00.000Z') }),
    });

    assert.ok(consegnaDi(piano, 'elettronica'));
    assert.deepEqual(piano.giaConsegnate, []);
});

test('in coda una fattura per l estero dice subito perche non uscira', () => {
    const piano = pianoConsegne({
        cliente: cliente({ fattura_elettronica: true, codice_destinatario: 'XXXXXXX', nazione_residenza: 'D' }),
        fattura: fattura(),
    });

    assert.match(consegnaDi(piano, 'elettronica').problema, /cliente estero \(D\)/);
});

// --- la coda: cosa fa "Prepara" -------------------------------------------

// Una fattura con il suo cliente, come arriva dal database con populate.
const daGuardare = (campiFattura = {}, campiCliente = {}) => ({
    ...fattura(campiFattura),
    cliente: cliente(campiCliente),
});

const vecchia = (campi = {}) => ({ serie: undefined, anno: 2025, numero: 11, ...campi });

const inCoda = (campi = {}) => ({
    _id: 'consegna-1',
    fattura: 'fattura-1',
    tipo: 'cortesia',
    canale: 'postale',
    stato: 'in_coda',
    ...campi,
});

// Chi riceve la copia per email, e una fattura non confermata.
const perEmail = (campi = {}) => ({ stampa_cortesia: 'email', email: 'ada@rossi.it', ...campi });
const inBozza = { stato: 'bozza', confermata: false };

const inserite = (esito) => esito.operazioni.filter((op) => op.insertOne).map((op) => op.insertOne.document);
const operazioneDi = (esito, id) => esito.operazioni.find((op) => op.updateOne?.filter._id === id)?.updateOne;
const aggiornamentoDi = (esito, id) => operazioneDi(esito, id)?.update;

test('una fattura emessa dal gestionale entra in coda con il recapito del cliente', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, perEmail())],
        esistenti: [],
    });

    assert.equal(esito.create, 1);
    assert.deepEqual(inserite(esito).map(({ tipo, canale, destinatario }) => ({ tipo, canale, destinatario })), [
        { tipo: 'cortesia', canale: 'email', destinatario: 'ada@rossi.it' },
    ]);
    // Dalla pagina Consegne la consegna non e "su richiesta", e un campo vuoto
    // non finisce scritto come null.
    assert.equal(inserite(esito)[0].su_richiesta, undefined);
    assert.equal('ultimo_errore' in inserite(esito)[0], false);
    assert.equal('problema' in inserite(esito)[0], false);
});

test('la coda generale non prepara le fatture del vecchio programma', () => {
    // Come le fatture di dicembre di Zuel, che il vecchio programma non ha mai
    // trasmesso perche partono ogni anno per altra via.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia(), { fattura_elettronica: true, codice_destinatario: 'TULURSB' })],
        esistenti: [],
    });

    assert.equal(esito.operazioni.length, 0);
    assert.deepEqual(esito.problemi, []);
});

test('la scheda di una fattura del vecchio programma la mette in coda apposta', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia(), { fattura_elettronica: true, codice_destinatario: 'TULURSB' })],
        esistenti: [],
        suRichiesta: true,
    });

    assert.deepEqual(inserite(esito).map(({ tipo, su_richiesta: suRichiesta }) => ({ tipo, suRichiesta })), [
        { tipo: 'cortesia', suRichiesta: true },
        { tipo: 'elettronica', suRichiesta: true },
    ]);
});

test('una copia gia spedita dal vecchio programma esce dalla coda con la sua data', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia({ data_invio_fattura: new Date('2026-01-22T00:00:00Z') }))],
        esistenti: [inCoda()],
    });

    assert.equal(esito.annullate, 1);
    assert.deepEqual(aggiornamentoDi(esito, 'consegna-1'), {
        $set: { stato: 'annullata', note: 'Già consegnata il 22/01/2026: non va ripetuta.', chiusa_dal_piano: true },
        // Sulla riga chiusa si legge il motivo, non il problema di quando era aperta.
        $unset: { problema: '', ultimo_errore: '' },
    });
});

test('una consegna del vecchio programma mai segnata esce dalla coda dicendo perche', () => {
    // Le copie cartacee delle fatture singole del 2026: il vecchio programma non
    // segnava di averle spedite, e il Prepara di prima le metteva in stampa.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia({ data_invio_fattura: new Date('1900-01-01T00:00:00Z') }))],
        esistenti: [inCoda()],
    });

    assert.match(aggiornamentoDi(esito, 'consegna-1').$set.note, /^Fattura del vecchio programma/);
});

test('la coda generale tiene in pari cio che e stato chiesto dalla scheda, invece di toglierlo', () => {
    // Di una fattura del vecchio programma la coda generale si occupa solo delle
    // righe chieste a mano: le lascia in coda, ma con il recapito di oggi. Prima
    // non le guardava affatto, e il recapito invecchiava.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia())],
        esistenti: [inCoda({ su_richiesta: true })],
    });

    assert.equal(esito.annullate, 0);
    assert.equal(esito.aggiornate, 1);
    assert.match(aggiornamentoDi(esito, 'consegna-1').$set.destinatario, /Via Roma 3/);
});

test('una riga chiesta a mano si chiude quando il piano non la prevede piu', () => {
    // E si chiude per il motivo vero - gia consegnata - non per "vecchio programma".
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia({ data_invio_fattura: new Date('2026-01-22T00:00:00Z') }))],
        esistenti: [inCoda({ su_richiesta: true })],
    });

    assert.equal(esito.annullate, 1);
    assert.match(aggiornamentoDi(esito, 'consegna-1').$set.note, /^Già consegnata il 22\/01\/2026/);
});

test('la coda generale non aggiunge un canale acceso dopo', () => {
    // Il cliente passa alla fattura elettronica a fatturazione gia fatta: le
    // fatture gia emesse non si trasmettono a mesi di distanza. Vale da qui in
    // avanti. Il segno sta sulla fattura, non nelle righe che ha: un cliente
    // senza copia di cortesia e senza fattura elettronica non ne ha nessuna, e
    // sarebbe passato per "mai guardata".
    const cliente = perEmail({ fattura_elettronica: true, codice_destinatario: 'TULURSB' });
    const decisa = daGuardare({ consegne_decise_il: new Date('2026-09-01') }, cliente);
    const esistenti = [inCoda({ canale: 'email', destinatario: 'ada@rossi.it' })];

    const generale = aggiornamentoCoda({ fatture: [decisa], esistenti });
    assert.equal(generale.create, 0);
    assert.deepEqual(generale.nonAggiunte.map((voce) => voce.tipo), ['elettronica']);

    const senzaNessunaRiga = aggiornamentoCoda({
        fatture: [daGuardare({ consegne_decise_il: new Date('2026-09-01') }, { stampa_cortesia: 'nessuna', fattura_elettronica: true, codice_destinatario: 'TULURSB' })],
        esistenti: [],
    });
    assert.equal(senzaNessunaRiga.create, 0);
    assert.equal(senzaNessunaRiga.nonAggiunte.length, 1);

    // Dalla scheda invece si puo: e una richiesta esplicita su quella fattura.
    const dallaScheda = aggiornamentoCoda({ fatture: [decisa], esistenti, suRichiesta: true });
    assert.deepEqual(inserite(dallaScheda).map((voce) => voce.tipo), ['elettronica']);
});

test('la prima volta che guarda una fattura, la coda generale prepara tutti i canali e ci mette il segno', () => {
    const fatturaNuova = daGuardare({}, perEmail({ fattura_elettronica: true, codice_destinatario: 'TULURSB' }));
    const esito = aggiornamentoCoda({ fatture: [fatturaNuova], esistenti: [] });

    assert.deepEqual(inserite(esito).map((voce) => voce.tipo), ['cortesia', 'elettronica']);
    assert.deepEqual(esito.decise, ['fattura-1']);
});

test('una fattura non pronta, o del vecchio programma, non viene segnata come decisa', () => {
    // Una bozza si guardera di nuovo quando sara confermata; una fattura del
    // vecchio programma la coda generale non la prepara affatto.
    const bozza = aggiornamentoCoda({ fatture: [daGuardare(inBozza, perEmail())], esistenti: [] });
    assert.deepEqual(bozza.decise, []);

    const storico = aggiornamentoCoda({ fatture: [daGuardare(vecchia(), perEmail())], esistenti: [] });
    assert.deepEqual(storico.decise, []);
});

test('un problema risolto in anagrafica non resta scritto sulla riga', () => {
    // Mongoose scarta i valori undefined di un $set: il vecchio messaggio
    // restava accanto a un recapito ormai giusto.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, perEmail())],
        esistenti: [inCoda({ canale: 'email', problema: 'Il cliente non ha un indirizzo email.' })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal(esito.aggiornate, 1);
    assert.equal(aggiornamento.$set.destinatario, 'ada@rossi.it');
    assert.equal(aggiornamento.$unset.problema, '');
});

test('Prepara non riscrive una consegna che non cambia', () => {
    // Ogni Prepara riscriveva tutte le consegne aperte e le contava come
    // aggiornate: a una fatturazione, 1.341 scritture per niente.
    const piano = pianoConsegne({ cliente: cliente(perEmail()), fattura: fattura() });
    const uguale = inCoda({
        cliente: 'cliente-1',
        canale: 'email',
        destinatario: 'ada@rossi.it',
        documento: piano.documento,
        intestatario: piano.intestatario,
        automatica: true,
    });

    const esito = aggiornamentoCoda({ fatture: [daGuardare({}, perEmail())], esistenti: [uguale] });

    assert.equal(esito.aggiornate, 0);
    assert.equal(esito.operazioni.length, 0);
});

test("Prepara non cancella l'errore di un file XML", () => {
    // Il file non si e potuto fare: la riga resta in coda con il motivo, e il
    // motivo lo toglie solo un file fatto.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, { fattura_elettronica: true, codice_destinatario: 'TULURSB', stampa_cortesia: 'nessuna' })],
        esistenti: [inCoda({ tipo: 'elettronica', canale: 'sdi', ultimo_errore: 'La fattura non ha righe.' })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal('ultimo_errore' in aggiornamento.$set, false);
    assert.equal(aggiornamento.$unset?.ultimo_errore, undefined);
});

test('una fattura confermata di nuovo perde il segno della bozza', () => {
    // La bozza e una condizione, non un guasto: se il piano prevede la
    // consegna, la fattura e confermata.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, perEmail())],
        esistenti: [inCoda({ canale: 'email', stato: 'errore', ultimo_errore: FATTURA_IN_BOZZA })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal(aggiornamento.$set.stato, 'in_coda');
    assert.equal(aggiornamento.$unset.ultimo_errore, '');
});

test('ogni scrittura vale solo se la consegna e ancora nello stato letto', () => {
    // Una consegna partita mentre Prepara lavorava non va chiusa ne riaperta.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia()), daGuardare({ _id: 'fattura-2' })],
        esistenti: [inCoda(), inCoda({ _id: 'consegna-2', fattura: 'fattura-2', stato: 'annullata', chiusa_dal_piano: true })],
    });

    assert.deepEqual(operazioneDi(esito, 'consegna-1').filter.stato, { $in: ['in_coda', 'errore'] });
    assert.deepEqual(operazioneDi(esito, 'consegna-2').filter.stato, { $in: ['annullata'] });
});

test('la coda generale non riapre una consegna annullata', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare()],
        esistenti: [inCoda({ stato: 'annullata', note: 'Annullata manualmente.' })],
    });

    assert.equal(esito.saltate, 1);
    assert.equal(esito.operazioni.length, 0);
});

test('dalla scheda Prepara rimette in coda una consegna annullata', () => {
    // Le fatture di dicembre chiuse dalla coda generale: se si decide di
    // mandarle da qui, la loro scheda deve poterle rimettere in coda.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(vecchia())],
        esistenti: [inCoda({ stato: 'annullata', note: 'Fattura del vecchio programma: ...' })],
        suRichiesta: true,
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal(esito.riaperte, 1);
    assert.equal(aggiornamento.$set.stato, 'in_coda');
    assert.equal(aggiornamento.$set.su_richiesta, true);
    assert.equal(aggiornamento.$unset.note, '');
});

test('la coda generale riapre cio che aveva chiuso lei, quando il piano torna a prevederlo', () => {
    // La fattura riportata a bozza si e vista chiudere le consegne; confermata
    // di nuovo, deve riaverle senza che qualcuno se ne ricordi fattura per fattura.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare()],
        esistenti: [inCoda({ stato: 'annullata', note: FATTURA_IN_BOZZA, chiusa_dal_piano: true })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal(esito.riaperte, 1);
    assert.equal(aggiornamento.$set.stato, 'in_coda');
    assert.equal(aggiornamento.$unset.note, '');
    assert.equal(aggiornamento.$unset.chiusa_dal_piano, '');
    assert.equal(aggiornamento.$set.su_richiesta, undefined);
});

test('Prepara non fa sparire un errore di invio', () => {
    // Il server di posta ha rifiutato l'indirizzo: la riga resta fra gli errori,
    // con il motivo, finche l'invio non riesce o una persona non la rimette in coda.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, perEmail())],
        esistenti: [inCoda({ canale: 'email', stato: 'errore', ultimo_errore: '550 casella inesistente' })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal(aggiornamento.$set.destinatario, 'ada@rossi.it');
    assert.equal('stato' in aggiornamento.$set, false);
    assert.equal('ultimo_errore' in aggiornamento.$set, false);
    assert.equal(aggiornamento.$unset?.ultimo_errore, undefined);
});

test('un problema del piano si scrive accanto a un errore di invio, senza cancellarlo', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, perEmail({ email: '' }))],
        esistenti: [inCoda({ canale: 'email', stato: 'errore', ultimo_errore: '550 casella inesistente' })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal(aggiornamento.$set.problema, 'Il cliente non ha un indirizzo email.');
    assert.equal('ultimo_errore' in aggiornamento.$set, false);
});

test("l'esito di una prova resta sulla riga dopo Prepara", () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare({}, perEmail())],
        esistenti: [inCoda({ canale: 'email', note: 'Prova del 21/09/2026: il cliente non l\'ha ricevuta. Resta in coda.' })],
    });

    const aggiornamento = aggiornamentoDi(esito, 'consegna-1');
    assert.equal('note' in aggiornamento.$set, false);
    assert.equal(aggiornamento.$unset?.note, undefined);
});

test('una consegna inviata non si tocca, nemmeno dalla scheda', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare()],
        esistenti: [inCoda({ stato: 'inviata' })],
        suRichiesta: true,
    });

    assert.equal(esito.saltate, 1);
    assert.equal(esito.operazioni.length, 0);
});

test('dalla scheda una bozza non entra in coda', () => {
    // Il pulsante Prepara della scheda c'e anche sulle bozze: il piano deve
    // fermarle, altrimenti un "Invia" successivo spedirebbe un documento non
    // confermato.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(inBozza, perEmail())],
        esistenti: [],
        suRichiesta: true,
    });

    assert.equal(esito.operazioni.length, 0);
    assert.match(esito.problemi[0].messaggio, /bozza/);
});

test('una fattura del gestionale tornata bozza chiude anche le consegne chieste dalla scheda', () => {
    // La protezione di cio che e stato chiesto dalla scheda vale per le fatture
    // del vecchio programma, che la coda generale non prepara: una fattura del
    // gestionale riportata a bozza non deve lasciare in coda un documento che
    // un "Invia" spedirebbe.
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(inBozza)],
        esistenti: [inCoda({ su_richiesta: true })],
    });

    assert.equal(esito.annullate, 1);
    assert.match(aggiornamentoDi(esito, 'consegna-1').$set.note, /bozza/);
});

test('una fattura tornata bozza lascia la coda con il motivo', () => {
    const esito = aggiornamentoCoda({
        fatture: [daGuardare(inBozza)],
        esistenti: [inCoda()],
    });

    assert.match(aggiornamentoDi(esito, 'consegna-1').$set.note, /bozza/);
    assert.equal(esito.problemi.length, 1);
});

test('il piano dice se la fattura viene dal vecchio programma', () => {
    assert.equal(pianoConsegne({ cliente: cliente(), fattura: fattura() }).emessaDalGestionale, true);
    assert.equal(pianoConsegne({ cliente: cliente(), fattura: fattura(vecchia()) }).emessaDalGestionale, false);
});
