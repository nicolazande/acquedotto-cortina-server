const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDeadlinePayload,
    calculateDelay,
    dataPagamento,
    getDueDate,
    withComputedDelay,
    withDeadlineDelay,
} = require('../services/deadlineService');
const { isConfirmedInvoice } = require('../services/invoiceLockService');

const OGGI = new Date('2026-06-15T10:30:00.000Z');

test('ritardo: nullo se la scadenza non e ancora arrivata', () => {
    assert.equal(calculateDelay({ scadenza: '2026-07-01' }, OGGI), 0);
});

test('ritardo: conta i giorni dalla scadenza a oggi se non pagata', () => {
    assert.equal(calculateDelay({ scadenza: '2026-06-01', saldo: false }, OGGI), 14);
});

test('ritardo: si ferma alla data di pagamento se saldata', () => {
    const scadenza = { scadenza: '2026-06-01', saldo: true, pagamento: '2026-06-05' };

    assert.equal(calculateDelay(scadenza, OGGI), 4, 'il ritardo di una scadenza pagata non cresce piu');
});

test('ritardo: pagata in anticipo non produce ritardo negativo', () => {
    const scadenza = { scadenza: '2026-06-10', saldo: true, pagamento: '2026-06-01' };

    assert.equal(calculateDelay(scadenza, OGGI), 0);
});

test('ritardo: senza data di scadenza vale zero', () => {
    assert.equal(calculateDelay({}, OGGI), 0);
    assert.equal(calculateDelay(null, OGGI), 0);
});

test('ritardo: una scadenza saldata senza data di pagamento non accumula ritardo', () => {
    // Non si sa di quanto sia stata pagata in ritardo, ma si sa che e chiusa:
    // contare fino a oggi la farebbe crescere per sempre su una posizione
    // ormai sistemata.
    assert.equal(calculateDelay({ scadenza: '2026-06-01', saldo: true }, OGGI), 0);
});

test('la data sentinella del vecchio gestionale non e una data', () => {
    // Il programma precedente scriveva 31/12/2099 al posto di lasciare vuoto.
    assert.equal(dataPagamento('2099-12-31'), null);
    assert.equal(dataPagamento(new Date('2099-12-31T23:00:00.000Z')), null);
    assert.equal(dataPagamento(''), null);
    assert.equal(dataPagamento(null), null);
    assert.deepEqual(dataPagamento('2026-06-05'), new Date('2026-06-05'));
});

test('ritardo: la sentinella non produce un ritardo di ventimila giorni', () => {
    const scadenza = { scadenza: '2026-06-01', saldo: true, pagamento: '2099-12-31' };

    assert.equal(calculateDelay(scadenza, OGGI), 0);
});

test('la sentinella non esce dalle scadenze lette dall interfaccia', () => {
    // Comparirebbe a schermo come "Pagamento: 31/12/2099".
    const letta = withComputedDelay({ scadenza: '2026-06-01', saldo: true, pagamento: '2099-12-31' }, OGGI);

    assert.equal(letta.pagamento, null);
    assert.equal(letta.ritardo, 0);
});

test('una data di pagamento vera resta intatta', () => {
    const letta = withComputedDelay({ scadenza: '2026-06-01', saldo: true, pagamento: '2026-06-05' }, OGGI);

    assert.deepEqual(letta.pagamento, new Date('2026-06-05'));
    assert.equal(letta.ritardo, 4);
});

test('withComputedDelay: sovrascrive il valore salvato, che invecchia', () => {
    const salvata = { scadenza: '2026-06-01', saldo: false, ritardo: -99 };
    const calcolata = withComputedDelay(salvata, OGGI);

    assert.equal(calcolata.ritardo, 14);
    assert.equal(calcolata.scadenza, '2026-06-01', 'gli altri campi restano invariati');
});

test('withComputedDelay resta corretta se passata a map', () => {
    // .map invoca il trasformatore con (elemento, indice, array): il secondo
    // argomento finiva nel parametro `now`, l'indice veniva letto come una data
    // del 1970 e il ritardo risultava sempre zero nelle liste.
    const scadenze = [
        { scadenza: '2026-06-01', saldo: false },
        { scadenza: '2026-05-01', saldo: false },
        { scadenza: '2026-04-01', saldo: false },
    ];

    const conMap = scadenze.map(withComputedDelay);
    const uno = scadenze.map((voce) => withComputedDelay(voce));

    assert.deepEqual(conMap.map((v) => v.ritardo), uno.map((v) => v.ritardo));
    assert.ok(conMap.every((v) => v.ritardo > 0), 'scadenze passate devono avere ritardo positivo');
});

test('getDueDate: predefinito a 30 giorni dalla data fattura', () => {
    assert.equal(getDueDate('2026-06-15').toISOString(), '2026-07-15T00:00:00.000Z');
});

test('getDueDate: una scadenza esplicita ha la precedenza', () => {
    assert.equal(getDueDate('2026-06-15', '2026-08-31').toISOString(), '2026-08-31T00:00:00.000Z');
});

test('buildDeadlinePayload: riporta i dati della fattura e parte non saldata', () => {
    const payload = buildDeadlinePayload({
        cliente: { cognome: 'Rossi', nome: 'Mario' },
        fattura: { anno: 2026, numero: 12, data_fattura: '2026-06-15', totale_fattura: 120.5 },
    });

    assert.equal(payload.anno, 2026);
    assert.equal(payload.numero, 12);
    assert.equal(payload.cognome, 'Rossi');
    assert.equal(payload.nome, 'Mario');
    assert.equal(payload.totale, 120.5);
    assert.equal(payload.saldo, false);
    assert.equal(payload.pagamento, null);
    assert.equal(payload.solleciti, 0);
    assert.equal(payload.scadenza.toISOString(), '2026-07-15T00:00:00.000Z');
});

test('buildDeadlinePayload: senza cognome usa la ragione sociale', () => {
    const payload = buildDeadlinePayload({
        cliente: { ragione_sociale: 'ACME srl' },
        fattura: { data_fattura: '2026-06-15' },
    });

    assert.equal(payload.cognome, 'ACME srl');
});

test('fattura confermata: riconosciuta sia dal booleano sia dallo stato', () => {
    assert.equal(isConfirmedInvoice({ confermata: true }), true);
    assert.equal(isConfirmedInvoice({ stato: 'confermata' }), true);
    assert.equal(isConfirmedInvoice({ stato: 'Confermata' }), true);
    assert.equal(isConfirmedInvoice({ confermata: false, stato: 'bozza' }), false);
    assert.equal(isConfirmedInvoice({}), false);
    assert.equal(isConfirmedInvoice(null), false);
});

test('la scadenza annidata in una fattura porta con se il proprio ritardo', () => {
    // Aprendo una fattura la prima domanda e se e stata incassata: il ritardo
    // arriva gia calcolato, invece di far rifare il conto all'interfaccia.
    const fattura = { anno: 2026, numero: 3, scadenza: { scadenza: '2026-06-01', saldo: false } };
    const letta = withDeadlineDelay(fattura, OGGI);

    assert.equal(letta.anno, 2026);
    assert.equal(letta.scadenza.ritardo, calculateDelay(fattura.scadenza, new Date()));
});

test('una fattura senza scadenza resta com e', () => {
    assert.deepEqual(withDeadlineDelay({ anno: 2026 }), { anno: 2026 });
    assert.equal(withDeadlineDelay(null), null);
});
