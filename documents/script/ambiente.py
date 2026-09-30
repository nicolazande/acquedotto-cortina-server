"""Quello che gli script hanno in comune: il .env del server, le variabili lette
in un modo solo, e come si apre un database.

Ogni script ne aveva una copia sua - tre modi di ricavare il nome del database
dall'indirizzo, due di leggere un numero o un elenco dall'ambiente, due blocchi
uguali per scegliere fra database locale e produzione - e le copie avevano gia
cominciato a divergere: il ripristino non guardava il nome del database scritto
in fondo all'indirizzo, il backup non leggeva le opzioni TLS.
"""

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv
from pymongo import MongoClient

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")

DEFAULT_DB_NAME = "acquedotto-zuel"
URI_LOCALE = "mongodb://localhost:27017"


def uri_del_server() -> str:
    """L'indirizzo del database del server, letto al momento: chi lavora sulla
    produzione (--remoto) lo cambia dopo che gli script sono stati caricati."""
    return os.getenv("MONGODB_URI", f"{URI_LOCALE}/{DEFAULT_DB_NAME}")


def env_flag(nome: str, predefinito: bool = False) -> bool:
    valore = os.getenv(nome)
    if valore is None:
        return predefinito
    return valore.strip().lower() in {"1", "true", "yes", "y", "on"}


def env_int(nome: str, predefinito: int) -> int:
    """Un numero positivo; un valore assente o sbagliato vale il predefinito."""
    try:
        valore = int(os.getenv(nome) or predefinito)
    except ValueError:
        return predefinito
    return valore if valore > 0 else predefinito


def env_list(nome: str, predefinito: list[str]) -> list[str]:
    valore = os.getenv(nome)
    if not valore:
        return predefinito
    return [voce.strip() for voce in valore.split(",") if voce.strip()]


def nome_nell_indirizzo(uri: str) -> str:
    return unquote(urlparse(uri).path.lstrip("/"))


def nome_database(uri: str) -> str:
    """Il database scritto in fondo all'indirizzo, o quello del gestionale."""
    return nome_nell_indirizzo(uri) or DEFAULT_DB_NAME


def opzioni_mongo(prefisso: str = "MONGODB", socket_ms: int = 45000) -> dict:
    """Tempi e TLS della connessione, dalle variabili `<prefisso>_...`."""
    opzioni = {
        "serverSelectionTimeoutMS": env_int(f"{prefisso}_SERVER_SELECTION_TIMEOUT_MS", 10000),
        "socketTimeoutMS": env_int(f"{prefisso}_SOCKET_TIMEOUT_MS", socket_ms),
        "maxPoolSize": env_int(f"{prefisso}_MAX_POOL_SIZE", 10),
    }
    for variabile, opzione in (
        ("TLS", "tls"),
        ("TLS_ALLOW_INVALID_CERTIFICATES", "tlsAllowInvalidCertificates"),
        ("DIRECT_CONNECTION", "directConnection"),
    ):
        if os.getenv(f"{prefisso}_{variabile}", "").strip():
            opzioni[opzione] = env_flag(f"{prefisso}_{variabile}")
    return opzioni


def apri_database(uri: str, nome: str | None = None, prefisso: str = "MONGODB", socket_ms: int = 45000):
    """Il client e il database; il client va chiuso da chi lo apre."""
    client = MongoClient(uri, **opzioni_mongo(prefisso, socket_ms))
    return client, client[nome or nome_database(uri)]


def database_del_server():
    """Il database che usa il server: quello del .env, letto adesso."""
    return apri_database(uri_del_server(), os.getenv("MONGODB_DB"))


def copia_gesco_e_destinazione(argomenti):
    """Per confrontare o allineare: la copia scaricata da Gesco, sempre locale,
    e il database in uso, locale o - con --remoto - la produzione.

    Restituisce i client da chiudere, l'origine e la destinazione.
    """
    locale = MongoClient(URI_LOCALE)
    origine = locale[argomenti.origine]
    if not argomenti.remoto:
        return [locale], origine, locale[argomenti.destinazione or DEFAULT_DB_NAME]

    uri = os.getenv("REMOTE_MONGODB_URI")
    # Sulla produzione il nome del database va detto, mai indovinato: ripiegare
    # sul nome predefinito scriverebbe in un database nuovo accanto a quello vero.
    nome = nome_nell_indirizzo(uri or "") or os.getenv("REMOTE_MONGODB_DB")
    if not uri or not nome:
        locale.close()
        raise SystemExit("--remoto richiede REMOTE_MONGODB_URI nel file .env, con il nome del database "
                         "in fondo all'indirizzo o in REMOTE_MONGODB_DB")
    remoto = MongoClient(uri)
    return [locale, remoto], origine, remoto[nome]
