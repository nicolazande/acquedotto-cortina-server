const DEFAULT_API_URL = 'http://localhost:5000/api';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS || '12000', 10);
const TEST_ATTACHMENTS = [
    {
        contentType: 'image/png',
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        filename: 'smoke-test.png',
    },
    {
        contentType: 'application/pdf',
        data: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDAvS2lkc1tdPj4KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+CiUlRU9G',
        filename: 'smoke-test.pdf',
    },
];
const { RESOURCE_NAMES } = require('../config/resources');

// Le date del test sono relative a oggi: con date fisse il test iniziava a fallire
// non appena la data scritta nel codice finiva nel passato (la scadenza risultava
// gia in ritardo e il confronto sul ritardo atteso saltava).
const giorniDopo = (giorni, base = new Date()) => {
    const data = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    data.setUTCDate(data.getUTCDate() + giorni);
    return data.toISOString().slice(0, 10);
};
const OGGI = giorniDopo(0);
const ANNO = new Date(OGGI).getUTCFullYear();
const INIZIO_ANNO = `${ANNO}-01-01`;
const FINE_ANNO = `${ANNO}-12-31`;
const SCADENZA_ATTESA = giorniDopo(Number.parseInt(process.env.INVOICE_DUE_DAYS || '30', 10));

const normalizeApiUrl = (value) => {
    const baseUrl = (value || DEFAULT_API_URL).replace(/\/+$/, '');
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

const apiUrl = normalizeApiUrl(process.env.SMOKE_API_URL || process.env.API_URL);
const skipMutation = ['1', 'true', 'yes'].includes(String(process.env.SMOKE_SKIP_MUTATION).toLowerCase());
let authToken = process.env.SMOKE_TOKEN || '';

const request = async (path, options = {}) => {
    const { skipAuth, ...requestOptions } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers = {
        ...(authToken && !skipAuth ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(requestOptions.headers || {}),
    };

    try {
        const response = await fetch(`${apiUrl}${path}`, {
            ...requestOptions,
            headers,
            signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
            ? await response.json()
            : await response.arrayBuffer();

        if (!response.ok) {
            throw new Error(`${options.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
        }

        return { body, contentType, response };
    } finally {
        clearTimeout(timeout);
    }
};

const loginForSmoke = async () => {
    if (authToken) {
        return;
    }

    const { SMOKE_USERNAME, SMOKE_PASSWORD } = process.env;
    if (!SMOKE_USERNAME || !SMOKE_PASSWORD) {
        throw new Error('Smoke API richiede SMOKE_TOKEN oppure SMOKE_USERNAME/SMOKE_PASSWORD');
    }

    const { body } = await request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: SMOKE_USERNAME, password: SMOKE_PASSWORD }),
        skipAuth: true,
    });
    authToken = body.token;
};

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const step = async (label, action) => {
    process.stdout.write(`- ${label}... `);
    await action();
    console.log('ok');
};

const testHealth = async () => {
    const { body } = await request('/auth/health');
    assert(body.status === 'ok', 'health status is not ok');
    assert(body.database === 'connected', 'database is not connected');
};

const testResourceLists = async () => {
    for (const resource of RESOURCE_NAMES) {
        const { body } = await request(`/${resource}?page=1&limit=1`);
        assert(Array.isArray(body.data), `${resource} did not return a paginated data array`);
        assert(Number.isInteger(body.totalItems), `${resource} did not return totalItems`);
    }

    const billingPreview = await request('/fatture/generazione/anteprima?limit=1');
    assert(Array.isArray(billingPreview.body.clienti), 'billing generation preview did not return clienti array');
};

const createRecord = async (resource, payload) => {
    const { body } = await request(`/${resource}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    assert(body && body._id, `${resource} create did not return _id`);
    return body;
};

// La pulizia tollera i record gia rimossi: cancellare una fattura elimina a cascata
// anche le sue righe servizio e la scadenza, quindi le cancellazioni successive
// trovano legittimamente un 404.
const deleteCreatedRecords = async (records) => {
    for (const { resource, id } of [...records].reverse()) {
        try {
            await request(`/${resource}/${id}`, { method: 'DELETE' });
        } catch (error) {
            if (!/failed with 404/.test(error.message)) {
                throw error;
            }
        }
    }
};

const createTrackedRecord = async (createdRecords, resource, payload) => {
    const record = await createRecord(resource, payload);
    createdRecords.push({ resource, id: record._id });
    return record;
};

// Su un database vuoto (installazione nuova, esecuzione in CI) non esiste ancora
// nulla da riusare: in quel caso il test si crea il minimo indispensabile e lo
// rimuove alla fine, cosi la suite gira sia sui dati reali sia da zero.
const firstOrCreateRecord = async (createdRecords, resource, sortField, payload) => {
    const query = sortField ? `&sortField=${sortField}` : '';
    const { body } = await request(`/${resource}?page=1&limit=1${query}`);
    const record = body.data && body.data[0];

    if (record && record._id) {
        return record;
    }

    return createTrackedRecord(createdRecords, resource, payload);
};

const testRelationReferences = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];

    try {
        const cliente = await firstOrCreateRecord(createdRecords, 'clienti', 'cognome', {
            cognome: 'Smoke',
            nome: 'Riferimento',
            ragione_sociale: 'Smoke Riferimento',
        });
        const edificio = await firstOrCreateRecord(createdRecords, 'edifici', 'descrizione', {
            descrizione: 'Smoke edificio',
            localita: 'Cortina',
        });
        const listino = await firstOrCreateRecord(createdRecords, 'listini', 'categoria', {
            categoria: 'SMOKE RIFERIMENTO',
            descrizione: 'Listino temporaneo smoke test',
        });
        const articolo = await firstOrCreateRecord(createdRecords, 'articoli', 'codice', {
            codice: 'SMOKE',
            descrizione: 'Articolo temporaneo smoke test',
            iva: 'IVA 10%',
        });
        // Le fatture storiche sono confermate e quindi bloccate in scrittura:
        // il test si crea una bozza dedicata invece di riusarne una esistente.
        const fattura = await createTrackedRecord(createdRecords, 'fatture', {
            cliente: cliente._id,
            data_fattura: OGGI,
            tipo_documento: 'Fattura',
            confermata: false,
        });

        const contatore = await createTrackedRecord(createdRecords, 'contatori', {
            codice: 'SMOKE-REL',
            seriale: 'SMOKE-REL',
            nome_cliente: 'Smoke relazione',
            nome_edificio: 'Smoke edificio',
            cliente: cliente._id,
            edificio: edificio._id,
            listino: listino._id,
        });

        const { body: loadedContatore } = await request(`/contatori/${contatore._id}`);
        assert(loadedContatore.cliente?._id === cliente._id, 'contatore cliente reference was not populated');
        assert(loadedContatore.edificio?._id === edificio._id, 'contatore edificio reference was not populated');
        assert(loadedContatore.listino?._id === listino._id, 'contatore listino reference was not populated');

        const lettura = await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: OGGI,
            consumo: 123,
            unita_misura: 'm3',
            contatore: contatore._id,
        });

        const { body: loadedLettura } = await request(`/letture/${lettura._id}`);
        assert(loadedLettura.contatore?._id === contatore._id, 'lettura contatore reference was not populated');

        const fascia = await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'SMOKE RELAZIONE',
            min: 0,
            max: 1,
            prezzo: 1,
            inizio: INIZIO_ANNO,
            scadenza: FINE_ANNO,
            listino: listino._id,
        });

        const { body: loadedFascia } = await request(`/fasce/${fascia._id}`);
        assert(loadedFascia.listino?._id === listino._id, 'fascia listino reference was not populated');

        const servizio = await createTrackedRecord(createdRecords, 'servizi', {
            descrizione: 'SMOKE RELAZIONE',
            fattura: fattura._id,
            lettura: lettura._id,
            articolo: articolo._id,
            prezzo: 1,
            valore_unitario: 1,
        });

        const { body: loadedServizio } = await request(`/servizi/${servizio._id}`);
        assert(loadedServizio.fattura?._id === fattura._id, 'servizio fattura reference was not populated');
        assert(loadedServizio.lettura?._id === lettura._id, 'servizio lettura reference was not populated');
        assert(loadedServizio.articolo?._id === articolo._id, 'servizio articolo reference was not populated');
    } finally {
        await deleteCreatedRecords(createdRecords);
    }
};

const getAttachmentTarget = async (createdRecords) => {
    const record = await firstOrCreateRecord(createdRecords, 'clienti', '', {
        cognome: 'Smoke',
        nome: 'Allegati',
        ragione_sociale: 'Smoke Allegati',
    });
    return record._id;
};

const testAttachments = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];
    const clienteId = await getAttachmentTarget(createdRecords);
    const createdIds = [];

    try {
        for (const attachment of TEST_ATTACHMENTS) {
            const createResult = await request(`/attachments/clienti/${clienteId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(attachment),
            });

            const createdId = createResult.body._id;
            createdIds.push(createdId);
            assert(createdId, 'attachment create did not return _id');
            assert(createResult.body.contentType === attachment.contentType, 'attachment content type was not preserved');

            const fileResult = await request(`/attachments/${createdId}/file`);
            assert(fileResult.contentType.startsWith(attachment.contentType), 'attachment file content type is wrong');
            assert(fileResult.body.byteLength > 0, 'attachment file is empty');
        }

        const listResult = await request(`/attachments/clienti/${clienteId}`);
        for (const createdId of createdIds) {
            assert(
                listResult.body.some((attachment) => attachment._id === createdId),
                'created attachment was not listed'
            );
        }
    } finally {
        for (const createdId of createdIds) {
            await request(`/attachments/${createdId}`, { method: 'DELETE' });
        }
        await deleteCreatedRecords(createdRecords);
    }
};

const testBillingGeneration = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];

    try {
        const cliente = await createTrackedRecord(createdRecords, 'clienti', {
            nome: 'Smoke',
            cognome: 'Fatturazione',
            ragione_sociale: 'Smoke Fatturazione',
        });
        const listino = await createTrackedRecord(createdRecords, 'listini', {
            categoria: 'SMOKE FATTURAZIONE',
            descrizione: 'Listino temporaneo smoke test',
        });

        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'Tariffa Base',
            min: 1,
            max: 100,
            prezzo: 1,
            inizio: INIZIO_ANNO,
            scadenza: FINE_ANNO,
            listino: listino._id,
        });
        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: '1° Supero',
            min: 101,
            max: 999,
            prezzo: 2,
            inizio: INIZIO_ANNO,
            scadenza: FINE_ANNO,
            listino: listino._id,
        });
        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'Fisso',
            min: 0,
            max: 999,
            prezzo: 10,
            inizio: INIZIO_ANNO,
            scadenza: FINE_ANNO,
            listino: listino._id,
        });

        const contatore = await createTrackedRecord(createdRecords, 'contatori', {
            codice: 'SMOKE-BILL',
            seriale: 'SMOKE-BILL',
            nome_cliente: 'Smoke Fatturazione',
            cliente: cliente._id,
            listino: listino._id,
            tipo_attivita: 'SMOKE FATTURAZIONE',
        });
        await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: INIZIO_ANNO,
            consumo: 10,
            unita_misura: 'm3',
            fatturata: true,
            contatore: contatore._id,
        });
        const lettura = await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: OGGI,
            consumo: 135,
            unita_misura: 'm3',
            fatturata: false,
            contatore: contatore._id,
        });
        const manualFattura = await createRecord('fatture', {
            cliente: cliente._id,
            data_fattura: OGGI,
            tipo_documento: 'Fattura',
            imponibile: 0,
            iva: 0,
            totale_fattura: 0,
        });
        createdRecords.push({ resource: 'fatture', id: manualFattura._id });
        assert(manualFattura.scadenza, 'manual invoice should generate a scadenza');
        createdRecords.push({ resource: 'scadenze', id: manualFattura.scadenza });

        const manualDeadline = await request(`/fatture/${manualFattura._id}/scadenza`);
        assert(manualDeadline.body?._id === manualFattura.scadenza, 'manual invoice deadline relation is missing');
        assert(manualDeadline.body.scadenza.startsWith(SCADENZA_ATTESA), 'manual invoice deadline should default to 30 days');
        assert(manualDeadline.body.ritardo === 0, 'manual invoice deadline delay should start at 0');

        const preview = await request(`/letture/${lettura._id}/calcolo`);
        assert(preview.body.billableConsumption === 125, 'billing preview did not calculate expected consumption');
        assert(preview.body.totals.imponibile === 160, 'billing preview imponibile is wrong');

        const generated = await request('/fatture/genera-da-letture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ letture: [lettura._id], data_fattura: OGGI }),
        });
        const fattura = generated.body.fattura;
        const servizi = generated.body.servizi || [];
        assert(fattura?._id, 'generated invoice did not return _id');
        assert(fattura.imponibile === 160, 'generated invoice imponibile is wrong');
        assert(fattura.stato === 'bozza', 'generated invoice should start as bozza');
        assert(fattura.origine === 'letture', 'generated invoice origin should be letture');
        assert(fattura.scadenza, 'generated invoice should create a deadline');
        const generatedDeadline = await request(`/fatture/${fattura._id}/scadenza`);
        assert(generatedDeadline.body.scadenza.startsWith(SCADENZA_ATTESA), 'generated invoice deadline should default to 30 days');
        assert((fattura.letture || []).includes(lettura._id), 'generated invoice should keep billed reading ids');
        assert(servizi.length === 3, 'generated invoice should have 3 service rows');
        assert(servizi.every((servizio) => servizio.listino), 'generated services should store listino snapshot reference');
        assert(servizi.every((servizio) => servizio.fascia), 'generated services should store fascia snapshot reference');
        assert(servizi.every((servizio) => servizio.calcolo_snapshot), 'generated services should store calculation snapshot');

        createdRecords.push(...servizi.map((servizio) => ({ resource: 'servizi', id: servizio._id })));
        createdRecords.push({ resource: 'fatture', id: fattura._id });
        createdRecords.push({ resource: 'scadenze', id: fattura.scadenza });

        const verification = await request(`/fatture/${fattura._id}/verifica-calcolo`);
        assert(verification.body.summary.serviziCoerenti, 'generated invoice services do not match recalculation');
        assert(verification.body.summary.fatturaCoerente, 'generated invoice totals do not match service rows');

        const pdf = await request(`/fatture/${fattura._id}/pdf`);
        assert(pdf.contentType.includes('application/pdf'), 'invoice PDF endpoint did not return application/pdf');
        assert(Buffer.from(pdf.body).subarray(0, 4).toString() === '%PDF', 'invoice PDF body is not a PDF');

        let duplicateBlocked = false;
        try {
            await request('/fatture/genera-da-letture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ letture: [lettura._id], data_fattura: OGGI }),
            });
        } catch (error) {
            duplicateBlocked = error.message.includes('409');
        }
        assert(duplicateBlocked, 'already billed reading was not blocked');
    } finally {
        await deleteCreatedRecords(createdRecords);
    }
};

// Cancellare una fattura deve ripulire tutto cio che ne dipende: senza questo
// controllo tornerebbero le righe servizio orfane (non piu cancellabili via API)
// e le letture bloccate per sempre su "fatturata".
const testInvoiceDeletionCascade = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];

    try {
        const cliente = await createTrackedRecord(createdRecords, 'clienti', {
            nome: 'Smoke',
            cognome: 'Cascata',
            ragione_sociale: 'Smoke Cascata',
        });
        const listino = await createTrackedRecord(createdRecords, 'listini', {
            categoria: 'SMOKE CASCATA',
            descrizione: 'Listino temporaneo smoke test',
        });
        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'Tariffa Base',
            min: 1,
            max: 100,
            prezzo: 1,
            inizio: INIZIO_ANNO,
            scadenza: FINE_ANNO,
            listino: listino._id,
        });
        const contatore = await createTrackedRecord(createdRecords, 'contatori', {
            codice: 'SMOKE-DEL',
            seriale: 'SMOKE-DEL',
            cliente: cliente._id,
            listino: listino._id,
        });
        await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: INIZIO_ANNO,
            consumo: 0,
            unita_misura: 'm3',
            fatturata: true,
            contatore: contatore._id,
        });
        const lettura = await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: OGGI,
            consumo: 40,
            unita_misura: 'm3',
            fatturata: false,
            contatore: contatore._id,
        });

        const { body: generated } = await request('/fatture/genera-da-letture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ letture: [lettura._id], data_fattura: OGGI }),
        });
        const fattura = generated.fattura;
        const servizi = generated.servizi || [];
        assert(servizi.length > 0, 'generated invoice should have service rows');
        assert(fattura.scadenza, 'generated invoice should have a deadline');

        const { body: letturaBloccata } = await request(`/letture/${lettura._id}`);
        assert(letturaBloccata.fatturata === true, 'billed reading should be locked');

        const { response: deleteResponse } = await request(`/fatture/${fattura._id}`, { method: 'DELETE' });
        assert(deleteResponse.status === 204, 'invoice delete should return 204');

        const missing = async (path) => {
            try {
                await request(path);
                return false;
            } catch (error) {
                return /failed with 404/.test(error.message);
            }
        };

        assert(await missing(`/fatture/${fattura._id}`), 'deleted invoice should be gone');
        for (const servizio of servizi) {
            assert(await missing(`/servizi/${servizio._id}`), 'service rows should be deleted with the invoice');
        }
        assert(await missing(`/scadenze/${fattura.scadenza}`), 'deadline should be deleted with the invoice');

        const { body: letturaLibera } = await request(`/letture/${lettura._id}`);
        assert(letturaLibera.fatturata === false, 'reading should be billable again after invoice deletion');

        // la lettura deve poter rientrare davvero in una nuova fattura
        const { body: rigenerata } = await request('/fatture/genera-da-letture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ letture: [lettura._id], data_fattura: OGGI }),
        });
        assert(rigenerata.fattura?._id, 'reading should be billable again');
        await request(`/fatture/${rigenerata.fattura._id}`, { method: 'DELETE' });
    } finally {
        await deleteCreatedRecords(createdRecords);
    }
};

// La catena della consegna, dal recapito scritto in anagrafica alla riga in
// coda. Il messaggio non parte davvero: senza server di posta configurato la
// consegna viene registrata come simulata, ed e proprio quello che si verifica.
const testInvoiceDelivery = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];

    try {
        const cliente = await createTrackedRecord(createdRecords, 'clienti', {
            nome: 'Smoke',
            cognome: 'Consegna',
            ragione_sociale: 'Smoke Consegna',
            stampa_cortesia: 'email',
            email: 'smoke@esempio.it',
        });
        assert(cliente.stampa_cortesia === 'email', 'delivery mode should be stored normalised');

        const fattura = await createRecord('fatture', {
            cliente: cliente._id,
            data_fattura: OGGI,
            tipo_documento: 'Fattura',
            imponibile: 10,
            iva: 1,
            totale_fattura: 11,
        });
        createdRecords.push({ resource: 'scadenze', id: fattura.scadenza });

        const bozza = await request(`/fatture/${fattura._id}/consegne`);
        assert(bozza.body.pronta === false, 'a draft invoice should not be deliverable');

        await request(`/fatture/${fattura._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confermata: true }),
        });

        const piano = await request(`/fatture/${fattura._id}/consegne`);
        const cortesia = piano.body.consegne.find((consegna) => consegna.tipo === 'cortesia');
        assert(cortesia?.canale === 'email', 'courtesy copy should follow the customer delivery mode');
        assert(cortesia.destinatario === 'smoke@esempio.it', 'courtesy copy should use the customer email');
        assert(cortesia.automatico === true, 'an email delivery should be automatic');

        const pianificate = await request('/consegne/pianifica', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fatture: [fattura._id] }),
        });
        assert(pianificate.body.create === 1, 'planning should queue exactly one delivery');

        const elaborate = await request('/consegne/elabora', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fatture: [fattura._id] }),
        });
        assert(elaborate.body.elaborate === 1, 'the queued delivery was not processed');
        assert(elaborate.body.errori === 0, `delivery failed: ${elaborate.body.esiti[0]?.motivo}`);

        const dopo = await request(`/fatture/${fattura._id}/consegne`);
        const registrata = dopo.body.registrate.find((consegna) => consegna.tipo === 'cortesia');
        assert(registrata.stato === 'inviata', 'the delivery should be marked as sent');
        assert(registrata.allegati.some((nome) => nome.endsWith('.pdf')), 'the invoice PDF should be attached');

        // Una consegna simulata non e uscita: scrivere la data di invio sulla
        // fattura direbbe il falso.
        const documento = await request(`/fatture/${fattura._id}`);
        if (registrata.simulata) {
            assert(!documento.body.data_invio_fattura, 'a simulated delivery must not date the invoice');
        }

        const cancellata = await request(`/fatture/${fattura._id}?sbloccoConfermato=true`, { method: 'DELETE' });
        assert(cancellata.response.status === 204, 'the confirmed invoice was not deleted');

        const orfane = await request('/consegne?page=1&limit=200&vista=inviate');
        const rimaste = orfane.body.data.filter((consegna) => consegna.fattura === fattura._id);
        assert(rimaste.length === 0, 'deleting an invoice must remove its deliveries');
    } finally {
        await deleteCreatedRecords(createdRecords);
    }
};

const main = async () => {
    console.log(`Smoke API target: ${apiUrl}`);
    await step('health endpoint', testHealth);
    await step('login smoke', loginForSmoke);
    await step('paginated resource lists', testResourceLists);
    await step('relation references create/read/delete', testRelationReferences);
    await step('billing preview/generation/verification', testBillingGeneration);
    await step('invoice deletion cascade', testInvoiceDeletionCascade);
    await step('invoice delivery queue', testInvoiceDelivery);
    await step('note attachments create/list/file/delete', testAttachments);
    console.log('Smoke API completed successfully.');
};

main().catch((error) => {
    const causeMessage = error.cause?.message ? `: ${error.cause.message}` : '';
    console.error(`${error.message}${causeMessage}`);
    process.exit(1);
});
