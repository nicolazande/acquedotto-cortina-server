"""Copia di sicurezza del database, in file JSON: una cartella per backup.

    .venv/bin/python documents/script/backup_mongodb.py
    .venv/bin/python documents/script/backup_mongodb.py --uri "<indirizzo del database>"

Salva tutte le collection (o quelle indicate con --collections) in
`backups/<database>-<data>/`, con un `manifest.json` che dice cosa c'e dentro.
Si ripristina con `restore_backup.py <cartella>`. E lo stesso backup che l'import
fa da solo prima di svuotare il database (`salva_backup`): uno solo, cosi il
ripristino legge sempre la stessa forma.

Legge soltanto: sul database non scrive niente.
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

from bson import json_util

from ambiente import SERVER_ROOT, apri_database, uri_del_server


def salva_backup(db, motivo: str, collezioni=None, prefisso: str | None = None) -> Path:
    """Scrive le collection in una cartella nuova e restituisce la cartella.

    Senza `collezioni` le salva tutte, tranne quelle di sistema: un elenco
    scritto a mano resta indietro appena ne nasce una nuova.
    """
    nomi = collezioni or sorted(nome for nome in db.list_collection_names() if not nome.startswith("system."))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destinazione = SERVER_ROOT / "backups" / f"{prefisso or db.name}-{stamp}"
    destinazione.mkdir(parents=True, exist_ok=True)

    conteggi = {}
    for nome in nomi:
        documenti = list(db[nome].find({}))
        conteggi[nome] = len(documenti)
        (destinazione / f"{nome}.json").write_text(json_util.dumps(documenti), encoding="utf-8")

    manifest = {
        "creato": datetime.now().isoformat(),
        "database": db.name,
        "motivo": motivo,
        "documenti": conteggi,
        "ripristino": "documents/script/restore_backup.py <cartella>",
    }
    (destinazione / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Backup salvato in {destinazione} ({sum(conteggi.values())} documenti)")
    return destinazione


def parse_args():
    parser = argparse.ArgumentParser(description="Copia di sicurezza del database in JSON")
    parser.add_argument("--uri", default=uri_del_server())
    parser.add_argument("--db", default=os.getenv("MONGODB_DB"), help="nome del database, se non e nell'indirizzo")
    parser.add_argument("--collections", default="", help="solo queste, separate da virgola")
    return parser.parse_args()


def main():
    args = parse_args()
    client, db = apri_database(args.uri, args.db, socket_ms=120000)
    try:
        collezioni = [nome.strip() for nome in args.collections.split(",") if nome.strip()]
        salva_backup(db, "backup a mano", collezioni or None)
    finally:
        client.close()


if __name__ == "__main__":
    main()
