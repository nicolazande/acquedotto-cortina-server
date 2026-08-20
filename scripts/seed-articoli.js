// Gli articoli con questi codici sono obbligatori: senza di loro la generazione
// fattura si ferma, perche l'aliquota IVA di ogni riga si ricava dall'articolo.
// Su una installazione nuova questo script crea le voci mancanti senza toccare
// quelle gia presenti.
const { runScript } = require('./utils/runScript');
const Articolo = require('../models/Articolo');
const {
    DEFAULT_CONDOMINIUM_ARTICLE_CODE,
    DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE,
    DEFAULT_DELAY_ARTICLE_CODE,
    DEFAULT_FIXED_ARTICLE_CODE,
    DEFAULT_WATER_ARTICLE_CODE,
} = require('../services/billingCalculator');

const ARTICOLI_RICHIESTI = [
    { codice: DEFAULT_WATER_ARTICLE_CODE, descrizione: 'Consumo acqua', iva: 'IVA 10%' },
    { codice: DEFAULT_FIXED_ARTICLE_CODE, descrizione: 'Quota fissa acqua', iva: 'IVA 10%' },
    { codice: DEFAULT_CONDOMINIUM_ARTICLE_CODE, descrizione: 'Consumo acqua condominiale', iva: 'IVA 10%' },
    { codice: DEFAULT_CONDOMINIUM_FIXED_ARTICLE_CODE, descrizione: 'Quota fissa condominiale', iva: 'IVA 10%' },
    { codice: DEFAULT_DELAY_ARTICLE_CODE, descrizione: 'Ritardo pagamento', iva: 'Esente art.15' },
];

const main = async () => {

    let creati = 0;
    for (const articolo of ARTICOLI_RICHIESTI) {
        const esistente = await Articolo.findOne({ codice: articolo.codice }).lean();

        if (esistente) {
            console.log(`  presente  ${articolo.codice.padEnd(10)} ${esistente.iva}`);
            continue;
        }

        await Articolo.create(articolo);
        creati += 1;
        console.log(`  creato    ${articolo.codice.padEnd(10)} ${articolo.iva}`);
    }

    console.log(creati ? `\nArticoli creati: ${creati}` : '\nTutti gli articoli richiesti erano gia presenti.');
};

runScript(main);
