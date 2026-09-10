// L'elenco dei consumi che una volta l'anno va all'anagrafe tributaria.
//
// E un file a larghezza fissa: ogni riga e lunga 1798 caratteri e ogni campo
// occupa una posizione precisa, riempita di spazi. Non e un formato che si possa
// "quasi" rispettare - un carattere fuori posto e il file viene scartato senza
// spiegazioni - quindi la mappa qui sotto e stata ricavata leggendo il file vero
// prodotto dal gestionale precedente, campo per campo, e i test lo confrontano
// con quello.
//
// Tre tipi di riga: una di testa (0), una per utenza (1), una di coda (9).
// Testa e coda sono identiche a meno del primo carattere.

const { siglaProvincia } = require('../utils/province');

const LUNGHEZZA_RIGA = 1798;

// La posizione di ogni campo, come si e osservata nel file di riferimento.
const CAMPI = {
    tipoRecord: [0, 1],
    codiceFiscale: [1, 17],
    cognome: [17, 41],
    nome: [41, 61],
    sesso: [61, 62],
    dataNascita: [62, 70],
    comuneNascita: [70, 110],
    provinciaNascita: [110, 112],
    ragioneSociale: [110, 172],
    comuneSede: [172, 212],
    provinciaSede: [212, 214],
    codiceUtenza: [214, 245],
    tipoUtenza: [245, 247],
    dataLettura: [247, 255],
    indirizzo: [255, 295],
    codiceCatastale: [295, 299],
    tipoFornitura: [299, 300],
    mesi: [322, 325],
    consumo: [325, 334],
    consumoPrecedente: [334, 343],
    fine: [1797, 1798],
};

// Il file e destinato a un sistema che non conosce accenti ne lettere
// minuscole: si scrive tutto in maiuscolo e senza segni.
const soloLettere = (testo) => String(testo ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9'\- .]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Nell'archivio la provincia e per esteso ("Belluno"); il tracciato vuole la
// sigla. La conversione e quella che usa gia la fattura elettronica.
const dueLettere = (valore) => String(siglaProvincia(valore) || '').slice(0, 2).padEnd(2, ' ');

const aSinistra = (valore, quanti) => soloLettere(valore).slice(0, quanti).padEnd(quanti, ' ');
const aDestra = (valore, quanti) => String(valore ?? '').slice(-quanti).padStart(quanti, ' ');

const dataCompatta = (data) => {
    if (!data) return '';
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return '';
    const due = (n) => String(n).padStart(2, '0');
    return `${due(d.getUTCDate())}${due(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
};

// Una riga si costruisce partendo da 1798 spazi e scrivendo dentro i campi: cosi
// una posizione dimenticata resta vuota invece di spostare tutto quello che segue.
const componiRiga = (valori) => {
    const riga = new Array(LUNGHEZZA_RIGA).fill(' ');

    Object.entries(valori).forEach(([campo, valore]) => {
        const posizione = CAMPI[campo];
        if (!posizione || valore === undefined || valore === null) return;

        const [da, a] = posizione;
        const testo = String(valore).slice(0, a - da);
        for (let i = 0; i < testo.length; i++) {
            riga[da + i] = testo[i];
        }
    });

    return riga.join('');
};

// I dati dell'ente che apre e chiude il file. Sono costanti dell'acquedotto -
// codice fornitura, partita IVA, denominazione - e stanno in `config/anagrafeTributaria`
// perche siano modificabili senza toccare il codice che compone le righe.
const intestazione = (tipoRecord, ente, anno) => {
    const riga = new Array(LUNGHEZZA_RIGA).fill(' ');
    const scrivi = (da, testo) => {
        const t = String(testo ?? '');
        for (let i = 0; i < t.length; i++) riga[da + i] = t[i];
    };

    scrivi(0, `${tipoRecord}${ente.codiceFornitura}`);
    scrivi(26, ente.partitaIva);
    // La denominazione e quella registrata presso l'Agenzia, doppi spazi
    // compresi: si scrive tale e quale, senza normalizzarla.
    scrivi(42, ente.denominazione.slice(0, 60));
    scrivi(102, soloLettere(ente.comune).slice(0, 40));
    scrivi(142, ente.provincia);
    scrivi(239, `${anno}${ente.progressivoFornitura}`);
    scrivi(259, ente.codiceInvio);
    scrivi(1797, 'A');

    return riga.join('');
};

// Il codice a due cifre che distingue il tipo di posizione. Nel file di
// riferimento: 21 e 22 per le persone, 31 per le societa; la seconda cifra
// cambia quando l'utenza e subentrata in corso d'anno.
const tipoUtenza = ({ eSocieta, lettura }) => {
    if (eSocieta) return '31';
    return lettura?.subentro ? '22' : '21';
};

// Una utenza. Persone fisiche e societa occupano posizioni diverse: la persona
// ha cognome, nome, sesso, data e comune di nascita; la societa ha la ragione
// sociale in un campo che parte dove la persona metterebbe la provincia.
const rigaUtenza = ({ cliente, contatore, edificio, lettura, consumo, consumoPrecedente, mesi }) => {
    // Una persona fisica ha il codice fiscale di sedici caratteri; una societa ha
    // la partita IVA. `ragione_sociale` non distingue: l'archivio la valorizza
    // anche per le persone, col nome e cognome dentro.
    const eSocieta = Boolean(cliente?.partita_iva);
    const identificativo = eSocieta ? cliente.partita_iva : (cliente?.codice_fiscale || '');

    const comuni = eSocieta
        ? {
            // La ragione sociale comincia due caratteri piu in la: cosi la
            // scriveva il gestionale precedente, e il tracciato lo accetta.
            ragioneSociale: `  ${aSinistra(cliente.ragione_sociale, 60)}`,
            comuneSede: aSinistra(cliente.localita_residenza, 40),
            provinciaSede: dueLettere(cliente.provincia_residenza),
        }
        : {
            cognome: aSinistra(cliente?.cognome, 24),
            nome: aSinistra(cliente?.nome, 20),
            sesso: /^f/i.test(cliente?.sesso || '') ? 'F' : 'M',
            dataNascita: dataCompatta(cliente?.data_nascita),
            comuneNascita: aSinistra(cliente?.comune_nascita, 40),
            provinciaNascita: dueLettere(cliente?.provincia_nascita),
        };

    return componiRiga({
        tipoRecord: '1',
        codiceFiscale: aSinistra(identificativo, 16),
        ...comuni,
        // Il codice dell'utenza e "1" seguito dal codice del contatore: cosi
        // lo scriveva il gestionale precedente, e lo si e verificato su tutte
        // le tredici righe del file di riferimento.
        codiceUtenza: aSinistra(`1${contatore?.codice ?? ''}`, 31),
        tipoUtenza: aSinistra(tipoUtenza({ eSocieta, lettura }), 2),
        dataLettura: lettura?.subentro ? dataCompatta(lettura.data_lettura) : '',
        indirizzo: aSinistra(edificio?.indirizzo || contatore?.nome_edificio, 40),
        codiceCatastale: aSinistra(edificio?.catasto, 4),
        tipoFornitura: 'F',
        mesi: aDestra(mesi ?? 12, 3),
        consumo: aDestra(Math.round(consumo ?? 0), 9),
        consumoPrecedente: aDestra(Math.round(consumoPrecedente ?? 0), 9),
        fine: 'A',
    });
};

const componiFile = ({ ente, anno, utenze }) => [
    intestazione('0', ente, anno),
    ...utenze.map(rigaUtenza),
    intestazione('9', ente, anno),
].join('\r\n') + '\r\n';

module.exports = {
    CAMPI,
    LUNGHEZZA_RIGA,
    aDestra,
    aSinistra,
    componiFile,
    componiRiga,
    dataCompatta,
    intestazione,
    rigaUtenza,
    soloLettere,
};
