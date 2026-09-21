// La numerazione delle fatture: chi assegna un numero, chi lo libera cancellando
// l'ultima fattura, e la regola che tiene insieme le due cose.
//
// Il progressivo si calcola sulla sola serie corrente. Prima veniva preso il
// massimo fra tutte le fatture dell'anno, storico compreso, e le fatture nuove
// ereditavano un numero derivato da codici cliente (2761, 2835, ...). Su un anno
// senza documenti il primo numero era inoltre 0, perche il contatore parte da -1:
// ora la prima fattura di una serie e la numero 1.
//
// La regola: un numero uscito non torna mai libero. Uscito vuol dire che il
// documento ha lasciato il gestionale - una consegna evasa davvero, un file XML
// prodotto, una data di invio - e che quindi puo essere in mano al cliente o allo
// SdI. Se quella fattura viene poi cancellata di lei non resta niente, e allora e
// il contatore a ricordarsi il numero (`ultimo_uscito`) per non scendere mai sotto.

const Fattura = require('../models/Fattura');
const InvoiceCounter = require('../models/InvoiceCounter');
const { INVOICE_SERIES, emessaDalGestionale } = require('../config/invoicing');
const { prossimoNumero, scopeDellaSerie } = require('./counters');
const { withSession } = require('../utils/mongo');
const { numberOrZero } = require('../utils/values');

// Il valore sotto cui il contatore di una serie non puo scendere: il numero piu
// alto fra le fatture che esistono e quelli usciti e poi cancellati. Le due letture
// sono in fila e non in parallelo perche dentro una transazione il database non
// accetta operazioni contemporanee sulla stessa sessione.
const pavimento = async ({ anno, serie, session }) => {
    const piuAlta = await withSession(Fattura.findOne({ anno, serie }), session)
        .sort({ numero: -1 })
        .select('numero')
        .lean();
    const contatore = await withSession(InvoiceCounter.findOne({ scope: scopeDellaSerie(serie), year: anno }), session)
        .select('ultimo_uscito')
        .lean();

    return Math.max(numberOrZero(piuAlta?.numero), numberOrZero(contatore?.ultimo_uscito));
};

const reserveInvoiceNumber = async (anno, session, serie = INVOICE_SERIES) => {
    const scope = scopeDellaSerie(serie);

    await InvoiceCounter.updateOne(
        { scope, year: anno },
        { $max: { value: await pavimento({ anno, serie, session }) } },
        { upsert: true, session }
    );

    return prossimoNumero({ scope, year: anno, session });
};

const haNumeroDiSerie = (fattura) => (
    emessaDalGestionale(fattura) && Boolean(fattura?.anno) && Number(fattura?.numero) > 0
);

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

// Se la fattura cancellata aveva l'ultimo numero della serie, il contatore torna
// indietro e la prossima fattura riprende da li: due fatture di prova cancellate
// non fanno partire la prima vera dal numero 3. Torna al pavimento, mai sotto un
// numero uscito. Solo se era proprio l'ultima: una fattura in mezzo lascia un buco,
// che non si chiude senza rinumerare quelle dopo. Il confronto sul valore del
// contatore rende l'operazione sicura anche se un'altra generazione ha gia preso
// il numero successivo: in quel caso non si tocca niente.
const liberaUltimoNumero = async (fattura, session) => {
    const esito = await InvoiceCounter.updateOne(
        { scope: scopeDellaSerie(fattura.serie), year: fattura.anno, value: Number(fattura.numero) },
        { $set: { value: await pavimento({ anno: fattura.anno, serie: fattura.serie, session }) } },
        { session }
    );

    return esito.modifiedCount > 0;
};

// Cosa ne e del numero di una fattura appena cancellata: se non e mai uscita lo si
// libera, se e uscita lo si ricorda. Va chiamata dopo la cancellazione, cosi il
// documento non conta piu fra quelli che esistono. Restituisce se il numero e
// stato liberato.
const congedaNumero = async ({ fattura, consegne, session }) => {
    if (!haNumeroDiSerie(fattura)) {
        return false;
    }

    if (numeroRiusabile({ fattura, consegne })) {
        return liberaUltimoNumero(fattura, session);
    }

    await InvoiceCounter.updateOne(
        { scope: scopeDellaSerie(fattura.serie), year: fattura.anno },
        { $max: { ultimo_uscito: Number(fattura.numero) } },
        { upsert: true, session }
    );

    return false;
};

module.exports = {
    congedaNumero,
    numeroRiusabile,
    reserveInvoiceNumber,
};
