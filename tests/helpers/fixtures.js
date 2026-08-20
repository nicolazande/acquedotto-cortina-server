// Costruttori minimi per i test del calcolatore: solo i campi che il calcolo legge.
const articolo = (codice, iva = 'IVA 10%') => ({ _id: `art-${codice}`, codice, descrizione: codice, iva });

const ARTICOLI = {
    ACQUA: articolo('ACQUA'),
    ACQUAF: articolo('ACQUAF'),
    COND: articolo('COND'),
    CONDF: articolo('CONDF'),
    GG_DELAY: articolo('GG_DELAY', 'Esente art.15'),
};

const listino = (categoria = 'DOMESTICO') => ({ _id: 'listino-1', categoria, descrizione: categoria });

const fascia = ({ tipo, min, max, prezzo, inizio, scadenza, listinoId = 'listino-1' }) => ({
    _id: `fascia-${tipo}-${min}`,
    tipo,
    min,
    max,
    prezzo,
    inizio,
    scadenza,
    listino: listinoId,
});

// Tariffa a scaglioni con estremi inclusivi, come nei listini reali.
const FASCE_STANDARD = [
    fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.33 }),
    fascia({ tipo: 'Ordinaria', min: 101, max: 150, prezzo: 0.73 }),
    fascia({ tipo: '1° Supero', min: 151, max: 200, prezzo: 0.83 }),
    fascia({ tipo: 'Fisso', min: 0, max: 99999, prezzo: 99 }),
];

const contatore = (overrides = {}) => ({
    _id: 'contatore-1',
    codice: 'C-1',
    seriale: 'S-1',
    tipo_contatore: 'Singolo',
    tipo_attivita: 'Uso domestico',
    listino: listino(),
    ...overrides,
});

const lettura = (overrides = {}) => ({
    _id: 'lettura-1',
    data_lettura: new Date('2026-06-15T00:00:00.000Z'),
    consumo: 135,
    ...overrides,
});

module.exports = {
    ARTICOLI,
    FASCE_STANDARD,
    articolo,
    contatore,
    fascia,
    lettura,
    listino,
};
