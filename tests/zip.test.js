const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { creaZip } = require('../utils/zip');

const QUANDO = new Date(2026, 7, 25, 11, 30, 0);

// Un archivio scritto a mano va provato con un programma che non sia il nostro,
// altrimenti si sta solo verificando che il codice sia d'accordo con se stesso.
// `unzip` non c'e su tutte le macchine: quando manca, i controlli sul formato
// restano comunque.
const conUnzip = (() => {
    try {
        execFileSync('unzip', ['-v'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

const scrivi = (buffer) => {
    const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    const file = path.join(cartella, 'prova.zip');
    fs.writeFileSync(file, buffer);
    return file;
};

test('un archivio con piu file e leggibile da unzip', { skip: !conUnzip ? 'unzip non disponibile' : false }, () => {
    const file = [
        { nome: 'IT01234567890_00001.xml', contenuto: Buffer.from('<?xml version="1.0"?><r>à è € ù</r>', 'utf8') },
        { nome: 'vuoto.xml', contenuto: Buffer.from('', 'utf8') },
        { nome: 'grande.xml', contenuto: Buffer.from('x'.repeat(300_000), 'utf8') },
    ];

    const percorso = scrivi(creaZip(file, QUANDO));
    const esito = execFileSync('unzip', ['-t', percorso], { encoding: 'utf8' });
    assert.match(esito, /No errors detected/);

    // Il contenuto deve tornare identico byte per byte, accenti compresi: un
    // XML per lo SdI che perde un carattere viene scartato.
    file.forEach((atteso) => {
        const uscita = execFileSync('unzip', ['-p', percorso, atteso.nome], { maxBuffer: 1024 * 1024 * 8 });
        assert.deepEqual(uscita, atteso.contenuto, `${atteso.nome} non torna identico`);
    });
});

test('le firme e i conteggi del formato sono al loro posto', () => {
    const file = [
        { nome: 'uno.xml', contenuto: Buffer.from('primo') },
        { nome: 'due.xml', contenuto: Buffer.from('secondo') },
    ];
    const zip = creaZip(file, QUANDO);

    assert.equal(zip.readUInt32LE(0), 0x04034b50, 'manca la firma della prima intestazione locale');

    const fine = zip.length - 22;
    assert.equal(zip.readUInt32LE(fine), 0x06054b50, 'manca la firma di chiusura');
    assert.equal(zip.readUInt16LE(fine + 8), file.length, 'il numero di file dichiarato non torna');
    assert.equal(zip.readUInt16LE(fine + 10), file.length, 'il totale dei file non torna');

    // L'indice centrale deve iniziare dove la chiusura dice che inizia.
    const inizioIndice = zip.readUInt32LE(fine + 16);
    assert.equal(zip.readUInt32LE(inizioIndice), 0x02014b50, 'l indice centrale non e dove dichiarato');
});

test('il CRC salvato e quello dei dati, non un altro', () => {
    const contenuto = Buffer.from('<?xml version="1.0"?><Fattura/>', 'utf8');
    const zip = creaZip([{ nome: 'f.xml', contenuto }], QUANDO);

    // Nell'intestazione locale: firma(4) versione(2) flag(2) metodo(2) ora(2)
    // data(2), poi il CRC a 32 bit.
    assert.equal(zip.readUInt32LE(14), zlib.crc32(contenuto));
    assert.equal(zip.readUInt32LE(18), contenuto.length, 'dimensione compressa');
    assert.equal(zip.readUInt32LE(22), contenuto.length, 'dimensione originale');
});

test('un archivio vuoto resta un archivio valido', () => {
    const zip = creaZip([], QUANDO);
    assert.equal(zip.length, 22, 'un archivio senza file e la sola chiusura');
    assert.equal(zip.readUInt32LE(0), 0x06054b50);
    assert.equal(zip.readUInt16LE(8), 0);
});
