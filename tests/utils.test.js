const test = require('node:test');
const assert = require('node:assert/strict');

const {
    escapeRegex,
    hasValue,
    normalizeText,
    numberOrZero,
    parseBoolean,
    parseOptionalBoolean,
    parsePositiveInteger,
    roundMoney,
    sumMoneyBy,
} = require('../utils/values');
const { addDays, daysBetween, formatItalianDate, getDate, startOfDay, toDate } = require('../utils/dates');
const { customerLabel } = require('../utils/customer');
const { conflict, createError, notFound, unprocessable } = require('../utils/errors');
const { recordId, uniqueById } = require('../utils/mongo');

test('numberOrZero: accetta la virgola come separatore decimale', () => {
    assert.equal(numberOrZero('1,5'), 1.5);
    assert.equal(numberOrZero('0,33'), 0.33);
    assert.equal(numberOrZero(2.5), 2.5);
});

test('numberOrZero: i valori non numerici valgono zero', () => {
    [null, undefined, '', 'abc', {}, NaN, Infinity].forEach((valore) => {
        assert.equal(numberOrZero(valore), 0, `${String(valore)} deve valere 0`);
    });
});

test('roundMoney: arrotonda a due decimali', () => {
    assert.equal(roundMoney(1.234), 1.23);
    assert.equal(roundMoney(1.235), 1.24);
    assert.equal(roundMoney(58.549999999), 58.55);
    assert.equal(roundMoney(0), 0);
    assert.equal(roundMoney(-1.234), -1.23);
});

test('sumMoneyBy: somma e arrotonda una sola volta alla fine', () => {
    const righe = [{ v: 0.1 }, { v: 0.2 }, { v: 0.3 }];

    assert.equal(sumMoneyBy(righe, (r) => r.v), 0.6);
    assert.equal(sumMoneyBy([], (r) => r.v), 0);
});

test('hasValue: distingue il vuoto dallo zero', () => {
    assert.equal(hasValue(0), true);
    assert.equal(hasValue(false), true);
    assert.equal(hasValue(''), false);
    assert.equal(hasValue(null), false);
    assert.equal(hasValue(undefined), false);
});

test('parseBoolean: riconosce le forme usate nelle querystring', () => {
    ['1', 'true', 'yes', 'si', 'y', 'on', ' TRUE '].forEach((valore) => {
        assert.equal(parseBoolean(valore), true, `${valore} deve valere true`);
    });
    ['0', 'false', 'no', '', 'altro'].forEach((valore) => {
        assert.equal(parseBoolean(valore), false, `${valore} deve valere false`);
    });
});

test('parseOptionalBoolean: distingue "non indicato" da false', () => {
    assert.equal(parseOptionalBoolean(undefined), undefined);
    assert.equal(parseOptionalBoolean(''), undefined);
    assert.equal(parseOptionalBoolean('false'), false);
    assert.equal(parseOptionalBoolean(true), true);
});

test('parsePositiveInteger: ricade sul valore predefinito', () => {
    assert.equal(parsePositiveInteger('25', 50), 25);
    assert.equal(parsePositiveInteger('0', 50), 50);
    assert.equal(parsePositiveInteger('-3', 50), 50);
    assert.equal(parsePositiveInteger('abc', 50), 50);
    assert.equal(parsePositiveInteger(undefined, 50), 50);
});

test('normalizeText: minuscolo, senza accenti e senza spazi doppi', () => {
    assert.equal(normalizeText('  SOCIETÀ   Immobiliari '), 'societa immobiliari');
    assert.equal(normalizeText('Ripartìto'), 'ripartito');
    assert.equal(normalizeText(null), '');
});

test('escapeRegex: neutralizza i caratteri speciali della ricerca', () => {
    assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c');
    assert.equal(escapeRegex('via Roma (2)'), 'via Roma \\(2\\)');
});

test('toDate: restituisce null quando la data non e valida', () => {
    assert.equal(toDate(null), null);
    assert.equal(toDate('non-una-data'), null);
    assert.equal(toDate('2026-06-15').toISOString(), '2026-06-15T00:00:00.000Z');
});

test('getDate: ricade sempre su una data valida', () => {
    assert.ok(getDate(null) instanceof Date);
    assert.ok(getDate('non-una-data') instanceof Date);
    assert.equal(getDate('2026-06-15').toISOString(), '2026-06-15T00:00:00.000Z');
});

test('startOfDay: azzera l orario in UTC', () => {
    assert.equal(startOfDay('2026-06-15T23:59:59.000Z').toISOString(), '2026-06-15T00:00:00.000Z');
    assert.equal(startOfDay(null), null);
});

test('addDays e daysBetween sono coerenti fra loro', () => {
    const partenza = '2026-01-31T00:00:00.000Z';
    const arrivo = addDays(partenza, 30);

    assert.equal(arrivo.toISOString(), '2026-03-02T00:00:00.000Z');
    assert.equal(daysBetween(partenza, arrivo), 30);
    assert.equal(daysBetween(arrivo, partenza), -30);
});

test('customerLabel: preferisce la ragione sociale, poi cognome e nome', () => {
    assert.equal(customerLabel({ ragione_sociale: 'ACME srl', cognome: 'Rossi' }), 'ACME srl');
    assert.equal(customerLabel({ cognome: 'Rossi', nome: 'Mario' }), 'Rossi Mario');
    assert.equal(customerLabel({ cognome: 'Rossi' }), 'Rossi');
});

test('customerLabel: ignora i segnaposto e ricade sui dati della fattura', () => {
    assert.equal(customerLabel({ cognome: 'Rossi', nome: '.' }), 'Rossi');
    assert.equal(customerLabel({}, { ragione_sociale: 'Da fattura' }), 'Da fattura');
    assert.equal(customerLabel({}, { nome_cliente: 'Nome cliente' }), 'Nome cliente');
    assert.equal(customerLabel(null, null), '');
});

test('errori: portano con se lo status HTTP', () => {
    assert.equal(createError('x').status, 400);
    assert.equal(notFound('x').status, 404);
    assert.equal(conflict('x').status, 409);
    assert.equal(unprocessable('x').status, 422);
    assert.ok(notFound('manca') instanceof Error);
    assert.equal(notFound('manca').message, 'manca');
});

test('recordId: accetta sia il documento sia l id grezzo', () => {
    assert.equal(recordId({ _id: 'abc' }), 'abc');
    assert.equal(recordId('abc'), 'abc');
    assert.equal(recordId(null), '');
});

test('uniqueById: rimuove i duplicati mantenendo l ordine', () => {
    const risultato = uniqueById([{ _id: 'a' }, { _id: 'b' }, { _id: 'a' }]);

    assert.deepEqual(risultato.map((r) => r._id), ['a', 'b']);
});

test('formatItalianDate: giorno/mese/anno, e stringa vuota se non e una data', () => {
    // Nei PDF e nei messaggi ai clienti non deve mai comparire "Invalid Date".
    assert.equal(formatItalianDate(new Date('2026-12-31T00:00:00.000Z')), '31/12/2026');
    assert.equal(formatItalianDate('2026-01-05'), '05/01/2026');
    assert.equal(formatItalianDate(''), '');
    assert.equal(formatItalianDate(null), '');
    assert.equal(formatItalianDate('non una data'), '');
});
