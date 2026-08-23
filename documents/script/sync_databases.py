import argparse
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv
from pymongo import MongoClient, ReplaceOne

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")

DEFAULT_DB_NAME = "acquedotto-zuel"
DEFAULT_LOCAL_URI = f"mongodb://localhost:27017/{DEFAULT_DB_NAME}"
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
    # Le consegne riferiscono le fatture per _id: vanno allineate insieme a
    # loro, altrimenti la coda di una delle due basi punta a documenti assenti.
    "consegne",
]


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except ValueError:
        return default


def env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def database_name_from_uri(mongo_uri: str) -> str | None:
    parsed_uri = urlparse(mongo_uri)
    db_name = unquote(parsed_uri.path.lstrip("/"))
    return db_name or None


def mongo_options() -> dict:
    options = {
        "serverSelectionTimeoutMS": env_int("SYNC_SERVER_SELECTION_TIMEOUT_MS", 10000),
        "socketTimeoutMS": env_int("SYNC_SOCKET_TIMEOUT_MS", 120000),
    }

    if os.getenv("SYNC_TLS", "").strip():
        options["tls"] = env_bool("SYNC_TLS")
    if os.getenv("SYNC_TLS_ALLOW_INVALID_CERTIFICATES", "").strip():
        options["tlsAllowInvalidCertificates"] = env_bool("SYNC_TLS_ALLOW_INVALID_CERTIFICATES")
    if os.getenv("SYNC_DIRECT_CONNECTION", "").strip():
        options["directConnection"] = env_bool("SYNC_DIRECT_CONNECTION")

    return options


def get_database(uri: str, db_name: str | None):
    client = MongoClient(uri, **mongo_options())
    return client, client[db_name or database_name_from_uri(uri) or DEFAULT_DB_NAME]


def chunked(items, size: int):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def rischio_duplicati(source_db, target_db, collection_name: str) -> tuple[bool, str]:
    """Rileva il caso in cui una sincronizzazione duplicherebbe invece di aggiornare.

    I documenti si riconoscono dall'_id. Dopo un reimport completo da Gesco gli
    _id sono tutti nuovi: senza --delete-missing la sincronizzazione non trova
    corrispondenze e inserisce ogni documento accanto a quello vecchio,
    raddoppiando la collection senza alcun errore. E successo davvero.
    """
    n_sorgente = source_db[collection_name].count_documents({})
    n_destinazione = target_db[collection_name].count_documents({})

    if n_sorgente == 0 or n_destinazione == 0:
        return False, ""

    campione = [d["_id"] for d in source_db[collection_name].find({}, {"_id": 1}).limit(200)]
    comuni = target_db[collection_name].count_documents({"_id": {"$in": campione}})
    quota = comuni / len(campione) if campione else 1.0

    if quota < 0.1:
        return True, (
            f"{collection_name}: su {len(campione)} documenti di origine solo {comuni} "
            f"esistono gia nella destinazione ({quota:.0%}). Gli identificativi non "
            f"corrispondono: la sincronizzazione aggiungerebbe {n_sorgente} documenti "
            f"ai {n_destinazione} presenti invece di aggiornarli."
        )

    return False, ""


def sync_collection(source_db, target_db, collection_name: str, batch_size: int, delete_missing: bool, dry_run: bool):
    source_collection = source_db[collection_name]
    target_collection = target_db[collection_name]
    source_count = source_collection.count_documents({})
    target_count = target_collection.count_documents({})

    if dry_run:
        print(f"[dry-run] {collection_name}: source={source_count}, target={target_count}")
        return {"upserted": 0, "modified": 0, "deleted": 0}

    upserted = 0
    modified = 0
    source_ids = set()
    batch = []

    for document in source_collection.find({}).batch_size(batch_size):
        source_ids.add(document["_id"])
        batch.append(ReplaceOne({"_id": document["_id"]}, document, upsert=True))

        if len(batch) >= batch_size:
            result = target_collection.bulk_write(batch, ordered=False)
            upserted += result.upserted_count
            modified += result.modified_count
            batch = []

    if batch:
        result = target_collection.bulk_write(batch, ordered=False)
        upserted += result.upserted_count
        modified += result.modified_count

    deleted = 0
    if delete_missing:
        target_ids = {item["_id"] for item in target_collection.find({}, {"_id": 1})}
        missing_ids = list(target_ids - source_ids)
        for delete_batch in chunked(missing_ids, batch_size):
            result = target_collection.delete_many({"_id": {"$in": delete_batch}})
            deleted += result.deleted_count

    print(
        f"{collection_name}: source={source_count}, target_before={target_count}, "
        f"upserted={upserted}, modified={modified}, deleted={deleted}"
    )
    return {"upserted": upserted, "modified": modified, "deleted": deleted}


def parse_args():
    parser = argparse.ArgumentParser(description="Sync Acquedotto MongoDB data between local and remote databases.")
    parser.add_argument(
        "--direction",
        choices=["pull", "push", "remote-to-local", "local-to-remote"],
        default=os.getenv("SYNC_DIRECTION", "pull"),
        help="pull/remote-to-local copies remote into local. push/local-to-remote copies local into remote.",
    )
    parser.add_argument("--local-uri", default=os.getenv("LOCAL_MONGODB_URI") or os.getenv("MONGODB_URI") or DEFAULT_LOCAL_URI)
    parser.add_argument("--local-db", default=os.getenv("LOCAL_MONGODB_DB") or os.getenv("MONGODB_DB"))
    parser.add_argument("--remote-uri", default=os.getenv("REMOTE_MONGODB_URI") or os.getenv("MONGODB_REMOTE_URI"))
    parser.add_argument("--remote-db", default=os.getenv("REMOTE_MONGODB_DB"))
    parser.add_argument("--collections", default=",".join(env_list("SYNC_COLLECTIONS", DEFAULT_COLLECTIONS)))
    parser.add_argument("--batch-size", type=int, default=env_int("SYNC_BATCH_SIZE", 500))
    parser.add_argument("--delete-missing", action="store_true", default=env_bool("SYNC_DELETE_MISSING"))
    parser.add_argument("--include-users", action="store_true", default=env_bool("SYNC_INCLUDE_USERS"))
    parser.add_argument("--dry-run", action="store_true", default=env_bool("SYNC_DRY_RUN"))
    parser.add_argument(
        "--force",
        action="store_true",
        help="procede anche quando gli identificativi non corrispondono (rischio duplicati)",
    )
    return parser.parse_args()


def resolve_databases(args):
    if not args.remote_uri:
        raise RuntimeError("Set REMOTE_MONGODB_URI in .env or pass --remote-uri.")

    local_client, local_db = get_database(args.local_uri, args.local_db)
    remote_client, remote_db = get_database(args.remote_uri, args.remote_db)

    if args.direction in {"pull", "remote-to-local"}:
        return remote_client, remote_db, local_client, local_db, "remote -> local"
    return local_client, local_db, remote_client, remote_db, "local -> remote"


def main():
    args = parse_args()
    collections = [item.strip() for item in args.collections.split(",") if item.strip()]
    if args.include_users and "users" not in collections:
        collections.append("users")

    source_client, source_db, target_client, target_db, direction_label = resolve_databases(args)

    try:
        print(f"Sync direction: {direction_label}")
        print(f"Source database: {source_db.name}")
        print(f"Target database: {target_db.name}")
        print(f"Collections: {', '.join(collections)}")
        if args.delete_missing:
            print("Delete missing: enabled")
        if args.dry_run:
            print("Dry run: enabled")

        # Con --delete-missing la sostituzione e integrale e il problema non si
        # pone. Senza, identificativi che non corrispondono producono duplicati
        # silenziosi: meglio fermarsi e dirlo.
        if not args.delete_missing and not args.force:
            avvisi = []
            for collection_name in collections:
                rischio, messaggio = rischio_duplicati(source_db, target_db, collection_name)
                if rischio:
                    avvisi.append(messaggio)

            if avvisi:
                print("\nSincronizzazione interrotta: rischio di duplicati.\n")
                for messaggio in avvisi:
                    print(f"  {messaggio}")
                print(
                    "\nSe la sorgente deve sostituire la destinazione (tipico dopo un"
                    "\nreimport completo) usare --delete-missing. Per procedere comunque"
                    "\ncon l'inserimento usare --force."
                )
                return 1

        totals = {"upserted": 0, "modified": 0, "deleted": 0}
        for collection_name in collections:
            result = sync_collection(
                source_db,
                target_db,
                collection_name,
                args.batch_size,
                args.delete_missing,
                args.dry_run,
            )
            for key, value in result.items():
                totals[key] += value

        print(
            f"Sync completed: upserted={totals['upserted']}, "
            f"modified={totals['modified']}, deleted={totals['deleted']}"
        )
    finally:
        source_client.close()
        target_client.close()


if __name__ == "__main__":
    # Il codice di uscita deve riflettere l'esito: un'interruzione per rischio
    # duplicati passava per riuscita in automazione.
    sys.exit(main() or 0)
