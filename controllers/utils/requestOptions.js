// Lettura delle opzioni dalla richiesta HTTP.
const { parseOptionalBoolean } = require('../../utils/values');

// Le opzioni di generazione di una fattura. Sono le stesse per la generazione
// da elenco letture e per quella dalla scheda cliente: leggerle in un posto solo
// evita che una delle due dimentichi un parametro quando se ne aggiunge uno.
const invoiceGenerationOptions = (body = {}) => ({
    data_fattura: body.data_fattura,
    data_scadenza: body.data_scadenza,
    includeFixedCharge: parseOptionalBoolean(body.includeFixedCharge),
    tipo_documento: body.tipo_documento,
    confermata: body.confermata,
});

module.exports = {
    invoiceGenerationOptions,
    parseOptionalBoolean,
};
