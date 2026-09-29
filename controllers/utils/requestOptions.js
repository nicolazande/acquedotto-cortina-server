// Lettura delle opzioni dalla richiesta HTTP.
const { parseOptionalBoolean } = require('../../utils/values');

// Cosa mettere in fattura oltre ai consumi: la quota fissa e la mora. Valgono
// uguali per l'anteprima (dalla querystring) e per la generazione (dal corpo),
// dalla pagina di generazione come dalla scheda del cliente: leggerle in un
// posto solo evita che una strada dimentichi un parametro quando se ne aggiunge
// uno. Un valore assente lascia la scelta predefinita, cioe includere.
const billingOptions = (source = {}) => ({
    includeDelay: parseOptionalBoolean(source.includeDelay),
    includeFixedCharge: parseOptionalBoolean(source.includeFixedCharge),
});

const invoiceGenerationOptions = (body = {}) => ({
    ...billingOptions(body),
    data_fattura: body.data_fattura,
    data_scadenza: body.data_scadenza,
    tipo_documento: body.tipo_documento,
});

module.exports = {
    billingOptions,
    invoiceGenerationOptions,
    parseOptionalBoolean,
};
