const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// config/auth.js decide all'importazione, quindi ogni caso va provato in un
// processo suo. Il valore in gioco e il segreto con cui si firmano i token: se
// e quello degli esempi, chiunque lo conosca puo firmarsi un accesso da
// amministratore, e non deve poter succedere per una dimenticanza.
const avvia = (env) => {
    try {
        const uscita = execFileSync(
            process.execPath,
            ['-e', "require('./config/auth'); console.log('AVVIATO');"],
            { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
        return { partito: uscita.includes('AVVIATO') };
    } catch (errore) {
        return { partito: false, messaggio: String(errore.stderr || '') };
    }
};

test('fuori dallo sviluppo un segreto assente o di esempio ferma l avvio', () => {
    ['production', 'staging', undefined].forEach((NODE_ENV) => {
        const dove = NODE_ENV || 'NODE_ENV assente';

        const senza = avvia({ NODE_ENV });
        assert.equal(senza.partito, false, `${dove}: e partito senza segreto`);
        assert.match(senza.messaggio, /JWT_SECRET/);

        ['change-me', 'your_jwt_secret', 'secret'].forEach((JWT_SECRET) => {
            assert.equal(avvia({ NODE_ENV, JWT_SECRET }).partito, false, `${dove}: e partito con "${JWT_SECRET}"`);
        });
    });
});

test('un segreto vero avvia, in qualunque ambiente', () => {
    const JWT_SECRET = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    ['production', 'development', undefined].forEach((NODE_ENV) => {
        assert.equal(avvia({ NODE_ENV, JWT_SECRET }).partito, true, `${NODE_ENV || 'senza NODE_ENV'}: non e partito`);
    });
});

test('in sviluppo si puo lavorare senza configurare niente', () => {
    ['development', 'test'].forEach((NODE_ENV) => {
        assert.equal(avvia({ NODE_ENV }).partito, true, `${NODE_ENV}: non e partito`);
    });
});
