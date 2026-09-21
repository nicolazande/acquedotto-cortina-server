// I documenti che una consegna porta con se: il PDF della fattura, il file XML
// con il suo progressivo di invio, la stampa in blocco delle buste e l'archivio
// degli XML da trasmettere.
//
// Sta fuori dalla coda (`deliveryService.js`) perche e un'altra cosa: la coda
// decide cosa deve partire e ne tiene lo stato, qui si producono i file. Lo
// scarico non cambia lo stato di nessuna consegna: si stampa, si controlla, e
// solo dopo una persona le dichiara evase.

const Consegna = require('../models/Consegna');
const Fattura = require('../models/Fattura');
const { righeDellaFattura } = require('./righeFattura');
const { FATTURA_IN_BOZZA, fatturaConfermata } = require('./deliveryPlan');
const { STATI_APERTI } = require('../config/delivery');
const { generateInvoicePdf, generateInvoicesPdf } = require('./invoicePdf');
const { buildInvoiceXml } = require('./invoiceXml');
const { riservaProgressivoInvio } = require('./counters');
const { badRequest, notFound, unprocessable } = require('../utils/errors');
const { parsePositiveInteger } = require('../utils/values');
const { creaZip } = require('../utils/zip');

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

// Ogni trasmissione si prende un progressivo nuovo, anche quando e un secondo
// tentativo sulla stessa fattura: lo SdI rifiuta un file il cui nome ha gia
// visto, quindi rispedire lo stesso nome vorrebbe dire non poter rispedire.
const allegatoXml = async (consegna, fattura) => {
    if (!fatturaConfermata(fattura)) {
        throw unprocessable(FATTURA_IN_BOZZA);
    }

    const servizi = await righeDellaFattura(fattura._id);
    const dati = { cliente: fattura.cliente, fattura, scadenza: fattura.scadenza, servizi };

    // Prima si controlla che il file si possa fare, poi si prende il progressivo.
    // Un documento rifiutato - un cliente estero, un totale che non torna - non
    // deve consumare un numero che lo SdI non vedra mai.
    buildInvoiceXml(dati);
    const progressivo = await riservaProgressivoInvio();
    const { filename, xml } = buildInvoiceXml({ ...dati, progressivo });

    // Il file si e fatto: un errore scritto da un tentativo precedente - un
    // cliente estero poi corretto, una fattura allora in bozza - non vale piu.
    await Consegna.updateOne({ _id: consegna._id }, { $set: { progressivo }, $unset: { ultimo_errore: '' } });

    return { nome: filename, contenuto: Buffer.from(xml, 'utf8'), tipo: 'application/xml' };
};

// ---------------------------------------------------------------------------
// Stampa e scarico in blocco
// ---------------------------------------------------------------------------

// Quante consegne si possono materializzare in una sola richiesta. Ogni fattura
// significa leggere il documento, le sue righe e disegnarne una pagina: senza un
// tetto, cinquecento in un colpo diventano un file enorme e una richiesta che
// scade.
const MAX_DA_STAMPARE = 200;

const consegneInCoda = async ({ canali, tipo, limite }) => Consegna.find({
    stato: { $in: STATI_APERTI },
    ...(canali ? { canale: { $in: canali } } : {}),
    ...(tipo ? { tipo } : {}),
})
    .sort({ intestatario: 1, createdAt: 1 })
    // Ordine alfabetico italiano, indifferente alle maiuscole: senza, "ANNO
    // 8919 srl" finisce prima di "Achenza" e le buste escono in un ordine che
    // non e quello in cui si imbustano.
    .collation({ locale: 'it', strength: 1 })
    .limit(Math.min(parsePositiveInteger(limite, MAX_DA_STAMPARE), MAX_DA_STAMPARE))
    .lean();

// Le fatture da imbustare, in un unico PDF ordinato per intestatario: e
// l'ordine in cui si preparano le buste.
const stampaDaConsegnare = async ({ limite } = {}) => {
    const cartacee = await consegneInCoda({ canali: ['postale', 'sportello'], limite });

    // Una fattura riportata a bozza dopo essere entrata in coda non si stampa:
    // la sua riga resta, con il motivo, finche il Prepara successivo la chiude.
    const confermate = new Set(
        (await Fattura.find({ _id: { $in: cartacee.map((consegna) => consegna.fattura) } }, { stato: 1, confermata: 1 }).lean())
            .filter(fatturaConfermata)
            .map((fattura) => String(fattura._id))
    );
    const daStampare = cartacee.filter((consegna) => confermate.has(String(consegna.fattura)));
    const inBozza = cartacee.filter((consegna) => !confermate.has(String(consegna.fattura)));

    if (inBozza.length) {
        await Consegna.updateMany({ _id: { $in: inBozza.map((consegna) => consegna._id) } }, { $set: { ultimo_errore: FATTURA_IN_BOZZA } });
    }
    // E una fattura confermata di nuovo perde il segno che una stampa precedente
    // le aveva lasciato: anche quelle chieste dalla scheda di una fattura del
    // vecchio programma, che il Prepara generale non aggiorna.
    await Consegna.updateMany(
        { _id: { $in: daStampare.map((consegna) => consegna._id) }, ultimo_errore: FATTURA_IN_BOZZA },
        { $unset: { ultimo_errore: '' } }
    );

    if (daStampare.length === 0) {
        const bozze = inBozza.length === 1
            ? 'la fattura in coda è una bozza: va confermata prima di consegnarla.'
            : 'le fatture in coda sono bozze: vanno confermate prima di consegnarle.';
        throw unprocessable(`Non c’è niente da stampare: ${inBozza.length ? bozze : 'la coda delle consegne cartacee è vuota.'}`);
    }

    const inCoda = await Consegna.countDocuments({
        stato: { $in: STATI_APERTI },
        canale: { $in: ['postale', 'sportello'] },
    });
    const documento = await generateInvoicesPdf(daStampare.map((consegna) => consegna.fattura));

    return {
        ...documento,
        consegne: daStampare.map((consegna) => consegna._id),
        // Quante restano fuori da questa stampa: senza dirlo, si crederebbe di
        // aver stampato tutto.
        rimaste: Math.max(0, inCoda - daStampare.length),
    };
};

// I file XML delle fatture elettroniche ancora da trasmettere, in un archivio.
const xmlDaTrasmettere = async ({ limite } = {}) => {
    const daInviare = await consegneInCoda({ tipo: 'elettronica', limite });

    if (daInviare.length === 0) {
        throw unprocessable('Non c’è nessuna fattura elettronica in attesa di trasmissione.');
    }

    const file = [];
    const incluse = [];
    const saltate = [];
    for (const consegna of daInviare) {
        const fattura = await fatturaDellaConsegna(consegna);
        if (!fattura) {
            saltate.push({ documento: consegna.documento, motivo: 'la fattura non esiste piu' });
            continue;
        }

        try {
            const allegato = await allegatoXml(consegna, fattura);
            file.push({ nome: allegato.nome, contenuto: allegato.contenuto });
            incluse.push(consegna._id);
        } catch (errore) {
            // Un documento che non si puo emettere non ferma gli altri: resta in
            // coda con il motivo scritto sulla riga, e l'archivio esce con quelli
            // buoni. Solo un rifiuto previsto si salta; un guasto vero si ferma.
            if (errore.status !== 422) {
                throw errore;
            }
            saltate.push({ documento: consegna.documento, motivo: errore.message });
            await Consegna.updateOne({ _id: consegna._id }, { $set: { ultimo_errore: errore.message } });
        }
    }

    if (file.length === 0) {
        throw unprocessable(
            `Nessuna delle fatture in coda si puo emettere: ${saltate.map((s) => `${s.documento}, ${s.motivo}`).join('; ')}`
        );
    }

    return {
        buffer: creaZip(file),
        filename: `fatture-elettroniche-${new Date().toISOString().slice(0, 10)}.zip`,
        quante: file.length,
        saltate,
        consegne: incluse,
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

    const fattura = await fatturaDellaConsegna(consegna);
    if (!fattura) {
        throw unprocessable('La fattura di questa consegna non esiste piu.');
    }

    const allegato = await allegatoXml(consegna, fattura);

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
