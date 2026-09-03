// I contatori progressivi persistenti.
//
// Ce ne sono due, e servono a cose diverse che e bene non confondere:
//
//   fatture:<serie>  il numero della fattura, che riparte ogni anno ed e cio
//                    che il cliente vede sul documento;
//   trasmissioni     il progressivo di invio allo SdI, che non riparte mai.
//
// Il secondo non e ricavabile dal primo. Il nome del file trasmesso
// (IT<partitaIva>_<progressivo>.xml) deve essere unico per sempre: se una
// fattura viene scartata e rispedita, il file deve avere un nome nuovo,
// altrimenti lo SdI lo rifiuta come gia inviato. Un progressivo dedotto dal
// numero della fattura non puo cambiare, e quindi non si puo rispedire nulla.
const InvoiceCounter = require('../models/InvoiceCounter');

// I contatori che non hanno un anno usano questo, perche l'indice e su
// (scope, anno) e vuole comunque un valore.
const SENZA_ANNO = 0;

const prossimoNumero = async ({ scope, year = SENZA_ANNO, session }) => {
    const counter = await InvoiceCounter.findOneAndUpdate(
        { scope, year },
        { $inc: { value: 1 } },
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
const riservaProgressivoInvio = async (session) => {
    const numero = await prossimoNumero({ scope: 'trasmissioni', session });
    return numero.toString(36).toUpperCase().padStart(5, '0');
};

module.exports = {
    prossimoNumero,
    riservaProgressivoInvio,
};
