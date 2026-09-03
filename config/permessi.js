// Chi puo fare cosa. E una dichiarazione, non un meccanismo: qui c'e la regola,
// in `middlewares/AuthorizationMiddleware` il guardiano che la applica alle
// rotte. La divisione non e formale - cosi la regola la possono leggere anche i
// controller e i servizi, che di Express non sanno niente e non devono
// dipenderne.
//
// Sta accanto alle altre politiche dichiarate del gestionale: `relations.js` dice
// cosa succede quando si cancella, `resources.js` quali risorse esistono.

const { RESOURCE_NAMES } = require('./resources');

// Il ruolo si legge dal record dell'utente e basta. Prima, quando il campo
// mancava, si ripiegava su "admin": comodo per gli account nati prima che il
// ruolo esistesse, ma e il ripiego sbagliato. Un permesso non deve mai nascere
// dall'assenza di un dato, altrimenti un account del portale che perdesse il
// campo - un import, una modifica a mano - diventerebbe amministratore.
//
// Gli account senza ruolo vanno sistemati sul database, non nel codice:
// `npm run maintenance:allinea-dati -- --fix` lo scrive guardando se l'account
// e collegato a un cliente.
const getUserRole = (user) => user?.role || null;

// Le risorse che il letturista puo toccare, quali anche scrivere, e quali
// relazioni puo seguire da una scheda all'altra. Sta qui perche serve in tre
// punti che devono restare d'accordo: il montaggio delle rotte, gli allegati -
// che ereditano il permesso di cio a cui sono attaccati - e l'elenco che il
// client usa per disegnare menu e pannelli.
//
// `relazioni` non e un dettaglio: sotto `/clienti` vivono anche
// `/:id/fatture` e `/:id/fatturazione`, sotto `/letture` anche `/:id/servizi` e
// `/:id/calcolo`. Aprire la risorsa senza dire quali sotto-rotte apre avrebbe
// dato a chi legge i contatori le fatture, gli importi e le righe di prezzo -
// nascoste nel menu ma raggiungibili scrivendo l'indirizzo.
const RISORSE_DEL_LETTURISTA = {
    edifici: { scrittura: false, relazioni: ['contatori'] },
    contatori: { scrittura: false, relazioni: ['cliente', 'edificio', 'letture', 'storia'] },
    clienti: { scrittura: false, relazioni: ['contatori'] },
    letture: { scrittura: true, relazioni: ['contatore'] },
};

// Due aree di lavoro non sono risorse con elenco e scheda - non hanno un
// modello - ma sono pagine che si aprono, e vanno nell'elenco insieme alle
// altre: altrimenti il client, che da quell'elenco disegna menu e rotte, non
// saprebbe che esistono.
const CRUSCOTTI_DELL_AMMINISTRATORE = ['panoramica', 'consegne'];

// L'area del cliente, che non e una risorsa del gestionale ma il suo portale.
const AREA_DEL_CLIENTE = 'portale-cliente';

// Cosa puo aprire chi sta guardando: risorse e aree, in un elenco solo. E la
// sola verita sui permessi - il server ci decide chi entra e il client ci
// disegna menu, rotte e pannelli - invece di tenerne due copie che col tempo
// divergono.
const risorsePerRuolo = (ruolo) => {
    if (ruolo === 'admin') {
        return [...RESOURCE_NAMES, ...CRUSCOTTI_DELL_AMMINISTRATORE];
    }

    if (ruolo === 'letturista') {
        return Object.keys(RISORSE_DEL_LETTURISTA);
    }

    if (ruolo === 'cliente') {
        return [AREA_DEL_CLIENTE];
    }

    return [];
};

// E quali di quelle puo anche cambiare. Il client ci nasconde i pulsanti che
// aprono una modifica: un "Elimina" che risponde 403 e peggio di un "Elimina"
// che non c'e.
const risorseScrivibiliPerRuolo = (ruolo) => {
    if (ruolo === 'admin') {
        return RESOURCE_NAMES;
    }

    if (ruolo === 'letturista') {
        return Object.entries(RISORSE_DEL_LETTURISTA)
            .filter(([, permesso]) => permesso.scrittura)
            .map(([nome]) => nome);
    }

    return [];
};

// Il permesso del letturista su una risorsa, in una riga sola. Lo usano il
// guardiano delle rotte e il controller degli allegati, che senza questa
// funzione se lo riscriverebbero uguale - e prima o poi diverso.
const puoUsareRisorsa = (ruolo, risorsa, { scrittura = false } = {}) => {
    if (ruolo === 'admin') {
        return true;
    }

    const permesso = RISORSE_DEL_LETTURISTA[risorsa];
    return ruolo === 'letturista' && Boolean(permesso) && (!scrittura || permesso.scrittura);
};

// Dentro la risorsa il letturista arriva all'elenco, alla singola scheda e alle
// relazioni dichiarate. Tutto il resto e chiuso, quindi una sotto-rotta aggiunta
// domani nasce chiusa anche qui, come le risorse nuove sotto `requireAdmin`.
const percorsoConcesso = (percorso, relazioni) => {
    const parti = percorso.split('/').filter(Boolean);

    if (parti.length <= 1) {
        return true; // l'elenco, o una scheda sola
    }

    return parti.length === 2 && relazioni.includes(parti[1]);
};


module.exports = {
    RISORSE_DEL_LETTURISTA,
    getUserRole,
    percorsoConcesso,
    puoUsareRisorsa,
    risorsePerRuolo,
    risorseScrivibiliPerRuolo,
};
