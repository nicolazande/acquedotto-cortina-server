#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_NODE="$ROOT_DIR/.tools/node-v20.18.1-linux-x64/bin"
MONGO_CONTAINER="${MONGO_CONTAINER:-acquedotto-cortina-mongo}"
MONGO_IMAGE="${MONGO_IMAGE:-mongo:7}"
MONGO_VOLUME="${MONGO_VOLUME:-acquedotto-mongo-data}"

if [[ -d "$LOCAL_NODE" ]]; then
    export PATH="$LOCAL_NODE:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "npm non trovato. Installa Node.js oppure usa il Node locale in $LOCAL_NODE." >&2
    exit 1
fi

cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
    echo "File .env mancante: lo creo da .env.example."
    cp .env.example .env
fi

env_value() {
    local key="$1"
    sed -n "s/^${key}=//p" .env | tail -n 1 | tr -d '\r'
}

APP_PORT="${PORT:-$(env_value PORT)}"
APP_PORT="${APP_PORT:-5000}"
API_BASE="http://localhost:${APP_PORT}"

server_health_ok() {
    command -v curl >/dev/null 2>&1 && curl -fsS "$API_BASE/api/auth/health" >/dev/null 2>&1
}

port_is_open() {
    (echo >"/dev/tcp/127.0.0.1/${APP_PORT}") >/dev/null 2>&1
}

if server_health_ok; then
    echo "Server gia' attivo su ${API_BASE}"
    echo "Health check: ${API_BASE}/api/auth/health"
    exit 0
fi

if port_is_open; then
    echo "La porta ${APP_PORT} e' gia' in uso, ma ${API_BASE}/api/auth/health non risponde." >&2
    echo "Chiudi il processo che usa la porta oppure avvia con una porta diversa, ad esempio:" >&2
    echo "  PORT=5050 ./start-local.sh" >&2
    exit 1
fi

if [[ "${START_MONGO:-false}" == "true" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
        echo "START_MONGO=true richiesto, ma docker non e' disponibile." >&2
        exit 1
    fi

    if docker ps --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
        echo "MongoDB locale gia' attivo: $MONGO_CONTAINER"
    elif docker ps -a --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
        echo "Avvio container MongoDB locale: $MONGO_CONTAINER"
        docker start "$MONGO_CONTAINER" >/dev/null
    else
        echo "Creo container MongoDB locale: $MONGO_CONTAINER"
        docker run -d \
            --name "$MONGO_CONTAINER" \
            -p 27017:27017 \
            -v "$MONGO_VOLUME":/data/db \
            "$MONGO_IMAGE" >/dev/null
    fi
fi

if [[ ! -d node_modules ]]; then
    echo "Dipendenze server mancanti: eseguo npm install..."
    npm install
fi

echo "Avvio server su ${API_BASE}"
echo "Health check: ${API_BASE}/api/auth/health"
npm start
