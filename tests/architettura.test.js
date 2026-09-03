const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// I livelli del server e la direzione in cui possono guardare.
//
// Non e pedanteria: un ciclo fra due moduli significa che non si puo piu leggere
// l'uno senza l'altro, e in Node puo dare un `undefined` a caso al caricamento,
// che si manifesta lontano dalla causa. Le inversioni di livello - un modello che
// chiama un servizio, una politica che chiama un controller - sono il modo in cui
// un'applicazione ordinata smette di esserlo, una riga alla volta.
const RADICE = path.join(__dirname, '..');
const CARTELLE = ['routes', 'controllers', 'services', 'models', 'middlewares', 'config', 'utils'];

// Chi puo importare chi: `utils` e `config` sono foglie, i modelli non salgono.
const PUO_GUARDARE = {
    routes: ['routes', 'controllers', 'middlewares', 'services', 'models', 'config', 'utils'],
    controllers: ['controllers', 'services', 'models', 'config', 'utils'],
    services: ['services', 'models', 'config', 'utils'],
    middlewares: ['models', 'config', 'utils'],
    models: ['config', 'utils'],
    config: ['models', 'config', 'utils'],
    utils: ['utils'],
};

const file = [];
const cammina = (cartella) => fs.readdirSync(cartella, { withFileTypes: true }).forEach((voce) => {
    const percorso = path.join(cartella, voce.name);
    if (voce.isDirectory()) cammina(percorso);
    else if (voce.name.endsWith('.js')) file.push(path.relative(RADICE, percorso));
});
CARTELLE.forEach((c) => cammina(path.join(RADICE, c)));

const dipendenze = new Map(file.map((f) => {
    const testo = fs.readFileSync(path.join(RADICE, f), 'utf8');
    const dip = [...testo.matchAll(/require\('(\.[^']+)'\)/g)]
        .map((m) => {
            const risolto = path.normalize(path.join(path.dirname(f), m[1]));
            return risolto.endsWith('.js') ? risolto : `${risolto}.js`;
        })
        .filter((d) => file.includes(d));
    return [f, dip];
}));

const livello = (f) => f.split('/')[0];

test('nessun modulo dipende da se stesso, per quanto in giro', () => {
    const stato = new Map();
    const cicli = [];
    const visita = (nodo, percorso) => {
        if (stato.get(nodo) === 'chiuso') return;
        if (stato.get(nodo) === 'aperto') {
            cicli.push([...percorso.slice(percorso.indexOf(nodo)), nodo].join(' -> '));
            return;
        }
        stato.set(nodo, 'aperto');
        percorso.push(nodo);
        dipendenze.get(nodo).forEach((d) => visita(d, percorso));
        percorso.pop();
        stato.set(nodo, 'chiuso');
    };
    file.forEach((f) => visita(f, []));

    assert.deepEqual([...new Set(cicli)], [], 'ci sono dipendenze circolari');
});

test('ogni livello guarda solo verso il basso', () => {
    const sbagliate = [];
    for (const [f, dip] of dipendenze) {
        const da = livello(f);
        dip.forEach((d) => {
            const a = livello(d);
            if (!PUO_GUARDARE[da].includes(a)) sbagliate.push(`${f} -> ${d} (${da} non puo dipendere da ${a})`);
        });
    }

    assert.deepEqual(sbagliate, [], 'ci sono dipendenze che risalgono i livelli');
});

// Un file che non e lungo per quello che decide ma per quello che disegna: il
// PDF e fatto di coordinate, e spezzarlo allontanerebbe le misure dal disegno.
const LUNGHI_PER_NATURA = ['services/invoicePdf.js'];

test('nessun modulo torna a essere un monolite', () => {
    // La fatturazione era un file solo da 1.066 righe, e li atterrava ogni nuova
    // funzione. Oltre le seicento righe di solito dentro ci sono due cose invece
    // di una: e il momento di guardare, non un divieto.
    const troppoGrandi = file
        .filter((f) => !LUNGHI_PER_NATURA.includes(f))
        .map((f) => ({ f, righe: fs.readFileSync(path.join(RADICE, f), 'utf8').split('\n').length }))
        .filter(({ righe }) => righe > 600);

    assert.deepEqual(troppoGrandi.map(({ f, righe }) => `${f} (${righe} righe)`), []);
});
