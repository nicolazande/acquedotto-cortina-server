const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDeadlinePayload,
    calculateDelay,
    getDueDate,
    withComputedDelay,
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

test('ritardo: saldo marcato ma senza data di pagamento usa oggi', () => {
    assert.equal(calculateDelay({ scadenza: '2026-06-01', saldo: true }, OGGI), 14);
});

test('withComputedDelay: sovrascrive il valore salvato, che invecchia', () => {
    const salvata = { scadenza: '2026-06-01', saldo: false, ritardo: -99 };
    const calcolata = withComputedDelay(salvata, OGGI);

    assert.equal(calcolata.ritardo, 14);
    assert.equal(calcolata.scadenza, '2026-06-01', 'gli altri campi restano invariati');
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
