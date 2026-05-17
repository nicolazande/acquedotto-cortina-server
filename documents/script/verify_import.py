import argparse
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv
from pymongo import MongoClient

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")

DEFAULT_DB_NAME = "acquedotto-zuel"
DEFAULT_URI = f"mongodb://localhost:27017/{DEFAULT_DB_NAME}"

COLLECTIONS = [
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
]

REQUIRED_REFS = [
    ("contatori", "cliente", "clienti"),
    ("letture", "contatore", "contatori"),
    ("servizi", "fattura", "fatture"),
]

OPTIONAL_REFS = [
    ("fatture", "cliente", "clienti"),
    ("fatture", "scadenza", "scadenze"),
    ("servizi", "articolo", "articoli"),
    ("servizi", "lettura", "letture"),
    ("contatori", "edificio", "edifici"),
    ("contatori", "listino", "listini"),
    ("fasce", "listino", "listini"),
]


def database_name_from_uri(mongo_uri: str) -> str | None:
    parsed_uri = urlparse(mongo_uri)
    db_name = unquote(parsed_uri.path.lstrip("/"))
    return db_name or None


def parse_args():
    parser = argparse.ArgumentParser(description="Verify imported Acquedotto data in MongoDB.")
    parser.add_argument("--uri", default=os.getenv("MONGODB_URI") or DEFAULT_URI)
    parser.add_argument("--db", default=os.getenv("MONGODB_DB"))
    return parser.parse_args()


def count_missing(db, collection_name: str, field_name: str) -> int:
    return db[collection_name].count_documents({
        "$or": [
            {field_name: {"$exists": False}},
            {field_name: None},
        ],
    })


def count_orphans(db, collection_name: str, field_name: str, target_collection: str) -> int:
    cursor = db[collection_name].aggregate([
        {"$match": {field_name: {"$ne": None}}},
        {
            "$lookup": {
                "from": target_collection,
                "localField": field_name,
                "foreignField": "_id",
                "as": "_target",
            },
        },
        {"$match": {"_target": {"$size": 0}}},
        {"$count": "count"},
    ])
    return next(cursor, {}).get("count", 0)


def count_invoices_without_services(db) -> int:
    cursor = db.fatture.aggregate([
        {
            "$lookup": {
                "from": "servizi",
                "localField": "_id",
                "foreignField": "fattura",
                "as": "_servizi",
            },
        },
        {"$match": {"_servizi": {"$size": 0}}},
        {"$count": "count"},
    ])
    return next(cursor, {}).get("count", 0)


def main():
    args = parse_args()
    db_name = args.db or database_name_from_uri(args.uri) or DEFAULT_DB_NAME
    client = MongoClient(args.uri, serverSelectionTimeoutMS=5000, socketTimeoutMS=120000)
    db = client[db_name]
    has_errors = False

    try:
        print(f"Database: {db.name}")
        print("Counts:")
        for collection_name in COLLECTIONS:
            print(f"- {collection_name}: {db[collection_name].count_documents({})}")

        print("Required references:")
        for collection_name, field_name, target_collection in REQUIRED_REFS:
            missing = count_missing(db, collection_name, field_name)
            orphans = count_orphans(db, collection_name, field_name, target_collection)
            if missing or orphans:
                has_errors = True
            print(
                f"- {collection_name}.{field_name} -> {target_collection}: "
                f"missing={missing}, orphan={orphans}"
            )

        print("Optional references:")
        for collection_name, field_name, target_collection in OPTIONAL_REFS:
            missing = count_missing(db, collection_name, field_name)
            orphans = count_orphans(db, collection_name, field_name, target_collection)
            print(
                f"- {collection_name}.{field_name} -> {target_collection}: "
                f"missing={missing}, orphan={orphans}"
            )

        invoices_without_services = count_invoices_without_services(db)
        print(f"Invoices without services: {invoices_without_services}")
    finally:
        client.close()

    if has_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
