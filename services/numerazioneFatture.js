// La numerazione delle fatture: chi assegna un numero, chi lo libera cancellando
// l'ultima fattura, e la regola che tiene insieme le due cose.
//
// Il numero si assegna alla conferma, non quando nasce la bozza. Prima la bozza
// lo riceveva subito: cancellarne una lasciava un buco nella serie, e in un
// giro di fatturazione le bozze si cancellano e si rigenerano. Una bozza non ha
// numero ne serie; lo riceve confermandola, nell'ordine in cui la si conferma.
//
// Il progressivo si calcola sulla sola serie corrente. Prima veniva preso il
// massimo fra tutte le fatture dell'anno, storico compreso, e le fatture nuove
// ereditavano un numero derivato da codici cliente (2761, 2835, ...). Su un anno
// senza documenti il primo numero era inoltre 0, perche il contatore parte da -1:
// ora la prima fattura di una serie e la numero 1.
//
// Il numero nuovo e quello dopo il piu alto fra le fatture che esistono e i
// numeri usciti: si ricava ogni volta dai dati, non da un contatore che va solo
// avanti. Cosi cancellare l'ultima fattura, se non e mai uscita, ne libera il
// numero da solo - due fatture di prova cancellate non fanno partire la prima
// vera dal numero 3 - mentre un buco in mezzo resta un buco.
//
// La regola: un numero uscito non torna mai libero. Uscito vuol dire che il
// documento ha lasciato il gestionale - una consegna evasa davvero, un file XML
// prodotto, una data di invio - e che quindi puo essere in mano al cliente o allo
// SdI. Se quella fattura viene poi cancellata di lei non resta niente, e allora e
// il contatore a ricordarsi il numero (`ultimo_uscito`) per non scendere mai sotto.

const Fattura = require('../models/Fattura');
const InvoiceCounter = require('../models/InvoiceCounter');
const {
    INVOICE_SERIES,
    emessaDalGestionale,
    haNumero,
    invoiceCode,
    numeroDocumento,
} = require('../config/invoicing');
const { scopeDellaSerie } = require('./counters');
const { formatItalianDate, getDate, nelFuturo, startOfDay } = require('../utils/dates');
const { unprocessable } = require('../utils/errors');
const { withSession } = require('../utils/mongo');
const { numberOrZero } = require('../utils/values');

const ultimaNumerata = ({ anno, serie, session }) => withSession(Fattura.findOne({ anno, serie }), session)
    .sort({ numero: -1 })
    .select('anno serie numero data_fattura')
    .lean();

// Il numero piu alto gia preso in una serie: fra le fatture che esistono e i
// numeri usciti e poi cancellati. Il prossimo e quello dopo. Le due letture sono
// in fila e non in parallelo perche dentro una transazione il database non
// accetta operazioni contemporanee sulla stessa sessione.
const pavimento = async ({ anno, serie, session }) => {
    const piuAlta = await ultimaNumerata({ anno, serie, session });
    const contatore = await withSession(InvoiceCounter.findOne({ scope: scopeDellaSerie(serie), year: anno }), session)
        .select('ultimo_uscito')
        .lean();

    return Math.max(numberOrZero(piuAlta?.numero), numberOrZero(contatore?.ultimo_uscito));
};

// Numeri e date vanno nello stesso verso: una fattura con un numero piu alto e
// una data piu vecchia di un'altra renderebbe il registro illeggibile. La data di
// una fattura numerata - o che sta per esserlo - sta quindi fra quella del numero
// prima e quella del numero dopo; lo stesso giorno va bene. E non nel futuro: una
// fattura datata dicembre per sbaglio e confermata a marzo bloccherebbe tutte le
// altre fino a dicembre. `numero` manca quando il numero lo si sta assegnando:
// allora la fattura prima e l'ultima numerata, e dopo non ce n'e.
const verificaData = async ({ data, anno, serie, numero, session }) => {
    if (nelFuturo(data)) {
        throw unprocessable(
            `La data ${formatItalianDate(data)} è nel futuro: una fattura porta la data del giorno `
            + 'in cui la si emette, o una precedente.'
        );
    }

    const vicina = (verso) => withSession(Fattura.findOne({
        anno,
        serie,
        ...(numero ? { numero: { [verso > 0 ? '$gt' : '$lt']: numero } } : {}),
    }), session)
        .sort({ numero: verso > 0 ? 1 : -1 })
        .select('anno serie numero data_fattura')
        .lean();

    const prima = await vicina(-1);
    if (prima?.data_fattura && startOfDay(data) < startOfDay(prima.data_fattura)) {
        throw unprocessable(
            `La fattura ha data ${formatItalianDate(data)}, ma la ${invoiceCode(prima)} è del `
            + `${formatItalianDate(prima.data_fattura)}: una fattura non può avere un numero più alto `
            + 'e una data più vecchia. Cambia la data prima di confermarla.'
        );
    }

    const dopo = numero ? await vicina(1) : null;
    if (dopo?.data_fattura && startOfDay(data) > startOfDay(dopo.data_fattura)) {
        throw unprocessable(
            `La fattura ha data ${formatItalianDate(data)}, ma la ${invoiceCode(dopo)}, che viene dopo, è del `
            + `${formatItalianDate(dopo.data_fattura)}: una fattura non può avere un numero più basso `
            + 'e una data più recente.'
        );
    }
};

// Il numero per una fattura che si sta confermando, con l'anno della sua data.
const assegnaNumero = async ({ data_fattura, session }) => {
    const data = getDate(data_fattura);
    const anno = data.getUTCFullYear();
    const serie = INVOICE_SERIES;
    await verificaData({ data, anno, serie, session });

    // Il contatore mette in fila due conferme contemporanee: dentro una
    // transazione la seconda che lo scrive si ferma, riparte e rilegge i dati
    // con il numero della prima. Senza transazioni (il database di sviluppo) e
    // l'indice univoco su anno, serie e numero a impedire il doppione.
    const numero = await pavimento({ anno, serie, session }) + 1;
    await InvoiceCounter.updateOne(
        { scope: scopeDellaSerie(serie), year: anno },
        { $set: { value: numero } },
        { upsert: true, session }
    );

    return { anno, serie, numero, codice: invoiceCode({ anno, numero, serie }) };
};

const haNumeroDiSerie = (fattura) => (
    emessaDalGestionale(fattura) && Boolean(fattura?.anno) && haNumero(fattura)
);

// Una fattura che ha gia un numero e a cui si cambia la data. L'anno fa parte
// del numero, e non cambia: vale anche per lo storico importato. Per quelle
// emesse da qui la data resta anche fra i numeri vicini.
const verificaDataNumerata = async ({ fattura, data_fattura, session }) => {
    const data = getDate(data_fattura);

    if (data.getUTCFullYear() !== Number(fattura.anno)) {
        throw unprocessable(
            `La fattura ${numeroDocumento(fattura)} è numerata nel ${fattura.anno}: la data deve restare in quell'anno.`
        );
    }

    if (haNumeroDiSerie(fattura)) {
        await verificaData({ data, anno: fattura.anno, serie: fattura.serie, numero: fattura.numero, session });
    }
};

// Il numero di una fattura cancellata si puo dare alla prossima solo se il
// documento non e mai uscito di qui: altrimenti due documenti diversi, uno gia in
// mano al cliente o allo SdI, avrebbero lo stesso numero. Un file XML prodotto
// conta come uscito anche senza una consegna evasa: qualcuno puo averlo caricato
// sul portale dello SdI senza dirlo al gestionale. Lo storico importato non ha
// serie, e i suoi numeri non sono un progressivo.
const numeroRiusabile = ({ fattura, consegne = [] }) => {
    if (!haNumeroDiSerie(fattura)) {
        return false;
    }

    if (fattura.data_invio_fattura || fattura.data_fattura_elettronica) {
        return false;
    }

    return !consegne.some((consegna) => (
        consegna.stato === 'inviata'
        || (consegna.tipo === 'elettronica' && Boolean(consegna.progressivo))
    ));
};

// Il numero di questa fattura e uscito dal gestionale: il contatore se lo
// ricorda, e se la fattura venisse cancellata non tornerebbe libero. Lo storico
// importato non ha un numero della serie, e non c'e niente da ricordare.
const segnaNumeroUscito = async (fattura, session) => {
    if (!haNumeroDiSerie(fattura)) {
        return;
    }

    await InvoiceCounter.updateOne(
        { scope: scopeDellaSerie(fattura.serie), year: fattura.anno },
        { $max: { ultimo_uscito: Number(fattura.numero) } },
        { upsert: true, session }
    );
};

// Cosa ne e del numero di una fattura appena cancellata: se e uscita lo si
// ricorda, cosi non torna libero. Va chiamata dopo la cancellazione, cosi il
// documento non conta piu fra quelli che esistono. Restituisce se il numero e
// tornato libero, cioe se la prossima conferma lo riprendera: solo se era il
// piu alto e non e mai uscito. Una bozza mai confermata non ha numero, e non
// c'e niente da fare.
const congedaNumero = async ({ fattura, consegne, session }) => {
    if (!haNumeroDiSerie(fattura)) {
        return false;
    }

    if (numeroRiusabile({ fattura, consegne })) {
        return Number(fattura.numero) > await pavimento({ anno: fattura.anno, serie: fattura.serie, session });
    }

    await segnaNumeroUscito(fattura, session);
    return false;
};

module.exports = {
    assegnaNumero,
    congedaNumero,
    haNumeroDiSerie,
    numeroRiusabile,
    segnaNumeroUscito,
    verificaDataNumerata,
};
