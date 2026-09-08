const crypto = require('crypto');

// Dove finiscono i byte di un allegato.
//
// Di suo il gestionale li tiene dentro MongoDB, nel documento stesso: comodo,
// perche un backup del database porta con se anche i file e non c'e niente da
// configurare. Va bene finche i file sono pochi. Con una foto per lettura si
// arriva a qualche gigabyte in dieci anni, e su un database quello spazio costa
// caro e appesantisce ogni copia di sicurezza: il ripristino passa da secondi a
// minuti, e ogni backup si porta dietro tutte le fotografie.
//
// Percio i byte possono anche andare in un archivio a oggetti - Cloudflare R2,
// Backblaze B2, qualunque servizio che parli il protocollo S3 - che costa pochi
// centesimi al gigabyte e non entra nei backup del database.
//
// Quale dei due si usa lo decide la configurazione, e nient'altro nel gestionale
// se ne accorge: chi carica e chi scarica un allegato chiama sempre queste tre
// funzioni. Senza le variabili di R2 si continua a salvare nel database
// esattamente come prima, quindi accendere l'archivio esterno e una scelta, non
// un passaggio obbligato.

const VARIABILI = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

const configurazione = () => {
    const mancanti = VARIABILI.filter((nome) => !process.env[nome]);

    if (mancanti.length === VARIABILI.length) {
        return null;
    }

    if (mancanti.length > 0) {
        // Meta configurato e peggio di niente: si scoprirebbe al primo allegato.
        throw new Error(`Archivio file configurato a meta: mancano ${mancanti.join(', ')}`);
    }

    return {
        bucket: process.env.R2_BUCKET,
        chiave: process.env.R2_ACCESS_KEY_ID,
        segreto: process.env.R2_SECRET_ACCESS_KEY,
        regione: process.env.R2_REGION || 'auto',
        // L'indirizzo si puo scrivere per esteso: serve per provare il codice
        // contro un archivio finto, e per usare un fornitore diverso da R2.
        base: process.env.R2_ENDPOINT
            || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    };
};

const sha256 = (valore) => crypto.createHash('sha256').update(valore).digest('hex');
const hmac = (chiave, valore) => crypto.createHmac('sha256', chiave).update(valore).digest();

// La firma richiesta dal protocollo S3 (AWS Signature v4). Sono una trentina di
// righe e non serve nessuna libreria: il conto e sempre lo stesso, e scritto qui
// si legge, invece di stare dentro un pacchetto da dieci megabyte.
const firma = ({ metodo, url, corpo, conf, contentType }) => {
    const adesso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const giorno = adesso.slice(0, 8);
    const impronta = sha256(corpo || '');
    const intestazioni = {
        host: url.host,
        'x-amz-content-sha256': impronta,
        'x-amz-date': adesso,
        // Il tipo va firmato insieme al resto: l'archivio lo restituisce tale e
        // quale, e senza tornerebbe indietro come flusso di byte anonimo.
        ...(contentType ? { 'content-type': contentType } : {}),
    };
    const nomi = Object.keys(intestazioni).sort();
    const canonica = [
        metodo,
        url.pathname,
        '',
        ...nomi.map((n) => `${n}:${intestazioni[n]}`),
        '',
        nomi.join(';'),
        impronta,
    ].join('\n');

    const ambito = `${giorno}/${conf.regione}/s3/aws4_request`;
    const daFirmare = ['AWS4-HMAC-SHA256', adesso, ambito, sha256(canonica)].join('\n');
    const chiaveFirma = ['s3', 'aws4_request'].reduce(
        (chiave, pezzo) => hmac(chiave, pezzo),
        hmac(hmac(`AWS4${conf.segreto}`, giorno), conf.regione)
    );

    return {
        ...intestazioni,
        Authorization: `AWS4-HMAC-SHA256 Credential=${conf.chiave}/${ambito}, `
            + `SignedHeaders=${nomi.join(';')}, `
            + `Signature=${crypto.createHmac('sha256', chiaveFirma).update(daFirmare).digest('hex')}`,
    };
};

const chiama = async ({ metodo, percorso, corpo, conf, contentType }) => {
    const url = new URL(`${conf.base}/${conf.bucket}/${percorso}`);
    const risposta = await fetch(url, {
        method: metodo,
        headers: firma({ metodo, url, corpo, conf, contentType }),
        body: corpo,
    });

    if (!risposta.ok) {
        throw new Error(`Archivio file: ${metodo} ${percorso} ha risposto ${risposta.status}`);
    }

    return risposta;
};

// Il nome con cui il file e riposto. L'anno serve a chi un giorno guardera
// dentro il secchio con le mani: senza, sarebbero centomila file in un mucchio
// solo. Il resto e casuale, perche il nome non deve dire niente di chi c'e
// dentro ne essere indovinabile.
const nuovaChiave = (nomeFile) => {
    const estensione = String(nomeFile || '').split('.').pop();
    const suffisso = estensione && estensione.length <= 5 ? `.${estensione.toLowerCase()}` : '';
    return `allegati/${new Date().getFullYear()}/${crypto.randomUUID()}${suffisso}`;
};

const suArchivioEsterno = () => Boolean(configurazione());

// Ripone i byte e restituisce come ritrovarli: o la chiave dell'archivio
// esterno, o i byte stessi da scrivere nel documento.
const riponi = async ({ buffer, contentType, filename }) => {
    const conf = configurazione();

    if (!conf) {
        return { data: buffer };
    }

    const chiave = nuovaChiave(filename);
    await chiama({
        metodo: 'PUT', percorso: chiave, corpo: buffer, contentType, conf,
    });

    return { chiave };
};

const leggi = async (allegato) => {
    if (allegato.data) {
        return allegato.data;
    }

    if (!allegato.chiave) {
        throw new Error('Allegato senza contenuto');
    }

    const conf = configurazione();
    if (!conf) {
        throw new Error('Allegato nell archivio esterno, ma l archivio non e configurato');
    }

    const risposta = await chiama({ metodo: 'GET', percorso: allegato.chiave, conf });
    return Buffer.from(await risposta.arrayBuffer());
};

// Cancellare il file non deve impedire di cancellare la scheda: un byte rimasto
// nell archivio e spazzatura che costa un millesimo, una scheda che non si
// cancella e un difetto che l'utente vede.
const dimentica = async (allegato) => {
    if (!allegato?.chiave || !configurazione()) {
        return;
    }

    try {
        await chiama({ metodo: 'DELETE', percorso: allegato.chiave, conf: configurazione() });
    } catch (errore) {
        console.error('[ArchivioFile] non sono riuscito a cancellare', allegato.chiave, errore.message);
    }
};

module.exports = {
    dimentica,
    leggi,
    nuovaChiave,
    riponi,
    suArchivioEsterno,
};
