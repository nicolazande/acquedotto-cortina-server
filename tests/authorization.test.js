const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    RISORSE_DEL_LETTURISTA,
    anchePerLetturista,
    risorsePerRuolo,
    getUserRole,
    requireAdmin,
    requireCustomer,
} = require('../middlewares/AuthorizationMiddleware');

// Una finta risposta Express: registra lo stato e il corpo invece di spedirli.
const rispostaFinta = () => {
    const risposta = { stato: null, corpo: null };
    risposta.status = (codice) => { risposta.stato = codice; return risposta; };
    risposta.json = (corpo) => { risposta.corpo = corpo; return risposta; };
    return risposta;
};

const esegui = (guardia, user, metodo = 'GET', percorso = '/') => {
    const res = rispostaFinta();
    let passato = false;
    guardia({ user, method: metodo, path: percorso }, res, () => { passato = true; });
    return { passato, stato: res.stato };
};

test('un permesso non nasce mai dall assenza del ruolo', () => {
    // Il controllo ripiegava su "admin" quando il campo mancava: un account del
    // portale che per un import o una modifica a mano perdesse il ruolo sarebbe
    // diventato amministratore. Ora un ruolo assente non apre niente.
    assert.equal(getUserRole({ username: 'senza' }), null);
    assert.equal(getUserRole({ username: 'nullo', role: null }), null);
    assert.equal(getUserRole(undefined), null);

    [undefined, { username: 'senza' }, { role: null }, { role: '' }].forEach((utente) => {
        assert.deepEqual(esegui(requireAdmin, utente), { passato: false, stato: 403 });
        assert.deepEqual(esegui(requireCustomer, utente), { passato: false, stato: 403 });
    });
});

test('ogni ruolo apre solo la propria porta', () => {
    assert.deepEqual(esegui(requireAdmin, { role: 'admin' }), { passato: true, stato: null });
    assert.deepEqual(esegui(requireCustomer, { role: 'cliente' }), { passato: true, stato: null });

    // Un cliente non entra dalla porta dell'amministratore, e viceversa.
    assert.deepEqual(esegui(requireAdmin, { role: 'cliente' }), { passato: false, stato: 403 });
    assert.deepEqual(esegui(requireCustomer, { role: 'admin' }), { passato: false, stato: 403 });
});

test('un ruolo inventato non vale come ruolo', () => {
    ['superadmin', 'Admin', 'ADMIN', 'root'].forEach((role) => {
        assert.deepEqual(esegui(requireAdmin, { role }), { passato: false, stato: 403 });
    });
});

test('il letturista guarda le anagrafiche e scrive solo dove gli e concesso', () => {
    const letturista = { role: 'letturista' };
    const amministratore = { role: 'admin' };

    // Una risorsa aperta in sola lettura: puo consultarla, non cambiarla.
    const soloLettura = anchePerLetturista('clienti');
    assert.deepEqual(esegui(soloLettura, letturista, 'GET'), { passato: true, stato: null });
    ['POST', 'PUT', 'DELETE'].forEach((metodo) => {
        assert.deepEqual(esegui(soloLettura, letturista, metodo), { passato: false, stato: 403 });
    });

    // Le letture invece le registra: e il suo lavoro.
    const conScrittura = anchePerLetturista('letture');
    ['GET', 'POST', 'PUT'].forEach((metodo) => {
        assert.deepEqual(esegui(conScrittura, letturista, metodo), { passato: true, stato: null });
    });

    // L'amministratore passa da entrambe, con qualunque verbo.
    ['GET', 'POST', 'DELETE'].forEach((metodo) => {
        assert.deepEqual(esegui(soloLettura, amministratore, metodo), { passato: true, stato: null });
    });
});

test('il letturista non entra dalle porte degli altri', () => {
    // Le risorse che non lo elencano restano chiuse: sotto la riga requireAdmin
    // ci sono fatture, consegne, incassi, listini.
    assert.deepEqual(esegui(requireAdmin, { role: 'letturista' }), { passato: false, stato: 403 });
    assert.deepEqual(esegui(requireCustomer, { role: 'letturista' }), { passato: false, stato: 403 });

    // E un ruolo assente non diventa letturista per distrazione.
    assert.deepEqual(esegui(anchePerLetturista('clienti'), undefined), { passato: false, stato: 403 });
    assert.deepEqual(esegui(anchePerLetturista('letture'), { role: null }), { passato: false, stato: 403 });
});

test('dentro una risorsa aperta, le sotto-rotte non dichiarate restano chiuse', () => {
    const letturista = { role: 'letturista' };
    const clienti = anchePerLetturista('clienti');

    // L'elenco, la scheda e le relazioni dichiarate.
    assert.equal(esegui(clienti, letturista, 'GET', '/').passato, true);
    assert.equal(esegui(clienti, letturista, 'GET', '/507f1f77bcf86cd799439011').passato, true);
    assert.equal(esegui(clienti, letturista, 'GET', '/507f1f77bcf86cd799439011/contatori').passato, true);

    // Sotto `/clienti` vivono anche le fatture del cliente, l'anteprima di
    // fatturazione e il suo accesso al portale: soldi e credenziali, non letture.
    ['/507f1f77bcf86cd799439011/fatture',
        '/507f1f77bcf86cd799439011/fatturazione',
        '/507f1f77bcf86cd799439011/portal-user'].forEach((percorso) => {
        assert.deepEqual(esegui(clienti, letturista, 'GET', percorso), { passato: false, stato: 403 }, percorso);
    });

    // Lo stesso sotto le letture: le righe di fattura e il calcolo sono importi.
    const letture = anchePerLetturista('letture');
    assert.equal(esegui(letture, letturista, 'GET', '/507f1f77bcf86cd799439011/contatore').passato, true);
    ['/507f1f77bcf86cd799439011/servizi', '/507f1f77bcf86cd799439011/calcolo'].forEach((percorso) => {
        assert.deepEqual(esegui(letture, letturista, 'GET', percorso), { passato: false, stato: 403 }, percorso);
    });

    // E niente listini dalla scheda del contatore.
    const contatori = anchePerLetturista('contatori');
    assert.equal(esegui(contatori, letturista, 'GET', '/507f1f77bcf86cd799439011/edificio').passato, true);
    assert.deepEqual(esegui(contatori, letturista, 'GET', '/507f1f77bcf86cd799439011/listino'), { passato: false, stato: 403 });

    // L'amministratore passa da tutte, che siano dichiarate o no.
    ['/507f1f77bcf86cd799439011/fatture', '/507f1f77bcf86cd799439011/portal-user'].forEach((percorso) => {
        assert.equal(esegui(clienti, { role: 'admin' }, 'GET', percorso).passato, true, percorso);
    });
});

test('una risorsa non prevista non si puo nemmeno montare', () => {
    // Meglio un server che non parte di uno che apre le fatture per un refuso.
    assert.throws(() => anchePerLetturista('fatture'), /non prevista/);
    assert.throws(() => anchePerLetturista('contatore'), /non prevista/);
});

test('di un cliente il letturista vede come trovarlo, non come pagarlo', () => {
    const { CAMPI_PER_LETTURISTA, soloCampiPerLetturista } = require('../utils/customer');

    const cliente = {
        _id: 'x', ragione_sociale: 'Rossi Mario', telefono: '0436 1234',
        localita_residenza: 'Zuel', iban: 'IT60X0542811101000000123456',
        codice_fiscale: 'RSSMRA80A01H501U', partita_iva: '01234567890',
        data_mandato_sdd: new Date(), email_pec: 'a@pec.it',
    };
    const ridotto = soloCampiPerLetturista(cliente);

    assert.equal(ridotto.ragione_sociale, 'Rossi Mario');
    assert.equal(ridotto.telefono, '0436 1234');
    ['iban', 'codice_fiscale', 'partita_iva', 'data_mandato_sdd', 'email_pec'].forEach((campo) => {
        assert.equal(ridotto[campo], undefined, `${campo} non deve uscire`);
    });
    assert.ok(!CAMPI_PER_LETTURISTA.some((campo) => /iban|fiscale|partita|mandato|pec/i.test(campo)));
});

test('le risorse del letturista sono le stesse che le rotte gli aprono', () => {
    // Gli allegati hanno una rotta sola per tutte le risorse, quindi il permesso
    // lo decidono guardando questo elenco. Se divergesse da come sono montate le
    // rotte, un allegato su una fattura potrebbe uscire da li.
    const montate = fs.readFileSync(path.join(__dirname, '..', 'routes', 'index.js'), 'utf8')
        .split('\n')
        .filter((riga) => riga.includes('anchePerLetturista'))
        .map((riga) => riga.match(/'\/(\w+)'/)?.[1])
        .filter(Boolean);

    assert.deepEqual(montate.sort(), Object.keys(RISORSE_DEL_LETTURISTA).sort());
});

test('le relazioni concesse al letturista esistono davvero fra le rotte', () => {
    // Un nome sbagliato nell'elenco non darebbe un errore: chiuderebbe in
    // silenzio una relazione che al letturista serve, e se ne accorgerebbe lui
    // davanti a un contatore, in mezzo alla neve.
    const fileDellaRisorsa = {
        edifici: 'edificioRoutes.js',
        contatori: 'contatoreRoutes.js',
        clienti: 'clienteRoutes.js',
        letture: 'letturaRoutes.js',
    };

    Object.entries(RISORSE_DEL_LETTURISTA).forEach(([risorsa, { relazioni }]) => {
        const file = fs.readFileSync(path.join(__dirname, '..', 'routes', fileDellaRisorsa[risorsa]), 'utf8');
        relazioni.forEach((relazione) => {
            // Il nome del parametro cambia da un file all'altro (`:id`,
            // `:edificioId`): quel che conta e che sia una rotta di lettura con
            // un solo parametro davanti alla relazione.
            const rotta = new RegExp(`router\\.get\\('/:\\w+/${relazione}'`);
            assert.ok(rotta.test(file), `${risorsa}: manca la rotta di lettura per ${relazione}`);
        });
    });
});

test('gli allegati delle fatture restano fuori dalla portata del letturista', () => {
    // La regola e che un allegato vale quanto il documento a cui e attaccato.
    ['fatture', 'consegne', 'scadenze', 'listini', 'servizi', 'articoli'].forEach((risorsa) => {
        assert.equal(RISORSE_DEL_LETTURISTA[risorsa], undefined, `${risorsa} non deve essergli aperta`);
    });
});

test('il profilo dice a ogni ruolo tutto cio che puo aprire', () => {
    // Il client ci disegna menu e rotte: cio che non e in questo elenco per lui
    // non esiste. Panoramica e consegne non sono risorse con un modello, ma sono
    // pagine, e senza il loro nome sparirebbero dal menu dell'amministratore -
    // e gia successo.
    const { RESOURCE_NAMES } = require('../config/resources');
    const admin = risorsePerRuolo('admin');

    RESOURCE_NAMES.forEach((nome) => assert.ok(admin.includes(nome), `manca ${nome}`));
    assert.ok(admin.includes('panoramica'));
    assert.ok(admin.includes('consegne'));

    assert.deepEqual(risorsePerRuolo('letturista').sort(), Object.keys(RISORSE_DEL_LETTURISTA).sort());
    assert.deepEqual(risorsePerRuolo('cliente'), ['portale-cliente']);

    // Un ruolo assente o inventato non apre niente.
    assert.deepEqual(risorsePerRuolo(null), []);
    assert.deepEqual(risorsePerRuolo('superadmin'), []);
});

test('la stessa regola protegge le rotte e gli allegati', () => {
    // Erano due copie: quella del middleware e quella del controller degli
    // allegati. Ora e una funzione sola, e questo lo verifica.
    const { puoUsareRisorsa } = require('../middlewares/AuthorizationMiddleware');

    assert.equal(puoUsareRisorsa('admin', 'fatture'), true);
    assert.equal(puoUsareRisorsa('letturista', 'contatori'), true);
    assert.equal(puoUsareRisorsa('letturista', 'contatori', { scrittura: true }), false);
    assert.equal(puoUsareRisorsa('letturista', 'letture', { scrittura: true }), true);
    assert.equal(puoUsareRisorsa('letturista', 'fatture'), false);
    assert.equal(puoUsareRisorsa('cliente', 'letture'), false);
    assert.equal(puoUsareRisorsa(null, 'letture'), false);
});
