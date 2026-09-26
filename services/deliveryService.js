// La coda delle consegne: dal piano al recapito, e ritorno.
//
// Tre operazioni, in quest'ordine:
//
//   1. PIANIFICA  - crea le consegne mancanti, una per canale, con il recapito
//                   ricavato dall'anagrafica, e tiene la coda in pari con il
//                   piano: chiude quelle non piu previste, riapre quelle che il
//                   piano aveva chiuso e torna a prevedere (deliveryPlan.js);
//   2. ELABORA    - percorre la coda e recapita quelle automatiche;
//   3. REGISTRA   - segna il risultato sulla consegna e, se e arrivata al
//                   cliente, la data sulla fattura. Una prova lascia la
//                   consegna in coda.
//
// I canali non automatici (posta, sportello) restano in coda: sono l'elenco di
// cosa stampare, e si chiudono quando una persona dichiara di averlo fatto, una
// per una o tutte quelle gia stampate insieme. Evasa per sbaglio, una consegna
// torna da fare; una partita dal gestionale no, perche una mail non si ritira.

const Cliente = require('../models/Cliente');
const Consegna = require('../models/Consegna');
const Fattura = require('../models/Fattura');
const {
    CAMPO_DATA_CONSEGNA,
    CANALE_TRASMISSIONE_SDI,
    EVASE_IN_BLOCCO,
    IN_UFFICIO,
    STATI_APERTI,
    testoEmailCortesia,
} = require('../config/delivery');
const { AZIENDA } = require('../config/azienda');
const { FILTRO_EMESSE_DAL_GESTIONALE, isConfirmedInvoice } = require('../config/invoicing');
const { allegatoPdf, allegatoXml, fatturaDellaConsegna } = require('./documentiConsegna');
const { FATTURA_IN_BOZZA, aggiornamentoCoda, chiudibiliInBlocco, chiusura, pianoConsegne } = require('./deliveryPlan');
const { inviaEmail, statoTrasporto } = require('./mailer');
const { badRequest, notFound, unprocessable } = require('../utils/errors');
const { formatItalianDate } = require('../utils/dates');
const { setOrUnset } = require('../utils/mongo');
const { parsePositiveInteger } = require('../utils/values');

// Tetto a un elenco esplicito di fatture: la scheda di una fattura ne chiede
// una, e un elenco senza limite sarebbe una richiesta di dimensione arbitraria.
const MAX_FATTURE_PER_RICHIESTA = 500;
// L'elaborazione costruisce un PDF per consegna: si procede a scaglioni.
const MAX_CONSEGNE_PER_ELABORAZIONE = 200;

// Le date che la coda scrive sulla fattura - quando e uscita, quando ne ha deciso
// i canali - non sono modifiche del documento, e non toccano `updatedAt`: quello
// dice quando la fattura e cambiata l'ultima volta, ed e cio che la chiusura in
// blocco confronta con la stampa (`chiudibiliInBlocco`). Altrimenti chiudere la
// fattura elettronica farebbe sembrare cambiata la copia gia stampata.
const SENZA_TOCCARE_IL_DOCUMENTO = { timestamps: false };

// Chi firma il messaggio di cortesia: lo stesso profilo delle fatture.
const mittente = () => ({
    nome: AZIENDA.denominazione,
    recapito: AZIENDA.contatti.email,
});

// ---------------------------------------------------------------------------
// Pianificazione
// ---------------------------------------------------------------------------

// Le fatture che guarda "Prepara".
//
// Dalla scheda di una fattura: quelle chieste, di qualunque provenienza.
// Dalla pagina Consegne: tutte le confermate emesse dal gestionale, piu quelle -
// di qualunque provenienza e in qualunque stato - che hanno una consegna da
// rimettere in pari, perche la coda resti vera: una fattura riportata a bozza
// deve vedersi chiudere le sue, una riconfermata riaverle. Cosa toccare lo
// decide `aggiornamentoCoda`: di una fattura del vecchio programma guarda solo
// le righe chieste dalla sua scheda. Prima guardava le 500 fatture piu recenti,
// storico compreso: una fatturazione ne fa circa 670 con la stessa data, e le
// altre restavano fuori per sempre, anche ripremendo.
const fattureDaGuardare = async (richieste) => {
    if (richieste) {
        return Fattura.find({ _id: { $in: richieste.slice(0, MAX_FATTURE_PER_RICHIESTA) } })
            .populate('cliente')
            .lean();
    }

    // Le fatture con una consegna da rimettere in pari: una aperta, oppure una
    // chiesta dalla scheda e chiusa dal piano, che il piano deve poter riaprire.
    const daRimettereInPari = await Consegna.distinct('fattura', {
        $or: [
            { stato: { $in: STATI_APERTI } },
            { stato: 'annullata', chiusa_dal_piano: true, su_richiesta: true },
        ],
    });

    return Fattura.find({
        $or: [
            { stato: 'confermata', ...FILTRO_EMESSE_DAL_GESTIONALE },
            { _id: { $in: daRimettereInPari } },
        ],
    })
        .populate('cliente')
        .lean();
};

const pianificaConsegne = async ({ fatture } = {}) => {
    const richieste = Array.isArray(fatture) && fatture.length ? fatture : null;
    const documenti = await fattureDaGuardare(richieste);
    const esistenti = documenti.length
        ? await Consegna.find({ fattura: { $in: documenti.map((fattura) => fattura._id) } }).lean()
        : [];

    const { operazioni, decise, ...esito } = aggiornamentoCoda({
        fatture: documenti,
        esistenti,
        suRichiesta: Boolean(richieste),
    });

    if (operazioni.length) {
        await Consegna.bulkWrite(operazioni, { ordered: false });
    }

    // Il segno sulle fatture appena decise: da qui in avanti la coda tiene in
    // pari le loro consegne senza aggiungerne di nuove.
    if (decise.length) {
        await Fattura.updateMany(
            { _id: { $in: decise } },
            { $set: { consegne_decise_il: new Date() } },
            SENZA_TOCCARE_IL_DOCUMENTO
        );
    }

    return { esaminate: documenti.length, ...esito };
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

// Consegne arrivate al cliente: recapitate dal gestionale, o evase da una
// persona, una per volta o tutte quelle gia stampate o scaricate insieme. L'esito di una
// prova precedente, un errore gia superato, un problema del piano, il motivo di
// un annullamento: niente di questo descrive piu una consegna arrivata.
//
// Ciascuna si chiude solo se e ancora nello stato che chi la chiude si aspetta
// (`ancora`): cio che nel frattempo qualcun altro ha cambiato non si tocca. La
// data che il gestionale precedente teneva sulla fattura continua a essere
// popolata (`CAMPO_DATA_CONSEGNA`), per le consegne chiuse adesso: chi guarda la
// fattura vede subito quando e uscita, senza aprire l'elenco delle consegne.
const chiudiComeInviate = async ({ consegne, ancora, quando, campi = {} }) => {
    if (!consegne.length) {
        return 0;
    }

    const ids = consegne.map((consegna) => consegna._id);

    await Consegna.updateMany({ _id: { $in: ids }, ...ancora }, {
        ...setOrUnset({
            stato: 'inviata',
            data_invio: quando,
            note: null,
            problema: null,
            ultimo_errore: null,
            ultimo_tentativo: null,
            chiusa_dal_piano: null,
            ...campi,
        }),
        $inc: { tentativi: 1 },
    });

    // Quelle chiuse adesso le riconosce la data appena scritta.
    const chiuse = await Consegna.find({ _id: { $in: ids }, stato: 'inviata', data_invio: quando }, { fattura: 1, tipo: 1 }).lean();

    await Promise.all(Object.entries(Object.groupBy(chiuse, (consegna) => consegna.tipo)).map(([tipo, sue]) => (
        Fattura.updateMany(
            { _id: { $in: sue.map((consegna) => consegna.fattura) } },
            { $set: { [CAMPO_DATA_CONSEGNA[tipo]]: quando } },
            SENZA_TOCCARE_IL_DOCUMENTO
        )
    )));

    return chiuse.length;
};

// Una mail partita e un fatto: si registra anche se nel frattempo qualcuno ha
// annullato la consegna, o l'ha segnata evasa a mano - resterebbe da rimettere
// da fare, e ripartirebbe una seconda volta. Solo una gia registrata come
// partita non si chiude due volte.
const registraEsito = ({ consegna, esito, quando }) => chiudiComeInviate({
    consegne: [consegna],
    ancora: { $or: [{ stato: { $ne: 'inviata' } }, { evasa_a_mano: true }] },
    quando,
    campi: {
        destinatario: esito.destinatario || consegna.destinatario,
        riferimento: esito.riferimento,
        allegati: esito.allegati || [],
        evasa_a_mano: null,
    },
});

// Una prova: senza posta attiva il messaggio non esce, oppure va all'indirizzo
// di prova invece che al cliente. Il cliente non ha ricevuto niente, quindi la
// consegna resta da fare, e partira davvero quando la posta sara attiva; sulla
// riga resta scritto com'e andata. Prima la prova la chiudeva come inviata: non
// tornava piu in coda, e il cliente restava senza copia anche a posta attiva.
const registraProva = async ({ consegna, esito, quando }) => {
    await Consegna.updateOne({ _id: consegna._id }, setOrUnset({
        stato: 'in_coda',
        allegati: esito.allegati || [],
        note: `Prova del ${formatItalianDate(quando)}: il cliente non l'ha ricevuta (${esito.motivo}). Resta in coda.`,
        ultimo_errore: null,
        ultimo_tentativo: quando,
    }));
};

const registraErrore = async ({ consegna, errore, quando }) => {
    await Consegna.updateOne({ _id: consegna._id }, {
        $set: { stato: 'errore', ultimo_errore: errore.message, ultimo_tentativo: quando },
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

    // Prima quelle mai tentate, poi quelle tentate da piu tempo: una prova o un
    // errore le lasciano aperte, e ripartire sempre dalle piu vecchie vorrebbe
    // dire ritentare ogni volta le stesse. Senza tentativi una consegna viene prima.
    const daFare = await Consegna.find(filtro)
        .sort({ ultimo_tentativo: 1, createdAt: 1 })
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

            const fattura = await fatturaDellaConsegna(consegna);

            if (!fattura) {
                throw notFound('Fattura non trovata.');
            }

            if (!isConfirmedInvoice(fattura)) {
                throw unprocessable(FATTURA_IN_BOZZA);
            }

            const esito = await trasporto({ consegna, fattura });

            if (esito.simulata) {
                await registraProva({ consegna, esito, quando: new Date() });
                simulate += 1;
            } else {
                await registraEsito({ consegna, esito, quando: new Date() });
                inviate += 1;
            }

            esiti.push({
                consegna: consegna._id,
                documento: consegna.documento,
                destinatario: esito.destinatario,
                stato: esito.simulata ? 'simulata' : 'inviata',
                motivo: esito.motivo || null,
            });
        } catch (errore) {
            await registraErrore({ consegna, errore, quando: new Date() });
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

    await chiudiComeInviate({
        consegne: [consegna],
        ancora: { stato: consegna.stato },
        quando: new Date(),
        campi: { note: note || null, evasa_a_mano: true },
    });

    return Consegna.findById(consegna._id).lean();
};

// Tutte insieme quelle gia uscite dal gestionale: le copie stampate e imbustate,
// o le fatture elettroniche scaricate e caricate nel box. Una per una, a
// novembre, sarebbero ottocento clic.
//
// Quelle la cui fattura e cambiata dopo, o e tornata bozza, non si chiudono:
// perdono il segno, perche il documento uscito non vale piu, e la stampa o
// l'archivio successivo le rifanno. La bozza lo dice anche sulla riga.
const segnaEvase = async ({ quali } = {}) => {
    if (!Object.hasOwn(EVASE_IN_BLOCCO, quali)) {
        throw badRequest('Si segnano evase in blocco solo le consegne già stampate o già scaricate.');
    }

    const segno = EVASE_IN_BLOCCO[quali];
    const filtro = IN_UFFICIO[quali];
    const uscite = await Consegna.find(filtro, { fattura: 1, [segno]: 1 }).lean();
    const fatture = await Fattura.find(
        { _id: { $in: uscite.map((consegna) => consegna.fattura) } },
        { stato: 1, confermata: 1, updatedAt: 1 }
    ).lean();
    const { chiudibili, inBozza, cambiate } = chiudibiliInBlocco({
        consegne: uscite,
        fatture: new Map(fatture.map((fattura) => [String(fattura._id), fattura])),
        segno,
    });

    const daRifare = [
        { consegne: inBozza, update: { $set: { ultimo_errore: FATTURA_IN_BOZZA }, $unset: { [segno]: '' } } },
        { consegne: cambiate, update: { $unset: { [segno]: '' } } },
    ].filter((gruppo) => gruppo.consegne.length);

    if (daRifare.length) {
        await Consegna.bulkWrite(daRifare.map(({ consegne, update }) => ({
            updateMany: { filter: { _id: { $in: consegne.map((consegna) => consegna._id) }, ...filtro }, update },
        })));
    }

    const evase = await chiudiComeInviate({
        consegne: chiudibili,
        ancora: filtro,
        quando: new Date(),
        campi: { evasa_a_mano: true },
    });

    return { quali, evase, daRifare: inBozza.length + cambiate.length };
};

// L'annullamento di una persona e una decisione: Prepara non la rimette in coda
// da solo, a differenza di cio che aveva chiuso lui. Una consegna gia evasa non
// si annulla: e arrivata, oppure - se e stato uno sbaglio - torna da fare.
const annullaConsegna = async (id, { note } = {}) => {
    const consegna = await caricaConsegna(id);

    if (consegna.stato === 'inviata') {
        throw badRequest('Una consegna già evasa non si annulla.');
    }

    await Consegna.updateOne({ _id: consegna._id, stato: consegna.stato }, chiusura(note || 'Annullata manualmente.'));

    return Consegna.findById(consegna._id).lean();
};

// Rimette una consegna fra quelle da fare: una fallita, azzerandone l'errore,
// o una evasa per sbaglio. Chi la rimette ha corretto qualcosa: torna fra le
// prime da tentare, da stampare o scaricare di nuovo. Ed e una richiesta
// esplicita, come Prepara dalla scheda: di una fattura del vecchio programma la
// coda generale terra in pari anche questa riga, invece di ignorarla.
//
// Torna indietro solo cio che una persona ha segnato evaso. Una consegna
// partita dal gestionale - la mail al cliente - e arrivata, e nessun pulsante
// la ritira.
const rimettiInCoda = async (id) => {
    const consegna = await caricaConsegna(id);

    if (consegna.stato === 'inviata' && !consegna.evasa_a_mano) {
        throw badRequest('Questa consegna è partita dal gestionale: è arrivata al cliente, e non torna fra quelle da fare.');
    }

    const { modifiedCount } = await Consegna.updateOne({ _id: consegna._id, stato: consegna.stato }, {
        $set: { stato: 'in_coda', su_richiesta: true },
        $unset: {
            ultimo_errore: '',
            ultimo_tentativo: '',
            chiusa_dal_piano: '',
            data_invio: '',
            evasa_a_mano: '',
            stampata_il: '',
            scaricata_il: '',
        },
    });

    // La data sulla fattura se l'aveva scritta questa consegna, e solo allora.
    if (modifiedCount && consegna.stato === 'inviata') {
        const campo = CAMPO_DATA_CONSEGNA[consegna.tipo];
        await Fattura.updateOne(
            { _id: consegna.fattura, [campo]: consegna.data_invio },
            { $unset: { [campo]: '' } },
            SENZA_TOCCARE_IL_DOCUMENTO
        );
    }

    return Consegna.findById(consegna._id).lean();
};

// ---------------------------------------------------------------------------
// Riepilogo
// ---------------------------------------------------------------------------

const contaPer = (righe, campo) => righe.reduce((totali, riga) => ({
    ...totali,
    [riga._id[campo]]: (totali[riga._id[campo]] || 0) + riga.quante,
}), {});

// Il lavoro d'ufficio, contato con gli stessi filtri con cui lo si fa.
const contaInUfficio = async () => {
    const voci = Object.entries(IN_UFFICIO);
    const quante = await Promise.all(voci.map(([, filtro]) => Consegna.countDocuments(filtro)));
    return Object.fromEntries(voci.map(([voce], indice) => [voce, quante[indice]]));
};

const riepilogo = async () => {
    const [righe, inUfficio, clientiPerModalita, elettroniche] = await Promise.all([
        Consegna.aggregate([
            { $group: { _id: { stato: '$stato', tipo: '$tipo', canale: '$canale' }, quante: { $sum: 1 } } },
        ]),
        contaInUfficio(),
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
        // Da stampare, gia stampate, da trasmettere, gia scaricate.
        ...inUfficio,
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
    segnaEvase,
};
