// Gli elenchi che una volta l'anno vanno fuori, in uno dei tre formati che chi
// li riceve sa aprire.
//
// Non sa quali elenchi esistono ne cosa contengono: li chiede al registro. Un
// elenco nuovo si aggiunge li e ha subito rotte, formati e riepilogo.

const { creaExcel, creaPdf, creaWord } = require('../services/tabellaStampabile');
const { getElenco } = require('../services/registroElenchi');
const { sendServiceError } = require('./utils/controllerActions');
const anagrafe = require('../config/anagrafeTributaria');

const FORMATI = {
    excel: {
        estensione: 'xlsx',
        tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        crea: (elenco, righe, opzioni) => creaExcel(elenco.colonne, righe, elenco.titolo(opzioni.anno)),
    },
    pdf: {
        estensione: 'pdf',
        tipo: 'application/pdf',
        crea: (elenco, righe, opzioni) => creaPdf(elenco.colonne, righe, opzioni),
    },
    word: {
        estensione: 'docx',
        tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        crea: (elenco, righe, opzioni) => creaWord(elenco.colonne, righe, opzioni),
    },
};

const FORMATI_AMMESSI = Object.keys(FORMATI).join(', ');

// L'anno chiesto, o quello scorso: l'elenco si manda a inizio anno per i consumi
// di quello appena chiuso, che e il caso normale.
const annoRichiesto = (valore) => {
    const anno = Number.parseInt(valore, 10);
    if (Number.isInteger(anno) && anno >= 1900 && anno <= 2200) return anno;
    return new Date().getUTCFullYear() - 1;
};

// Un nome di elenco che non esiste e un 404, non un 500: la rotta e valida, e
// quello che si chiede a non esserci.
const trovaElenco = (req, res) => {
    const elenco = getElenco(String(req.params.elenco || '').toLowerCase());
    if (!elenco) {
        res.status(404).json({ error: `Elenco sconosciuto: ${req.params.elenco}` });
        return null;
    }

    return elenco;
};

const scaricaElenco = async (req, res) => {
    try {
        const elenco = trovaElenco(req, res);
        if (!elenco) return undefined;

        const formato = FORMATI[String(req.params.formato || '').toLowerCase()];
        if (!formato) {
            return res.status(400).json({ error: `Formato non valido: usare ${FORMATI_AMMESSI}` });
        }

        const anno = annoRichiesto(req.query.anno);
        const righe = await elenco.righe(anno);
        const buffer = formato.crea(elenco, righe, { anno, ente: anagrafe.denominazione });
        const filename = `${elenco.nomeFile(anno)}.${formato.estensione}`;

        res.setHeader('Content-Type', formato.tipo);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
    } catch (error) {
        return sendServiceError(res, error, 'Error generating elenco');
    }
};

// Cosa c'e dentro l'elenco, prima di scaricarlo: quante utenze, quanti metri
// cubi, e le poche cose che vale la pena guardare prima di mandarlo fuori.
const riepilogoElenco = async (req, res) => {
    try {
        const elenco = trovaElenco(req, res);
        if (!elenco) return undefined;

        return res.status(200).json(await elenco.riepilogo(annoRichiesto(req.query.anno)));
    } catch (error) {
        return sendServiceError(res, error, 'Error reading elenco summary');
    }
};

module.exports = { riepilogoElenco, scaricaElenco };
