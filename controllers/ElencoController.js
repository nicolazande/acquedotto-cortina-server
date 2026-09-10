// Gli elenchi che una volta l'anno vanno fuori: i consumi al BIM, che ci fattura
// fognatura e depurazione.
//
// Chi li riceve li vuole in tre formati diversi, ma sono lo stesso elenco: le
// righe si preparano una volta sola e il formato decide solo l'impaginazione.

const { creaExcel, creaPdf, creaWord, riepilogoDellAnno, righeDellAnno } = require('../services/elencoBim');
const { sendServiceError } = require('./utils/controllerActions');
const anagrafe = require('../config/anagrafeTributaria');

const FORMATI = {
    excel: {
        estensione: 'xlsx',
        tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        crea: (righe, opzioni) => creaExcel(righe, `Consumi ${opzioni.anno}`),
    },
    pdf: {
        estensione: 'pdf',
        tipo: 'application/pdf',
        crea: creaPdf,
    },
    word: {
        estensione: 'docx',
        tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        crea: creaWord,
    },
};

// L'anno chiesto, o quello scorso: l'elenco si manda a inizio anno per i consumi
// di quello appena chiuso, che e il caso normale.
const annoRichiesto = (valore) => {
    const anno = Number.parseInt(valore, 10);
    if (Number.isInteger(anno) && anno >= 1900 && anno <= 2200) return anno;
    return new Date().getUTCFullYear() - 1;
};

const scaricaElencoBim = async (req, res) => {
    try {
        const formato = FORMATI[String(req.params.formato || '').toLowerCase()];
        if (!formato) {
            return res.status(400).json({ error: 'Formato non valido: usare excel, pdf o word' });
        }

        const anno = annoRichiesto(req.query.anno);
        const righe = await righeDellAnno(anno);
        const buffer = formato.crea(righe, { anno, ente: anagrafe.denominazione });
        const filename = `Elenco_BIM_${anno}.${formato.estensione}`;

        res.setHeader('Content-Type', formato.tipo);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
    } catch (error) {
        return sendServiceError(res, error, 'Error generating elenco BIM');
    }
};

// Cosa c'e dentro l'elenco, prima di scaricarlo: quante utenze, quanti metri
// cubi, e le poche cose che vale la pena guardare prima di mandarlo fuori.
const riepilogoElencoBim = async (req, res) => {
    try {
        return res.status(200).json(await riepilogoDellAnno(annoRichiesto(req.query.anno)));
    } catch (error) {
        return sendServiceError(res, error, 'Error reading elenco BIM summary');
    }
};

module.exports = { riepilogoElencoBim, scaricaElencoBim };
