// Controlla che ogni riga fattura rispetti la formula prezzo x quantita e che
// l'IVA corrisponda all'articolo.
//
// E un rapporto, non un test: stampa cio che trova e non fa fallire nulla.
const { runScript } = require('./utils/runScript');
const Servizio = require('../models/Servizio');
require('../models/Articolo');

const {
    getTaxRate,
    isFixedBand,
    numberOrZero,
    roundMoney,
} = require('../services/billingCalculator');

const TOLERANCE = 0.02;

const closeMoney = (a, b) => Math.abs(roundMoney(a) - roundMoney(b)) <= TOLERANCE;
const isCondominiumFixed = (service) => service.articolo?.codice === 'CONDF';
const isFixedService = (service) => Boolean(service.tipo_quota) || isFixedBand(service);
const hasBillableNumbers = (service) => (
    service.valore_unitario !== undefined
    && service.valore_unitario !== null
    && service.prezzo !== undefined
    && service.prezzo !== null
);

const getExpectedLineTotals = (service) => {
    const price = numberOrZero(service.prezzo);
    const quantityTotal = roundMoney(numberOrZero(service.metri_cubi) * price);

    if (isFixedService(service) && !isCondominiumFixed(service)) {
        return [roundMoney(price), quantityTotal];
    }

    return [quantityTotal];
};

const getLineType = (service) => {
    if (isCondominiumFixed(service)) {
        return 'fisso condominiale ripartito';
    }
    if (isFixedService(service)) {
        return 'fisso';
    }
    return 'consumo/servizio';
};

const main = async () => {

    const services = await Servizio.find({ fattura: { $ne: null } })
        .populate('articolo')
        .lean();
    const stats = {
        lines: services.length,
        checked: 0,
        fixed: 0,
        condominiumFixed: 0,
        fixedMultiplied: 0,
        variable: 0,
        mismatches: [],
        taxMissing: 0,
    };

    services.forEach((service) => {
        if (!hasBillableNumbers(service)) {
            return;
        }

        const type = getLineType(service);
        const expectedTotals = getExpectedLineTotals(service);
        const actual = roundMoney(service.valore_unitario);
        const matches = expectedTotals.some((expected) => closeMoney(actual, expected));

        stats.checked += 1;
        if (type === 'fisso') {
            stats.fixed += 1;
            if (!closeMoney(actual, numberOrZero(service.prezzo))) {
                stats.fixedMultiplied += 1;
            }
        } else if (type === 'fisso condominiale ripartito') {
            stats.condominiumFixed += 1;
        } else {
            stats.variable += 1;
        }

        if (!matches && stats.mismatches.length < 20) {
            stats.mismatches.push({
                servizio: service._id,
                articolo: service.articolo?.codice,
                tipo: type,
                tariffa: service.tipo_tariffa,
                metri_cubi: service.metri_cubi,
                prezzo: service.prezzo,
                valore_unitario: service.valore_unitario,
                expected: expectedTotals,
            });
        }

        if ((service.aliquota_iva === undefined || service.aliquota_iva === null) && getTaxRate(service.articolo) === 0) {
            stats.taxMissing += 1;
        }
    });

    console.log('Verifica formule righe fattura');
    console.log(`Righe totali: ${stats.lines}`);
    console.log(`Righe controllate: ${stats.checked}`);
    console.log(`Righe consumo/servizio: ${stats.variable}`);
    console.log(`Righe fisso standard: ${stats.fixed}`);
    console.log(`Righe fisso standard moltiplicate per quantita: ${stats.fixedMultiplied}`);
    console.log(`Righe fisso condominiale ripartito: ${stats.condominiumFixed}`);
    console.log(`Righe con formula non coerente: ${stats.mismatches.length}`);
    console.log(`Righe senza IVA deducibile: ${stats.taxMissing}`);

    if (stats.mismatches.length) {
        console.log('\nEsempi formula non coerente:');
        console.log(JSON.stringify(stats.mismatches, null, 2));
    }

    // Restituire false segnala l'esito negativo: disconnessione e codice
    // di uscita sono compito di runScript.
    return !(stats.mismatches.length > 0);
};

runScript(main);
