// L'elenco delle utenze che una volta l'anno va all'Anagrafe Tributaria.
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

const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Servizio = require('../models/Servizio');
// Serviti dalle populate qui sotto: chiesti per nome, vanno registrati.
require('../models/Cliente');
require('../models/Edificio');
require('../models/Lettura');
const anagrafe = require('../config/anagrafeTributaria');
const { dataReale, formatItalianDate, toDate } = require('../utils/dates');
const { fromCents, toCents } = require('../utils/money');
const { siglaProvincia } = require('../utils/province');
const { senzaAccenti } = require('../utils/values');
const { MESI_DELL_ANNO, mesiDiServizio } = require('./rateoQuotaFissa');

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
    // I metri cubi fatturati nell'anno e quanto sono costati, in euro senza
    // decimali: la sola quota a consumo, senza quota fissa e senza IVA. Il
    // secondo campo sembrava la lettura precedente, e invece e l'importo: nel
    // file del gestionale precedente Siorpaes, 16 mc per 5,28 euro, porta 16 e 5,
    // e RP Management, 3949 mc per 5127,64 euro, porta 3949 e 5128.
    consumo: [325, 334],
    importoConsumi: [334, 343],
    fine: [1797, 1798],
};

// Il file e destinato a un sistema che non conosce accenti ne lettere
// minuscole: si scrive tutto in maiuscolo e senza segni.
const soloLettere = (testo) => senzaAccenti(String(testo ?? '').toUpperCase())
    .replace(/[^A-Z0-9'\- .]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Nell'archivio la provincia e per esteso ("Belluno"); il tracciato vuole la
// sigla. La conversione e quella che usa gia la fattura elettronica.
const dueLettere = (valore) => String(siglaProvincia(valore) || '').slice(0, 2).padEnd(2, ' ');

const aSinistra = (valore, quanti) => soloLettere(valore).slice(0, quanti).padEnd(quanti, ' ');
const aDestra = (valore, quanti) => String(valore ?? '').slice(-quanti).padStart(quanti, ' ');

// La data come la vuole il tracciato: giorno, mese e anno di seguito, 27042026.
const dataCompatta = (data) => formatItalianDate(data).replace(/\//g, '');

// Euro senza decimali, arrotondati a meta per eccesso: 13,50 diventa 14. Si
// passa dai centesimi, cosi una somma di righe non porta con se gli errori della
// virgola mobile.
const euroInteri = (valore) => {
    const centesimi = toCents(valore);
    return centesimi >= 0 ? Math.round(centesimi / 100) : -Math.round(-centesimi / 100);
};

// Una persona fisica si identifica col codice fiscale, una societa con la
// partita IVA. `ragione_sociale` non distingue: l'archivio la valorizza anche per
// le persone, col nome e cognome dentro.
const eSocieta = (cliente) => Boolean(cliente?.partita_iva);
const identificativoFiscale = (cliente) => (
    eSocieta(cliente) ? cliente.partita_iva : (cliente?.codice_fiscale || '')
);

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
// con la "E" davanti che marca la posizione come nuova. Si contano come la quota
// fissa, col mese d'inizio intero: chi subentra il 27 aprile ne ha nove.
const mesiDiFornitura = ({ nuova, inizio }) => {
    const attivazione = toDate(inizio);
    if (!nuova || !attivazione) {
        return String(MESI_DELL_ANNO).padStart(3);
    }

    const mesi = mesiDiServizio({ inizio: attivazione, fine: null, anno: attivazione.getUTCFullYear() });
    return `E${String(mesi).padStart(2)}`;
};

// Una utenza. Persone fisiche e societa occupano posizioni diverse: la persona
// ha cognome, nome, sesso, data e comune di nascita; la societa ha la ragione
// sociale in un campo che parte dove la persona metterebbe la provincia.
const rigaUtenza = ({ cliente, contatore, edificio, nuova, consumo, importoConsumi }) => {
    const comuni = eSocieta(cliente)
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
        codiceFiscale: aSinistra(identificativoFiscale(cliente), 16),
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
        // Quello che e stato fatturato nell'anno. Un subentro appena cominciato non
        // ha ancora niente, e porta zero come nel file del gestionale precedente.
        consumo: aDestra(Math.round(consumo ?? 0), 9),
        importoConsumi: aDestra(euroInteri(importoConsumi ?? 0), 9),
        fine: 'A',
    });
};

const componiFile = ({ ente, anno, utenze }) => [
    intestazione('0', ente, anno),
    ...utenze.map(rigaUtenza),
    intestazione('9', ente, anno),
].join('\r\n') + '\r\n';

// Le righe di fattura che dicono quanta acqua e passata da un contatore e quanto
// e costata: le fasce a consumo. Restano fuori la quota fissa, la mora per il
// ritardo e le righe scritte a mano senza una fascia.
const TARIFFA_FISSA = /fiss/i;

const eRigaAConsumo = (riga) => (
    Boolean(riga?.tipo_tariffa)
    && !TARIFFA_FISSA.test(String(riga.tipo_tariffa))
    && !TARIFFA_FISSA.test(String(riga.tipo_quota || ''))
    && riga.calcolo_snapshot?.quota !== 'delay'
);

// I contratti cominciati nell'anno da dichiarare come nuovi: i subentri a
// un'utenza fatturata nello stesso anno. Quando cambia l'intestatario si
// dichiarano in due, chi esce con i suoi consumi e chi entra con i dati catastali.
//
// E la regola del file del gestionale precedente, verificata sui dieci contratti
// nuovi del 2026: dichiara Guaitani, subentrato a Siorpaes fatturata nel 2026, e
// non Bernardi, subentrato ad Alberti fatturato l'anno prima. Un primo impianto
// non si dichiara come nuovo: compare l'anno in cui viene fatturato.
const subentriDaDichiarare = ({ nuovi, fratelli, fatturati }) => nuovi.filter((nuovo) => {
    const attivazione = toDate(nuovo.inizio);
    if (!nuovo.seriale || !attivazione) return false;

    const predecessore = fratelli
        .filter((f) => f.seriale === nuovo.seriale && String(f._id) !== String(nuovo._id))
        .map((f) => ({ contatore: f, fine: dataReale(f.scadenza) }))
        .filter(({ fine }) => fine && fine < attivazione)
        .sort((a, b) => b.fine - a.fine)[0]?.contatore;

    return Boolean(predecessore) && fatturati.has(String(predecessore._id));
});

// Le utenze da mandare all'Anagrafe per un anno, e quanto non si e riusciti ad
// attribuire.
//
// Ci vanno le utenze fatturate nell'anno, con i metri cubi e l'importo delle loro
// righe a consumo; un'utenza con la sola quota fissa e fatturata anche lei, e ci
// va con zero. Una riga si attribuisce al contatore della lettura che l'ha
// generata: una riga a consumo senza lettura non si sa di chi sia, resta fuori
// dal file e finisce nel riepilogo, perche qualcuno la guardi. Poi i subentri.
const datiDellAnno = async (anno) => {
    const inizio = new Date(Date.UTC(anno, 0, 1));
    const dopo = new Date(Date.UTC(anno + 1, 0, 1));

    const fatture = await Fattura.find({ anno }).distinct('_id');
    const righe = await Servizio.find({ fattura: { $in: fatture } })
        .select('lettura tipo_tariffa tipo_quota metri_cubi valore_unitario calcolo_snapshot.quota')
        .populate({ path: 'lettura', select: 'contatore' })
        .lean();

    const fatturati = new Map();
    let righeSenzaContatore = 0;

    righe.forEach((riga) => {
        const aConsumo = eRigaAConsumo(riga);
        const contatore = riga.lettura?.contatore;

        if (!contatore) {
            if (aConsumo) righeSenzaContatore += 1;
            return;
        }

        const chiave = String(contatore);
        const gia = fatturati.get(chiave) || { consumo: 0, centesimi: 0 };
        if (aConsumo) {
            gia.consumo += Number(riga.metri_cubi) || 0;
            gia.centesimi += toCents(riga.valore_unitario);
        }
        fatturati.set(chiave, gia);
    });

    const nuovi = await Contatore.find({ inizio: { $gte: inizio, $lt: dopo } }).select('seriale inizio').lean();
    const seriali = [...new Set(nuovi.map((c) => c.seriale).filter(Boolean))];
    const fratelli = await Contatore.find({ seriale: { $in: seriali } }).select('seriale scadenza').lean();
    const subentri = new Set(
        subentriDaDichiarare({ nuovi, fratelli, fatturati: new Set(fatturati.keys()) }).map((c) => String(c._id))
    );

    const contatori = await Contatore.find({ _id: { $in: [...fatturati.keys(), ...subentri] } })
        .populate(['cliente', 'edificio'])
        .lean();

    const utenze = contatori.map((contatore) => {
        const fatturato = fatturati.get(String(contatore._id));

        return {
            cliente: contatore.cliente,
            contatore,
            edificio: contatore.edificio,
            // Nuova e la riga di chi subentra: porta i dati catastali, la data di
            // inizio e i mesi che restano dell'anno.
            nuova: subentri.has(String(contatore._id)),
            consumo: fatturato?.consumo ?? 0,
            importoConsumi: fromCents(fatturato?.centesimi ?? 0),
        };
    });

    // In ordine di codice fiscale, poi di contatore: e l'ordine del file del
    // gestionale precedente, e rende due invii dello stesso anno confrontabili.
    const chiaveOrdine = (u) => `${identificativoFiscale(u.cliente)}|${String(u.contatore.codice ?? '').padStart(10, '0')}`;
    utenze.sort((a, b) => (chiaveOrdine(a) < chiaveOrdine(b) ? -1 : 1));

    return { utenze, righeSenzaContatore };
};

// Il file completo per un anno, intestazione e piede compresi.
const fileDellAnno = async (anno) => componiFile({
    ente: anagrafe,
    anno,
    utenze: (await datiDellAnno(anno)).utenze,
});

// Cosa contiene il file, senza produrlo: quante utenze, quante nuove, e le cose
// da guardare prima di mandarlo.
const riepilogoDellAnno = async (anno) => {
    const { utenze, righeSenzaContatore } = await datiDellAnno(anno);
    const subentri = utenze.filter((u) => u.nuova);

    return {
        anno,
        utenze: utenze.length,
        subentri: subentri.length,
        // Senza foglio e particella un subentro parte incompleto, ed e il dato che
        // va chiesto a chi firma il contratto.
        senzaCatasto: subentri.filter((u) => !u.edificio?.foglio || !(u.edificio?.particella ?? u.edificio?.ped)).length,
        senzaCodiceFiscale: utenze.filter((u) => !identificativoFiscale(u.cliente)).length,
        righeSenzaContatore,
    };
};

module.exports = {
    CAMPI,
    LUNGHEZZA_RIGA,
    componiRiga,
    eRigaAConsumo,
    fileDellAnno,
    intestazione,
    riepilogoDellAnno,
    rigaUtenza,
    subentriDaDichiarare,
};
