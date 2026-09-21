const test = require('node:test');
const assert = require('node:assert/strict');

const { allineaStatoNellAggiornamento } = require('../models/Fattura');

// Una fattura dice due volte la stessa cosa: `confermata` (booleano storico) e
// `stato`. Chi la cerca guarda `stato` - l'elenco delle confermate e la coda
// delle consegne - quindi se i due divergono la fattura sparisce da entrambi.

test('la spunta "Confermata" porta con se lo stato, anche nella forma che produce Mongoose', () => {
    // Con i timestamp attivi l'aggiornamento arriva misto: il campo passato
    // resta in cima e accanto compare un $set con updatedAt. Guardando solo
    // dentro $set non si vedeva nulla, e la fattura restava "bozza".
    const update = allineaStatoNellAggiornamento({
        confermata: true,
        $set: { updatedAt: new Date('2026-09-21') },
    });

    assert.equal(update.confermata, true);
    assert.equal(update.stato, 'confermata');
});

test('un aggiornamento tutto dentro $set resta dentro $set', () => {
    const update = allineaStatoNellAggiornamento({ $set: { confermata: false } });

    assert.equal(update.$set.stato, 'bozza');
    assert.equal(update.stato, undefined, 'lo stesso campo non va scritto in due punti');
});

test('anche partendo dallo stato si aggiorna il booleano', () => {
    assert.equal(allineaStatoNellAggiornamento({ stato: 'confermata' }).confermata, true);
    assert.equal(allineaStatoNellAggiornamento({ $set: { stato: 'bozza' } }).$set.confermata, false);
});

test('quando i due si contraddicono vince lo stato', () => {
    // La maschera rispedisce l'intero record: insieme alla spunta viaggia lo
    // stato di prima. A mettere d'accordo i due prima di arrivare qui pensa il
    // controller, che sa qual e il campo appena toccato.
    const update = allineaStatoNellAggiornamento({ confermata: true, stato: 'bozza' });

    assert.equal(update.stato, 'bozza');
    assert.equal(update.confermata, false);
});

test('un aggiornamento che non parla di stato resta com e', () => {
    const update = allineaStatoNellAggiornamento({ $set: { totale_fattura: 10 } });

    assert.deepEqual(update, { $set: { totale_fattura: 10 } });
    assert.deepEqual(allineaStatoNellAggiornamento({}), {});
});
