const test = require('node:test');
const assert = require('node:assert/strict');

const { IMPORTO_MORA, descriviMora, moraDovuta, rigaMoraPer } = require('../services/mora');

const giorno = (data) => new Date(`${data}T00:00:00.000Z`);
const oggi = giorno('2026-11-15');
const precedente = (scadenza) => ({
    _id: 'f1',
    anno: 2025,
    numero: 12,
    serie: 'A',
    data_fattura: giorno('2025-11-10'),
    scadenza: { _id: 's1', scadenza: giorno('2025-12-10'), saldo: false, ...scadenza },
});

test('la mora e dovuta su una scadenza passata e non pagata', () => {
    assert.equal(moraDovuta(precedente(), oggi), true);
});

test('niente mora senza fattura precedente, senza scadenza o prima della scadenza', () => {
    assert.equal(moraDovuta(undefined, oggi), false);
    assert.equal(moraDovuta({ ...precedente(), scadenza: null }, oggi), false);
    assert.equal(moraDovuta(precedente({ scadenza: giorno('2026-12-01') }), oggi), false);
});

test('la mora si addebita una volta sola per scadenza', () => {
    assert.equal(moraDovuta(precedente({ mora_fatturata: true }), oggi), false);
});

test('pagata in tempo niente mora, pagata in ritardo si', () => {
    assert.equal(moraDovuta(precedente({ saldo: true, pagamento: giorno('2025-12-01') }), oggi), false);
    assert.equal(moraDovuta(precedente({ saldo: true, pagamento: giorno('2026-01-20') }), oggi), true);
});

test('la riga porta la fattura e la scadenza da cui nasce', () => {
    const articolo = { _id: 'art', codice: 'GG_DELAY', iva: 'Esente art.15' };
    const riga = rigaMoraPer({ articlesByCode: { GG_DELAY: articolo }, precedente: precedente(), dataFattura: oggi });

    assert.equal(riga.valore_unitario, IMPORTO_MORA);
    assert.equal(riga.descrizione_attivita, '2025/A/12');
    assert.equal(riga.calcolo_snapshot.quota, 'delay');
    assert.equal(riga.calcolo_snapshot.scadenza._id, 's1');
    assert.equal(rigaMoraPer({ articlesByCode: {}, precedente: precedente({ saldo: true, pagamento: giorno('2025-12-01') }), dataFattura: oggi }), null);
});

test('senza l\'articolo della mora non si inventa una riga', () => {
    assert.throws(() => rigaMoraPer({ articlesByCode: {}, precedente: precedente(), dataFattura: oggi }), /GG_DELAY/);
});

test('l\'anteprima racconta la mora: su quale fattura, da quanti giorni', () => {
    const descritta = descriviMora(precedente(), oggi);

    assert.equal(descritta.fattura, '2025/A/12');
    assert.equal(descritta.importo, IMPORTO_MORA);
    assert.equal(descritta.ritardo, 340);
});
