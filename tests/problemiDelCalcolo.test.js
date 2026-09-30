const test = require('node:test');
const assert = require('node:assert/strict');

const { problemiDelCalcolo } = require('../services/verificaFattura');

const pulita = {
    letture: 1, fatturaCoerente: true, serviziCoerenti: true, quotaFissaApplicabile: false,
    deltaFattura: 0, deltaLetture: 0, quotaFissaMancante: 0, extraImponibile: 0,
};

test('una fattura con la mora o con una riga a mano non e un problema: non vengono dal listino', () => {
    assert.deepEqual(problemiDelCalcolo({ ...pulita, extraImponibile: 6 }), []);
});

test('i problemi escono dal piu grave, e il primo e l esito della scheda', () => {
    const problemi = problemiDelCalcolo({
        ...pulita, fatturaCoerente: false, deltaFattura: 0.01, quotaFissaApplicabile: true, quotaFissaMancante: 35, serviziCoerenti: false, deltaLetture: -35,
    });

    assert.deepEqual(problemi.map((p) => [p.tipo, p.gravita, p.contatore]), [
        ['totale', 'danger', 'scostamentoFattura'],
        ['quota-fissa', 'warning', 'quotaFissaApplicabile'],
        ['listino', 'info', 'scostamentoListino'],
    ]);
});

test('senza letture contano solo i totali: una fattura a mano non ha un listino', () => {
    const problemi = problemiDelCalcolo({ ...pulita, letture: 0, serviziCoerenti: false, quotaFissaApplicabile: true });

    assert.deepEqual(problemi, []);
});
