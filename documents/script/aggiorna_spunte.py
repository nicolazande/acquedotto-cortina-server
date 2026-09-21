"""Rilegge da Gesco le spunte che l'import non ha mai letto.

Una casella di spunta non ha testo: il parser la leggeva come campo vuoto e
`parse_bool` la dava per "no". Tutti i dati importati prima della correzione
hanno quindi socio, fattura elettronica, contatore inattivo, subentro,
sostituzione e condominiale **falsi su ogni record**, anche dove in Gesco sono
spuntati.

Questo script non reimporta niente: apre le schede di Gesco in sola lettura e
aggiorna solo quei campi, piu il codice Gesco del cliente dove manca - e la
chiave con cui le fatture trovano il loro intestatario.

    npm run gesco:spunte                      # mostra e basta
    npm run gesco:spunte -- --scrivi           # applica, sul database locale
    npm run gesco:spunte -- --scrivi --remoto  # applica su quello di produzione

Serve una sessione valida (`npm run gesco:login`): il login chiede un CAPTCHA.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import main  # noqa: E402  (il percorso va sistemato prima dell'import)

SPUNTE_CLIENTE = ["socio", "fattura_elettronica"]
SPUNTE_CONTATORE = ["inattivo", "subentro", "sostituzione", "condominiale"]


def mappa_dei_codici(db) -> dict:
    """Codice Gesco -> cliente, ricavato da dove il codice e gia scritto.

    I clienti importati prima della correzione non hanno `codice`, ma la scheda
    del contatore riporta il cliente come "1290 - ROSSI MARIO": il numero e lo
    stesso id di Gesco.
    """
    mappa = {}
    for cliente in db.clienti.find({"codice": {"$nin": [None, ""]}}, {"codice": 1}):
        mappa[str(cliente["codice"])] = cliente["_id"]

    for contatore in db.contatori.find({"nome_cliente": {"$regex": r"^\d+ - "}}, {"nome_cliente": 1, "cliente": 1}):
        codice = contatore["nome_cliente"].split(" - ")[0].strip()
        mappa.setdefault(codice, contatore.get("cliente"))

    return {codice: id_cliente for codice, id_cliente in mappa.items() if id_cliente}


def cliente_da_aggiornare(db, codice, dati, codici):
    """Il cliente a cui appartiene la scheda, e cosa cambia."""
    id_cliente = codici.get(str(codice))

    if not id_cliente:
        # Restano i clienti senza contatori: li riconosce la ragione sociale, ma
        # solo se e di uno solo, altrimenti si sceglierebbe a caso.
        nome = main.testo_confrontabile(dati.get("ragione_sociale"))
        candidati = [
            documento["_id"] for documento in db.clienti.find({}, {"ragione_sociale": 1})
            if main.testo_confrontabile(documento.get("ragione_sociale")) == nome
        ]
        if len(candidati) != 1:
            return None, None
        id_cliente = candidati[0]

    attuale = db.clienti.find_one({"_id": id_cliente}, {campo: 1 for campo in SPUNTE_CLIENTE + ["codice"]})
    cambi = {campo: dati[campo] for campo in SPUNTE_CLIENTE if bool(attuale.get(campo)) != bool(dati[campo])}

    if not attuale.get("codice"):
        cambi["codice"] = str(codice)

    return id_cliente, cambi


def aggiorna_clienti(cookie, db, scrivi: bool) -> dict:
    codici = mappa_dei_codici(db)
    identificativi = main.collect_paged_ids(
        cookie, "Client",
        lambda pagina: main.fasttools_url(f"/Customers?page={pagina}"),
        main.parse_client_list,
    )

    esito = {"letti": 0, "cambiati": 0, "non_trovati": [], "spunte": {campo: 0 for campo in SPUNTE_CLIENTE}}

    def lavora(codice):
        dati = main.parse_client_details(main.fetch_html(cookie, main.fasttools_url(f"/Customers/Details/{codice}")))
        id_cliente, cambi = cliente_da_aggiornare(db, codice, dati, codici)
        esito["letti"] += 1

        if id_cliente is None:
            esito["non_trovati"].append(f"{codice} {dati.get('ragione_sociale')}")
            return

        for campo in SPUNTE_CLIENTE:
            if dati[campo]:
                esito["spunte"][campo] += 1

        if not cambi:
            return

        esito["cambiati"] += 1
        if scrivi:
            db.clienti.update_one({"_id": id_cliente}, {"$set": cambi})

    main.run_threaded(identificativi, lavora, main.env_int("IMPORT_CLIENTI_WORKERS", 12))
    return esito


def aggiorna_contatori(cookie, db, scrivi: bool) -> dict:
    # I contatori si leggono dalla scheda del cliente, ma il loro id e gia nel
    # database: `codice` e l'id di Gesco, e si va dritti alla pagina.
    contatori = list(db.contatori.find({"codice": {"$nin": [None, ""]}}, {"codice": 1, **{c: 1 for c in SPUNTE_CONTATORE}}))
    esito = {"letti": 0, "cambiati": 0, "spunte": {campo: 0 for campo in SPUNTE_CONTATORE}}

    def lavora(contatore):
        dati = main.parse_counter_details(
            main.fetch_html(cookie, main.fasttools_url(f"/Counters/Details/{contatore['codice']}"))
        )
        esito["letti"] += 1

        for campo in SPUNTE_CONTATORE:
            if dati[campo]:
                esito["spunte"][campo] += 1

        cambi = {campo: dati[campo] for campo in SPUNTE_CONTATORE if bool(contatore.get(campo)) != bool(dati[campo])}
        if not cambi:
            return

        esito["cambiati"] += 1
        if scrivi:
            db.contatori.update_one({"_id": contatore["_id"]}, {"$set": cambi})

    main.run_threaded(contatori, lavora, main.env_int("IMPORT_CLIENTI_WORKERS", 12))
    return esito


def destinazione_remota():
    """`--remoto` lavora sul database di produzione invece che su quello locale.

    Sta qui e non nella riga di comando perche passare l'indirizzo a mano e il
    modo piu facile di scrivere sul database sbagliato: o la variabile c'e, o lo
    script si ferma. Stessa regola degli script di manutenzione in `scripts/`.
    """
    if "--remoto" not in sys.argv:
        return True

    remoto = main.os.getenv("REMOTE_MONGODB_URI")
    if not remoto:
        print("--remoto richiede REMOTE_MONGODB_URI nel file .env")
        return False

    main.os.environ["MONGODB_URI"] = remoto
    main.os.environ.pop("MONGODB_DB", None)
    print("== PRODUZIONE: si sta lavorando sul database remoto ==")
    return True


def main_script() -> int:
    if not destinazione_remota():
        return 1

    scrivi = "--scrivi" in sys.argv
    cookie = main.cookie_salvato() or main.get_session_cookie(
        main.os.getenv("FASTTOOLS_EMAIL"), main.os.getenv("FASTTOOLS_PASSWORD")
    )

    if not cookie:
        print("Nessuna sessione Gesco: esegui prima `npm run gesco:login`.")
        return 1

    client, db = main.get_database()
    print(f"Database: {db.name} | Gesco: {main.FASTTOOLS_BASE_URL}")
    print("== SOLA LETTURA (usa --scrivi per applicare) ==" if not scrivi else "== APPLICO LE CORREZIONI ==")

    try:
        clienti = aggiorna_clienti(cookie, db, scrivi)
        print(f"\nClienti letti da Gesco: {clienti['letti']}")
        for campo, quanti in clienti["spunte"].items():
            print(f"  con {campo}: {quanti}")
        print(f"  schede da correggere: {clienti['cambiati']}")
        if clienti["non_trovati"]:
            print(f"  non abbinati ({len(clienti['non_trovati'])}): {', '.join(clienti['non_trovati'][:10])}")

        contatori = aggiorna_contatori(cookie, db, scrivi)
        print(f"\nContatori letti da Gesco: {contatori['letti']}")
        for campo, quanti in contatori["spunte"].items():
            print(f"  con {campo}: {quanti}")
        print(f"  schede da correggere: {contatori['cambiati']}")
    finally:
        client.close()

    return 0


if __name__ == "__main__":
    sys.exit(main_script())
