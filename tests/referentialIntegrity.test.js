const test = require('node:test');
const assert = require('node:assert/strict');

const { DIPENDENZE, TUTTI_I_LEGAMI, dipendenzeDi } = require('../config/relations');

// I nomi dichiarati devono esistere davvero: un modello scritto male
// renderebbe il controllo silenziosamente inefficace, che e il modo peggiore di
// fallire per un guardiano.
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');

// Si caricano tutti i modelli che esistono, non un elenco scritto a mano: era
// proprio un modello dimenticato nell'elenco (AuditLog) a far passare inosservato
// un riferimento senza politica dichiarata.
const CARTELLA_MODELLI = path.join(__dirname, '..', 'models');
fs.readdirSync(CARTELLA_MODELLI)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => require(path.join(CARTELLA_MODELLI, file)));

test('ogni legame dichiarato punta a modelli e campi che esistono', () => {
    TUTTI_I_LEGAMI.forEach((arco) => {
        assert.ok(mongoose.modelNames().includes(arco.modello), `modello sconosciuto: ${arco.modello}`);
        assert.ok(mongoose.modelNames().includes(arco.bersaglio), `modello sconosciuto: ${arco.bersaglio}`);

        const schema = mongoose.model(arco.modello).schema.paths[arco.campo];
        assert.ok(schema, `${arco.modello} non ha il campo ${arco.campo}`);

        const riferimento = schema.options?.ref || schema.caster?.options?.ref;
        assert.equal(riferimento, arco.bersaglio, `${arco.modello}.${arco.campo} punta a ${riferimento}, non a ${arco.bersaglio}`);
    });
});

test('nessun riferimento fra documenti resta fuori dalla dichiarazione', () => {
    // Aggiungere un riferimento a uno schema senza dichiararlo qui vorrebbe dire
    // creare un legame che nessuno protegge.
    const dichiarati = new Set(TUTTI_I_LEGAMI.map((arco) => `${arco.modello}.${arco.campo}`));
    const mancanti = [];

    mongoose.modelNames().forEach((nome) => {
        Object.entries(mongoose.model(nome).schema.paths).forEach(([campo, tipo]) => {
            const riferimento = tipo.options?.ref || tipo.caster?.options?.ref;
            if (riferimento && !dichiarati.has(`${nome}.${campo}`)) {
                mancanti.push(`${nome}.${campo} -> ${riferimento}`);
            }
        });
    });

    assert.deepEqual(mancanti, [], `riferimenti non dichiarati: ${mancanti.join(', ')}`);
});

test('le anagrafiche si bloccano, i figli di un documento vanno a cascata', () => {
    const politiche = (modello) => Object.fromEntries(
        dipendenzeDi(modello).map((arco) => [`${arco.modello}.${arco.campo}`, arco.politica])
    );

    // Un cliente con fatture non si cancella: si corregge.
    assert.equal(politiche('Cliente')['Fattura.cliente'], 'blocca');
    assert.equal(politiche('Cliente')['User.cliente'], 'blocca');
    // Una riga di fattura senza la sua fattura non significa niente.
    assert.equal(politiche('Fattura')['Servizio.fattura'], 'cascata');
    assert.equal(politiche('Fattura')['Consegna.fattura'], 'cascata');
    // Le fasce appartengono al listino, i contatori no.
    assert.equal(politiche('Listino')['Fascia.listino'], 'cascata');
    assert.equal(politiche('Listino')['Contatore.listino'], 'blocca');
});

test('ogni politica dichiarata e una di quelle previste', () => {
    TUTTI_I_LEGAMI.forEach((arco) => {
        assert.ok(['blocca', 'cascata', 'conserva'].includes(arco.politica), `politica sconosciuta: ${arco.politica}`);
        assert.ok(arco.descrizione, `${arco.modello}.${arco.campo} senza descrizione leggibile`);
    });
});

test('il giornale delle modifiche sopravvive a chi vi compare', () => {
    // AuditLog.actor punta a un utente, ma il giornale tiene gia il nome e il
    // ruolo accanto al riferimento: cancellare un utente non deve ne essere
    // impedito dal registro ne cancellarne le voci.
    const arco = dipendenzeDi('User').find((voce) => voce.modello === 'AuditLog');
    assert.equal(arco?.politica, 'conserva');

    const giornale = mongoose.model('AuditLog').schema.paths;
    assert.ok(giornale.actorUsername, 'il giornale deve tenere il nome di chi ha agito');
    assert.ok(giornale.actorRole, 'il giornale deve tenere il ruolo di chi ha agito');
});

test('le anagrafiche principali sono tutte protette', () => {
    // Erano cancellabili senza alcun controllo: il gestionale precedente non
    // offriva nemmeno il pulsante.
    ['Articolo', 'Cliente', 'Contatore', 'Edificio', 'Listino', 'Scadenza'].forEach((modello) => {
        assert.ok(
            dipendenzeDi(modello).some((arco) => arco.politica === 'blocca'),
            `${modello} non ha alcun legame che ne impedisca la cancellazione`
        );
    });
    assert.ok(Object.keys(DIPENDENZE).length >= 9);
});
