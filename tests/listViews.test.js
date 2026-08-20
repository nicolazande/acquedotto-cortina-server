const test = require('node:test');
const assert = require('node:assert/strict');

const {
    clienteViews,
    contatoreViews,
    fatturaViews,
    letturaViews,
    scadenzaViews,
} = require('../config/listViews');
const { combineFilters, getViewFilter } = require('../controllers/utils/paginatedQuery');

test('le viste sono funzioni che producono un filtro', () => {
    const tutte = { ...clienteViews, ...contatoreViews, ...fatturaViews, ...letturaViews, ...scadenzaViews };

    Object.entries(tutte).forEach(([nome, vista]) => {
        assert.equal(typeof vista, 'function', `${nome} deve essere una funzione`);
        assert.equal(typeof vista(), 'object', `${nome} deve produrre un oggetto`);
    });
});

test('scadenze: aperte accetta anche il campo saldo mancante', () => {
    const filtro = scadenzaViews.aperte();

    assert.deepEqual(filtro, { $or: [{ saldo: false }, { saldo: { $exists: false } }] });
});

test('scadenze: scadute unisce non saldata e data passata', () => {
    const filtro = scadenzaViews.scadute();

    assert.ok(Array.isArray(filtro.$and), 'le due condizioni restano separate');
    assert.deepEqual(filtro.$and[0], scadenzaViews.aperte());
    assert.ok(filtro.$and[1].scadenza.$lte instanceof Date);
});

test('scadenze: la data di confronto e valutata a ogni chiamata', async () => {
    const primo = scadenzaViews.scadute().$and[1].scadenza.$lte;
    await new Promise((r) => setTimeout(r, 5));
    const secondo = scadenzaViews.scadute().$and[1].scadenza.$lte;

    assert.ok(secondo >= primo, 'una data fissata al caricamento del modulo invecchierebbe');
});

test('letture: da fatturare comprende il flag assente', () => {
    assert.deepEqual(letturaViews['da-fatturare'](), {
        $or: [{ fatturata: false }, { fatturata: { $exists: false } }],
    });
    assert.deepEqual(letturaViews.fatturate(), { fatturata: true });
});

test('fatture: bozze e confermate usano lo stato, unica verita del documento', () => {
    assert.deepEqual(fatturaViews.bozze(), { stato: 'bozza' });
    assert.deepEqual(fatturaViews.confermate(), { stato: 'confermata' });
});

test('getViewFilter: una vista sconosciuta non filtra invece di sbagliare', () => {
    assert.equal(getViewFilter(scadenzaViews, 'inventata'), null);
    assert.equal(getViewFilter(scadenzaViews, ''), null);
    assert.equal(getViewFilter(scadenzaViews, undefined), null);
    assert.equal(getViewFilter(undefined, 'aperte'), null);
});

test('getViewFilter: restituisce il filtro della vista richiesta', () => {
    assert.deepEqual(getViewFilter(letturaViews, 'fatturate'), { fatturata: true });
});

test('combineFilters: senza vista resta la sola ricerca', () => {
    const ricerca = { $or: [{ nome: /rossi/i }] };

    assert.deepEqual(combineFilters(ricerca, null), ricerca);
});

test('combineFilters: senza ricerca resta il solo filtro della vista', () => {
    const vista = { fatturata: true };

    assert.deepEqual(combineFilters({}, vista), vista);
});

test('combineFilters: ricerca e vista restano condizioni separate', () => {
    // Fondere due $or sullo stesso livello ne cambierebbe il significato:
    // si otterrebbero i record che soddisfano l'una OPPURE l'altra.
    const ricerca = { $or: [{ cognome: /rossi/i }] };
    const vista = { $or: [{ saldo: false }, { saldo: { $exists: false } }] };
    const combinato = combineFilters(ricerca, vista);

    assert.deepEqual(combinato, { $and: [ricerca, vista] });
});
