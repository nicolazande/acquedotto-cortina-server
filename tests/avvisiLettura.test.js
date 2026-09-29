const test = require('node:test');
const assert = require('node:assert/strict');

const {
    avvisiDellaLettura,
    fatturataDopo,
    motivoLetturaSuperata,
    ritmoAbituale,
} = require('../services/avvisiLettura');

const lettura = (id, data, consumo, fatturata = true) => ({
    _id: id,
    data_lettura: new Date(`${data}T00:00:00.000Z`),
    consumo,
    fatturata,
});

// Un contatore letto ogni autunno, che consuma circa 100 m³ l'anno.
const storia = [
    lettura('a', '2022-11-01', 1000),
    lettura('b', '2023-11-01', 1100),
    lettura('c', '2024-11-01', 1200),
    lettura('d', '2025-11-01', 1300),
];
const oggi = new Date('2026-11-15T00:00:00.000Z');

test('una lettura piu vecchia di una gia fatturata non si fattura in automatico', () => {
    const vecchia = lettura('v', '2021-11-11', 900, false);
    const conLaVecchia = [vecchia, ...storia];

    assert.equal(fatturataDopo(vecchia, conLaVecchia)._id, 'd');
    assert.match(motivoLetturaSuperata(vecchia, storia[3]), /11\/11\/2021.*01\/11\/2025/);
});

test('una lettura nuova non e superata da niente', () => {
    const nuova = lettura('n', '2026-11-01', 1400, false);

    assert.equal(fatturataDopo(nuova, [...storia, nuova]), null);
    // Una lettura successiva non ancora fatturata non conta: non copre niente.
    assert.equal(fatturataDopo(storia[0], [storia[0], lettura('x', '2023-01-01', 1010, false)]), null);
});

test('il ritmo abituale e la mediana degli ultimi periodi, in m³ al giorno', () => {
    const ritmo = ritmoAbituale(storia);

    assert.ok(Math.abs(ritmo * 365 - 100) < 1, `circa 100 m³ l'anno, trovato ${ritmo * 365}`);
    // Con una lettura sola non c'e nessun periodo da misurare.
    assert.equal(ritmoAbituale([storia[0]]), null);
    // I periodi di pochi giorni non dicono un'abitudine.
    assert.equal(ritmoAbituale([storia[0], lettura('z', '2022-11-10', 1050)]), null);
});

test('un consumo in linea con la storia non da avvisi', () => {
    const nuova = lettura('n', '2026-11-01', 1410, false);

    assert.deepEqual(avvisiDellaLettura({ lettura: nuova, consumo: 110, storia: [...storia, nuova], oggi }), []);
});

test('un consumo fuori misura e segnalato, con quanto ci si aspettava', () => {
    const nuova = lettura('n', '2026-11-01', 1700, false);
    const avvisi = avvisiDellaLettura({ lettura: nuova, consumo: 400, storia: [...storia, nuova], oggi });

    assert.deepEqual(avvisi.map((avviso) => avviso.tipo), ['consumo_alto']);
    assert.match(avvisi[0].messaggio, /400 m³.*100 m³/);
});

test('il triplo di poco non e un allarme: servono anche 50 m³ in piu', () => {
    const piccola = [
        lettura('a', '2023-11-01', 10),
        lettura('b', '2024-11-01', 13),
        lettura('c', '2025-11-01', 16),
    ];
    const nuova = lettura('n', '2026-11-01', 28, false);

    assert.deepEqual(avvisiDellaLettura({ lettura: nuova, consumo: 12, storia: [...piccola, nuova], oggi }), []);
});

test('una lettura di un anno gia chiuso va controllata prima di fatturarla', () => {
    const arretrata = lettura('n', '2025-11-20', 1305, false);
    const avvisi = avvisiDellaLettura({ lettura: arretrata, consumo: 5, storia: [...storia, arretrata], oggi });

    assert.deepEqual(avvisi.map((avviso) => avviso.tipo), ['anno_chiuso']);
    assert.match(avvisi[0].messaggio, /20\/11\/2025/);
});

test('senza storia non si inventano avvisi sul consumo', () => {
    const prima = lettura('n', '2026-10-01', 500, false);

    assert.deepEqual(avvisiDellaLettura({ lettura: prima, consumo: 500, storia: [prima], oggi }), []);
});
