const test = require('node:test');
const assert = require('node:assert/strict');

const {
    applyRate,
    applyRateToLines,
    fromCents,
    multiplyCents,
    rateToBasisPoints,
    sumCents,
    toCents,
} = require('../utils/money');
const { roundMoney, sumMoneyBy } = require('../utils/values');

test('toCents: converte gli importi in centesimi interi', () => {
    assert.equal(toCents(0), 0);
    assert.equal(toCents(1), 100);
    assert.equal(toCents(0.33), 33);
    assert.equal(toCents(58.55), 5855);
    assert.equal(toCents(-1.5), -150);
});

test('toCents: accetta stringhe, anche con la virgola decimale', () => {
    assert.equal(toCents('1,5'), 150);
    assert.equal(toCents('0,33'), 33);
    assert.equal(toCents('12.34'), 1234);
    assert.equal(toCents(' 7,10 '), 710);
});

test('toCents: i valori assenti o non numerici valgono zero', () => {
    [null, undefined, '', 'abc', NaN, Infinity, {}].forEach((valore) => {
        assert.equal(toCents(valore), 0, `${String(valore)} deve valere 0`);
    });
});

test('toCents: il mezzo centesimo si arrotonda per eccesso', () => {
    // Arrotondamento commerciale: 2,675 vale 2,68 anche se il suo valore binario
    // e leggermente inferiore. E il punto per cui si lavora in centesimi.
    assert.equal(toCents(2.675), 268);
    assert.equal(toCents(1.005), 101);
    assert.equal(toCents(8.165), 817);
    assert.equal(toCents(9.095), 910);
    assert.equal(toCents('2.135'), 214);
});

test('toCents: i negativi si arrotondano in valore assoluto', () => {
    assert.equal(toCents(-2.675), -268);
    assert.equal(toCents(-1.005), -101);
});

test('toCents: taglia oltre il centesimo senza propagare errore', () => {
    assert.equal(toCents(1.004), 100);
    assert.equal(toCents(1.0049999), 100);
    assert.equal(toCents(1.0050001), 101);
});

test('sumCents: la somma non accumula errore', () => {
    assert.equal(sumCents([0.1, 0.2]), 30);
    assert.equal(sumCents(Array(10000).fill(0.01)), 10000, '10.000 volte 1 centesimo fa 100 euro');
    assert.equal(fromCents(sumCents(Array(10000).fill(0.01))), 100);
});

test('sumCents: accetta un estrattore', () => {
    const righe = [{ v: 33 }, { v: 25.55 }];

    assert.equal(sumCents(righe, (r) => r.v), 5855);
});

test('multiplyCents: quantita frazionarie danno centesimi interi', () => {
    assert.equal(multiplyCents(33, 100), 3300);
    assert.equal(multiplyCents(73, 35), 2555);
    assert.equal(multiplyCents(73, 35.5), 2592, '2591,5 si arrotonda per eccesso');
    assert.equal(multiplyCents(100, 0), 0);
    assert.equal(multiplyCents(100, 'abc'), 0);
});

test('rateToBasisPoints: le aliquote frazionarie restano intere', () => {
    assert.equal(rateToBasisPoints(10), 1000);
    assert.equal(rateToBasisPoints(22), 2200);
    assert.equal(rateToBasisPoints(4.5), 450);
    assert.equal(rateToBasisPoints(0), 0);
    assert.equal(rateToBasisPoints(undefined), 0);
});

test('applyRate: imposta di una singola riga', () => {
    assert.equal(applyRate(10000, 10), 1000);
    assert.equal(applyRate(5000, 22), 1100);
    assert.equal(applyRate(600, 0), 0);
    assert.equal(applyRate(9095, 10), 910, 'il mezzo centesimo sale');
});

test('applyRateToLines: somma prima di arrotondare, una volta sola', () => {
    const iva = applyRateToLines([
        { cents: 5200, rate: 10 },
        { cents: 3895, rate: 10 },
    ]);

    assert.equal(iva, 910, '9,095 arrotondato per eccesso');
});

test('applyRateToLines: gestisce piu aliquote insieme', () => {
    const iva = applyRateToLines([
        { cents: 10000, rate: 10 },
        { cents: 5000, rate: 22 },
        { cents: 600, rate: 0 },
    ]);

    assert.equal(iva, 2100);
});

test('fromCents: torna a un importo con due decimali', () => {
    assert.equal(fromCents(5855), 58.55);
    assert.equal(fromCents(0), 0);
    assert.equal(fromCents(-150), -1.5);
});

test('roundMoney resta il punto di arrotondamento condiviso', () => {
    assert.equal(roundMoney(1.234), 1.23);
    assert.equal(roundMoney(2.675), 2.68);
    assert.equal(roundMoney('1,005'), 1.01);
    assert.equal(roundMoney(null), 0);
});

test('sumMoneyBy: somma esatta di importi', () => {
    const righe = [{ v: 0.1 }, { v: 0.2 }, { v: 0.3 }];

    assert.equal(sumMoneyBy(righe, (r) => r.v), 0.6);
    assert.equal(sumMoneyBy(Array(3).fill({ v: 33.33 }), (r) => r.v), 99.99);
});
