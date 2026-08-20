"""Ripristina un backup creato prima di un import.

    .venv/bin/python documents/script/restore_backup.py backups/before-import-20260820-120000

Le collection presenti nel backup vengono sostituite integralmente. Le altre
non vengono toccate. Senza --conferma lo script si limita a dire cosa farebbe.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from bson import json_util
from dotenv import load_dotenv
from pymongo import MongoClient

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")


def parse_args():
    parser = argparse.ArgumentParser(description="Ripristina un backup dell'import")
    parser.add_argument("cartella", help="cartella del backup (contiene manifest.json)")
    parser.add_argument("--conferma", action="store_true", help="esegue davvero il ripristino")
    parser.add_argument("--uri", default=os.getenv("MONGODB_URI", "mongodb://localhost:27017/acquedotto-zuel"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cartella = Path(args.cartella)
    manifest_path = cartella / "manifest.json"

    if not manifest_path.exists():
        print(f"Manifest non trovato in {cartella}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"Backup del {manifest['creato']} sul database {manifest['database']}")

    client = MongoClient(args.uri)
    db = client.get_default_database()

    try:
        for nome, attesi in manifest["documenti"].items():
            percorso = cartella / f"{nome}.json"
            if not percorso.exists():
                print(f"  {nome}: file mancante, saltata")
                continue

            documenti = json_util.loads(percorso.read_text(encoding="utf-8"))
            attuali = db[nome].count_documents({})
            print(f"  {nome}: {attuali} attuali -> {len(documenti)} dal backup (attesi {attesi})")

            if not args.conferma:
                continue

            db[nome].delete_many({})
            if documenti:
                db[nome].insert_many(documenti)

        if not args.conferma:
            print("\nSola lettura: aggiungere --conferma per ripristinare davvero.")
    finally:
        client.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
