const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const VARIABILI = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'];

// `archivioFile` legge la configurazione a ogni chiamata, quindi si puo accendere
// e spegnere fra un test e l'altro senza ricaricare il modulo.
const conArchivio = async (base, operazione) => {
    const prima = Object.fromEntries(VARIABILI.map((v) => [v, process.env[v]]));
    Object.assign(process.env, {
        R2_ACCOUNT_ID: 'prova',
        R2_BUCKET: 'allegati',
        R2_ACCESS_KEY_ID: 'chiave',
        R2_SECRET_ACCESS_KEY: 'segreto',
        R2_ENDPOINT: base,
    });

    try {
        return await operazione();
    } finally {
        VARIABILI.forEach((v) => {
            if (prima[v] === undefined) delete process.env[v];
            else process.env[v] = prima[v];
        });
    }
};

// Un archivio a oggetti finto: accetta solo richieste firmate, come fa R2.
const archivioFinto = async () => {
    const file = new Map();
    const viste = [];
    const server = http.createServer((req, res) => {
        const chiave = decodeURIComponent(req.url.replace(/^\/[^/]+\//, ''));
        viste.push({ metodo: req.method, chiave, tipo: req.headers['content-type'], firmata: String(req.headers.authorization || '').startsWith('AWS4-HMAC-SHA256') });

        if (!String(req.headers.authorization || '').startsWith('AWS4-HMAC-SHA256')) {
            res.writeHead(403); res.end(); return;
        }
        if (req.method === 'PUT') {
            const pezzi = [];
            req.on('data', (c) => pezzi.push(c));
            req.on('end', () => { file.set(chiave, Buffer.concat(pezzi)); res.writeHead(200); res.end(); });
            return;
        }
        if (req.method === 'GET') {
            const b = file.get(chiave);
            if (!b) { res.writeHead(404); res.end(); return; }
            res.writeHead(200); res.end(b);
            return;
        }
        if (req.method === 'DELETE') { file.delete(chiave); res.writeHead(204); res.end(); return; }
        res.writeHead(405); res.end();
    });

    await new Promise((r) => server.listen(0, r));
    return { base: `http://127.0.0.1:${server.address().port}`, file, viste, chiudi: () => server.close() };
};

test('senza configurazione i byte restano nel documento', async () => {
    const { riponi, suArchivioEsterno } = require('../services/archivioFile');
    const byte = Buffer.from('una foto');

    assert.equal(suArchivioEsterno(), false);
    assert.deepEqual(await riponi({ buffer: byte, contentType: 'image/jpeg', filename: 'a.jpg' }), { data: byte });
});

test('una configurazione a meta si ferma subito, non al primo allegato', () => {
    const prima = process.env.R2_BUCKET;
    process.env.R2_BUCKET = 'allegati';

    try {
        assert.throws(() => require('../services/archivioFile').suArchivioEsterno(), /a meta/);
    } finally {
        if (prima === undefined) delete process.env.R2_BUCKET;
        else process.env.R2_BUCKET = prima;
    }
});

test('con la configurazione i byte vanno nell archivio, firmati', async () => {
    const finto = await archivioFinto();

    try {
        await conArchivio(finto.base, async () => {
            const { riponi, leggi, dimentica, suArchivioEsterno } = require('../services/archivioFile');
            assert.equal(suArchivioEsterno(), true);

            const byte = Buffer.from('il quadrante del contatore');
            const riposto = await riponi({ buffer: byte, contentType: 'image/jpeg', filename: 'quadrante.jpg' });

            // Nel documento resta la chiave, non i byte.
            assert.equal(riposto.data, undefined);
            assert.match(riposto.chiave, /^allegati\/\d{4}\/[0-9a-f-]{36}\.jpg$/);
            assert.equal(finto.file.size, 1);

            // La richiesta e firmata e porta il tipo del file: senza, l'archivio
            // lo restituirebbe come flusso di byte anonimo.
            assert.equal(finto.viste[0].firmata, true);
            assert.equal(finto.viste[0].tipo, 'image/jpeg');

            // E si rilegge identico.
            assert.deepEqual(await leggi({ chiave: riposto.chiave }), byte);

            await dimentica({ chiave: riposto.chiave });
            assert.equal(finto.file.size, 0);
        });
    } finally {
        finto.chiudi();
    }
});

test('i byte gia nel documento si leggono anche con l archivio acceso', async () => {
    const finto = await archivioFinto();

    try {
        await conArchivio(finto.base, async () => {
            // Un allegato caricato prima di accendere l'archivio: nessuna
            // migrazione, continua a leggersi da dove sta.
            const byte = Buffer.from('vecchio allegato');
            assert.deepEqual(await require('../services/archivioFile').leggi({ data: byte }), byte);
            assert.equal(finto.viste.length, 0, 'non doveva nemmeno interrogare l archivio');
        });
    } finally {
        finto.chiudi();
    }
});

test('cancellare un file che non c e piu non fa fallire la cancellazione', async () => {
    const finto = await archivioFinto();

    try {
        await conArchivio(finto.base, async () => {
            // Un byte rimasto nell'archivio costa un millesimo; una scheda che
            // non si cancella e un difetto che l'utente vede.
            await require('../services/archivioFile').dimentica({ chiave: 'allegati/2020/mai-esistito.jpg' });
        });
    } finally {
        finto.chiudi();
    }
});

test('un allegato senza contenuto lo dice, invece di restituire il vuoto', async () => {
    await assert.rejects(() => require('../services/archivioFile').leggi({}), /senza contenuto/);
});
