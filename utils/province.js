// Conversione del nome della provincia nella sigla di due lettere.
//
// Il tracciato della fattura elettronica accetta solo la sigla; l'anagrafica
// importata dal gestionale precedente contiene invece il nome esteso su tutti i
// clienti. La corrispondenza copre i valori realmente presenti nei dati.

const SIGLE = {
    agrigento: 'AG', ancona: 'AN', aquila: 'AQ', "l'aquila": 'AQ',
    'ascoli piceno': 'AP', bari: 'BA', belluno: 'BL', benevento: 'BN',
    bergamo: 'BG', biella: 'BI', bologna: 'BO', bolzano: 'BZ', brescia: 'BS',
    campobasso: 'CB', 'carbonia iglesias': 'SU', catania: 'CT', catanzaro: 'CZ',
    como: 'CO', cremona: 'CR', fermo: 'FM', ferrara: 'FE', firenze: 'FI',
    foggia: 'FG', 'forli cesena': 'FC', 'forlì cesena': 'FC', frosinone: 'FR',
    gorizia: 'GO', imperia: 'IM', 'la spezia': 'SP', latina: 'LT', lecce: 'LE',
    mantova: 'MN', matera: 'MT', messina: 'ME', milano: 'MI', modena: 'MO',
    'monza e della brianza': 'MB', napoli: 'NA', novara: 'NO', padova: 'PD',
    palermo: 'PA', parma: 'PR', pavia: 'PV', perugia: 'PG',
    'pesaro e urbino': 'PU', 'pesaro (vecchio codice)': 'PU', pescara: 'PE',
    piacenza: 'PC', pordenone: 'PN', ravenna: 'RA', 'reggio emilia': 'RE',
    rimini: 'RN', roma: 'RM', rovigo: 'RO', sassari: 'SS', siena: 'SI',
    trento: 'TN', treviso: 'TV', trieste: 'TS', udine: 'UD', varese: 'VA',
    venezia: 'VE', vercelli: 'VC', verona: 'VR', vicenza: 'VI',
};

// Valori che nell'anagrafica indicano "non applicabile": non sono province.
const NON_PROVINCE = new Set(['- nessuna -', 'nessuna', 'stato estero', '']);

const siglaProvincia = (valore) => {
    const testo = String(valore || '').trim();

    if (!testo || NON_PROVINCE.has(testo.toLowerCase())) {
        return null;
    }

    // Gia una sigla di due lettere.
    if (/^[A-Za-z]{2}$/.test(testo)) {
        return testo.toUpperCase();
    }

    return SIGLE[testo.toLowerCase()] || null;
};

module.exports = { siglaProvincia };
