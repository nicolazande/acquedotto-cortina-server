// Registrare gli incassi: dire che una scadenza e stata pagata, e quando.
//
// Nel gestionale precedente si faceva una scadenza alla volta, aprendo una
// maschera per ciascuna, su una griglia senza filtri ne ricerca: circa
// settecento volte l'anno. Nel 2025 nessuno l'ha piu fatto, e infatti 694
// scadenze risultano aperte mentre gli anni precedenti sono al 99%.
//
// Qui la stessa operazione si fa su molte scadenze insieme. Le regole su cosa
// significhi "saldata" e su come si calcoli il ritardo restano in
// deadlineService: questo modulo si occupa solo di registrare il fatto.

const Scadenza = require('../models/Scadenza');
const { NON_SALDATA, dataPagamento } = require('./deadlineService');
const { toDate } = require('../utils/dates');
const { badRequest } = require('../utils/errors');
const { sumMoneyBy } = require('../utils/values');

// Tetto per singola richiesta. Registrare un incasso e un'operazione che tocca
// il denaro: un limite tiene la conferma leggibile e l'eventuale errore piccolo.
const MAX_PER_VOLTA = 500;

const elencoValido = (scadenze) => {
    if (!Array.isArray(scadenze) || scadenze.length === 0) {
        throw badRequest('Nessuna scadenza selezionata.');
    }

    if (scadenze.length > MAX_PER_VOLTA) {
        throw badRequest(`Troppe scadenze in una volta sola: massimo ${MAX_PER_VOLTA}.`);
    }

    return scadenze;
};

// La data in cui il denaro e arrivato. Deve essere una data vera e non nel
// futuro: un incasso datato domani non e un incasso, e sballerebbe il calcolo
// del ritardo, che si ferma al giorno del pagamento.
const dataIncasso = (valore) => {
    const data = dataPagamento(toDate(valore));

    if (!data) {
        throw badRequest('Indicare la data in cui il pagamento è arrivato.');
    }

    const domani = new Date();
    domani.setHours(24, 0, 0, 0);

    if (data >= domani) {
        throw badRequest('La data di pagamento non può essere nel futuro.');
    }

    return data;
};

// Segna pagate le scadenze indicate.
//
// Tocca solo quelle ancora aperte: rieseguire la stessa operazione non
// sovrascrive una data di pagamento gia registrata, che e il dato piu prezioso
// da non perdere.
const registraPagamenti = async ({ scadenze, pagamento }) => {
    const ids = elencoValido(scadenze);
    const data = dataIncasso(pagamento);

    const aperte = await Scadenza.find({ $and: [{ _id: { $in: ids } }, NON_SALDATA] })
        .select('_id totale cognome nome anno numero scadenza')
        .lean();

    if (aperte.length === 0) {
        return { registrate: 0, gia_saldate: ids.length, totale: 0, pagamento: data, scadenze: [] };
    }

    await Scadenza.updateMany(
        { _id: { $in: aperte.map((voce) => voce._id) } },
        { $set: { saldo: true, pagamento: data } }
    );

    return {
        registrate: aperte.length,
        gia_saldate: ids.length - aperte.length,
        totale: sumMoneyBy(aperte, (voce) => voce.totale),
        pagamento: data,
        scadenze: aperte,
    };
};

// Rimette aperte delle scadenze segnate pagate per errore. La data di pagamento
// viene tolta: tenerla su una scadenza aperta direbbe due cose opposte.
const annullaPagamenti = async ({ scadenze }) => {
    const ids = elencoValido(scadenze);

    const saldate = await Scadenza.find({ _id: { $in: ids }, saldo: true })
        .select('_id totale cognome nome anno numero')
        .lean();

    if (saldate.length === 0) {
        return { annullate: 0, totale: 0, scadenze: [] };
    }

    await Scadenza.updateMany(
        { _id: { $in: saldate.map((voce) => voce._id) } },
        { $set: { saldo: false }, $unset: { pagamento: '' } }
    );

    return {
        annullate: saldate.length,
        totale: sumMoneyBy(saldate, (voce) => voce.totale),
        scadenze: saldate,
    };
};

module.exports = {
    MAX_PER_VOLTA,
    annullaPagamenti,
    dataIncasso,
    registraPagamenti,
};
