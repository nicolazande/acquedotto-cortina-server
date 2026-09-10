// Gli elenchi che una volta l'anno vanno fuori: chi li produce, come si
// chiamano i file, cosa mostrarne prima di scaricarli.
//
// E un registro come `resources.js`: aggiungere un elenco vuol dire aggiungere
// una voce qui, non un altro controller e altre rotte uguali alle prime. Oggi
// c'e solo il BIM, ma l'Anagrafe Tributaria e gia scritta a meta e arrivera.
//
// Sta fra i servizi e non in `config` perche i servizi che produce li deve
// conoscere, e `config` e una foglia: da li non si guarda verso l'alto.

const elencoBim = require('../services/elencoBim');

const ELENCHI = {
    bim: {
        etichetta: 'Consumi per il BIM',
        // Il nome del file che arriva a chi lo scarica, anno compreso.
        nomeFile: (anno) => `Elenco_BIM_${anno}`,
        // Il titolo del foglio dentro l'Excel, che non e il nome del file.
        titolo: (anno) => `Consumi ${anno}`,
        colonne: elencoBim.COLONNE,
        righe: elencoBim.righeDellAnno,
        riepilogo: elencoBim.riepilogoDellAnno,
    },
};

const NOMI_ELENCHI = Object.freeze(Object.keys(ELENCHI));

const getElenco = (nome) => ELENCHI[nome];

module.exports = {
    NOMI_ELENCHI,
    getElenco,
};
