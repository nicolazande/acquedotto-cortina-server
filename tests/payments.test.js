const test = require('node:test');
const assert = require('node:assert/strict');

const { dataIncasso } = require('../services/paymentService');

const giorniFa = (giorni) => {
    const data = new Date();
    data.setDate(data.getDate() - giorni);
    return data;
};

test('la data di incasso deve esserci', () => {
    // Senza data non si sa quando il denaro e arrivato, e il ritardo non si
    // puo piu calcolare: il campo non e un dettaglio facoltativo.
    assert.throws(() => dataIncasso(undefined), /Indicare la data/);
    assert.throws(() => dataIncasso(''), /Indicare la data/);
    assert.throws(() => dataIncasso('non una data'), /Indicare la data/);
});

test('un incasso non puo essere datato nel futuro', () => {
    const domani = new Date();
    domani.setDate(domani.getDate() + 1);

    assert.throws(() => dataIncasso(domani), /non può essere nel futuro/);
});

test('oggi e una data valida', () => {
    assert.ok(dataIncasso(new Date()) instanceof Date);
});

test('una data passata viene accettata cosi com e', () => {
    const settimanaScorsa = giorniFa(7);

    assert.equal(dataIncasso(settimanaScorsa).getTime(), settimanaScorsa.getTime());
});

test('la sentinella del vecchio gestionale non e una data di incasso', () => {
    // 31/12/2099 era il modo di Gesco di dire "non pagata": accettarla come
    // data di incasso rimetterebbe in circolo il valore che abbiamo ripulito.
    assert.throws(() => dataIncasso('2099-12-31'), /Indicare la data/);
});
