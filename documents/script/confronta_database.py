"""Confronta due database del gestionale e dice dove non coincidono.

Serve per l'audit dei dati: da una parte una copia appena scaricata da Gesco -
l'import corretto, in un database a parte - dall'altra la produzione, che viene
dall'import vecchio e nel frattempo ha continuato a lavorare.

    .venv/bin/python documents/script/confronta_database.py --origine acquedotto-zuel-gesco
    .venv/bin/python documents/script/confronta_database.py --origine acquedotto-zuel-gesco --remoto

Non scrive niente: legge e stampa. I record si riconoscono per la chiave che
hanno in Gesco - l'id del cliente, quello del contatore, quello della lettura -
e le fatture per intestatario, data e importi, perche nei dati vecchi il loro
numero non e affidabile.
"""
import argparse
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402
from pymongo import MongoClient  # noqa: E402

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")

# Come si riconosce lo stesso record nei due database, e quali campi confrontare.
# I riferimenti (ObjectId) sono esclusi: due import indipendenti li generano
# diversi, e confrontarli direbbe solo che sono due database diversi.
COLLEZIONI = {
    "clienti": {
        "chiave": lambda d: str(d.get("codice") or ""),
        "campi": ["ragione_sociale", "codice_fiscale", "partita_iva", "email", "email_pec",
                  "codice_destinatario", "fattura_elettronica", "socio", "pagamento",
                  "indirizzo_residenza", "cap_residenza", "localita_residenza"],
    },
    "contatori": {
        "chiave": lambda d: str(d.get("codice") or ""),
        "campi": ["seriale", "seriale_interno", "nome_cliente", "nome_edificio", "tipo_attivita",
                  "tipo_contatore", "inattivo", "subentro", "sostituzione", "condominiale",
                  "inizio", "scadenza", "consumo"],
    },
    "letture": {
        "chiave": lambda d: str(d.get("id_lettura") or ""),
        "campi": ["data_lettura", "consumo", "unita_misura", "fatturata", "tipo"],
    },
    "scadenze": {
        "chiave": lambda d: f"{d.get('anno')}/{d.get('numero')}",
        "campi": ["scadenza", "totale", "cognome", "nome", "saldo"],
    },
    "fatture": {
        # Il numero delle fatture importate prima della correzione e il civico
        # dell'indirizzo: per riconoscerle servono intestatario, data e importi.
        "chiave": lambda d: "|".join([
            str(d.get("codice") or ""),
            d["data_fattura"].strftime("%Y-%m-%d") if d.get("data_fattura") else "",
            f"{float(d.get('totale_fattura') or 0):.2f}",
            f"{float(d.get('imponibile') or 0):.2f}",
            str(d.get("tipo_documento") or ""),
        ]),
        "campi": ["anno", "numero", "ragione_sociale", "destinazione", "iva", "tipo_pagamento"],
    },
    "edifici": {
        "chiave": lambda d: str(d.get("descrizione") or ""),
        "campi": ["indirizzo", "numero", "cap", "localita", "catasto", "foglio", "ped", "estensione"],
    },
    "articoli": {
        "chiave": lambda d: str(d.get("codice") or ""),
        "campi": ["descrizione", "iva"],
    },
    "listini": {
        "chiave": lambda d: str(d.get("categoria") or ""),
        "campi": ["descrizione"],
    },
    "fasce": {
        "chiave": lambda d: f"{d.get('tipo')}|{d.get('min')}|{d.get('max')}|{d.get('inizio')}",
        "campi": ["prezzo", "scadenza"],
    },
}


def confrontabile(valore):
    """Due valori uguali devono risultare uguali anche scritti in modi diversi."""
    if hasattr(valore, "strftime"):
        return valore.strftime("%Y-%m-%d")
    if isinstance(valore, float):
        return f"{valore:.2f}"
    if isinstance(valore, str):
        return " ".join(valore.split())
    return valore


def indicizza(collezione, chiave, escludi=frozenset()):
    per_chiave = defaultdict(list)
    for documento in collezione.find({}):
        if documento["_id"] not in escludi:
            per_chiave[chiave(documento)].append(documento)
    per_chiave.pop("", None)
    return per_chiave


def scadenze_del_gestionale(db):
    """Le scadenze delle fatture emesse da qui: portano anno e numero del loro
    documento, che coincidono con quelli di una fattura di Gesco (la 2026/A/1
    ha la scadenza 2026/1). Non sono di Gesco e non si confrontano con Gesco."""
    return frozenset(
        documento["scadenza"]
        for documento in db.fatture.find({"serie": {"$exists": True}}, {"scadenza": 1})
        if documento.get("scadenza")
    )


def confronta(nome, origine, destinazione, esempi=3):
    regole = COLLEZIONI[nome]
    esclusi = scadenze_del_gestionale(destinazione) if nome == "scadenze" else frozenset()
    da_gesco = indicizza(origine[nome], regole["chiave"])
    in_uso = indicizza(destinazione[nome], regole["chiave"], esclusi)

    solo_gesco = sorted(set(da_gesco) - set(in_uso))
    solo_destinazione = sorted(set(in_uso) - set(da_gesco))
    comuni = set(da_gesco) & set(in_uso)

    differenze = Counter()
    campioni = defaultdict(list)
    for chiave in comuni:
        uno, due = da_gesco[chiave][0], in_uso[chiave][0]
        for campo in regole["campi"]:
            if confrontabile(uno.get(campo)) != confrontabile(due.get(campo)):
                differenze[campo] += 1
                if len(campioni[campo]) < esempi:
                    campioni[campo].append(f"{chiave}: Gesco {uno.get(campo)!r} / in uso {due.get(campo)!r}")

    print(f"\n== {nome}")
    print(f"   da Gesco: {origine[nome].count_documents({})} | in uso: {destinazione[nome].count_documents({})}"
          f" | riconosciuti: {len(comuni)}")
    if solo_gesco:
        print(f"   presenti solo in Gesco: {len(solo_gesco)} -> {', '.join(solo_gesco[:5])}")
    if solo_destinazione:
        print(f"   presenti solo in uso:   {len(solo_destinazione)} -> {', '.join(solo_destinazione[:5])}")
    if not differenze:
        print("   nessuna differenza sui campi confrontati")
    for campo, quante in differenze.most_common():
        print(f"   {campo}: {quante} diversi")
        for esempio in campioni[campo]:
            print(f"      {esempio}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origine", required=True, help="database con la copia appena scaricata da Gesco")
    parser.add_argument("--destinazione", help="database da confrontare (predefinito: quello del .env)")
    parser.add_argument("--remoto", action="store_true", help="confronta con il database di produzione")
    argomenti = parser.parse_args()

    locale = MongoClient("mongodb://localhost:27017")
    origine = locale[argomenti.origine]

    if argomenti.remoto:
        uri = os.getenv("REMOTE_MONGODB_URI")
        if not uri:
            print("--remoto richiede REMOTE_MONGODB_URI nel file .env")
            return 1
        client = MongoClient(uri)
        destinazione = client.get_default_database()
    else:
        client = locale
        destinazione = locale[argomenti.destinazione or "acquedotto-zuel"]

    print(f"Copia da Gesco: {origine.name} | Database in uso: {destinazione.name}")

    try:
        for nome in COLLEZIONI:
            confronta(nome, origine, destinazione)

        # I servizi non hanno una chiave propria: si contano per fattura.
        print("\n== servizi")
        print(f"   da Gesco: {origine.servizi.count_documents({})} | in uso: {destinazione.servizi.count_documents({})}")
    finally:
        locale.close()
        if client is not locale:
            client.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
