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
JWT_SECRET=change-me
CLIENT_ORIGINS=http://localhost:3000
```

`CLIENT_ORIGINS` accetta piu' origini separate da virgola. Se non viene definito, il server consente localhost e gli URL Netlify gia' presenti nel progetto.

## Struttura utile

- `server.js`: bootstrap Express, CORS e middleware globali
- `config/db.js`: connessione MongoDB
- `routes`: rotte HTTP divise per risorsa
- `controllers`: logica delle API
- `models`: schema Mongoose
- `middlewares/AuthMiddleware.js`: verifica JWT per le rotte protette

## Endpoint salute

```text
GET /api/auth/health
```

Risponde `{ "status": "ok" }` quando il server e' raggiungibile.
