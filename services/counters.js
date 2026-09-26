// I contatori progressivi persistenti.
//
// Ce ne sono tre, e servono a cose diverse che e bene non confondere:
//
//   fatture:<serie>  il numero della fattura, che riparte ogni anno ed e cio
//                    che il cliente vede sul documento;
//   trasmissioni     il progressivo di invio allo SdI, che non riparte mai;
//   anagrafe:invii   il codice che identifica un file mandato all'Anagrafe
//                    Tributaria, che cambia a ogni file prodotto.
//
// Il secondo non e ricavabile dal primo. Il nome del file trasmesso
// (IT<partitaIva>_<progressivo>.xml) deve essere unico per sempre: se una
// fattura viene scartata e rispedita, il file deve avere un nome nuovo,
// altrimenti lo SdI lo rifiuta come gia inviato. Un progressivo dedotto dal
// numero della fattura non puo cambiare, e quindi non si puo rispedire nulla.
const InvoiceCounter = require('../models/InvoiceCounter');
const anagrafe = require('../config/anagrafeTributaria');
const { dataCompatta } = require('../utils/dates');

// I contatori che non hanno un anno usano questo, perche l'indice e su
// (scope, anno) e vuole comunque un valore.
const SENZA_ANNO = 0;

// Il contatore dei numeri di fattura di una serie. Lo usano chi assegna un numero
// e chi lo libera cancellando l'ultima fattura: scritto due volte, basterebbe
// cambiarne una perche i due non si parlino piu.
const scopeDellaSerie = (serie) => `fatture:${serie}`;

const prossimoNumero = async ({ scope, year = SENZA_ANNO, session, quanti = 1 }) => {
    const counter = await InvoiceCounter.findOneAndUpdate(
        { scope, year },
        { $inc: { value: quanti } },
        {
            new: true,
            session,
            upsert: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return counter.value;
};

// Il progressivo di invio, in base 36 maiuscola: il tracciato lo vuole
// alfanumerico e lungo al massimo dieci caratteri, e cosi un contatore decimale
// arriverebbe al limite molto prima.
const progressivoDiInvio = (numero) => numero.toString(36).toUpperCase().padStart(5, '0');

// Quanti progressivi servono, in una scrittura sola: un archivio di ottocento
// file non fa ottocento andate e ritorni al database, ne prende un intervallo.
const riservaProgressiviInvio = async (quanti) => {
    if (!quanti) {
        return [];
    }

    const ultimo = await prossimoNumero({ scope: 'trasmissioni', quanti });
    return Array.from({ length: quanti }, (_, indice) => progressivoDiInvio(ultimo - quanti + 1 + indice));
};

// Il codice che identifica un invio all'Anagrafe Tributaria: sei cifre di
// progressivo e la data del giorno, come lo scriveva il gestionale precedente
// (210041 + 28022026). Cambia a ogni file prodotto, anche quando lo stesso elenco
// viene ristampato dopo una correzione segnalata dal Desktop Telematico: due file
// diversi non possono portare lo stesso codice.
const componiCodiceInvio = (progressivo, quando = new Date()) => (
    `${String(progressivo).padStart(6, '0')}${dataCompatta(quando)}`
);

// Il progressivo riparte da dove l'aveva lasciato il gestionale precedente, cosi
// i codici gia mandati all'Agenzia non si ripetono.
const riservaCodiceInvioAnagrafe = async ({ quando = new Date(), session } = {}) => {
    const scope = 'anagrafe:invii';
    const partenza = Number(String(anagrafe.ultimoCodiceInvio || '').slice(0, 6)) || 0;

    await InvoiceCounter.updateOne(
        { scope, year: SENZA_ANNO },
        { $max: { value: partenza } },
        { upsert: true, session }
    );

    return componiCodiceInvio(await prossimoNumero({ scope, session }), quando);
};

module.exports = {
    componiCodiceInvio,
    scopeDellaSerie,
    prossimoNumero,
    progressivoDiInvio,
    riservaCodiceInvioAnagrafe,
    riservaProgressiviInvio,
};
