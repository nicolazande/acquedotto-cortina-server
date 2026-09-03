// La coda delle consegne: dal piano al recapito, e ritorno.
//
// Tre operazioni, in quest'ordine:
//
//   1. PIANIFICA  - guarda le fatture confermate e crea le consegne mancanti,
//                   una per canale, con il recapito ricavato dall'anagrafica;
//   2. ELABORA    - percorre la coda e recapita quelle automatiche;
//   3. REGISTRA   - segna il risultato sulla consegna e la data sulla fattura.
//
// I canali non automatici (posta, sportello) restano in coda: sono l'elenco di
// cosa stampare, e si chiudono quando una persona dichiara di averlo fatto.

const Cliente = require('../models/Cliente');
const Consegna = require('../models/Consegna');
const Fattura = require('../models/Fattura');
const { righeDellaFattura } = require('./righeFattura');
const { CANALE_TRASMISSIONE_SDI, testoEmailCortesia } = require('../config/delivery');
const { pianoConsegne } = require('./deliveryPlan');
const { generateInvoicePdf, generateInvoicesPdf } = require('./invoicePdf');
const { buildInvoiceXml } = require('./invoiceXml');
const { riservaProgressivoInvio } = require('./counters');
const { inviaEmail, statoTrasporto } = require('./mailer');
const { badRequest, notFound, unprocessable } = require('../utils/errors');
const { formatItalianDate } = require('../utils/dates');
const { parsePositiveInteger } = require('../utils/values');
const { creaZip } = require('../utils/zip');

// Tetto alle fatture toccate da una sola richiesta: la pianificazione legge
// anagrafiche e la elaborazione costruisce PDF, quindi il costo per documento
// non e trascurabile.
const MAX_FATTURE_PER_LOTTO = 500;
const MAX_CONSEGNE_PER_ELABORAZIONE = 200;

// Stati su cui si puo ancora intervenire. Una consegna gia inviata non viene
// mai riscritta da una nuova pianificazione: sarebbe riscrivere la storia.
const STATI_APERTI = ['in_coda', 'errore'];

const mittente = () => ({
    nome: process.env.INVOICE_COMPANY_NAME || 'Cooperativa di Gestione Acquedotto Zuel di Sopra',
    recapito: process.env.INVOICE_COMPANY_EMAIL || '',
});

const chiave = (fatturaId, tipo) => `${fatturaId}:${tipo}`;

// ---------------------------------------------------------------------------
// Pianificazione
// ---------------------------------------------------------------------------

const caricaFatture = async ({ fatture, anno, limite }) => {
    const filtro = { stato: 'confermata' };

    if (Array.isArray(fatture) && fatture.length) {
        filtro._id = { $in: fatture };
    } else if (anno) {
        filtro.anno = Number(anno);
    }

    return Fattura.find(filtro)
        .populate('cliente')
        .populate('scadenza')
        .sort({ data_fattura: -1 })
        .limit(Math.min(parsePositiveInteger(limite, MAX_FATTURE_PER_LOTTO), MAX_FATTURE_PER_LOTTO))
        .lean();
};

// Il documento da salvare sulla consegna. Tenere qui l'etichetta e il nome del
// cliente evita di ripopolare due relazioni ogni volta che si guarda la coda.
const documentoConsegna = (piano, consegna) => ({
    fattura: piano.fattura,
    cliente: piano.cliente,
    tipo: consegna.tipo,
    canale: consegna.canale,
    destinatario: consegna.destinatario,
    documento: piano.documento,
    intestatario: piano.intestatario,
    automatica: consegna.automatico,
    stato: 'in_coda',
    ultimo_errore: consegna.problema || undefined,
    note: consegna.nota || undefined,
});

const pianificaConsegne = async ({ fatture, anno, limite } = {}) => {
    const documenti = await caricaFatture({ fatture, anno, limite });

    if (!documenti.length) {
        return { esaminate: 0, create: 0, aggiornate: 0, annullate: 0, saltate: 0, problemi: [] };
    }

    const esistenti = await Consegna.find({ fattura: { $in: documenti.map((f) => f._id) } }).lean();
    const perChiave = new Map(esistenti.map((c) => [chiave(c.fattura, c.tipo), c]));

    const operazioni = [];
    const problemi = [];
    let create = 0;
    let aggiornate = 0;
    let annullate = 0;
    let saltate = 0;

    documenti.forEach((fattura) => {
        const piano = pianoConsegne({ cliente: fattura.cliente, fattura });

        piano.ostacoli.forEach((ostacolo) => problemi.push({
            fattura: fattura._id,
            documento: piano.documento,
            messaggio: ostacolo,
        }));

        const previste = new Set(piano.consegne.map((consegna) => consegna.tipo));

        piano.consegne.forEach((consegna) => {
            const esistente = perChiave.get(chiave(fattura._id, consegna.tipo));

            if (!esistente) {
                operazioni.push({ insertOne: { document: documentoConsegna(piano, consegna) } });
                create += 1;
                return;
            }

            if (!STATI_APERTI.includes(esistente.stato)) {
                saltate += 1;
                return;
            }

            operazioni.push({
                updateOne: {
                    filter: { _id: esistente._id },
                    update: { $set: documentoConsegna(piano, consegna) },
                },
            });
            aggiornate += 1;
        });

        // Una consegna che il piano non prevede piu (il cliente e passato a
        // "nessuna copia", oppure ha perso il recapito) non va lasciata in coda
        // a far numero: viene chiusa dichiarando il motivo.
        esistenti
            .filter((c) => String(c.fattura) === String(fattura._id))
            .filter((c) => STATI_APERTI.includes(c.stato) && !previste.has(c.tipo))
            .forEach((c) => {
                operazioni.push({
                    updateOne: {
                        filter: { _id: c._id },
                        update: { $set: { stato: 'annullata', note: 'Non più prevista dal piano di consegna.' } },
                    },
                });
                annullate += 1;
            });
    });

    if (operazioni.length) {
        await Consegna.bulkWrite(operazioni, { ordered: false });
    }

    return { esaminate: documenti.length, create, aggiornate, annullate, saltate, problemi };
};

// Anteprima non persistente: cosa succederebbe a questa fattura.
const anteprimaFattura = async (fatturaId) => {
    const fattura = await Fattura.findById(fatturaId).populate('cliente').populate('scadenza').lean();

    if (!fattura) {
        throw notFound('Fattura non trovata.');
    }

    const piano = pianoConsegne({ cliente: fattura.cliente, fattura });
    const registrate = await Consegna.find({ fattura: fattura._id }).sort({ tipo: 1 }).lean();

    return { ...piano, registrate, trasporto: statoTrasporto() };
};

// ---------------------------------------------------------------------------
// Allegati
// ---------------------------------------------------------------------------

const allegatoPdf = async (fatturaId) => {
    const { buffer, filename } = await generateInvoicePdf(fatturaId);
    return { nome: filename, contenuto: buffer, tipo: 'application/pdf' };
};

// Ogni trasmissione si prende un progressivo nuovo, anche quando e un secondo
// tentativo sulla stessa fattura: lo SdI rifiuta un file il cui nome ha gia
// visto, quindi rispedire lo stesso nome vorrebbe dire non poter rispedire.
const allegatoXml = async (consegna, fattura) => {
    const servizi = await righeDellaFattura(fattura._id);
    const progressivo = await riservaProgressivoInvio();
    const { filename, xml } = buildInvoiceXml({ cliente: fattura.cliente, fattura, progressivo, servizi });

    await Consegna.updateOne({ _id: consegna._id }, { $set: { progressivo } });

    return { nome: filename, contenuto: Buffer.from(xml, 'utf8'), tipo: 'application/xml' };
};

// ---------------------------------------------------------------------------
// Trasporti
// ---------------------------------------------------------------------------

// La copia di cortesia: il PDF allegato a un messaggio, per email o per PEC.
const consegnaCortesiaEmail = async ({ consegna, fattura }) => {
    const { oggetto, testo } = testoEmailCortesia({
        cliente: consegna.intestatario || 'cliente',
        documento: consegna.documento,
        scadenza: formatItalianDate(fattura.scadenza?.scadenza),
        mittente: mittente(),
    });

    const allegato = await allegatoPdf(fattura._id);
    const esito = await inviaEmail({ a: consegna.destinatario, oggetto, testo, allegati: [allegato] });

    return { ...esito, allegati: [allegato.nome] };
};

// La fattura elettronica verso il Sistema di Interscambio.
//
// Oggi l'inoltro passa da un intermediario e questa funzione non viene mai
// chiamata: le consegne elettroniche restano in coda come promemoria. Quando
// l'acquedotto avra un canale proprio bastera valorizzare
// CANALE_TRASMISSIONE_SDI: il resto della catena e gia al suo posto.
const SDI_PEC = process.env.SDI_PEC_DESTINATARIO || 'sdi01@pec.fatturapa.it';

const trasmettiFatturaElettronica = async ({ consegna, fattura }) => {
    if (CANALE_TRASMISSIONE_SDI !== 'pec') {
        throw unprocessable(
            'La trasmissione allo SdI non è automatica: scarica il file XML e inoltralo, '
            + 'oppure configura CANALE_TRASMISSIONE_SDI.'
        );
    }

    const allegato = await allegatoXml(consegna, fattura);
    const esito = await inviaEmail({
        a: SDI_PEC,
        oggetto: `Invio fattura ${consegna.documento}`,
        testo: `In allegato il file ${allegato.nome}.`,
        allegati: [allegato],
    });

    return { ...esito, allegati: [allegato.nome] };
};

const TRASPORTI = {
    'cortesia:email': consegnaCortesiaEmail,
    'cortesia:pec': consegnaCortesiaEmail,
    'elettronica:sdi': trasmettiFatturaElettronica,
    'elettronica:pec': trasmettiFatturaElettronica,
    'elettronica:cassetto': trasmettiFatturaElettronica,
};

const trasportoPer = (consegna) => TRASPORTI[`${consegna.tipo}:${consegna.canale}`];

// ---------------------------------------------------------------------------
// Elaborazione della coda
// ---------------------------------------------------------------------------

// La data che il gestionale precedente teneva sulla fattura. Continua a essere
// popolata: chi guarda la fattura vede subito quando e uscita, senza aprire
// l'elenco delle consegne.
const CAMPO_DATA_FATTURA = {
    cortesia: 'data_invio_fattura',
    elettronica: 'data_fattura_elettronica',
};

const registraEsito = async ({ consegna, esito, quando }) => {
    await Consegna.updateOne({ _id: consegna._id }, {
        $set: {
            stato: 'inviata',
            data_invio: quando,
            destinatario: esito.destinatario || consegna.destinatario,
            riferimento: esito.riferimento || undefined,
            simulata: Boolean(esito.simulata),
            allegati: esito.allegati || [],
            note: esito.motivo || undefined,
            ultimo_errore: undefined,
        },
        $inc: { tentativi: 1 },
    });

    // Una consegna simulata non e uscita: la data sulla fattura direbbe il falso.
    if (!esito.simulata) {
        await Fattura.updateOne(
            { _id: consegna.fattura },
            { $set: { [CAMPO_DATA_FATTURA[consegna.tipo]]: quando } }
        );
    }
};

const registraErrore = async ({ consegna, errore }) => {
    await Consegna.updateOne({ _id: consegna._id }, {
        $set: { stato: 'errore', ultimo_errore: errore.message },
        $inc: { tentativi: 1 },
    });
};

const elaboraCoda = async ({ limite, tipo, fatture } = {}) => {
    const filtro = {
        stato: { $in: STATI_APERTI },
        automatica: true,
        ...(tipo ? { tipo } : {}),
        ...(Array.isArray(fatture) && fatture.length ? { fattura: { $in: fatture } } : {}),
    };

    const daFare = await Consegna.find(filtro)
        .sort({ createdAt: 1 })
        .limit(Math.min(parsePositiveInteger(limite, 50), MAX_CONSEGNE_PER_ELABORAZIONE))
        .lean();

    const esiti = [];
    let inviate = 0;
    let simulate = 0;
    let errori = 0;

    for (const consegna of daFare) {
        const trasporto = trasportoPer(consegna);

        try {
            if (!trasporto) {
                throw unprocessable(`Nessun trasporto per ${consegna.tipo} su ${consegna.canale}.`);
            }

            const fattura = await Fattura.findById(consegna.fattura)
                .populate('cliente')
                .populate('scadenza')
                .lean();

            if (!fattura) {
                throw notFound('Fattura non trovata.');
            }

            const esito = await trasporto({ consegna, fattura });
            await registraEsito({ consegna, esito, quando: new Date() });

            if (esito.simulata) simulate += 1; else inviate += 1;
            esiti.push({
                consegna: consegna._id,
                documento: consegna.documento,
                destinatario: esito.destinatario,
                stato: esito.simulata ? 'simulata' : 'inviata',
                motivo: esito.motivo || null,
            });
        } catch (errore) {
            await registraErrore({ consegna, errore });
            errori += 1;
            esiti.push({
                consegna: consegna._id,
                documento: consegna.documento,
                destinatario: consegna.destinatario,
                stato: 'errore',
                motivo: errore.message,
            });
        }
    }

    return { elaborate: daFare.length, inviate, simulate, errori, esiti, trasporto: statoTrasporto() };
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
    const daStampare = await consegneInCoda({ canali: ['postale', 'sportello'], limite });

    if (daStampare.length === 0) {
        throw unprocessable('Non c’è niente da stampare: la coda delle consegne cartacee è vuota.');
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
    for (const consegna of daInviare) {
        const fattura = await Fattura.findById(consegna.fattura).populate('cliente').lean();
        if (!fattura) {
            continue;
        }

        const servizi = await righeDellaFattura(fattura._id);
        const progressivo = await riservaProgressivoInvio();
        const { filename, xml } = buildInvoiceXml({ cliente: fattura.cliente, fattura, progressivo, servizi });
        await Consegna.updateOne({ _id: consegna._id }, { $set: { progressivo } });
        file.push({ nome: filename, contenuto: xml });
    }

    return {
        buffer: creaZip(file),
        filename: `fatture-elettroniche-${new Date().toISOString().slice(0, 10)}.zip`,
        quante: file.length,
        consegne: daInviare.map((consegna) => consegna._id),
    };
};

// ---------------------------------------------------------------------------
// Azioni sulla singola consegna
// ---------------------------------------------------------------------------

const caricaConsegna = async (id) => {
    const consegna = await Consegna.findById(id).lean();

    if (!consegna) {
        throw notFound('Consegna non trovata.');
    }

    return consegna;
};

// Chiude a mano una consegna che una persona ha evaso: la busta imbucata, la
// fattura ritirata allo sportello, il file caricato sul portale.
const segnaConsegnata = async (id, { note } = {}) => {
    const consegna = await caricaConsegna(id);

    if (consegna.stato === 'inviata') {
        throw badRequest('La consegna risulta già evasa.');
    }

    const quando = new Date();
    await Consegna.updateOne({ _id: consegna._id }, {
        $set: { stato: 'inviata', data_invio: quando, simulata: false, note: note || consegna.note, ultimo_errore: undefined },
        $inc: { tentativi: 1 },
    });
    await Fattura.updateOne(
        { _id: consegna.fattura },
        { $set: { [CAMPO_DATA_FATTURA[consegna.tipo]]: quando } }
    );

    return Consegna.findById(consegna._id).lean();
};

const annullaConsegna = async (id, { note } = {}) => {
    const consegna = await caricaConsegna(id);
    await Consegna.updateOne({ _id: consegna._id }, {
        $set: { stato: 'annullata', note: note || 'Annullata manualmente.' },
    });

    return Consegna.findById(consegna._id).lean();
};

// Rimette in coda una consegna fallita, azzerandone l'errore.
const rimettiInCoda = async (id) => {
    const consegna = await caricaConsegna(id);

    if (consegna.stato === 'inviata') {
        throw badRequest('Una consegna già evasa non si rimette in coda.');
    }

    await Consegna.updateOne({ _id: consegna._id }, {
        $set: { stato: 'in_coda' },
        $unset: { ultimo_errore: '' },
    });

    return Consegna.findById(consegna._id).lean();
};

// ---------------------------------------------------------------------------
// Riepilogo
// ---------------------------------------------------------------------------

const contaPer = (righe, campo) => righe.reduce((totali, riga) => ({
    ...totali,
    [riga._id[campo]]: (totali[riga._id[campo]] || 0) + riga.quante,
}), {});

const riepilogo = async () => {
    const [righe, clientiPerModalita, elettroniche] = await Promise.all([
        Consegna.aggregate([
            { $group: { _id: { stato: '$stato', tipo: '$tipo', canale: '$canale' }, quante: { $sum: 1 } } },
        ]),
        Cliente.aggregate([
            { $group: { _id: { $ifNull: ['$stampa_cortesia', 'non impostata'] }, quante: { $sum: 1 } } },
            { $sort: { quante: -1 } },
        ]),
        Cliente.countDocuments({ fattura_elettronica: true }),
    ]);

    const inCoda = righe.filter((riga) => riga._id.stato === 'in_coda');

    return {
        perStato: contaPer(righe, 'stato'),
        perTipo: contaPer(inCoda, 'tipo'),
        perCanale: contaPer(inCoda, 'canale'),
        daStampare: inCoda
            .filter((riga) => ['postale', 'sportello'].includes(riga._id.canale))
            .reduce((totale, riga) => totale + riga.quante, 0),
        clienti: {
            perModalita: clientiPerModalita.map((riga) => ({ modalita: riga._id, quanti: riga.quante })),
            conFatturaElettronica: elettroniche,
        },
        trasporto: statoTrasporto(),
        canaleSdi: CANALE_TRASMISSIONE_SDI,
    };
};

module.exports = {
    annullaConsegna,
    anteprimaFattura,
    elaboraCoda,
    pianificaConsegne,
    riepilogo,
    rimettiInCoda,
    segnaConsegnata,
    stampaDaConsegnare,
    xmlDaTrasmettere,
};
