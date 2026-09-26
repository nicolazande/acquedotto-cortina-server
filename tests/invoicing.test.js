const test = require('node:test');
const assert = require('node:assert/strict');

const {
    FILTRO_CONFERMATE,
    FILTRO_EMESSE_DAL_GESTIONALE,
    INVOICE_SERIES,
    emessaDalGestionale,
    invoiceCode,
    isConfirmedInvoice,
} = require('../config/invoicing');

test('il codice documento unisce anno, serie e numero', () => {
    assert.equal(invoiceCode({ anno: 2026, numero: 1, serie: 'A' }), '2026/A/1');
    assert.equal(invoiceCode({ anno: 2026, numero: 128, serie: 'A' }), '2026/A/128');
});

test('senza serie non si costruisce un codice', () => {
    // Le fatture importate non hanno serie: il loro numero viene dal gestionale
    // precedente e non appartiene alla numerazione di questo.
    assert.equal(invoiceCode({ anno: 2026, numero: 2760 }), '');
    assert.equal(invoiceCode({}), '');
});

test('la serie predefinita e una sola lettera maiuscola', () => {
    assert.match(INVOICE_SERIES, /^[A-Z0-9]+$/);
});

test('la regola delle fatture del gestionale e il suo filtro dicono la stessa cosa', () => {
    // La regola decide in memoria, il filtro nel database: se divergono, la coda
    // generale prende fatture che il piano tratta come storico, o viceversa.
    // Il filtro chiede una serie scritta e non vuota; la regola la stessa cosa.
    assert.deepEqual(FILTRO_EMESSE_DAL_GESTIONALE, { serie: { $type: 'string', $ne: '' } });
    assert.equal(emessaDalGestionale({ serie: 'A' }), true);
    assert.equal(emessaDalGestionale({ serie: '' }), false);
    assert.equal(emessaDalGestionale({ serie: null }), false);
    assert.equal(emessaDalGestionale({}), false);
});

test('il filtro delle fatture confermate dice quello che dice la regola', () => {
    // La regola decide in memoria, il filtro nel database: il portale del cliente
    // usa il filtro, e una fattura che la regola considera bozza non deve
    // comparirgli.
    const [perSpunta, perStato] = FILTRO_CONFERMATE.$or;
    const soddisfa = (fattura) => fattura.confermata === perSpunta.confermata
        || perStato.stato.test(String(fattura.stato || ''));

    [
        { confermata: true, stato: 'confermata' },
        { stato: 'Confermata' },
        { confermata: true },
        { confermata: false, stato: 'bozza' },
        { stato: 'bozza' },
        {},
    ].forEach((fattura) => assert.equal(soddisfa(fattura), isConfirmedInvoice(fattura), JSON.stringify(fattura)));
});
