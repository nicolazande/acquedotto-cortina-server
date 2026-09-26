// I documenti che una consegna porta con se: il PDF della fattura, il file XML
// con il suo progressivo di invio, la stampa in blocco delle buste e l'archivio
// degli XML da trasmettere.
//
// Sta fuori dalla coda (`deliveryService.js`) perche e un'altra cosa: la coda
// decide cosa deve partire e ne tiene lo stato, qui si producono i file.
// Stampare e scaricare non chiudono nessuna consegna: si stampa, si controlla,
// e solo dopo una persona le dichiara evase. Lasciano pero un segno su quelle
// uscite (`stampata_il`, `scaricata_il`), cosi si possono segnare evase tutte
// insieme.

const Consegna = require('../models/Consegna');
const Fattura = require('../models/Fattura');
const { righeDelleFatture, righeDellaFattura } = require('./righeFattura');
const { FATTURA_IN_BOZZA } = require('./deliveryPlan');
const { isConfirmedInvoice } = require('../config/invoicing');
const { IN_UFFICIO, STATI_APERTI } = require('../config/delivery');
const { generateInvoicePdf, generateInvoicesPdf } = require('./invoicePdf');
const { buildInvoiceXml, nomeFileXml } = require('./invoiceXml');
const { riservaProgressiviInvio } = require('./counters');
const { badRequest, notFound, unprocessable } = require('../utils/errors');
const { parsePositiveInteger } = require('../utils/values');
const { creaZip } = require('../utils/zip');

// Ogni scrittura su una consegna vale solo finche e aperta: una chiusa mentre si
// preparavano i file non va toccata.
const APERTA = { stato: { $in: STATI_APERTI } };

// ---------------------------------------------------------------------------
// Allegati
// ---------------------------------------------------------------------------

const allegatoPdf = async (fatturaId) => {
    const { buffer, filename } = await generateInvoicePdf(fatturaId);
    return { nome: filename, contenuto: buffer, tipo: 'application/pdf' };
};

// La fattura di una consegna, con addosso quello che serve per scriverla: il
// cliente e la scadenza, che nel tracciato dice entro quando pagare.
const fatturaDellaConsegna = (consegna) => (
    Fattura.findById(consegna.fattura).populate('cliente scadenza').lean()
);

// Le fatture di piu consegne in una lettura sola, per id.
const fattureDelleConsegne = async (consegne) => {
    const trovate = await Fattura.find({ _id: { $in: consegne.map((consegna) => consegna.fattura) } })
        .populate('cliente scadenza')
        .lean();

    return new Map(trovate.map((fattura) => [String(fattura._id), fattura]));
};

// I file XML di una o piu consegne, ciascuno col suo progressivo di invio.
//
// Ogni file prende un progressivo nuovo, anche al secondo tentativo sulla stessa
// fattura: lo SdI rifiuta un nome che ha gia visto, e rispedire lo stesso nome
// vorrebbe dire non poter rispedire. Prima si costruiscono i documenti, poi si
// prendono i progressivi, tutti insieme e solo per quelli riusciti: uno rifiutato
// - un cliente estero, una bozza, un totale che non torna - non consuma un
// numero che lo SdI non vedra mai, e non ferma gli altri. Si salta solo un
// rifiuto previsto; un guasto vero si ferma.
//
// Uno scarico - l'archivio, il pulsante sulla riga - lascia sulla consegna il
// segno che il file e uscito (`scaricataIl`, preso prima di leggere i dati: una
// correzione salvata mentre si costruiva il file risulta piu recente, e la
// chiusura in blocco la vede). La trasmissione automatica no: di lei parla
// l'esito dell'invio.
const fileXml = async (voci, { scaricataIl } = {}) => {
    const riusciti = [];
    const saltate = [];

    voci.forEach(({ consegna, fattura, righe }) => {
        try {
            if (!isConfirmedInvoice(fattura)) {
                throw unprocessable(FATTURA_IN_BOZZA);
            }
            const { xml } = buildInvoiceXml({ cliente: fattura.cliente, fattura, scadenza: fattura.scadenza, servizi: righe });
            riusciti.push({ consegna, fattura, contenuto: Buffer.from(xml, 'utf8') });
        } catch (errore) {
            if (errore.status !== 422) {
                throw errore;
            }
            saltate.push({ consegna, documento: consegna.documento, motivo: errore.message });
        }
    });

    const progressivi = await riservaProgressiviInvio(riusciti.length);
    const file = riusciti.map(({ consegna, fattura, contenuto }, indice) => ({
        consegna,
        progressivo: progressivi[indice],
        nome: nomeFileXml(fattura, progressivi[indice]),
        contenuto,
    }));

    // Il file fatto toglie l'errore di un tentativo precedente - un cliente estero
    // poi corretto, una fattura allora in bozza - e il problema che Prepara aveva
    // visto: il tracciato fa lo stesso controllo sul destinatario, e se il file
    // c'e il problema non c'e piu. Il documento rifiutato si porta il motivo
    // sulla riga, e perde il segno di uno scarico di prima: quel file non
    // corrisponde piu ai dati di oggi.
    const scritture = [
        ...file.map(({ consegna, progressivo }) => ({
            updateOne: {
                filter: { _id: consegna._id, ...APERTA },
                update: {
                    $set: { progressivo, ...(scaricataIl ? { scaricata_il: scaricataIl } : {}) },
                    $unset: { ultimo_errore: '', problema: '' },
                },
            },
        })),
        ...saltate.map(({ consegna, motivo }) => ({
            updateOne: {
                filter: { _id: consegna._id, ...APERTA },
                update: { $set: { ultimo_errore: motivo }, $unset: { scaricata_il: '' } },
            },
        })),
    ];

    if (scritture.length) {
        await Consegna.bulkWrite(scritture, { ordered: false });
    }

    return { file, saltate };
};

// Il file di una consegna sola: quello da scaricare dalla sua riga, o da
// allegare alla PEC per lo SdI quando la trasmissione sara automatica.
const allegatoXml = async (consegna, fattura, opzioni) => {
    const righe = await righeDellaFattura(fattura._id);
    const { file: [fatto], saltate: [rifiutato] } = await fileXml([{ consegna, fattura, righe }], opzioni);

    if (rifiutato) {
        throw unprocessable(rifiutato.motivo);
    }

    return { nome: fatto.nome, contenuto: fatto.contenuto, tipo: 'application/xml' };
};

// ---------------------------------------------------------------------------
// Stampa e scarico in blocco
// ---------------------------------------------------------------------------

// Quante fatture entrano in una stampa: ognuna e una pagina da disegnare, e
// cinquecento in un colpo diventano un file enorme e una richiesta che scade.
const MAX_DA_STAMPARE = 200;

// Quanti file entrano in un archivio: pochi kilobyte l'uno, e una fatturazione
// intera - a novembre circa ottocento fatture elettroniche - esce in un colpo.
const MAX_XML_PER_ARCHIVIO = 1000;

const tetto = (limite, massimo) => Math.min(parsePositiveInteger(limite, massimo), massimo);

// Una copia con un problema scritto sulla riga - di solito manca l'indirizzo -
// non si stampa: tornerebbe in ogni blocco senza poter partire. Torna fra quelle
// da stampare quando il problema e sistemato e Prepara lo toglie.
const STAMPABILI = { ...IN_UFFICIO.daStampare, problema: null };
const BLOCCATE = { ...IN_UFFICIO.daStampare, problema: { $ne: null } };

// Le consegne nell'ordine in cui si preparano: alfabetico italiano, indifferente
// alle maiuscole. Senza, "ANNO 8919 srl" finisce prima di "Achenza" e le buste
// escono in un ordine che non e quello in cui si imbustano. A parita decide
// `_id`: due stampe dello stesso blocco devono prendere le stesse consegne.
const inOrdine = (filtro, limite) => Consegna.find(filtro)
    .sort({ intestatario: 1, createdAt: 1, _id: 1 })
    .collation({ locale: 'it', strength: 1 })
    .limit(limite)
    .lean();

// Un blocco di lavoro d'ufficio: prima quelle gia uscite e non ancora evase,
// poi le altre fino al tetto, ciascun gruppo nell'ordine delle buste. Cosi
// ripremendo esce lo stesso blocco anche se nel frattempo Prepara ha aggiunto
// fatture che vengono prima in ordine alfabetico, e nessuna di quelle che
// "Segna evase" chiudera resta fuori dall'ultimo file.
const blocco = async ({ daFare, uscite, limite }) => {
    const giaUscite = await inOrdine(uscite, limite);
    const posti = limite - giaUscite.length;

    if (posti <= 0) {
        return giaUscite;
    }

    return [...giaUscite, ...await inOrdine({ ...daFare, _id: { $nin: giaUscite.map((consegna) => consegna._id) } }, posti)];
};

// Le fatture da imbustare, in un unico PDF, un blocco per volta. La stampa non
// sposta niente: finche non vengono segnate evase, la successiva ripete le
// stesse, e cosi una stampa andata storta - la stampante inceppata, il PDF
// chiuso per sbaglio - si rifa premendo di nuovo. Segnate evase quelle
// stampate, la stampa passa alle prossime.
const stampaDaConsegnare = async ({ limite } = {}) => {
    // Il segno porta l'ora di prima di leggere i dati, come per l'XML.
    const stampataIl = new Date();
    const cartacee = await blocco({
        daFare: STAMPABILI,
        uscite: IN_UFFICIO.stampate,
        limite: tetto(limite, MAX_DA_STAMPARE),
    });

    // Una fattura riportata a bozza dopo essere entrata in coda non si stampa:
    // la sua riga resta, con il motivo, finche il Prepara successivo la chiude.
    const confermate = new Set(
        (await Fattura.find({ _id: { $in: cartacee.map((consegna) => consegna.fattura) } }, { stato: 1, confermata: 1 }).lean())
            .filter(isConfirmedInvoice)
            .map((fattura) => String(fattura._id))
    );
    const daStampare = cartacee.filter((consegna) => confermate.has(String(consegna.fattura)));
    const inBozza = cartacee.filter((consegna) => !confermate.has(String(consegna.fattura)));

    // E perde il segno di una stampa fatta quando era confermata: quella copia
    // non vale piu.
    if (inBozza.length) {
        await Consegna.updateMany(
            { _id: { $in: inBozza.map((consegna) => consegna._id) }, ...APERTA },
            { $set: { ultimo_errore: FATTURA_IN_BOZZA }, $unset: { stampata_il: '' } }
        );
    }

    // Quante restano fuori per un problema: si dicono, altrimenti "Stampa (N)"
    // non arriverebbe mai a zero senza spiegazione.
    const bloccate = await Consegna.countDocuments(BLOCCATE);

    if (daStampare.length === 0) {
        const motivi = [
            inBozza.length === 1 ? 'la fattura in coda è una bozza: va confermata prima di consegnarla.' : null,
            inBozza.length > 1 ? 'le fatture in coda sono bozze: vanno confermate prima di consegnarle.' : null,
            bloccate ? `${bloccate === 1 ? 'una copia ha' : `${bloccate} copie hanno`} un problema scritto sulla riga, `
                + 'di solito l’indirizzo che manca: si sistema nella scheda del cliente, poi Prepara.' : null,
        ].filter(Boolean);
        throw unprocessable(`Non c’è niente da stampare: ${motivi.length
            ? motivi.join(' Inoltre ')
            : 'la coda delle consegne cartacee è vuota.'}`);
    }

    // La stampa riuscita lascia il segno e toglie l'errore di un tentativo
    // precedente - la fattura allora in bozza e confermata di nuovo -, come il
    // file XML fatto.
    const ids = daStampare.map((consegna) => consegna._id);
    const documento = await generateInvoicesPdf(daStampare.map((consegna) => consegna.fattura));
    await Consegna.updateMany(
        { _id: { $in: ids }, ...APERTA },
        { $set: { stampata_il: stampataIl }, $unset: { ultimo_errore: '' } }
    );

    return {
        ...documento,
        consegne: ids,
        // Quante aspettano il loro turno dopo queste: senza dirlo, si crederebbe
        // di aver stampato tutto.
        rimaste: Math.max(0, await Consegna.countDocuments(STAMPABILI) - ids.length),
        bloccate,
    };
};

// I file XML delle fatture elettroniche da trasmettere, in un archivio: tutte
// quelle in coda, anche le gia scaricate, finche non vengono segnate evase. Se
// lo zip si perde lo si rifa; ogni file prende comunque un nome nuovo.
const xmlDaTrasmettere = async ({ limite } = {}) => {
    const scaricataIl = new Date();
    const daInviare = await blocco({
        daFare: IN_UFFICIO.daTrasmettere,
        uscite: IN_UFFICIO.scaricate,
        limite: tetto(limite, MAX_XML_PER_ARCHIVIO),
    });

    if (daInviare.length === 0) {
        throw unprocessable('Non c’è nessuna fattura elettronica in attesa di trasmissione.');
    }

    // Le fatture e le loro righe in due letture, non due per consegna.
    const fatture = await fattureDelleConsegne(daInviare);
    const righe = await righeDelleFatture([...fatture.keys()]);

    const senzaFattura = daInviare.filter((consegna) => !fatture.has(String(consegna.fattura)));
    const { file, saltate } = await fileXml(
        daInviare
            .filter((consegna) => fatture.has(String(consegna.fattura)))
            .map((consegna) => ({
                consegna,
                fattura: fatture.get(String(consegna.fattura)),
                righe: righe.get(String(consegna.fattura)) || [],
            })),
        { scaricataIl }
    );
    const fuori = [
        ...senzaFattura.map((consegna) => ({ documento: consegna.documento, motivo: 'la fattura non esiste piu' })),
        ...saltate.map(({ documento, motivo }) => ({ documento, motivo })),
    ];

    if (file.length === 0) {
        throw unprocessable(
            `Nessuna delle fatture in coda si puo emettere: ${fuori.map((voce) => `${voce.documento}, ${voce.motivo}`).join('; ')}`
        );
    }

    return {
        buffer: creaZip(file),
        filename: `fatture-elettroniche-${new Date().toISOString().slice(0, 10)}.zip`,
        quante: file.length,
        saltate: fuori,
        consegne: file.map(({ consegna }) => consegna._id),
        // Oltre il tetto dell'archivio: arrivano con quello successivo, dopo aver
        // segnato evase queste.
        rimaste: Math.max(0, await Consegna.countDocuments(IN_UFFICIO.daTrasmettere) - daInviare.length),
    };
};

// Il file di una singola consegna, per chi trasmette una fattura per volta:
// stesso contenuto e stesso nome che avrebbe dentro l'archivio, senza passare
// da uno zip da aprire e da rinominare.
const xmlDellaConsegna = async (consegnaId) => {
    const consegna = await Consegna.findById(consegnaId).lean();

    if (!consegna) {
        throw notFound('Consegna non trovata.');
    }

    if (consegna.tipo !== 'elettronica') {
        throw unprocessable('Questa consegna e una copia di cortesia, non una fattura elettronica.');
    }

    // Solo una consegna ancora da fare produce un file. Su una gia evasa un file
    // nuovo avrebbe un altro progressivo - non piu quello che lo SdI ha ricevuto
    // - e sarebbe una seconda copia valida di una fattura gia trasmessa.
    if (!STATI_APERTI.includes(consegna.stato)) {
        throw badRequest(consegna.stato === 'inviata'
            ? 'Questa fattura elettronica e gia stata trasmessa: il file e quello gia inviato, e non se ne produce un secondo.'
            : 'Questa consegna e annullata: rimettila in coda per produrre il file.');
    }

    const scaricataIl = new Date();
    const fattura = await fatturaDellaConsegna(consegna);
    if (!fattura) {
        throw unprocessable('La fattura di questa consegna non esiste piu.');
    }

    const allegato = await allegatoXml(consegna, fattura, { scaricataIl });

    return { filename: allegato.nome, contenuto: allegato.contenuto };
};

module.exports = {
    allegatoPdf,
    allegatoXml,
    fatturaDellaConsegna,
    stampaDaConsegnare,
    xmlDaTrasmettere,
    xmlDellaConsegna,
};
