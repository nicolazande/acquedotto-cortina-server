// Un file mandato al browser: il PDF di una fattura, un XML, un archivio, un
// elenco, un allegato.
//
// Otto punti scrivevano a mano le stesse intestazioni, ognuno a modo suo: chi
// dava la lunghezza e chi no, e il nome del file fra virgolette cosi com'era. Un
// nome con una virgoletta, o con un carattere fuori dall'alfabeto latino - un
// allegato caricato con "€" nel nome -, rompeva l'intestazione e la risposta.
// Qui il nome va in due forme (RFC 6266): una semplice che ogni browser legge, e
// quella esatta in UTF-8 per chi la capisce.
const { senzaAccenti } = require('../../utils/values');

const nomeSemplice = (nome) => senzaAccenti(nome).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

// encodeURIComponent lascia ' ( ) *, che la forma UTF-8 dell'intestazione non ammette.
const nomeEsatto = (nome) => encodeURIComponent(nome)
    .replace(/['()*]/g, (carattere) => `%${carattere.charCodeAt(0).toString(16).toUpperCase()}`);

const disposizione = (nome, scarica) => `${scarica ? 'attachment' : 'inline'}; `
    + `filename="${nomeSemplice(nome)}"; filename*=UTF-8''${nomeEsatto(nome)}`;

// `scarica`: il browser lo salva invece di aprirlo. `intestazioni`: quelle in
// piu che accompagnano il file, come i conteggi della stampa delle consegne.
const inviaFile = (res, { contenuto, nome, tipo, scarica = false, intestazioni = {} }) => {
    // Byte cosi come sono; un testo - l'XML - in UTF-8, e la lunghezza e quella
    // in byte, non in caratteri.
    const corpo = contenuto instanceof Uint8Array
        ? Buffer.from(contenuto.buffer, contenuto.byteOffset, contenuto.byteLength)
        : Buffer.from(String(contenuto ?? ''), 'utf8');

    Object.entries(intestazioni).forEach(([chiave, valore]) => res.setHeader(chiave, String(valore)));
    res.setHeader('Content-Type', tipo);
    res.setHeader('Content-Disposition', disposizione(String(nome), scarica));
    res.setHeader('Content-Length', corpo.length);
    return res.status(200).send(corpo);
};

module.exports = { disposizione, inviaFile };
