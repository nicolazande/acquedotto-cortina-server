const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { componi, DESTINAZIONE } = require('../scripts/genera-modello');

// Il diagramma disegnato a mano invecchia in silenzio, ed e cosi che quello in
// documents/uml/ era finito a mostrare classi che non esistevano piu. Questo
// test toglie il silenzio: se qualcuno aggiunge un campo, cambia una politica o
// crea una collezione senza rilanciare `npm run modello`, fallisce qui.
test('docs/modello.md descrive ancora il codice', () => {
    const { documento } = componi();
    assert.equal(
        fs.readFileSync(DESTINAZIONE, 'utf8'),
        documento,
        'docs/modello.md non e aggiornato: lancia `npm run modello`'
    );
});

test('ogni riferimento negli schemi ha una politica dichiarata', () => {
    const { nonDichiarati } = componi();
    assert.deepEqual(nonDichiarati, [], `senza politica: ${nonDichiarati.join(', ')}`);
});
