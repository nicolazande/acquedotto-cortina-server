const Articolo = require('../models/Articolo');
const Servizio = require('../models/Servizio');
const { sendPaginated } = require('./utils/paginatedQuery');
const { getTaxRate } = require('../services/billingCalculator');
const {
    associateRecords,
    createRecord,
    deleteRecord,
    getManyByField,
    getRecord,
    updateRecord,
} = require('./utils/controllerActions');

// Le tariffe determinano quanto pagano i clienti: ogni modifica lascia traccia.
const audit = {
        entityType: 'Articolo',
        fields: ['codice', 'descrizione', 'iva'],
        label: (record) => `${record.codice} (IVA ${record.iva})`,
    };

module.exports = {
    createArticolo: createRecord(Articolo, { audit, name: 'Articolo' }),
    getArticoli: (req, res) => sendPaginated(Articolo, req, res, {
        defaultSort: 'descrizione',
        errorMessage: 'Error fetching articoli',
        // L'aliquota e scritta dentro l'etichetta ("IVA 10%", "Esente art.15"):
        // e la forma giusta per la fattura elettronica, che vuole la dicitura,
        // ma per fare un conto serve il numero. Si ricava qui con la stessa
        // funzione che usa la fatturazione, invece di lasciare che il client si
        // scriva la sua regola per leggere quella stringa.
        transform: (articolo) => ({ ...articolo.toObject?.() ?? articolo, aliquota: getTaxRate(articolo) }),
    }),
    getArticolo: getRecord(Articolo, { name: 'Articolo' }),
    updateArticolo: updateRecord(Articolo, { audit, name: 'Articolo' }),
    deleteArticolo: deleteRecord(Articolo, { audit, name: 'Articolo' }),
    associateServizio: associateRecords({
        field: 'articolo',
        responseKey: 'servizio',
        setOn: 'target',
        sourceModel: Articolo,
        sourceName: 'Articolo',
        sourceParam: 'articoloId',
        targetModel: Servizio,
        targetName: 'Servizio',
        targetParam: 'servizioId',
    }),
    getServiziAssociati: getManyByField({
        Model: Servizio,
        field: 'articolo',
        errorMessage: 'Error fetching servizi associati',
    }),
};
