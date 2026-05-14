# Acquedotto Zuel - Server

Backend Express/Mongoose per il gestionale Acquedotto Zuel.

## Avvio locale

```bash
npm install
npm run dev
```

In produzione:

```bash
npm start
```

## Configurazione

Crea un file `.env` partendo da `.env.example`.

```bash
PORT=5000
MONGODB_URI=mongodb://localhost:27017/acquedotto-zuel
MONGODB_DB=acquedotto-zuel
JWT_SECRET=change-me
CLIENT_ORIGINS=http://localhost:3000,http://localhost:3001
```

`MONGODB_DB` e' opzionale se il nome database e' gia' nella URI, ma conviene impostarlo con provider remoti: molte URI Atlas copiate dalla dashboard non includono il database e senza questa variabile il driver userebbe un default non desiderato.

Esempio MongoDB Atlas:

```bash
MONGODB_URI=mongodb+srv://user:password@cluster.example.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=acquedotto-zuel
```

Se username o password contengono caratteri speciali, vanno URL-encoded nella URI. Per Atlas ricordati anche di consentire l'IP del server nelle regole Network Access.

Opzioni Mongo utili:

```bash
MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
MONGODB_SOCKET_TIMEOUT_MS=45000
MONGODB_MAX_POOL_SIZE=10
MONGODB_TLS=
MONGODB_TLS_ALLOW_INVALID_CERTIFICATES=false
MONGODB_DIRECT_CONNECTION=
```

`MONGODB_TLS` normalmente non serve con `mongodb+srv://`: il driver abilita TLS quando necessario. `MONGODB_TLS_ALLOW_INVALID_CERTIFICATES=true` va usato solo in ambienti controllati con certificati self-signed.

`CLIENT_ORIGINS` accetta piu' origini separate da virgola, ad esempio:

```bash
CLIENT_ORIGINS=https://app.example.com,https://preview.example.com
```

In ambienti dietro proxy/load balancer puoi impostare `TRUST_PROXY=true`.

## Struttura utile

- `server.js`: bootstrap Express, CORS e middleware globali
- `config/db.js`: connessione MongoDB
- `routes`: rotte HTTP divise per risorsa
- `controllers`: logica delle API
- `controllers/utils/paginatedQuery.js`: paginazione, ricerca e ordinamento condivisi
- `models`: schema Mongoose
- `middlewares/AuthMiddleware.js`: verifica JWT per le rotte protette

## Endpoint salute

```text
GET /api/auth/health
```

Risponde `200` con database connesso:

```json
{ "status": "ok", "database": "connected" }
```

Risponde `503` se Express e' raggiungibile ma MongoDB non e' connesso.

## Import dati

Lo script in `documents/script/main.py` usa le stesse variabili MongoDB del server, quindi puo' importare anche su MongoDB remoto:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python documents/script/main.py
```

Per Atlas usa `pymongo[srv]`, gia' incluso in `requirements.txt`.

Puoi limitare l'import a una o piu' sezioni:

```bash
IMPORT_STEPS=listini,articoli,clienti
```

Valori disponibili: `listini`, `articoli`, `clienti`, `edifici`, `scadenze`, `fatture`.

Per ambienti lenti o database remoti puoi ridurre il parallelismo:

```bash
FASTTOOLS_TIMEOUT_SECONDS=60
IMPORT_CLIENTI_WORKERS=10
IMPORT_EDIFICI_WORKERS=10
IMPORT_FATTURE_WORKERS=10
```
