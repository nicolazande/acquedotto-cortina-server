// Gli elenchi che una volta l'anno vanno fuori: chi li produce, come si
// chiamano i file, cosa mostrarne prima di scaricarli.
//
// E un registro come `resources.js`: aggiungere un elenco vuol dire aggiungere
// una voce qui, non un altro controller e altre rotte uguali alle prime.
//
// Sta fra i servizi e non in `config` perche i servizi che produce li deve
// conoscere, e `config` e una foglia: da li non si guarda verso l'alto.

const elencoBim = require('./elencoBim');
const elencoCategorie = require('./elencoCategorie');
const elencoSubentri = require('./elencoSubentri');
const elencoUfficioEntrate = require('./elencoUfficioEntrate');

const ELENCHI = {
    bim: {
        // Il nome del file che arriva a chi lo scarica, anno compreso.
        nomeFile: (anno) => `Elenco_BIM_${anno}`,
        // Il titolo del foglio dentro l'Excel, che non e il nome del file.
        titolo: (anno) => `Consumi ${anno}`,
        colonne: elencoBim.COLONNE,
        righe: elencoBim.righeDellAnno,
        riepilogo: elencoBim.riepilogoDellAnno,
    },
    // L'Anagrafe Tributaria non vuole una tabella ma un file a larghezza fissa,
    // con un tracciato deciso da loro: non ha colonne, ha `testo`.
    'anagrafe-tributaria': {
        nomeFile: (anno) => `Anagrafe_Tributaria_${anno}`,
        testo: elencoUfficioEntrate.fileDellAnno,
        riepilogo: elencoUfficioEntrate.riepilogoDellAnno,
    },
    // Le due stampe di Gesco che l'ufficio puo chiedere per il Comune o per il
    // commercialista: il fatturato per categoria di tariffa, e subentri e
    // sostituzioni dei contatori.
    categorie: {
        nomeFile: (anno) => `Fatturato_per_categoria_${anno}`,
        titolo: (anno) => `Fatturato ${anno}`,
        intestazione: (anno) => `Fatturato per categoria - Anno ${anno}`,
        piede: (righe) => `${Math.max(0, righe.length - 1)} categorie`,
        colonne: elencoCategorie.COLONNE,
        righe: elencoCategorie.righeDellAnno,
        riepilogo: elencoCategorie.riepilogoDellAnno,
    },
    subentri: {
        nomeFile: (anno) => `Subentri_e_sostituzioni_${anno}`,
        titolo: (anno) => `Subentri ${anno}`,
        intestazione: (anno) => `Subentri e sostituzioni - Anno ${anno}`,
        piede: (righe) => `${righe.length} fra subentri e sostituzioni`,
        colonne: elencoSubentri.COLONNE,
        righe: elencoSubentri.righeDellAnno,
        riepilogo: elencoSubentri.riepilogoDellAnno,
    },
};

const NOMI_ELENCHI = Object.freeze(Object.keys(ELENCHI));

const getElenco = (nome) => ELENCHI[nome];

module.exports = {
    NOMI_ELENCHI,
    getElenco,
};
