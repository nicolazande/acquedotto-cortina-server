const Articolo = require('../models/Articolo');
const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Edificio = require('../models/Edificio');
const Fascia = require('../models/Fascia');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Listino = require('../models/Listino');
const Scadenza = require('../models/Scadenza');
const Servizio = require('../models/Servizio');

const resourceModels = {
    articoli: Articolo,
    clienti: Cliente,
    contatori: Contatore,
    edifici: Edificio,
    fasce: Fascia,
    fatture: Fattura,
    letture: Lettura,
    listini: Listino,
    scadenze: Scadenza,
    servizi: Servizio,
};

const RESOURCE_NAMES = Object.freeze(Object.keys(resourceModels));

const getResourceModel = (resource) => resourceModels[resource];

module.exports = {
    RESOURCE_NAMES,
    getResourceModel,
    resourceModels,
};
