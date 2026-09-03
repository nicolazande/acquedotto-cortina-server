// La storia di un punto di fornitura.
//
// Un contatore non e il punto di fornitura: ne e solo il pezzo montato in un
// certo periodo. Quando viene sostituito perche guasto, o quando cambia
// l'intestatario, ne compare uno nuovo e il vecchio resta con le sue letture.
// Seguendo all'indietro `precedente` si rimette insieme la storia intera.
//
// Non si memorizza nulla di nuovo: matricole, date, letture e motivo sono gia
// sui contatori e sulle loro letture. Qui si mettono solo in fila.
const Contatore = require('../models/Contatore');
const Lettura = require('../models/Lettura');
const { notFound } = require('../utils/errors');

// Un anello della catena, con cio che serve a chi ricostruisce: quale
// apparecchio, di chi era, per quanto, e con quale indice si e chiuso.
const anello = async (contatore) => {
    const [prima, ultima] = await Promise.all([
        Lettura.findOne({ contatore: contatore._id }).sort({ data_lettura: 1 }).select('data_lettura consumo').lean(),
        Lettura.findOne({ contatore: contatore._id }).sort({ data_lettura: -1 }).select('data_lettura consumo').lean(),
    ]);

    return {
        _id: contatore._id,
        codice: contatore.codice,
        seriale: contatore.seriale,
        cliente: contatore.cliente,
        nome_cliente: contatore.nome_cliente,
        inizio: contatore.inizio,
        scadenza: contatore.scadenza,
        causale: contatore.causale,
        note: contatore.note,
        prima_lettura: prima ? { data: prima.data_lettura, indice: prima.consumo } : null,
        ultima_lettura: ultima ? { data: ultima.data_lettura, indice: ultima.consumo } : null,
        letture: await Lettura.countDocuments({ contatore: contatore._id }),
    };
};

// Dal contatore chiesto si risale all'indietro fino al primo, poi si torna in
// avanti fino all'ultimo che lo ha sostituito: la catena e completa da
// qualunque anello si parta.
const storiaContatore = async (contatoreId) => {
    const partenza = await Contatore.findById(contatoreId)
        .select('codice seriale cliente nome_cliente inizio scadenza causale note precedente')
        .lean();

    if (!partenza) {
        throw notFound('Contatore not found');
    }

    const catena = [partenza];
    const visti = new Set([String(partenza._id)]);

    let corrente = partenza;
    while (corrente?.precedente && !visti.has(String(corrente.precedente))) {
        visti.add(String(corrente.precedente));
        corrente = await Contatore.findById(corrente.precedente)
            .select('codice seriale cliente nome_cliente inizio scadenza causale note precedente')
            .lean();
        if (corrente) catena.unshift(corrente);
    }

    corrente = partenza;
    for (;;) {
        const successore = await Contatore.findOne({ precedente: corrente._id })
            .select('codice seriale cliente nome_cliente inizio scadenza causale note precedente')
            .lean();
        if (!successore || visti.has(String(successore._id))) break;
        visti.add(String(successore._id));
        catena.push(successore);
        corrente = successore;
    }

    return {
        contatore: partenza._id,
        quanti: catena.length,
        catena: await Promise.all(catena.map(anello)),
    };
};

module.exports = { storiaContatore };
