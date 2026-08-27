const test = require('node:test');
const assert = require('node:assert/strict');

const { getUserRole, requireAdmin, requireCustomer } = require('../middlewares/AuthorizationMiddleware');

// Una finta risposta Express: registra lo stato e il corpo invece di spedirli.
const rispostaFinta = () => {
    const risposta = { stato: null, corpo: null };
    risposta.status = (codice) => { risposta.stato = codice; return risposta; };
    risposta.json = (corpo) => { risposta.corpo = corpo; return risposta; };
    return risposta;
};

const esegui = (guardia, user) => {
    const res = rispostaFinta();
    let passato = false;
    guardia({ user }, res, () => { passato = true; });
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
