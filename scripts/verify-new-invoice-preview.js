// Anteprima delle fatture generabili dalle letture non ancora fatturate.
//
// E un rapporto, non un test: stampa cio che trova e non fa fallire nulla.
const { runScript } = require('./utils/runScript');
const { previewBillingBatch } = require('../services/invoiceGenerator');

const parseArgs = () => {
    const limitIndex = process.argv.indexOf('--limit');
    return {
        limit: limitIndex === -1 ? 2000 : Number(process.argv[limitIndex + 1]),
        verbose: process.argv.includes('--verbose'),
    };
};

const main = async () => {
    const args = parseArgs();

    const preview = await previewBillingBatch({ limit: args.limit });
    const anomalies = [
        ...preview.anomalies,
        ...preview.clienti.flatMap((cliente) => cliente.anomalies || []),
    ];

    console.log('Preview nuove fatture da letture');
    console.log(`Letture scansionate: ${preview.scannedReadings}`);
    console.log(`Clienti pronti: ${preview.totals.clienti}`);
    console.log(`Letture fatturabili: ${preview.totals.letture}`);
    console.log(`Anomalie bloccanti: ${anomalies.length}`);
    console.log(`Totale imponibile preview: ${preview.totals.imponibile}`);
    console.log(`Totale IVA preview: ${preview.totals.iva}`);
    console.log(`Totale fatture preview: ${preview.totals.totale_fattura}`);

    if (args.verbose && anomalies.length) {
        console.log('\nAnomalie:');
        console.log(JSON.stringify(anomalies.slice(0, 20), null, 2));
    }

    // Restituire false segnala l'esito negativo: alla disconnessione e al codice
    // di uscita pensa runScript.
    return anomalies.length === 0;
};

runScript(main);
