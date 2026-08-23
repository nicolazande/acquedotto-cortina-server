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
const { indirizzoPostale, pianoConsegne } = require('../services/deliveryPlan');

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
