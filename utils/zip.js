// Un archivio ZIP scritto a mano, senza dipendenze.
//
// Serve per consegnare in un colpo solo i file XML delle fatture elettroniche:
// lo SdI ne vuole uno per documento, quindi scaricarli a uno a uno significa
// cinquecento clic. I file vengono inseriti senza comprimere ("store"): sono
// XML di pochi kB, la compressione aggiungerebbe complessita per risparmiare
// pochi secondi di rete, e un archivio non compresso e leggibile da qualunque
// programma senza sorprese.
//
// Il formato e quello descritto da APPNOTE.TXT di PKWARE: per ogni file una
// intestazione locale piu i dati, poi un indice centrale, poi la sua chiusura.

const { crc32 } = require('zlib');

const FIRMA_LOCALE = 0x04034b50;
const FIRMA_INDICE = 0x02014b50;
const FIRMA_FINE = 0x06054b50;
// 2.0: la versione minima che gestisce le cartelle e i nomi lunghi.
const VERSIONE = 20;

// Data e ora nel formato MS-DOS che lo ZIP si porta dietro dal 1989: la data in
// 16 bit con gli anni contati dal 1980, l'ora in 16 bit con i secondi a passi
// di due.
const dataDos = (quando) => (
    ((quando.getFullYear() - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate()
);
const oraDos = (quando) => (
    (quando.getHours() << 11) | (quando.getMinutes() << 5) | Math.floor(quando.getSeconds() / 2)
);

const intestazioneLocale = ({ nome, contenuto, crc, quando }) => {
    const testata = Buffer.alloc(30);
    testata.writeUInt32LE(FIRMA_LOCALE, 0);
    testata.writeUInt16LE(VERSIONE, 4);
    testata.writeUInt16LE(0, 6); // nessun flag
    testata.writeUInt16LE(0, 8); // metodo 0: nessuna compressione
    testata.writeUInt16LE(oraDos(quando), 10);
    testata.writeUInt16LE(dataDos(quando), 12);
    testata.writeUInt32LE(crc, 14);
    testata.writeUInt32LE(contenuto.length, 18);
    testata.writeUInt32LE(contenuto.length, 22);
    testata.writeUInt16LE(nome.length, 26);
    testata.writeUInt16LE(0, 28); // nessun campo extra

    return Buffer.concat([testata, nome, contenuto]);
};

const voceIndice = ({ nome, contenuto, crc, quando, posizione }) => {
    const voce = Buffer.alloc(46);
    voce.writeUInt32LE(FIRMA_INDICE, 0);
    voce.writeUInt16LE(VERSIONE, 4);
    voce.writeUInt16LE(VERSIONE, 6);
    voce.writeUInt16LE(0, 8);
    voce.writeUInt16LE(0, 10);
    voce.writeUInt16LE(oraDos(quando), 12);
    voce.writeUInt16LE(dataDos(quando), 14);
    voce.writeUInt32LE(crc, 16);
    voce.writeUInt32LE(contenuto.length, 20);
    voce.writeUInt32LE(contenuto.length, 24);
    voce.writeUInt16LE(nome.length, 28);
    voce.writeUInt16LE(0, 30); // extra
    voce.writeUInt16LE(0, 32); // commento
    voce.writeUInt16LE(0, 34); // disco
    voce.writeUInt16LE(0, 36); // attributi interni
    voce.writeUInt32LE(0, 38); // attributi esterni
    voce.writeUInt32LE(posizione, 42);

    return Buffer.concat([voce, nome]);
};

const chiusura = ({ quanti, dimensioneIndice, posizioneIndice }) => {
    const fine = Buffer.alloc(22);
    fine.writeUInt32LE(FIRMA_FINE, 0);
    fine.writeUInt16LE(0, 4); // numero del disco
    fine.writeUInt16LE(0, 6); // disco su cui inizia l'indice
    fine.writeUInt16LE(quanti, 8);
    fine.writeUInt16LE(quanti, 10);
    fine.writeUInt32LE(dimensioneIndice, 12);
    fine.writeUInt32LE(posizioneIndice, 16);
    fine.writeUInt16LE(0, 20); // nessun commento

    return fine;
};

// `file` e un elenco di { nome, contenuto }, dove il contenuto e una stringa o
// un Buffer.
const creaZip = (file, quando = new Date()) => {
    const parti = [];
    const indice = [];
    let posizione = 0;

    file.forEach(({ nome, contenuto }) => {
        const nomeBuffer = Buffer.from(nome, 'utf8');
        const datiBuffer = Buffer.isBuffer(contenuto) ? contenuto : Buffer.from(contenuto, 'utf8');
        const crc = crc32(datiBuffer);
        const voce = { nome: nomeBuffer, contenuto: datiBuffer, crc, quando };

        parti.push(intestazioneLocale(voce));
        indice.push(voceIndice({ ...voce, posizione }));
        posizione += 30 + nomeBuffer.length + datiBuffer.length;
    });

    const corpo = Buffer.concat(parti);
    const indiceBuffer = Buffer.concat(indice);

    return Buffer.concat([
        corpo,
        indiceBuffer,
        chiusura({
            quanti: file.length,
            dimensioneIndice: indiceBuffer.length,
            posizioneIndice: corpo.length,
        }),
    ]);
};

module.exports = { creaZip };
