const test = require('node:test');
const assert = require('node:assert/strict');

const { misuraCambiata } = require('../services/misuraLettura');

const inFattura = {
    consumo: 1520,
    data_lettura: new Date('2026-08-25T00:00:00.000Z'),
    contatore: { toString: () => '6a1b2c3d4e5f60718293a4b5' },
    unita_misura: 'm3',
    note: 'letta dal vicino',
};

test('la stessa misura riscritta dal modulo non conta come cambiata', () => {
    // Il modulo rimanda tutto il record: numeri come testo, la data come giorno,
    // il contatore come id.
    assert.deepEqual(misuraCambiata(inFattura, {
        consumo: '1520',
        data_lettura: '2026-08-25',
        contatore: '6a1b2c3d4e5f60718293a4b5',
        unita_misura: 'm3',
        note: 'corretta la nota',
    }), []);
});

test('valore, data e contatore cambiati si vedono, anche uno per volta', () => {
    assert.deepEqual(misuraCambiata(inFattura, { consumo: 1530 }), ['consumo']);
    assert.deepEqual(misuraCambiata(inFattura, { data_lettura: '2026-08-26' }), ['data_lettura']);
    assert.deepEqual(misuraCambiata(inFattura, { contatore: { _id: 'altro' } }), ['contatore']);
});

test('un campo che non arriva resta com e', () => {
    assert.deepEqual(misuraCambiata(inFattura, { note: 'solo la nota' }), []);
});
