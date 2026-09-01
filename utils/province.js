// Le province italiane: l'elenco da cui si sceglie e la conversione in sigla.
//
// Servono a due cose che devono restare d'accordo. Il tracciato della fattura
// elettronica accetta solo la sigla di due lettere; l'anagrafica scritta a mano
// conteneva il nome per esteso, e in campo libero ha prodotto "Aquila",
// "Pesaro (vecchio codice)" e "Carbonia Iglesias", che e una provincia
// soppressa. Da qui esce anche l'elenco che il gestionale propone, cosi si puo
// scegliere soltanto una provincia che la fattura elettronica sa scrivere.

// L'elenco ufficiale, in ordine alfabetico: e quello che si vede nella tendina.
const PROVINCE = [
    ['AG', 'Agrigento'], ['AL', 'Alessandria'], ['AN', 'Ancona'], ['AO', 'Aosta'],
    ['AR', 'Arezzo'], ['AP', 'Ascoli Piceno'], ['AT', 'Asti'], ['AV', 'Avellino'],
    ['BA', 'Bari'], ['BT', 'Barletta-Andria-Trani'], ['BL', 'Belluno'], ['BN', 'Benevento'],
    ['BG', 'Bergamo'], ['BI', 'Biella'], ['BO', 'Bologna'], ['BZ', 'Bolzano'],
    ['BS', 'Brescia'], ['BR', 'Brindisi'], ['CA', 'Cagliari'], ['CL', 'Caltanissetta'],
    ['CB', 'Campobasso'], ['CE', 'Caserta'], ['CT', 'Catania'], ['CZ', 'Catanzaro'],
    ['CH', 'Chieti'], ['CO', 'Como'], ['CS', 'Cosenza'], ['CR', 'Cremona'],
    ['KR', 'Crotone'], ['CN', 'Cuneo'], ['EN', 'Enna'], ['FM', 'Fermo'],
    ['FE', 'Ferrara'], ['FI', 'Firenze'], ['FG', 'Foggia'], ['FC', 'Forlì-Cesena'],
    ['FR', 'Frosinone'], ['GE', 'Genova'], ['GO', 'Gorizia'], ['GR', 'Grosseto'],
    ['IM', 'Imperia'], ['IS', 'Isernia'], ['AQ', "L'Aquila"], ['SP', 'La Spezia'],
    ['LT', 'Latina'], ['LE', 'Lecce'], ['LC', 'Lecco'], ['LI', 'Livorno'],
    ['LO', 'Lodi'], ['LU', 'Lucca'], ['MC', 'Macerata'], ['MN', 'Mantova'],
    ['MS', 'Massa-Carrara'], ['MT', 'Matera'], ['ME', 'Messina'], ['MI', 'Milano'],
    ['MO', 'Modena'], ['MB', 'Monza e della Brianza'], ['NA', 'Napoli'], ['NO', 'Novara'],
    ['NU', 'Nuoro'], ['OR', 'Oristano'], ['PD', 'Padova'], ['PA', 'Palermo'],
    ['PR', 'Parma'], ['PV', 'Pavia'], ['PG', 'Perugia'], ['PU', 'Pesaro e Urbino'],
    ['PE', 'Pescara'], ['PC', 'Piacenza'], ['PI', 'Pisa'], ['PT', 'Pistoia'],
    ['PN', 'Pordenone'], ['PZ', 'Potenza'], ['PO', 'Prato'], ['RG', 'Ragusa'],
    ['RA', 'Ravenna'], ['RC', 'Reggio Calabria'], ['RE', 'Reggio Emilia'], ['RI', 'Rieti'],
    ['RN', 'Rimini'], ['RM', 'Roma'], ['RO', 'Rovigo'], ['SA', 'Salerno'],
    ['SS', 'Sassari'], ['SV', 'Savona'], ['SI', 'Siena'], ['SR', 'Siracusa'],
    ['SO', 'Sondrio'], ['SU', 'Sud Sardegna'], ['TA', 'Taranto'], ['TE', 'Teramo'],
    ['TR', 'Terni'], ['TO', 'Torino'], ['TP', 'Trapani'], ['TN', 'Trento'],
    ['TV', 'Treviso'], ['TS', 'Trieste'], ['UD', 'Udine'], ['VA', 'Varese'],
    ['VE', 'Venezia'], ['VB', 'Verbano-Cusio-Ossola'], ['VC', 'Vercelli'], ['VR', 'Verona'],
    ['VV', 'Vibo Valentia'], ['VI', 'Vicenza'], ['VT', 'Viterbo'],
].map(([sigla, nome]) => ({ sigla, nome }));

// Grafie che l'anagrafica importata contiene e che nell'elenco non ci sono:
// nomi senza articolo, province soppresse, accenti e trattini scritti a modo
// proprio. Servono a leggere il passato, non a proporre scelte nuove.
const GRAFIE_STORICHE = {
    aquila: 'AQ',
    'carbonia iglesias': 'SU',
    'forli cesena': 'FC',
    'forlì cesena': 'FC',
    'pesaro (vecchio codice)': 'PU',
    'monza e brianza': 'MB',
    'massa carrara': 'MS',
    'barletta andria trani': 'BT',
    'reggio nell emilia': 'RE',
    'verbano cusio ossola': 'VB',
};

// Valori che nell'anagrafica indicano "non applicabile": non sono province.
const NON_PROVINCE = new Set(['- nessuna -', 'nessuna', 'stato estero', '']);

const PER_NOME = new Map(PROVINCE.map(({ sigla, nome }) => [nome.toLowerCase(), sigla]));
const SIGLE_VALIDE = new Set(PROVINCE.map(({ sigla }) => sigla));

const siglaProvincia = (valore) => {
    const testo = String(valore || '').trim();

    if (!testo || NON_PROVINCE.has(testo.toLowerCase())) {
        return null;
    }

    // Gia una sigla di due lettere.
    if (/^[A-Za-z]{2}$/.test(testo)) {
        const sigla = testo.toUpperCase();
        return SIGLE_VALIDE.has(sigla) ? sigla : null;
    }

    const chiave = testo.toLowerCase();
    return PER_NOME.get(chiave) || GRAFIE_STORICHE[chiave] || null;
};

module.exports = { PROVINCE, siglaProvincia };
