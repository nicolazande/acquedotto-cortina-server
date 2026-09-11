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
const Contatore = require('../models/Contatore');
const Lettura = require('../models/Lettura');
const anagrafe = require('../config/anagrafeTributaria');
const { righeDellAnno } = require('./elencoBim');

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
    // Foglio, particella e subalterno dell'unita immobiliare. Ci sono solo
    // sulle utenze nuove: per le vecchie l'Anagrafe vuole i soli consumi.
    foglio: [300, 306],
    particella: [306, 313],
    subalterno: [313, 319],
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

// Il codice a due cifre che distingue il tipo di posizione.
//
// La prima cifra dice che uso si fa dell'acqua: 1 un'abitazione di residenti,
// 2 un'abitazione di non residenti, 3 un'attivita - un'impresa, un cantiere.
// La seconda dice se l'utenza e nuova dell'anno, e in quel caso vale 2.
//
// La regola e ricavata dalle tredici righe del file prodotto dal gestionale
// precedente. Non e la partita IVA a decidere la prima cifra: Guaitani non ne
// ha e sta fra le attivita (32), perche il suo contatore e PRODUTTIVO.
const CIFRA_PER_ATTIVITA = [
    [/non\s*residen/i, '2'],
    [/residen/i, '1'],
];

const cifraDellUso = (contatore) => {
    const attivita = String(contatore?.tipo_attivita || '');
    const trovata = CIFRA_PER_ATTIVITA.find(([quale]) => quale.test(attivita));
    // Tutto cio che non e un'abitazione e un'attivita: produttivo, cantieri,
    // utenze condominiali, societa immobiliari.
    return trovata ? trovata[1] : '3';
};

const tipoUtenza = ({ contatore, nuova }) => `${cifraDellUso(contatore)}${nuova ? '2' : '1'}`;

// I mesi di fornitura scritti nel tracciato. Un'utenza che c'e stata tutto
// l'anno ne ha dodici; una nuova ne ha quanti ne restano da quando e cominciata,
// col mese d'inizio contato intero - chi subentra il 27 aprile ne ha nove, da
// aprile a dicembre - e la "E" davanti che marca la posizione come nuova.
const MESI_DELL_ANNO = 12;

const mesiDiFornitura = ({ nuova, inizio }) => {
    if (!nuova || !inizio) {
        return String(MESI_DELL_ANNO).padStart(3);
    }

    const mese = (inizio instanceof Date ? inizio : new Date(inizio)).getUTCMonth() + 1;
    return `E${String(MESI_DELL_ANNO + 1 - mese).padStart(2)}`;
};

// Una utenza. Persone fisiche e societa occupano posizioni diverse: la persona
// ha cognome, nome, sesso, data e comune di nascita; la societa ha la ragione
// sociale in un campo che parte dove la persona metterebbe la provincia.
const rigaUtenza = ({ cliente, contatore, edificio, nuova, consumo, consumoPrecedente }) => {
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

    // I dati catastali accompagnano solo le utenze nuove: per le altre
    // l'Anagrafe vuole i soli consumi, e le colonne restano vuote.
    const catasto = nuova
        ? {
            foglio: aDestra(edificio?.foglio, 6),
            particella: aDestra(edificio?.particella ?? edificio?.ped, 7),
            subalterno: aDestra(edificio?.subalterno ?? edificio?.estensione, 6),
        }
        : {};

    return componiRiga({
        tipoRecord: '1',
        codiceFiscale: aSinistra(identificativo, 16),
        ...comuni,
        // Il codice dell'utenza e "1" seguito dal codice del contatore: cosi
        // lo scriveva il gestionale precedente, e lo si e verificato su tutte
        // le tredici righe del file di riferimento.
        codiceUtenza: aSinistra(`1${contatore?.codice ?? ''}`, 31),
        tipoUtenza: tipoUtenza({ contatore, nuova }),
        // La data di inizio della fornitura, che c'e solo sulle utenze nuove.
        dataLettura: nuova ? dataCompatta(contatore?.inizio) : '',
        indirizzo: aSinistra(edificio?.indirizzo || contatore?.nome_edificio, 40),
        codiceCatastale: aSinistra(edificio?.catasto, 4),
        tipoFornitura: 'F',
        ...catasto,
        mesi: mesiDiFornitura({ nuova, inizio: contatore?.inizio }),
        // Su un'utenza nuova il gestionale precedente scriveva zero in entrambi
        // i consumi: il primo anno non ha ancora una lettura da confrontare.
        consumo: aDestra(nuova ? 0 : Math.round(consumo ?? 0), 9),
        consumoPrecedente: aDestra(nuova ? 0 : Math.round(consumoPrecedente ?? 0), 9),
        fine: 'A',
    });
};

const componiFile = ({ ente, anno, utenze }) => [
    intestazione('0', ente, anno),
    ...utenze.map(rigaUtenza),
    intestazione('9', ente, anno),
].join('\r\n') + '\r\n';

// Le utenze da mandare all'Anagrafe per un anno.
//
// Ci vanno tutte quelle che hanno avuto un consumo, piu quelle nate nell'anno -
// un subentro o un primo impianto - che portano anche i dati catastali. Le
// vecchie hanno i soli consumi: e la regola che l'acquedotto applica da sempre.
//
// I consumi arrivano dalle stesse righe che vanno al BIM, cosi i due elenchi non
// possono raccontare due storie diverse dello stesso anno. Li si trova per
// seriale, che e l'unica cosa che la riga del BIM porta con se del contatore.
const utenzeDellAnno = async (anno) => {
    const inizio = new Date(Date.UTC(anno, 0, 1));
    const dopo = new Date(Date.UTC(anno + 1, 0, 1));

    const consumiPerSeriale = new Map();
    (await righeDellAnno(anno)).forEach((riga) => {
        if (!riga.seriale) return;
        const gia = consumiPerSeriale.get(riga.seriale);
        consumiPerSeriale.set(riga.seriale, {
            consumo: (gia?.consumo ?? 0) + riga.consumi,
            consumoPrecedente: gia?.consumoPrecedente ?? riga.letturaPrecedente,
        });
    });

    // I contatori con una lettura nell'anno: sono le utenze da dichiarare.
    const lettiQuestAnno = await Lettura.find({ data_lettura: { $gte: inizio, $lt: dopo } })
        .distinct('contatore');

    const contatori = await Contatore.find({ _id: { $in: lettiQuestAnno } })
        .populate(['cliente', 'edificio'])
        .sort({ inizio: 1, codice: 1 })
        .lean();

    return contatori.map((contatore) => {
        // Nuova e l'utenza cominciata quest'anno: solo quelle portano i dati
        // catastali, e solo per quelle l'Anagrafe vuole la data di inizio.
        const nuova = Boolean(contatore.inizio) && contatore.inizio >= inizio && contatore.inizio < dopo;
        const consumi = consumiPerSeriale.get(contatore.seriale);

        return {
            cliente: contatore.cliente,
            contatore,
            edificio: contatore.edificio,
            nuova,
            consumo: consumi?.consumo ?? 0,
            consumoPrecedente: consumi?.consumoPrecedente ?? 0,
        };
    });
};

// Il file completo per un anno, intestazione e piede compresi.
const fileDellAnno = async (anno) => componiFile({
    ente: anagrafe,
    anno,
    utenze: await utenzeDellAnno(anno),
});

// Cosa contiene il file, senza produrlo: quante utenze, quante nuove, e quante
// di quelle nuove non hanno i dati catastali - che per l'Anagrafe e il dato che
// conta, e l'unico che va chiesto a chi firma il contratto.
const riepilogoDellAnno = async (anno) => {
    const utenze = await utenzeDellAnno(anno);
    const nuove = utenze.filter((u) => u.nuova);

    return {
        anno,
        utenze: utenze.length,
        nuove: nuove.length,
        senzaCatasto: nuove.filter((u) => !u.edificio?.foglio || !(u.edificio?.particella ?? u.edificio?.ped)).length,
        senzaCodiceFiscale: utenze.filter((u) => !u.cliente?.codice_fiscale && !u.cliente?.partita_iva).length,
    };
};

module.exports = {
    CAMPI,
    fileDellAnno,
    riepilogoDellAnno,
    utenzeDellAnno,
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
