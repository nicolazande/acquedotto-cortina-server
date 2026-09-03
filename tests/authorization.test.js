const test = require('node:test');
const assert = require('node:assert/strict');

const {
    anchePerLetturista,
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

const esegui = (guardia, user, metodo = 'GET') => {
    const res = rispostaFinta();
    let passato = false;
    guardia({ user, method: metodo }, res, () => { passato = true; });
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
    const soloLettura = anchePerLetturista();
    assert.deepEqual(esegui(soloLettura, letturista, 'GET'), { passato: true, stato: null });
    ['POST', 'PUT', 'DELETE'].forEach((metodo) => {
        assert.deepEqual(esegui(soloLettura, letturista, metodo), { passato: false, stato: 403 });
    });

    // Le letture invece le registra: e il suo lavoro.
    const conScrittura = anchePerLetturista({ scrittura: true });
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
    assert.deepEqual(esegui(anchePerLetturista(), undefined), { passato: false, stato: 403 });
    assert.deepEqual(esegui(anchePerLetturista({ scrittura: true }), { role: null }), { passato: false, stato: 403 });
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
