// Il fatturato di un anno per categoria di tariffa: quante fatture e quanti
// contatori, i metri cubi, i consumi e le quote fisse. In Gesco era la stampa
// "Statistiche su fatturato" per categoria.
//
// Contano le fatture confermate dell'anno. Una riga appartiene alla categoria
// del listino con cui e stata calcolata; le righe importate dal vecchio
// programma il listino non lo portano, e lo si prende dal contatore della loro
// lettura. Le righe senza lettura - la mora, le righe scritte a mano - stanno in
// una voce a parte.

const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Listino = require('../models/Listino');
const Servizio = require('../models/Servizio');
const { getFixedServices } = require('./confrontoRighe');
const { FILTRO_CONFERMATE } = require('../config/invoicing');
const { recordId } = require('../utils/mongo');
const { numberOrZero, sumMoneyBy } = require('../utils/values');

const COLONNE = [
    { titolo: 'Categoria', campo: 'categoria', larghezza: 150 },
    { titolo: 'Fatture', campo: 'fatture', larghezza: 40, numero: true },
    { titolo: 'Contatori', campo: 'contatori', larghezza: 45, numero: true },
    { titolo: 'Metri cubi', campo: 'metriCubi', larghezza: 50, numero: true },
    { titolo: 'Consumi (euro)', campo: 'consumi', larghezza: 55, numero: true, euro: true },
    { titolo: 'Quote fisse (euro)', campo: 'quoteFisse', larghezza: 60, numero: true, euro: true },
    { titolo: 'Altro (euro)', campo: 'altro', larghezza: 50, numero: true, euro: true },
    { titolo: 'Imponibile (euro)', campo: 'imponibile', larghezza: 60, numero: true, euro: true },
];

const SENZA_LETTURA = 'Altre righe (mora, righe a mano)';

const perId = (documenti) => new Map(documenti.map((documento) => [String(documento._id), documento]));

// Da un gruppo di righe della stessa categoria, la riga dell'elenco.
const rigaDellaCategoria = (categoria, righe, contatoreDi) => {
    const fisse = new Set(getFixedServices(righe));
    const consumi = righe.filter((riga) => riga.lettura && !fisse.has(riga));

    return {
        categoria,
        fatture: new Set(righe.map((riga) => String(riga.fattura))).size,
        contatori: new Set(righe.map(contatoreDi).filter(Boolean)).size,
        metriCubi: Math.round(consumi.reduce((somma, riga) => somma + numberOrZero(riga.metri_cubi), 0) * 100) / 100,
        consumi: sumMoneyBy(consumi, (riga) => riga.valore_unitario),
        quoteFisse: sumMoneyBy([...fisse], (riga) => riga.valore_unitario),
        altro: sumMoneyBy(righe.filter((riga) => !riga.lettura && !fisse.has(riga)), (riga) => riga.valore_unitario),
        imponibile: sumMoneyBy(righe, (riga) => riga.valore_unitario),
    };
};

const righeDellAnno = async (anno) => {
    const fatture = await Fattura.find({ anno, ...FILTRO_CONFERMATE }).select('_id').lean();
    const servizi = await Servizio.find({ fattura: { $in: fatture.map((fattura) => fattura._id) } })
        .select('fattura lettura listino metri_cubi valore_unitario tipo_quota tipo_tariffa')
        .lean();
    const letture = perId(await Lettura.find({ _id: { $in: servizi.map((riga) => riga.lettura).filter(Boolean) } })
        .select('contatore')
        .lean());
    const contatori = perId(await Contatore.find({ _id: { $in: [...letture.values()].map((lettura) => lettura.contatore) } })
        .select('listino')
        .lean());
    const listini = perId(await Listino.find({
        _id: { $in: [...servizi.map((riga) => riga.listino), ...[...contatori.values()].map((c) => c.listino)].filter(Boolean) },
    }).select('categoria descrizione').lean());

    const contatoreDi = (riga) => recordId(letture.get(recordId(riga.lettura))?.contatore) || null;
    const categoriaDi = (riga) => {
        if (!riga.lettura) {
            return SENZA_LETTURA;
        }
        const listino = listini.get(recordId(riga.listino)) || listini.get(recordId(contatori.get(contatoreDi(riga))?.listino));
        return listino?.categoria || listino?.descrizione || 'Senza listino';
    };

    const gruppi = new Map();
    servizi.forEach((riga) => {
        const categoria = categoriaDi(riga);
        gruppi.set(categoria, [...(gruppi.get(categoria) || []), riga]);
    });

    const righe = [...gruppi.entries()]
        .map(([categoria, delGruppo]) => rigaDellaCategoria(categoria, delGruppo, contatoreDi))
        .sort((a, b) => b.imponibile - a.imponibile);

    return righe.length ? [...righe, rigaDellaCategoria('Totale', servizi, contatoreDi)] : [];
};

const riepilogoDellAnno = async (anno) => {
    const righe = await righeDellAnno(anno);
    const totale = righe.at(-1);
    return {
        anno,
        righe: Math.max(0, righe.length - 1),
        fatture: totale?.fatture || 0,
        imponibile: totale?.imponibile || 0,
    };
};

module.exports = {
    COLONNE,
    riepilogoDellAnno,
    righeDellAnno,
};
