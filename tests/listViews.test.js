const test = require('node:test');
const assert = require('node:assert/strict');

const {
    clienteViews,
    consegnaViews,
    contatoreViews,
    fatturaViews,
    letturaViews,
    scadenzaViews,
} = require('../config/listViews');
const { combineFilters, getViewFilter } = require('../controllers/utils/paginatedQuery');

test('le viste sono funzioni che producono un filtro', () => {
    const tutte = {
        ...clienteViews,
        ...consegnaViews,
        ...contatoreViews,
        ...fatturaViews,
        ...letturaViews,
        ...scadenzaViews,
    };

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

test('getViewFilter: una vista sconosciuta e un errore, non un elenco senza filtro', () => {
    // Ignorarla in silenzio restituirebbe tutti i record a chi crede di
    // guardarne un sottoinsieme: uno scarto fra client e server passerebbe inosservato.
    assert.throws(() => getViewFilter(scadenzaViews, 'inventata'), /Vista non riconosciuta/);
    assert.throws(() => getViewFilter(undefined, 'aperte'), /Vista non riconosciuta/);
});

test('getViewFilter: nessuna vista richiesta significa nessun filtro', () => {
    assert.equal(getViewFilter(scadenzaViews, ''), null);
    assert.equal(getViewFilter(scadenzaViews, undefined), null);
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

test('clienti: la vista per modalita riconosce anche la scrittura importata', () => {
    // In anagrafica c'e scritto "Cartacea Postale", non "postale": la vista
    // deve funzionare anche prima che i dati siano normalizzati.
    const filtro = clienteViews['consegna-postale']();
    const espressione = filtro.$or[0].stampa_cortesia.$regex;

    assert.ok(new RegExp(espressione, 'i').test('Cartacea Postale'));
    assert.ok(new RegExp(espressione, 'i').test('postale'));
    // La modalita predefinita vale anche per chi non ha mai avuto il campo.
    assert.deepEqual(filtro.$or[2], { stampa_cortesia: { $exists: false } });
});

test('clienti: le modalita diverse da quella predefinita non catturano i campi vuoti', () => {
    const filtro = clienteViews['consegna-email']();

    assert.equal(filtro.$or, undefined);
    assert.ok(new RegExp(filtro.stampa_cortesia.$regex, 'i').test('E-Mail'));
    assert.equal(new RegExp(filtro.stampa_cortesia.$regex, 'i').test(''), false);
});

test('consegne: da stampare e il lavoro che resta a una persona', () => {
    assert.deepEqual(consegnaViews['da-stampare'](), {
        stato: 'in_coda',
        canale: { $in: ['postale', 'sportello'] },
    });
});

test('consegne: le automatiche sono solo quelle ancora in coda', () => {
    assert.deepEqual(consegnaViews.automatiche(), { stato: 'in_coda', automatica: true });
});
