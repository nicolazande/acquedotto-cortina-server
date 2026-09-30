// Gli addebiti da chiedere alla banca per le fatture di un anno: chi paga con
// l'addebito in conto (`pagaConAddebito`, cioe chi ci ha dato l'IBAN), quanto e
// entro quando. Prima la distinta si faceva a mano, copiando IBAN e importi dalle
// fatture: qui esce gia pronta, in ordine di scadenza, con scritto accanto a
// ogni riga cosa manca perche la banca la accetti.
//
// Contano le fatture confermate - non le note di credito, che sono soldi da
// rendere - con la scadenza aperta e **non ancora passata**. L'addebito si chiede
// prima della scadenza: dopo, o la banca ha gia incassato o la fattura e da
// sollecitare. Gli incassi si registrano nel programma di contabilita, quindi
// "aperta" da sola non basterebbe: la distinta di dicembre ripeterebbe gli
// addebiti di novembre, gia pagati.

const Fattura = require('../models/Fattura');
const { NON_SALDATA } = require('../models/Scadenza');
require('../models/Cliente');
const { FILTRO_CONFERMATE, numeroDocumento, pagaConAddebito, tipoDocumentoXml } = require('../config/invoicing');
const { customerLabel } = require('../utils/customer');
const { formatItalianDate, startOfDay } = require('../utils/dates');
const { ibanLeggibile, ibanValido } = require('../utils/iban');
const { importoItaliano } = require('../utils/money');
const { sumMoneyBy } = require('../utils/values');

const COLONNE = [
    { titolo: 'Scadenza', campo: 'scadenza', larghezza: 45 },
    { titolo: 'Cliente', campo: 'cliente', larghezza: 130 },
    { titolo: 'IBAN', campo: 'iban', larghezza: 125 },
    { titolo: 'Mandato del', campo: 'mandato', larghezza: 45 },
    { titolo: 'Fattura', campo: 'fattura', larghezza: 45 },
    { titolo: 'Importo (euro)', campo: 'importo', larghezza: 50, numero: true, euro: true },
    { titolo: 'Da sistemare', campo: 'daSistemare', larghezza: 90 },
];

// Cosa manca a una riga perche la banca la accetti: un conto che non sta in
// piedi, o un mandato di cui non si sa la data di firma, che la distinta vuole.
const cosaManca = (cliente) => [
    !ibanValido(cliente.iban) && 'IBAN non valido',
    !cliente.data_mandato_sdd && 'manca la data del mandato',
].filter(Boolean).join(', ');

const righeDellAnno = async (anno, { oggi = new Date() } = {}) => {
    const fatture = await Fattura.find({ anno, ...FILTRO_CONFERMATE })
        .select('anno numero serie codice confermata stato tipo_documento totale_fattura cliente scadenza')
        .populate('cliente', 'ragione_sociale cognome nome iban data_mandato_sdd')
        .populate({
            path: 'scadenza',
            match: { ...NON_SALDATA, scadenza: { $gte: startOfDay(oggi) } },
            select: 'scadenza',
        })
        .lean();

    return fatture
        .filter((fattura) => fattura.cliente && fattura.scadenza && pagaConAddebito(fattura.cliente)
            && tipoDocumentoXml(fattura.tipo_documento) !== 'TD04')
        .map((fattura) => ({
            quando: new Date(fattura.scadenza.scadenza).getTime(),
            scadenza: formatItalianDate(fattura.scadenza.scadenza),
            cliente: customerLabel(fattura.cliente),
            iban: ibanLeggibile(fattura.cliente.iban),
            mandato: formatItalianDate(fattura.cliente.data_mandato_sdd),
            fattura: numeroDocumento(fattura),
            importo: fattura.totale_fattura,
            daSistemare: cosaManca(fattura.cliente),
        }))
        .sort((a, b) => a.quando - b.quando || a.cliente.localeCompare(b.cliente, 'it'))
        .map(({ quando, ...riga }) => riga);
};

const riepilogoDelleRighe = (anno, righe) => ({
    anno,
    righe: righe.length,
    clienti: new Set(righe.map((riga) => `${riga.cliente}|${riga.iban}`)).size,
    totale: sumMoneyBy(righe, (riga) => riga.importo),
    daSistemare: righe.filter((riga) => riga.daSistemare).length,
});

const riepilogoDellAnno = async (anno) => riepilogoDelleRighe(anno, await righeDellAnno(anno));

// In fondo a ogni pagina quanti sono e quanto fanno: e il totale che la banca
// ripete nella distinta, il primo controllo che non manchi niente.
const piede = (righe) => `${righe.length === 1 ? 'Un addebito' : `${righe.length} addebiti`} `
    + `per ${importoItaliano(sumMoneyBy(righe, (riga) => riga.importo))} euro`;

module.exports = {
    COLONNE,
    cosaManca,
    piede,
    riepilogoDelleRighe,
    riepilogoDellAnno,
    righeDellAnno,
};
