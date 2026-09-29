// Subentri e sostituzioni di un anno: chi e subentrato a chi sullo stesso
// apparecchio, e quali contatori sono stati cambiati. In Gesco erano due stampe,
// "Lista dei subentri" e "Lista delle sostituzioni", senza filtro di periodo;
// qui sono un elenco solo, per l'anno in cui e cominciato il contatore nuovo.
//
// Non si memorizza niente di nuovo. Una sostituzione ha il suo collegamento
// (`precedente`); un subentro lo lega la matricola, che resta quella del pezzo
// montato (`predecessorePerMatricola`, la stessa regola dell'Anagrafe Tributaria).

const Contatore = require('../models/Contatore');
const Lettura = require('../models/Lettura');
require('../models/Cliente');
const { predecessorePerMatricola } = require('./counterHistoryService');
const { customerLabel } = require('../utils/customer');
const { formatItalianDate } = require('../utils/dates');

const COLONNE = [
    { titolo: 'Tipo', campo: 'tipo', larghezza: 45 },
    { titolo: 'Dal', campo: 'dal', larghezza: 40 },
    { titolo: 'Cliente precedente', campo: 'clientePrecedente', larghezza: 130 },
    { titolo: 'Matricola prec.', campo: 'matricolaPrecedente', larghezza: 60 },
    { titolo: 'Ultima lettura', campo: 'ultimaLettura', larghezza: 70 },
    { titolo: 'Nuovo cliente', campo: 'nuovoCliente', larghezza: 130 },
    { titolo: 'Nuova matricola', campo: 'nuovaMatricola', larghezza: 60 },
];

const CAMPI = 'seriale inizio scadenza cliente nome_cliente precedente sostituzione subentro';

const nomeDi = (contatore) => customerLabel(contatore?.cliente) || contatore?.nome_cliente || '';

const righeDellAnno = async (anno) => {
    const nuovi = await Contatore.find({
        inizio: { $gte: new Date(Date.UTC(anno, 0, 1)), $lt: new Date(Date.UTC(anno + 1, 0, 1)) },
    }).select(CAMPI).populate('cliente', 'ragione_sociale cognome nome').sort({ inizio: 1 }).lean();

    const seriali = [...new Set(nuovi.map((contatore) => contatore.seriale).filter(Boolean))];
    const idPrecedenti = nuovi.map((contatore) => contatore.precedente).filter(Boolean);
    const vecchi = await Contatore.find({ $or: [{ seriale: { $in: seriali } }, { _id: { $in: idPrecedenti } }] })
        .select(CAMPI)
        .populate('cliente', 'ragione_sociale cognome nome')
        .lean();
    const perId = new Map(vecchi.map((contatore) => [String(contatore._id), contatore]));

    const righe = [];
    for (const nuovo of nuovi) {
        const sostituzione = Boolean(nuovo.precedente) || nuovo.sostituzione === true;
        const vecchio = nuovo.precedente
            ? perId.get(String(nuovo.precedente))
            : predecessorePerMatricola(nuovo, vecchi);
        if (!vecchio) {
            continue;
        }

        const ultima = await Lettura.findOne({ contatore: vecchio._id })
            .sort({ data_lettura: -1, _id: -1 })
            .select('data_lettura consumo')
            .lean();

        righe.push({
            tipo: sostituzione ? 'Sostituzione' : 'Subentro',
            dal: formatItalianDate(nuovo.inizio),
            clientePrecedente: nomeDi(vecchio),
            matricolaPrecedente: vecchio.seriale || '',
            ultimaLettura: ultima ? `${ultima.consumo} (${formatItalianDate(ultima.data_lettura)})` : '',
            nuovoCliente: nomeDi(nuovo),
            nuovaMatricola: nuovo.seriale || '',
        });
    }

    return righe;
};

const riepilogoDellAnno = async (anno) => {
    const righe = await righeDellAnno(anno);
    return {
        anno,
        righe: righe.length,
        subentri: righe.filter((riga) => riga.tipo === 'Subentro').length,
        sostituzioni: righe.filter((riga) => riga.tipo === 'Sostituzione').length,
    };
};

module.exports = {
    COLONNE,
    riepilogoDellAnno,
    righeDellAnno,
};
