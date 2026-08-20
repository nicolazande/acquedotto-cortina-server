const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_TENTATIVI, rateLimitLogin, _tentativi } = require('../middlewares/RateLimitMiddleware');
const { MAX_PAGE_SIZE } = require('../controllers/utils/paginatedQuery');

// Finta coppia richiesta/risposta: il middleware decide guardando lo stato finale
// della risposta, quindi il test deve poter simulare l'esito.
const creaScambio = (username = 'admin', ip = '10.0.0.1') => {
    const ascoltatori = {};
    const res = {
        statusCode: 200,
        headers: {},
        setHeader(nome, valore) { this.headers[nome] = valore; },
        status(codice) { this.statusCode = codice; return this; },
        json(corpo) { this.corpo = corpo; return this; },
        on(evento, callback) { ascoltatori[evento] = callback; },
        concludi(codice) { this.statusCode = codice; ascoltatori.finish?.(); },
    };

    return { req: { ip, body: { username } }, res };
};

const tentativoFallito = (username, ip) => {
    const { req, res } = creaScambio(username, ip);
    let passato = false;
    rateLimitLogin(req, res, () => { passato = true; });
    if (passato) res.concludi(401);
    return { passato, res };
};

test.beforeEach(() => _tentativi.clear());

test('i primi tentativi passano', () => {
    for (let i = 0; i < MAX_TENTATIVI; i++) {
        assert.equal(tentativoFallito('admin').passato, true, `il tentativo ${i + 1} deve passare`);
    }
});

test('oltre il limite la richiesta viene respinta con 429', () => {
    for (let i = 0; i < MAX_TENTATIVI; i++) tentativoFallito('admin');

    const { passato, res } = tentativoFallito('admin');

    assert.equal(passato, false, 'la richiesta non deve arrivare al controller');
    assert.equal(res.statusCode, 429);
    assert.equal(res.corpo.reason, 'too_many_attempts');
    assert.ok(res.headers['Retry-After'] > 0, 'deve indicare fra quanto riprovare');
});

test('il blocco vale per la coppia indirizzo e utente, non per tutti', () => {
    for (let i = 0; i < MAX_TENTATIVI; i++) tentativoFallito('admin', '10.0.0.1');

    assert.equal(tentativoFallito('admin', '10.0.0.1').passato, false, 'stessa coppia: bloccata');
    assert.equal(tentativoFallito('altro', '10.0.0.1').passato, true, 'altro utente: passa');
    assert.equal(tentativoFallito('admin', '10.0.0.2').passato, true, 'altro indirizzo: passa');
});

test('un accesso riuscito azzera il conteggio', () => {
    for (let i = 0; i < MAX_TENTATIVI - 1; i++) tentativoFallito('admin');

    const { req, res } = creaScambio('admin');
    rateLimitLogin(req, res, () => {});
    res.concludi(200);

    // Dopo un accesso valido chi sbaglia di nuovo riparte da zero.
    for (let i = 0; i < MAX_TENTATIVI; i++) {
        assert.equal(tentativoFallito('admin').passato, true);
    }
});

test('gli errori diversi da 401 non contano come tentativo', () => {
    for (let i = 0; i < MAX_TENTATIVI + 3; i++) {
        const { req, res } = creaScambio('admin');
        rateLimitLogin(req, res, () => {});
        res.concludi(500);
    }

    assert.equal(tentativoFallito('admin').passato, true, 'un guasto del server non blocca l utente');
});

test('il tetto ai record per pagina e un numero positivo', () => {
    assert.ok(Number.isInteger(MAX_PAGE_SIZE) && MAX_PAGE_SIZE > 0);
    assert.ok(MAX_PAGE_SIZE <= 2000, 'un tetto troppo alto non protegge la memoria');
});
