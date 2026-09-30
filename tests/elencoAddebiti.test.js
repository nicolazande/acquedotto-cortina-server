const test = require('node:test');
const assert = require('node:assert/strict');

const { cosaManca, piede, riepilogoDelleRighe } = require('../services/elencoAddebiti');
const { modalitaPagamentoXml, pagaConAddebito } = require('../config/invoicing');

const CONTO = 'IT11M0851161070000000006953';

test('paga con addebito chi ha dato l IBAN, qualunque termine sia scritto', () => {
    assert.equal(pagaConAddebito({ iban: CONTO, pagamento: '30 Giorni data fattura' }), true);
    assert.equal(pagaConAddebito({ iban: '  ', pagamento: 'Addebito in conto  a scadenza' }), false);
    assert.equal(modalitaPagamentoXml({ iban: CONTO }), 'MP19');
    assert.equal(modalitaPagamentoXml({ pagamento: 'Contanti' }), 'MP01');
    assert.equal(modalitaPagamentoXml({ pagamento: '30 Giorni data fattura' }), 'MP05');
});

test('ogni riga dice cosa manca perche la banca la accetti', () => {
    assert.equal(cosaManca({ iban: CONTO, data_mandato_sdd: new Date('2022-12-06') }), '');
    assert.equal(cosaManca({ iban: 'ITY0851161070000000027314' }), 'IBAN non valido, manca la data del mandato');
});

test('il piede e il riepilogo ripetono quanti sono e quanto fanno', () => {
    const righe = [
        { cliente: 'Rossi', iban: 'A', importo: 40.15, daSistemare: '' },
        { cliente: 'Verdi', iban: 'B', importo: 12362.35, daSistemare: 'IBAN non valido' },
    ];

    assert.equal(piede(righe), '2 addebiti per 12.402,50 euro');
    assert.equal(piede(righe.slice(0, 1)), 'Un addebito per 40,15 euro');
    assert.deepEqual(riepilogoDelleRighe(2026, righe), { anno: 2026, righe: 2, clienti: 2, totale: 12402.5, daSistemare: 1 });
});
