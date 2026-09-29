const test = require('node:test');
const assert = require('node:assert/strict');

const { isSplitCondominiumCounter, quotaDiRiparto } = require('../services/billingCalculator');
const { rigaInQuota } = require('../services/ripartoCondominiale');

// I contatori della Casa ex Lete, com'erano in Gesco.
const condominiale = { tipo_contatore: '04 - Condominali Ripartiti', tipo_attivita: 'UTENZA CONDOMINIALE', consumo: 100 };
const linguiti = { _id: 'u1', seriale: '07496473', tipo_contatore: '02 - CONDOMINIALE + Utenze Private', consumo: 33.33 };
const deAnna = { _id: 'u2', seriale: '07603054', tipo_contatore: '02 - CONDOMINIALE + Utenze Private', consumo: 33.34 };

test('il contatore condominiale si riconosce, le utenze no', () => {
    assert.equal(isSplitCondominiumCounter(condominiale), true);
    assert.equal(isSplitCondominiumCounter(linguiti), false);
});

test('la quota di riparto e quella scritta sul contatore dell utenza', () => {
    assert.equal(quotaDiRiparto(linguiti), 33.33);
    assert.equal(quotaDiRiparto(deAnna), 33.34);
    // Il condominiale non paga una quota di se stesso, e un contatore normale nemmeno.
    assert.equal(quotaDiRiparto(condominiale), 0);
    assert.equal(quotaDiRiparto({ tipo_contatore: '', consumo: 50 }), 0);
    // "Utenze Private" con quota zero, come a Ca' dei Larici: niente riparto.
    assert.equal(quotaDiRiparto({ tipo_contatore: '03 - Utenze Private', consumo: 0 }), 0);
});

test('la riga del consumo si riduce alla quota, come la scriveva Gesco', () => {
    // 43 m3 del condominiale nel 2025, al 33,33%: 14,3319 m3 a 0,33.
    const riga = rigaInQuota(
        { metri_cubi: 43, prezzo: 0.33, valore_unitario: 14.19, calcolo_snapshot: { quota: 'variable' } },
        { quota: 33.33, utenza: linguiti }
    );

    assert.equal(riga.metri_cubi, 14.3319);
    assert.equal(riga.valore_unitario, 4.73);
    assert.equal(riga.descrizione, 'Spesa Acqua cont. condominiale. Su Seriale:07496473 Perc. 33,33');
    assert.deepEqual(riga.calcolo_snapshot.riparto, { contatore: 'u1', seriale: '07496473', quota: 33.33 });
});

test('la quota fissa si riduce alla quota', () => {
    // 35 euro di fisso del condominiale: 11,6655 in Gesco, 11,67 al centesimo.
    const riga = rigaInQuota(
        { metri_cubi: 1, prezzo: 35, valore_unitario: 35, tipo_quota: 'Q.Fissa', calcolo_snapshot: { quota: 'fixed' } },
        { quota: 33.33, utenza: linguiti }
    );

    assert.equal(riga.metri_cubi, 0.3333);
    assert.equal(riga.valore_unitario, 11.67);
    assert.equal(rigaInQuota({ metri_cubi: 1, prezzo: 35, valore_unitario: 35, tipo_quota: 'Q.Fissa' }, { quota: 33.34, utenza: deAnna }).valore_unitario, 11.67);
});
