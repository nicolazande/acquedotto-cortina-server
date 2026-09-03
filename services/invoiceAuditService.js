const { diffFields, writeAuditLog } = require('./auditLogService');

const INVOICE_AUDIT_FIELDS = [
    'cliente',
    'scadenza',
    'confermata',
    'stato',
    'data_fattura',
    'data_fattura_elettronica',
    'data_invio_fattura',
    'imponibile',
    'iva',
    'totale_fattura',
    'tipo_pagamento',
];

const SERVICE_AUDIT_FIELDS = [
    'riga',
    'descrizione',
    'tipo_tariffa',
    'metri_cubi',
    'prezzo',
    'valore_unitario',
    'tipo_quota',
    'lettura',
    'articolo',
    'fattura',
];

const invoiceLabel = (fattura) => [
    fattura?.tipo_documento || 'Fattura',
    fattura?.anno,
    fattura?.numero,
    fattura?.ragione_sociale || fattura?.nome_cliente,
].filter(Boolean).join(' - ');

const invoiceId = (fatturaOrId) => fatturaOrId?._id || fatturaOrId;

const writeInvoiceAudit = (req, fatturaOrId, action, summary, options = {}) => writeAuditLog({
    action,
    entityId: invoiceId(fatturaOrId),
    entityType: 'Fattura',
    req,
    summary,
    ...options,
});

const writeInvoiceUpdateAudit = (req, before, after, action) => writeInvoiceAudit(
    req,
    after,
    action,
    `Aggiornata ${invoiceLabel(after)}`,
    { changes: diffFields(before, after, INVOICE_AUDIT_FIELDS) }
);

const writeServiceAudit = (req, service, action, summary, options = {}) => {
    if (!service?.fattura) return null;
    return writeInvoiceAudit(req, service.fattura, action, summary, options);
};

const writeServiceUpdateAudit = (req, before, after) => writeServiceAudit(
    req,
    before,
    'fattura.servizio_modificato',
    'Modificata riga servizio',
    { changes: diffFields(before, after, SERVICE_AUDIT_FIELDS) }
);

module.exports = {
    invoiceLabel,
    writeInvoiceAudit,
    writeInvoiceUpdateAudit,
    writeServiceAudit,
    writeServiceUpdateAudit,
};
