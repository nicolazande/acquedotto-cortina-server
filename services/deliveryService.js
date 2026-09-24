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
// cosa stampare, e si chiudono quando una persona dichiara di averlo fatto.

const Cliente = require('../models/Cliente');
const Consegna = require('../models/Consegna');
const Fattura = require('../models/Fattura');
const {
    CAMPO_DATA_CONSEGNA,
    CANALE_TRASMISSIONE_SDI,
    STATI_APERTI,
    testoEmailCortesia,
} = require('../config/delivery');
const { AZIENDA } = require('../config/azienda');
const { FILTRO_EMESSE_DAL_GESTIONALE, isConfirmedInvoice } = require('../config/invoicing');
const { allegatoPdf, allegatoXml, fatturaDellaConsegna } = require('./documentiConsegna');
const { FATTURA_IN_BOZZA, aggiornamentoCoda, chiusura, pianoConsegne } = require('./deliveryPlan');
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
        await Fattura.updateMany({ _id: { $in: decise } }, { $set: { consegne_decise_il: new Date() } });
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

// Una consegna arrivata al cliente: recapitata dal gestionale, o evasa a mano da
// una persona. L'esito di una prova precedente, un errore gia superato, un
// problema del piano, il motivo di un annullamento: niente di questo descrive
// piu una consegna arrivata. La data che il gestionale precedente teneva sulla
// fattura continua a essere popolata (`CAMPO_DATA_CONSEGNA`): chi guarda la
// fattura vede subito quando e uscita, senza aprire l'elenco delle consegne.
const chiudiComeInviata = async ({ consegna, quando, campi = {} }) => {
    await Consegna.updateOne({ _id: consegna._id }, {
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

    await Fattura.updateOne(
        { _id: consegna.fattura },
        { $set: { [CAMPO_DATA_CONSEGNA[consegna.tipo]]: quando } }
    );
};

const registraEsito = ({ consegna, esito, quando }) => chiudiComeInviata({
    consegna,
    quando,
    campi: {
        destinatario: esito.destinatario || consegna.destinatario,
        riferimento: esito.riferimento,
        allegati: esito.allegati || [],
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

    await chiudiComeInviata({ consegna, quando: new Date(), campi: { note: note || null } });

    return Consegna.findById(consegna._id).lean();
};

// L'annullamento di una persona e una decisione: Prepara non la rimette in coda
// da solo, a differenza di cio che aveva chiuso lui.
const annullaConsegna = async (id, { note } = {}) => {
    const consegna = await caricaConsegna(id);
    await Consegna.updateOne({ _id: consegna._id }, chiusura(note || 'Annullata manualmente.'));

    return Consegna.findById(consegna._id).lean();
};

// Rimette in coda una consegna fallita, azzerandone l'errore. Chi la rimette
// ha corretto qualcosa: torna fra le prime da tentare. Ed e una richiesta
// esplicita, come Prepara dalla scheda: di una fattura del vecchio programma la
// coda generale terra in pari anche questa riga, invece di ignorarla.
const rimettiInCoda = async (id) => {
    const consegna = await caricaConsegna(id);

    if (consegna.stato === 'inviata') {
        throw badRequest('Una consegna già evasa non si rimette in coda.');
    }

    await Consegna.updateOne({ _id: consegna._id }, {
        $set: { stato: 'in_coda', su_richiesta: true },
        $unset: { ultimo_errore: '', ultimo_tentativo: '', chiusa_dal_piano: '' },
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
};
