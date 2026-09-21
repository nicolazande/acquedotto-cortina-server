"""Porta nel database in uso cio che manca rispetto a una copia scaricata da Gesco.

Non reimporta e non cancella: aggiunge quello che non c'e e corregge i campi che
l'import vecchio sbagliava. Tutto il resto - le fatture emesse da questo
gestionale, le consegne, gli account, le tariffe rinnovate qui - non viene
toccato.

    .venv/bin/python documents/script/allinea_a_gesco.py --origine acquedotto-zuel-gesco
    .venv/bin/python documents/script/allinea_a_gesco.py --origine acquedotto-zuel-gesco --scrivi
    .venv/bin/python documents/script/allinea_a_gesco.py --origine acquedotto-zuel-gesco --scrivi --remoto

Cosa fa, in quest'ordine:

1. **numero delle fatture importate**: l'import vecchio ci scriveva il civico
   dell'indirizzo. Si corregge solo sui documenti che vengono da Gesco, mai su
   quelli emessi da qui (che hanno una serie propria);
2. **scadenze mancanti**: quelle del 2021 e di parte del 2022, mai importate, e
   il loro legame con la fattura - che si riconosce da anno e numero, ora giusti;
3. **letture mancanti**: le piu vecchie di ogni contatore, che l'import leggeva
   solo per la prima pagina;
4. **clienti e contatori mancanti**, con le loro letture;
5. **fatture mancanti**, con le loro righe.

I record si riconoscono per la chiave che hanno in Gesco; i riferimenti vengono
riscritti con gli identificativi del database di destinazione.
"""
import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402
from pymongo import MongoClient  # noqa: E402

from confronta_database import COLLEZIONI  # noqa: E402

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")

# I legami fra le collezioni, nella forma (chi, campo, verso dove).
RIFERIMENTI = [
    ("contatori", "cliente", "clienti"),
    ("contatori", "edificio", "edifici"),
    ("contatori", "listino", "listini"),
    ("letture", "contatore", "contatori"),
    ("fatture", "cliente", "clienti"),
    ("fatture", "scadenza", "scadenze"),
    ("servizi", "fattura", "fatture"),
    ("servizi", "lettura", "letture"),
    ("servizi", "articolo", "articoli"),
    ("fasce", "listino", "listini"),
]


def indice(collezione, chiave, escludi=frozenset()):
    """Chiave di Gesco -> documento, saltando chi la chiave non ce l'ha."""
    trovati = {}
    for documento in collezione.find({}):
        if documento["_id"] in escludi:
            continue
        valore = chiave(documento)
        if valore:
            trovati.setdefault(valore, documento)
    return trovati


class Allineamento:
    def __init__(self, origine, destinazione, scrivi):
        self.origine = origine
        self.destinazione = destinazione
        self.scrivi = scrivi
        self.resoconto = defaultdict(int)
        # Da identificativo nella copia di Gesco a identificativo in uso.
        self.corrispondenze = {}

    def conta(self, voce, quanti=1):
        self.resoconto[voce] += quanti

    def collega(self, nome, chiave, escludi=frozenset()):
        """Associa i documenti delle due parti e ricorda chi corrisponde a chi."""
        da_gesco = indice(self.origine[nome], chiave)
        in_uso = indice(self.destinazione[nome], chiave, escludi)

        for valore, documento in da_gesco.items():
            gemello = in_uso.get(valore)
            if gemello:
                self.corrispondenze[documento["_id"]] = gemello["_id"]

        return da_gesco, in_uso

    def riferimento(self, valore):
        """L'identificativo corrispondente nel database di destinazione.

        Quando non c'e corrispondenza il riferimento resta vuoto: un legame
        assente si vede e si ripara, uno che punta a un documento di un altro
        database sembra buono e non lo e.
        """
        if not valore:
            return valore
        return self.corrispondenze.get(valore)

    def inserisci(self, nome, documento, riferimenti):
        """Copia un documento riscrivendone i riferimenti. Torna il nuovo id."""
        copia = {campo: valore for campo, valore in documento.items() if campo != "_id"}
        for campo in riferimenti:
            if campo in copia:
                copia[campo] = self.riferimento(copia[campo])

        if not self.scrivi:
            # Senza scrivere non c'e un id nuovo: si tiene quello di origine, cosi
            # i documenti che dipendono da questo restano collegabili nel conteggio.
            self.corrispondenze[documento["_id"]] = documento["_id"]
            return documento["_id"]

        nuovo = self.destinazione[nome].insert_one(copia).inserted_id
        self.corrispondenze[documento["_id"]] = nuovo
        return nuovo

    def aggiorna(self, nome, id_documento, cambi):
        if self.scrivi:
            self.destinazione[nome].update_one({"_id": id_documento}, {"$set": cambi})

    # -- i passi ------------------------------------------------------------

    def clienti_e_contatori(self):
        da_gesco, in_uso = self.collega("clienti", COLLEZIONI["clienti"]["chiave"])
        for codice, cliente in da_gesco.items():
            if codice in in_uso:
                continue
            self.inserisci("clienti", cliente, [])
            self.conta("clienti aggiunti")

        da_gesco, in_uso = self.collega("contatori", COLLEZIONI["contatori"]["chiave"])
        for codice, contatore in da_gesco.items():
            gemello = in_uso.get(codice)
            if not gemello:
                self.inserisci("contatori", contatore, ["cliente", "edificio", "listino"])
                self.conta("contatori aggiunti")
                continue

            # Una data di cessazione arrivata dopo l'import: senza, il contatore
            # risulterebbe ancora in servizio e verrebbe fatturato.
            cambi = {
                campo: contatore.get(campo) for campo in ("inizio", "scadenza")
                if contatore.get(campo) != gemello.get(campo)
            }
            if cambi:
                self.aggiorna("contatori", gemello["_id"], cambi)
                self.conta("contatori con le date corrette")

    def letture(self):
        da_gesco, in_uso = self.collega("letture", COLLEZIONI["letture"]["chiave"])
        for identificativo, lettura in da_gesco.items():
            gemella = in_uso.get(identificativo)
            if not gemella:
                self.inserisci("letture", lettura, ["contatore"])
                self.conta("letture aggiunte")
                continue

            if bool(lettura.get("fatturata")) != bool(gemella.get("fatturata")):
                self.aggiorna("letture", gemella["_id"], {"fatturata": lettura.get("fatturata")})
                self.conta("letture con lo stato di fatturazione corretto")

    def numeri_delle_fatture(self):
        chiave = COLLEZIONI["fatture"]["chiave"]
        da_gesco, in_uso = self.collega("fatture", chiave)

        for valore, fattura in da_gesco.items():
            gemella = in_uso.get(valore)
            if not gemella:
                continue
            # I documenti emessi da questo gestionale hanno una serie propria e
            # una numerazione che non viene da Gesco: non si toccano.
            if gemella.get("serie"):
                continue
            if gemella.get("numero") != fattura.get("numero"):
                self.aggiorna("fatture", gemella["_id"], {"numero": fattura.get("numero")})
                self.conta("numeri di fattura corretti")

    def scadenze_del_gestionale(self):
        """Le scadenze delle fatture emesse da qui.

        Non hanno la serie, ma hanno anno e numero del loro documento: la
        scadenza della 2026/A/1 dice 2026/1, come la 2026/1 di Gesco. Riconoscerle
        per anno e numero le confondeva - ed e successo, con una prima versione di
        questo script. Sono di chi le ha create, e si lasciano fuori.
        """
        return frozenset(
            documento["scadenza"]
            for documento in self.destinazione.fatture.find({"serie": {"$exists": True}}, {"scadenza": 1})
            if documento.get("scadenza")
        )

    def scadenze(self):
        chiave = COLLEZIONI["scadenze"]["chiave"]
        da_gesco, in_uso = self.collega("scadenze", chiave, self.scadenze_del_gestionale())

        for valore, scadenza in da_gesco.items():
            if valore in in_uso:
                continue
            self.inserisci("scadenze", scadenza, [])
            self.conta("scadenze aggiunte")

    def legami_fattura_scadenza(self):
        """Ogni fattura venuta da Gesco punta alla scadenza che ha in Gesco.

        E a nessuna, se in Gesco non ne ha: con il numero sbagliato due fatture
        di pari importo finivano sulla stessa scadenza, e dare a una delle due la
        scadenza di un'altra e peggio che lasciarla senza.
        """
        da_gesco, in_uso = self.collega("fatture", COLLEZIONI["fatture"]["chiave"])

        for valore, fattura in da_gesco.items():
            gemella = in_uso.get(valore)
            if not gemella or gemella.get("serie"):
                continue

            attesa = self.corrispondenze.get(fattura["scadenza"]) if fattura.get("scadenza") else None
            if gemella.get("scadenza") == attesa:
                continue

            self.aggiorna("fatture", gemella["_id"], {"scadenza": attesa})
            if attesa is None:
                self.conta("fatture staccate da una scadenza non loro (in Gesco non ne hanno)")
            elif gemella.get("scadenza"):
                self.conta("fatture che puntavano alla scadenza di un'altra")
            else:
                self.conta("fatture ricollegate alla loro scadenza")

    def fatture_mancanti(self):
        chiave = COLLEZIONI["fatture"]["chiave"]
        da_gesco, in_uso = self.collega("fatture", chiave)

        righe_per_fattura = defaultdict(list)
        for riga in self.origine.servizi.find({}):
            righe_per_fattura[riga["fattura"]].append(riga)

        for valore, fattura in da_gesco.items():
            if valore in in_uso:
                continue

            vecchio_id = fattura["_id"]
            nuovo_id = self.inserisci("fatture", fattura, ["cliente", "scadenza"])
            self.conta("fatture aggiunte")

            for riga in righe_per_fattura.get(vecchio_id, []):
                riga = {**riga, "fattura": nuovo_id}
                self.inserisci("servizi", riga, ["lettura", "articolo"])
                self.conta("righe di fattura aggiunte")

    def anagrafiche_comuni(self):
        """Edifici, listini e articoli esistono da entrambe le parti: servono le
        corrispondenze prima di copiare cio che li richiama."""
        for nome in ("edifici", "listini", "articoli", "fasce"):
            self.collega(nome, COLLEZIONI[nome]["chiave"])

    def ripara_riferimenti(self):
        """Legami che puntano a documenti di un altro database.

        Succede a chi copia senza tradurre gli identificativi - e successo a una
        prima versione di questo script. Il riferimento si ritrova risalendo al
        documento nella copia di Gesco e cercando il suo gemello qui.
        """
        for collezione, campo, verso in RIFERIMENTI:
            appesi = self.destinazione[collezione].aggregate([
                {"$match": {campo: {"$ne": None}}},
                {"$lookup": {"from": verso, "localField": campo, "foreignField": "_id", "as": "_t"}},
                {"$match": {"_t": {"$size": 0}}},
                {"$project": {campo: 1}},
            ])

            for documento in appesi:
                corretto = self.corrispondenze.get(documento[campo])
                if corretto is None:
                    originale = self.origine[verso].find_one({"_id": documento[campo]})
                    if originale:
                        chiave = COLLEZIONI[verso]["chiave"](originale)
                        esclusi = self.scadenze_del_gestionale() if verso == "scadenze" else frozenset()
                        gemello = next(
                            (d for d in self.destinazione[verso].find({})
                             if d["_id"] not in esclusi and COLLEZIONI[verso]["chiave"](d) == chiave),
                            None,
                        )
                        corretto = gemello["_id"] if gemello else None

                self.aggiorna(collezione, documento["_id"], {campo: corretto})
                self.conta(f"riferimenti riparati in {collezione}.{campo}")

    def esegui(self):
        self.anagrafiche_comuni()
        self.clienti_e_contatori()
        self.letture()
        self.numeri_delle_fatture()
        self.scadenze()
        self.fatture_mancanti()
        self.legami_fattura_scadenza()
        self.ripara_riferimenti()
        return self.resoconto


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origine", required=True, help="database con la copia scaricata da Gesco")
    parser.add_argument("--destinazione", help="database da allineare (predefinito: acquedotto-zuel)")
    parser.add_argument("--remoto", action="store_true", help="allinea il database di produzione")
    parser.add_argument("--scrivi", action="store_true", help="applica invece di mostrare soltanto")
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
        print("== PRODUZIONE: si sta lavorando sul database remoto ==")
    else:
        client = locale
        destinazione = locale[argomenti.destinazione or "acquedotto-zuel"]

    print(f"Copia da Gesco: {origine.name} -> database: {destinazione.name}")
    print("== SOLA LETTURA (usa --scrivi per applicare) ==" if not argomenti.scrivi else "== APPLICO ==")

    try:
        resoconto = Allineamento(origine, destinazione, argomenti.scrivi).esegui()
        print()
        for voce, quanti in resoconto.items():
            print(f"  {voce}: {quanti}")
        if not resoconto:
            print("  niente da fare: i due database dicono la stessa cosa")
    finally:
        locale.close()
        if client is not locale:
            client.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
