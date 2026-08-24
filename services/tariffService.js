// Le tariffe nel tempo: quando scadono, e come si rinnovano senza sbagliare.
//
// Le fasce di un listino hanno una validita, ma una tariffa scaduta non ferma
// la fatturazione: `getApplicableBands` la proroga finche non ne arriva una
// nuova, perche e cosi che funziona nella realta - il consiglio approva un
// prezzo e quello vale finche non ne delibera un altro.
//
// Restano pero da rinnovare, e accorgersene serve lo stesso: alla scrittura di
// questo modulo dieci listini su quindici scadevano insieme il 31/12/2026, e
// uno era scaduto da due anni senza che nessuno se ne fosse accorto. Senza un
// avviso si finisce per fatturare l'anno nuovo ai prezzi vecchi senza averlo
// deciso.
//
// Le regole su quali fasce siano valide e quali siano quote fisse non sono
// riscritte qui: arrivano da billingCalculator, cosi il controllo e il calcolo
// non possono dare risposte diverse sulla stessa fascia.

const Contatore = require('../models/Contatore');
const Fascia = require('../models/Fascia');
const Listino = require('../models/Listino');
const { getApplicableBands, isFixedBand } = require('./billingCalculator');
const { fromCents, toCents } = require('../utils/money');
const { numberOrZero } = require('../utils/values');
const { badRequest, notFound, unprocessable } = require('../utils/errors');

// Quanto in anticipo vale la pena accorgersi di una scadenza.
const MESI_DI_PREAVVISO = 6;

// Gli estremi delle fasce sono inclusivi (1-100, 101-150). Il calcolo lavora su
// un limite inferiore esclusivo, e queste due funzioni fanno la stessa
// conversione che fa billingCalculator.
const limiteInferiore = (fascia) => (numberOrZero(fascia.min) > 0 ? numberOrZero(fascia.min) - 1 : 0);
const limiteSuperiore = (fascia) => (numberOrZero(fascia.max) > 0 ? numberOrZero(fascia.max) : Infinity);

const inizioAnno = (anno) => new Date(Date.UTC(anno, 0, 1));
const fineAnno = (anno) => new Date(Date.UTC(anno, 11, 31));
const soloData = (valore) => (valore ? new Date(valore).toISOString().slice(0, 10) : null);

// --------------------------------------------------------------------------
// Copertura: buchi e sovrapposizioni fra le fasce a consumo di una data
// --------------------------------------------------------------------------

const analizzaCopertura = (fasce, data) => {
    const valide = getApplicableBands(fasce, { date: data });
    const aConsumo = valide.filter((fascia) => !isFixedBand(fascia) && numberOrZero(fascia.prezzo) >= 0);
    const problemi = [];

    if (aConsumo.length === 0) {
        return {
            problemi: [valide.length
                ? 'Nessuna fascia a consumo valida: resterebbe solo la quota fissa.'
                : 'Nessuna fascia valida a questa data.'],
            tetto: 0,
            fasce: aConsumo,
        };
    }

    if (limiteInferiore(aConsumo[0]) !== 0) {
        problemi.push(`I primi ${limiteInferiore(aConsumo[0])} mc non hanno tariffa: la prima fascia parte da ${aConsumo[0].min}.`);
    }

    aConsumo.slice(1).forEach((fascia, indice) => {
        const precedente = aConsumo[indice];
        if (limiteInferiore(fascia) < limiteSuperiore(precedente)) {
            problemi.push(`Le fasce ${precedente.min}-${precedente.max} e ${fascia.min}-${fascia.max} si sovrappongono.`);
        } else if (limiteInferiore(fascia) > limiteSuperiore(precedente)) {
            problemi.push(`Fra ${precedente.max} e ${fascia.min} mc non c'è tariffa.`);
        }
    });

    return { problemi, tetto: limiteSuperiore(aConsumo[aConsumo.length - 1]), fasce: aConsumo };
};

// --------------------------------------------------------------------------
// Scadenze
// --------------------------------------------------------------------------

// I listini con contatori collegati le cui tariffe scadono entro N mesi.
// Un listino senza contatori non interessa: nessuno ci fattura sopra.
const tariffeInScadenza = async ({ mesi = MESI_DI_PREAVVISO } = {}) => {
    const limite = new Date();
    limite.setMonth(limite.getMonth() + mesi);

    const listini = await Listino.find({}).lean();
    const inScadenza = [];

    for (const listino of listini) {
        const contatori = await Contatore.countDocuments({ listino: listino._id });
        if (contatori === 0) {
            continue;
        }

        const fasce = await Fascia.find({ listino: listino._id }).select('tipo min max scadenza').lean();
        const scadenti = fasce.filter((fascia) => fascia.scadenza && new Date(fascia.scadenza) <= limite);

        if (scadenti.length === 0) {
            continue;
        }

        const prima = scadenti.map((fascia) => new Date(fascia.scadenza)).sort((a, b) => a - b)[0];

        inScadenza.push({
            listino: listino._id,
            categoria: listino.categoria || listino.descrizione,
            contatori,
            fasceInScadenza: scadenti.length,
            fasceTotali: fasce.length,
            scadeIl: prima,
            scaduto: prima < new Date(),
        });
    }

    return inScadenza.sort((a, b) => a.scadeIl - b.scadeIl);
};

// --------------------------------------------------------------------------
// Rinnovo
// --------------------------------------------------------------------------

// Il prezzo rinnovato, con l'eventuale variazione percentuale. Passa dai
// centesimi interi come tutto il resto del denaro.
const prezzoRinnovato = (prezzo, variazione) => {
    const centesimi = toCents(prezzo);
    if (!variazione) {
        return fromCents(centesimi);
    }

    return fromCents(Math.round(centesimi * (1 + Number(variazione) / 100)));
};

// Cosa succederebbe rinnovando le tariffe di un listino per un anno.
//
// Non tutte le fasce vanno copiate: quelle che valgono gia per l'anno di
// destinazione (nei dati importati la fascia piu alta arriva al 2099)
// resterebbero valide, e duplicarle creerebbe una sovrapposizione, cioe una
// doppia fatturazione dello stesso scaglione.
const pianoRinnovo = ({ fasce, anno, variazione = 0 }) => {
    const inizio = inizioAnno(anno);
    const fine = fineAnno(anno);
    const giornoPrima = new Date(inizio.getTime() - 86400000);

    const copronoGiaLAnno = fasce.filter((fascia) => {
        const daQuando = fascia.inizio ? new Date(fascia.inizio) : null;
        const finoA = fascia.scadenza ? new Date(fascia.scadenza) : null;
        return (!daQuando || daQuando <= inizio) && (!finoA || finoA >= fine);
    });
    const giaValide = new Set(copronoGiaLAnno.map((fascia) => String(fascia._id)));

    // Le tariffe in vigore alla vigilia: sono quelle che vanno rinnovate.
    //
    // Se alla vigilia non c'e piu niente in vigore, il listino e gia scaduto da
    // tempo - succede: uno dei listini reali e scaduto due anni prima che
    // qualcuno se ne accorgesse. In quel caso si riprendono le ultime tariffe
    // che sono state in vigore, che sono proprio quelle da rinnovare: rifiutarsi
    // lascerebbe scoperto l'unico caso in cui questo strumento serve davvero.
    // Le tariffe in vigore alla vigilia. `getApplicableBands` proroga da sola le
    // fasce scadute che nessuna nuova ha sostituito, quindi qui arrivano anche
    // le tariffe di un listino fermo da anni: sono proprio quelle da rinnovare.
    const daRinnovare = getApplicableBands(fasce, { date: giornoPrima })
        .filter((fascia) => !giaValide.has(String(fascia._id)));

    const nuove = daRinnovare.map((fascia) => ({
        tipo: fascia.tipo,
        min: fascia.min,
        max: fascia.max,
        prezzo: prezzoRinnovato(fascia.prezzo, variazione),
        prezzoPrecedente: numberOrZero(fascia.prezzo),
        inizio,
        scadenza: fine,
        listino: fascia.listino,
    }));

    // Il risultato si controlla come lo controllerebbe il calcolo: se dopo il
    // rinnovo restassero buchi o sovrapposizioni, la fatturazione si fermerebbe
    // comunque, solo piu tardi e con meno tempo per rimediare.
    const risultanti = [
        ...copronoGiaLAnno,
        ...nuove.map((fascia, indice) => ({ ...fascia, _id: `nuova-${indice}` })),
    ];
    const copertura = analizzaCopertura(risultanti, inizio);

    return {
        anno,
        variazione: Number(variazione) || 0,
        nuove,
        giaValide: copronoGiaLAnno.map((fascia) => ({
            tipo: fascia.tipo,
            min: fascia.min,
            max: fascia.max,
            prezzo: numberOrZero(fascia.prezzo),
            scadenza: soloData(fascia.scadenza),
        })),
        problemi: copertura.problemi,
        applicabile: nuove.length > 0 && copertura.problemi.length === 0,
    };
};

const caricaListino = async (listinoId) => {
    const listino = await Listino.findById(listinoId).lean();
    if (!listino) {
        throw notFound('Listino non trovato.');
    }
    return listino;
};

const anteprimaRinnovo = async ({ listinoId, anno, variazione }) => {
    const listino = await caricaListino(listinoId);
    const fasce = await Fascia.find({ listino: listino._id }).lean();
    const piano = pianoRinnovo({ fasce, anno: Number(anno), variazione });

    return { listino: { _id: listino._id, categoria: listino.categoria }, ...piano };
};

// Crea le fasce del nuovo anno. Non tocca quelle esistenti: le vecchie restano
// com'erano, perche sono la tariffa con cui sono state emesse le fatture di
// allora e riscriverle cambierebbe il passato.
const rinnovaTariffe = async ({ listinoId, anno, variazione }) => {
    const annoNumero = Number(anno);
    if (!Number.isInteger(annoNumero) || annoNumero < 2000 || annoNumero > 2100) {
        throw badRequest('Anno non valido.');
    }

    const listino = await caricaListino(listinoId);
    const fasce = await Fascia.find({ listino: listino._id }).lean();
    const piano = pianoRinnovo({ fasce, anno: annoNumero, variazione });

    if (piano.nuove.length === 0) {
        throw unprocessable(`Il listino ${listino.categoria} ha già tariffe valide per il ${annoNumero}.`);
    }

    if (piano.problemi.length > 0) {
        throw unprocessable(
            `Il rinnovo lascerebbe il listino ${listino.categoria} incompleto: ${piano.problemi.join(' ')}`
        );
    }

    const create = await Fascia.insertMany(piano.nuove.map(
        ({ prezzoPrecedente, ...fascia }) => fascia
    ));

    return {
        listino: { _id: listino._id, categoria: listino.categoria },
        anno: annoNumero,
        variazione: piano.variazione,
        create: create.length,
        fasce: create,
    };
};

module.exports = {
    MESI_DI_PREAVVISO,
    analizzaCopertura,
    anteprimaRinnovo,
    pianoRinnovo,
    prezzoRinnovato,
    rinnovaTariffe,
    tariffeInScadenza,
};
