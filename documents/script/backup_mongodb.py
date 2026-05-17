import argparse
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from bson import json_util
from dotenv import load_dotenv
from pymongo import MongoClient

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")

DEFAULT_DB_NAME = "acquedotto-zuel"
DEFAULT_COLLECTIONS = [
    "articoli",
    "clienti",
    "contatori",
    "edifici",
    "fasce",
    "fatture",
    "letture",
    "listini",
    "scadenze",
    "servizi",
    "note_attachments",
]


def database_name_from_uri(mongo_uri: str) -> str | None:
    parsed_uri = urlparse(mongo_uri)
    db_name = unquote(parsed_uri.path.lstrip("/"))
    return db_name or None


def parse_args():
    parser = argparse.ArgumentParser(description="Backup MongoDB collections as JSON files.")
    parser.add_argument("--uri", default=os.getenv("MONGODB_URI"))
    parser.add_argument("--db", default=os.getenv("MONGODB_DB"))
    parser.add_argument("--collections", default=",".join(DEFAULT_COLLECTIONS))
    parser.add_argument("--output-dir", default=None)
    return parser.parse_args()


def main():
    args = parse_args()
    if not args.uri:
        raise RuntimeError("Set --uri or MONGODB_URI.")

    db_name = args.db or database_name_from_uri(args.uri) or DEFAULT_DB_NAME
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = Path(args.output_dir or SERVER_ROOT / "backups" / f"{db_name}-{timestamp}")
    output_dir.mkdir(parents=True, exist_ok=True)

    collections = [item.strip() for item in args.collections.split(",") if item.strip()]
    client = MongoClient(args.uri, serverSelectionTimeoutMS=10000, socketTimeoutMS=120000)
    db = client[db_name]

    try:
        print(f"Backup database: {db.name}")
        print(f"Output: {output_dir}")
        for collection_name in collections:
            documents = list(db[collection_name].find({}))
            target = output_dir / f"{collection_name}.json"
            target.write_text(json_util.dumps(documents, indent=2), encoding="utf-8")
            print(f"{collection_name}: {len(documents)}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
