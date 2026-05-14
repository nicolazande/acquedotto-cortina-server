import os
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv
from pymongo import MongoClient
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
from selenium import webdriver
from bs4 import BeautifulSoup
import requests
from bson import ObjectId
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(SERVER_ROOT / ".env")
DEFAULT_DB_NAME = "acquedotto-zuel"
FASTTOOLS_BASE_URL = os.getenv("FASTTOOLS_BASE_URL", "https://zuel.fast.tools").rstrip("/")
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
)

IMPORT_COLLECTIONS = [
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

IMPORT_STEPS = {
    "listini": "fetch_all_listini",
    "articoli": "fetch_all_articoli",
    "clienti": "fetch_all_clients",
    "edifici": "fetch_all_edifici",
    "scadenze": "fetch_all_scadenze",
    "fatture": "fetch_all_fatture",
}

DEFAULT_IMPORT_ORDER = ["listini", "articoli", "clienti", "edifici", "scadenze", "fatture"]

def env_flag(name: str, default: bool = False) -> bool:
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
    return [item.strip().lower() for item in value.split(",") if item.strip()]

def get_database_name(mongo_uri: str) -> str:
    env_db = os.getenv("MONGODB_DB")
    if env_db:
        return env_db

    parsed_uri = urlparse(mongo_uri)
    db_name = unquote(parsed_uri.path.lstrip("/"))
    return db_name or DEFAULT_DB_NAME

def get_mongo_options() -> dict:
    options = {
        "serverSelectionTimeoutMS": env_int("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 10000),
        "socketTimeoutMS": env_int("MONGODB_SOCKET_TIMEOUT_MS", 45000),
        "maxPoolSize": env_int("MONGODB_MAX_POOL_SIZE", 10),
    }
    if os.getenv("MONGODB_TLS", "").strip():
        options["tls"] = env_flag("MONGODB_TLS")
    if os.getenv("MONGODB_TLS_ALLOW_INVALID_CERTIFICATES", "").strip():
        options["tlsAllowInvalidCertificates"] = env_flag("MONGODB_TLS_ALLOW_INVALID_CERTIFICATES")
    if os.getenv("MONGODB_DIRECT_CONNECTION", "").strip():
        options["directConnection"] = env_flag("MONGODB_DIRECT_CONNECTION")
    return options

def get_database():
    mongo_uri = os.getenv("MONGODB_URI", f"mongodb://localhost:27017/{DEFAULT_DB_NAME}")
    mongo_db = get_database_name(mongo_uri)
    client = MongoClient(mongo_uri, **get_mongo_options())
    return client, client[mongo_db]

def reset_import_collections(db):
    print("Resetting import collections...")
    for collection in IMPORT_COLLECTIONS:
        db[collection].delete_many({})

def fasttools_url(path: str) -> str:
    return f"{FASTTOOLS_BASE_URL}/{path.lstrip('/')}"

def clean_text(value) -> str | None:
    if value is None:
        return None
    text = value.get_text(strip=True) if hasattr(value, "get_text") else str(value).strip()
    return text or None

def parse_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on", "checked", "si", "sì"}

def parse_number(value: str) -> float | int | None:
    """Converts a string to float or int if possible."""
    if not value:
        return None
    try:
        value = value.replace(",", ".")
        return int(value) if value.isdigit() else float(value)
    except ValueError:
        return None

def parse_form_groups(soup, section_labels: set[str] | None = None, keep_empty: bool = False) -> dict:
    details = {}
    current_section = None
    section_labels = section_labels or set()

    for group in soup.find_all('div', class_='form-group'):
        section_label = clean_text(group.find('label'))
        if section_label in section_labels:
            current_section = section_label
            continue

        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for index in range(0, len(columns) - 1, 2):
            label = clean_text(columns[index])
            value = clean_text(columns[index + 1])
            if not label or (not value and not keep_empty):
                continue

            if current_section:
                details.setdefault(current_section, {})[label] = value
            else:
                details[label] = value

    return details

def get_nested(details: dict, section: str, key: str):
    return details.get(section, {}).get(key)

def table_headers(table) -> list[str]:
    return [header.get_text(strip=True) for header in table.find_all('th')]

def row_to_dict(row, headers: list[str]) -> dict:
    columns = row.find_all('td')
    return {
        headers[index]: column.get_text(strip=True)
        for index, column in enumerate(columns)
        if index < len(headers)
    }

def table_dicts(table, row_class: str | None = None, skip_header: bool = True) -> list[dict]:
    if not table:
        return []

    headers = table_headers(table)
    rows = table.find_all('tr', class_=row_class) if row_class else table.find_all('tr')
    if skip_header and not row_class:
        rows = rows[1:]
    return [row_to_dict(row, headers) for row in rows]

def extract_id_from_onclick(onclick: str, path_prefix: str) -> str | None:
    marker = f"location.href='{path_prefix}"
    if marker not in onclick:
        return None
    return onclick.split(path_prefix, 1)[1].split("'", 1)[0]

def find_onclick_ids(html: str, path_prefix: str, row_selector: str = "tr") -> list[str]:
    soup = BeautifulSoup(html, 'html.parser')
    ids = []
    for row in soup.select(row_selector):
        detail_button = row.find('button', class_='btn btn-info')
        onclick = detail_button and detail_button.attrs.get('onclick')
        if not onclick:
            continue
        item_id = extract_id_from_onclick(onclick, path_prefix)
        if item_id:
            ids.append(item_id)
    return ids

def collect_paged_ids(session_cookie, label: str, url_for_page, parse_ids, max_pages: int | None = None) -> list[str]:
    item_ids = set()
    old_size = 0
    page = 1

    while max_pages is None or page <= max_pages:
        print(f"Fetching {label} list, page {page}...")
        html = fetch_html(session_cookie, url_for_page(page))
        page_ids = parse_ids(html)
        item_ids.update(page_ids)

        if not page_ids or len(item_ids) == old_size:
            print(f"No new {label} IDs found on page {page}. Stopping.")
            break

        old_size = len(item_ids)
        print(f"Page {page}: Found {len(page_ids)} IDs. Total unique IDs: {old_size}.")
        page += 1

    id_list = list(item_ids)
    print(f"Total unique {label} IDs collected: {len(id_list)}")
    return id_list

def run_threaded(items, worker, max_workers: int):
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(worker, item) for item in items]
        for future in futures:
            future.result()

def parse_date(value: str) -> datetime | None:
    """Parses a date string in the format '01/gen/1900' into a datetime object."""
    if not value:
        return None
    try:
        # Map Italian month abbreviations to month numbers
        months = {
            "gen": "01", "feb": "02", "mar": "03", "apr": "04", "mag": "05", "giu": "06",
            "lug": "07", "ago": "08", "set": "09", "ott": "10", "nov": "11", "dic": "12"
        }
        # Replace the Italian month abbreviation with the corresponding number
        for month, num in months.items():
            if month in value:
                value = value.replace(month, num)
                break
        return datetime.strptime(value, "%d/%m/%Y")
    except ValueError:
        return None

def get_session_cookie(email, password):
    options = webdriver.ChromeOptions()
    chrome_binary = os.getenv("CHROME_BINARY")
    if chrome_binary:
        options.binary_location = chrome_binary
    elif Path("/snap/bin/chromium").exists():
        options.binary_location = "/snap/bin/chromium"

    options.add_argument("--no-sandbox")
    options.add_argument("--disable-setuid-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--remote-debugging-port=9222")
    options.add_argument(f"--user-data-dir={tempfile.mkdtemp(prefix='zuel-chrome-')}")
    if env_flag("IMPORT_HEADLESS"):
        options.add_argument("--headless=new")

    try:
        driver = webdriver.Chrome(options=options)
    except Exception:
        driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)

    try:
        print("Opening login page...")
        login_url = fasttools_url("/Account/Login")
        driver.get(login_url)

        print("Filling in login credentials...")
        driver.find_element(By.NAME, "Email").send_keys(email)
        driver.find_element(By.NAME, "Password").send_keys(password)

        print("Please solve the CAPTCHA and submit the form. Press Enter here when done...")
        input("Press Enter to continue after login is complete.")

        print("Extracting session cookie...")
        cookies = driver.get_cookies()
        for cookie in cookies:
            if cookie['name'] == '.AspNet.ApplicationCookie':
                print("Session cookie found.")
                return cookie['value']

        print("Session cookie not found.")
        return None
    finally:
        driver.quit()

def fetch_html(session_cookie, url):
    print(f"Fetching URL: {url}")
    headers = {
        'Cookie': f'.AspNet.ApplicationCookie={session_cookie}',
        'User-Agent': DEFAULT_USER_AGENT,
    }
    response = requests.get(url, headers=headers, timeout=env_int("FASTTOOLS_TIMEOUT_SECONDS", 30))
    response.raise_for_status()
    return response.text

def parse_client_list(html):
    print("Parsing client list...")
    return find_onclick_ids(html, "/Customers/Details/", "div.form-group")

def parse_client_details(html):
    print("Parsing client details...")
    soup = BeautifulSoup(html, 'html.parser')
    details = parse_form_groups(
        soup,
        {"INDIRIZZO RESIDENZA", "INDIRIZZO FATTURAZIONE", "ALTRI DATI"},
    )

    mapped_details = {
        "ragione_sociale": details.get("Ragione sociale"),
        "cognome": details.get("Cognome"),
        "nome": details.get("Nome"),
        "sesso": details.get("Sesso"),
        "socio": parse_bool(details.get("Socio")),
        "quote": parse_number(details.get("Quote")),
        "con_commerciali": details.get("Con Commerciali"),
        "data_nascita": parse_date(details.get("Data di Nascita")),
        "comune_nascita": details.get("Comune Nascita"),
        "provincia_nascita": details.get("Prov Nascita"),
        "indirizzo_residenza": get_nested(details, "INDIRIZZO RESIDENZA", "Indirizzo"),
        "numero_residenza": get_nested(details, "INDIRIZZO RESIDENZA", "Numero"),
        "cap_residenza": get_nested(details, "INDIRIZZO RESIDENZA", "CAP"),
        "localita_residenza": get_nested(details, "INDIRIZZO RESIDENZA", "Località"),
        "provincia_residenza": get_nested(details, "INDIRIZZO RESIDENZA", "Provincia"),
        "nazione_residenza": get_nested(details, "INDIRIZZO RESIDENZA", "Nazione"),
        "destinazione_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "Destinazione"),
        "indirizzo_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "Indirizzo"),
        "numero_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "Numero"),
        "cap_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "CAP"),
        "localita_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "Località"),
        "provincia_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "Provincia"),
        "nazione_fatturazione": get_nested(details, "INDIRIZZO FATTURAZIONE", "Nazione"),
        "codice_fiscale": get_nested(details, "ALTRI DATI", "Codice Fiscale"),
        "partita_iva": get_nested(details, "ALTRI DATI", "PIVA"),
        "stampa_cortesia": get_nested(details, "ALTRI DATI", "Stampa cortesia"),
        "telefono": get_nested(details, "ALTRI DATI", "Telefono"),
        "cellulare": get_nested(details, "ALTRI DATI", "Cellulare"),
        "cellulare2": get_nested(details, "ALTRI DATI", "Cellulare2"),
        "email": get_nested(details, "ALTRI DATI", "email"),
        "pagamento": get_nested(details, "ALTRI DATI", "Pagamento"),
        "data_mandato_sdd": parse_date(get_nested(details, "ALTRI DATI", "Data Mandato SDD")),
        "email_pec": get_nested(details, "ALTRI DATI", "email PEC"),
        "codice_destinatario": get_nested(details, "ALTRI DATI", "Codice Destinatario"),
        "fattura_elettronica": parse_bool(get_nested(details, "ALTRI DATI", "Fattura Elettronica")),
        "codice_cliente_erp": get_nested(details, "ALTRI DATI", "Codice Cliente ERP"),
        "iban": get_nested(details, "ALTRI DATI", "IBAN"),
        "note": get_nested(details, "ALTRI DATI", "Note")
    }

    print(f"Mapped Client Details: {mapped_details}")
    return mapped_details

def parse_letture_from_counter(html, counter_mongo_id):
    print(f"Parsing Letture for Counter ID {counter_mongo_id}...")
    soup = BeautifulSoup(html, 'html.parser')
    letture = []

    letture_table = soup.find('table', class_='grid-table')
    for details in table_dicts(letture_table, row_class='grid-row', skip_header=False):
        letture.append({
            "id_lettura": details.get("ID"),
            "data_lettura": parse_date(details.get("Data Lettura")),
            "unita_misura": details.get("UM"),
            "consumo": parse_number(details.get("Consumo")),
            "fatturata": parse_bool(details.get("Fatturata")),
            "tipo": details.get("Tipo"),
            "note": details.get("Note"),
            "contatore": counter_mongo_id
        })

    return letture

def parse_counter_details(html):
    print("Parsing counter details (Consuntivo)...")
    soup = BeautifulSoup(html, 'html.parser')
    details = parse_form_groups(soup, keep_empty=True)

    mapped_details = {
        "tipo_contatore": details.get("Tipo Contatore"),
        "codice": details.get("Codice"),
        "nome_cliente": details.get("Cliente"),
        "seriale_interno": details.get("Seriale Interno"),
        "nome_edificio": details.get("Edificio"),
        "tipo_attivita": details.get("Tipo attività"),
        "seriale": details.get("Seriale"),
        "inattivo": parse_bool(details.get("Inattivo")),
        "consumo": parse_number(details.get("% Consumo")),
        "subentro": parse_bool(details.get("Subentro")),
        "sostituzione": parse_bool(details.get("Sostituzione")),
        "condominiale": parse_bool(details.get("Condominiale")),
        "inizio": parse_date(details.get("Dalla data")),
        "scadenza": parse_date(details.get("Alla data")),
        "causale": details.get("Causale No Dati Catasto"),
        "note": details.get("Note"),
        "foto": details.get("Foto Contatore"),
    }

    return mapped_details

def fetch_client_and_counters_with_letture(session_cookie, client_id, db):
    client_url = fasttools_url(f"/Customers/Details/{client_id}")
    client_html = fetch_html(session_cookie, client_url)
    client_details = parse_client_details(client_html)
    client_mongo_id = db.clienti.insert_one(client_details).inserted_id
    # Parse and fetch counters with details
    parse_and_fetch_counters_from_client(client_html, session_cookie, client_mongo_id, db)
    print(f"Inserted Client {client_id} and all associated Counters and Letture.")

def parse_edifici_list(html):
    print("Parsing Edifici list...")
    return find_onclick_ids(html, "/Buildings/Details/")

def parse_edificio_details(html, edificio_id, edificio_mongo_id, db):
    print(f"Parsing Edificio details for ID {edificio_id}...")
    soup = BeautifulSoup(html, 'html.parser')
    details = parse_form_groups(soup)

    mapped_details = {
        "descrizione": details.get("Descrizione"),
        "indirizzo": details.get("Indirizzo"),
        "numero": details.get("Numero"),
        "cap": details.get("CAP"),
        "localita": details.get("Località"),
        "provincia": details.get("Provincia"),
        "nazione": details.get("Nazione"),
        "attivita": details.get("Tipo attività"),
        "posti_letto": parse_number(details.get("Posti letto")),
        "latitudine": parse_number(details.get("Latitudine (X)")),
        "longitudine": parse_number(details.get("Longitudine (Y)")),
        "unita_abitative": parse_number(details.get("Unità Abitative")),
        "catasto": details.get("Catasto"),
        "foglio": details.get("Foglio"),
        "ped": details.get("PED"),
        "estensione": details.get("Estensione"),
        "tipo": details.get("Tipo"),
        "note": details.get("Note"),
    }

    # Parsing Contatori table and updating the MongoDB counters
    counters_table = soup.find('table', class_='table-hover')
    for counter_data in table_dicts(counters_table):
        seriale = counter_data.get("Seriale")
        if not seriale:
            continue
        existing_counter = db.contatori.find_one({"seriale": seriale})
        if existing_counter:
            db.contatori.update_one(
                {"_id": existing_counter["_id"]},
                {"$set": {"edificio": edificio_mongo_id}}
            )
            print(f"Linked Counter {existing_counter['_id']} to Edificio {edificio_mongo_id}.")

    return mapped_details

def fetch_and_store_edificio(session_cookie, edificio_id, db):
    print(f"Fetching details for Edificio ID {edificio_id}...")
    edificio_url = fasttools_url(f"/Buildings/Details/{edificio_id}")
    edificio_html = fetch_html(session_cookie, edificio_url)

    # Pre-generate ObjectId for the edificio
    edificio_mongo_id = ObjectId()
    edificio_details = parse_edificio_details(edificio_html, edificio_id, edificio_mongo_id, db)

    # Add the pre-generated ObjectId to the edificio document
    edificio = {"_id": edificio_mongo_id, **edificio_details}
    db.edifici.insert_one(edificio)
    print(f"Inserted Edificio {edificio_id} with ObjectId {edificio_mongo_id} into MongoDB.")

def parse_and_fetch_counters_from_client(html, session_cookie, client_mongo_id, db):
    print("Parsing and fetching counters for client...")
    soup = BeautifulSoup(html, 'html.parser')

    counters_table = soup.find('table', class_='table-hover')
    rows = counters_table.find_all('tr')[1:] if counters_table else []

    for row in rows:
        detail_button = row.find('button', class_='btn btn-info')
        onclick = detail_button and detail_button.attrs.get('onclick')
        counter_id = extract_id_from_onclick(onclick or "", "/Counters/Details/")
        if not counter_id:
            continue

        counter_url = fasttools_url(f"/Counters/Details/{counter_id}")
        counter_html = fetch_html(session_cookie, counter_url)
        counter_details = parse_counter_details(counter_html)

        existing_listino = db.listini.find_one({"categoria": counter_details["tipo_attivita"]})
        if existing_listino:
            counter_details["listino"] = existing_listino["_id"]
        counter_details["cliente"] = client_mongo_id

        counter_mongo_id = db.contatori.insert_one(counter_details).inserted_id
        letture = parse_letture_from_counter(counter_html, counter_mongo_id)
        if letture:
            db.letture.insert_many(letture)

        print(f"Inserted Counter {counter_id} with {len(letture)} Letture.")

def parse_listino_list(html):
    print("Parsing Listini list...")
    listino_ids = find_onclick_ids(html, "/Prices/Details/")
    print(f"Found {len(listino_ids)} Listini IDs.")
    return listino_ids

def parse_listino_details(html):
    print("Parsing Listino details...")
    soup = BeautifulSoup(html, 'html.parser')
    details = parse_form_groups(soup)

    mapped_details = {
        "categoria": details.get("Categoria"),
        "descrizione": details.get("Descrizione")
    }

    return mapped_details

def parse_fasce(html: str, listino_mongo_id: str):
    print("Parsing Fasce...")
    soup = BeautifulSoup(html, 'html.parser')
    fasce = []

    table = soup.find('table', class_='table-hover')
    for details in table_dicts(table):
        fasce.append({
            "tipo": details.get("Tipo"),
            "min": parse_number(details.get("Qta da")),
            "max": parse_number(details.get("Qta a")),
            "prezzo": parse_number(details.get("Prezzo")),
            "inizio": parse_date(details.get("Validità da")),
            "scadenza": parse_date(details.get("Validità a")),
            "listino": listino_mongo_id
        })

    print(f"Found {len(fasce)} Fasce.")
    return fasce


def fetch_listino_and_fasce(session_cookie, listino_id, db):
    listino_url = fasttools_url(f"/Prices/Details/{listino_id}")
    listino_html = fetch_html(session_cookie, listino_url)
    listino_details = parse_listino_details(listino_html)

    # Store Listino
    listino_mongo_id = db.listini.insert_one(listino_details).inserted_id

    # Parse and store Fasce
    fasce = parse_fasce(listino_html, listino_mongo_id)
    if fasce:
        db.fasce.insert_many(fasce)

    print(f"Inserted Listino {listino_id} with {len(fasce)} Fasce.")

def fetch_all_listini(session_cookie, db):
    listino_id_list = collect_paged_ids(
        session_cookie,
        "Listini",
        lambda page: fasttools_url(f"/Prices?page={page}"),
        parse_listino_list,
    )
    run_threaded(
        listino_id_list,
        lambda listino_id: fetch_listino_and_fasce(session_cookie, listino_id, db),
        env_int("IMPORT_LISTINI_WORKERS", 10),
    )

    print("All Listini and Fasce have been processed.")
    return listino_id_list

def fetch_all_clients(session_cookie, db):
    """
    Fetch all client IDs and process them to store client details, counters, and letture.
    """
    client_id_list = collect_paged_ids(
        session_cookie,
        "Client",
        lambda page: fasttools_url(f"/Customers?page={page}"),
        parse_client_list,
    )
    run_threaded(
        client_id_list,
        lambda client_id: fetch_client_and_counters_with_letture(session_cookie, client_id, db),
        env_int("IMPORT_CLIENTI_WORKERS", 50),
    )

    print("All clients, counters, and letture have been processed and imported into MongoDB.")
    return client_id_list

def fetch_all_edifici(session_cookie, db):
    """
    Fetch all Edifici IDs and process them to store Edifici details in the database.
    """
    edifici_id_list = collect_paged_ids(
        session_cookie,
        "Edifici",
        lambda page: fasttools_url(f"/Buildings?page={page}"),
        parse_edifici_list,
    )
    run_threaded(
        edifici_id_list,
        lambda edificio_id: fetch_and_store_edificio(session_cookie, edificio_id, db),
        env_int("IMPORT_EDIFICI_WORKERS", 50),
    )

    print("All Edifici have been processed and imported into MongoDB.")
    return edifici_id_list

def parse_articoli(html):
    print("Parsing Articoli...")
    soup = BeautifulSoup(html, 'html.parser')
    articoli = []

    # Locate the table inside the panel
    panel = soup.find('div', class_='panel-primary')
    if not panel:
        print("No panel-primary found.")
        return articoli

    table = panel.find('table')
    if not table:
        print("No Articoli table found.")
        return articoli

    for details in table_dicts(table):
        articoli.append({
            "codice": details.get("Codice"),
            "descrizione": details.get("Descrizione"),
            "iva": details.get("IVA"),
        })

    print(f"Found {len(articoli)} Articoli.")
    return articoli

def fetch_all_articoli(session_cookie, db):
    """
    Fetch all Articoli from the server and store new entries in the database.
    """
    articoli_ids = set()  # Use a set to store unique IDs
    all_articoli = []  # Collect all articoli from all pages
    old_size = 0
    page = 1

    while True:
        print(f"Fetching articoli list, page {page}...")
        articoli_list_url = fasttools_url(f"/Products?page={page}")
        articoli_list_html = fetch_html(session_cookie, articoli_list_url)
        page_articoli = parse_articoli(articoli_list_html)

        if not page_articoli:
            print(f"No Articoli found on page {page}. Stopping.")
            break

        # Collect articoli and unique IDs
        page_articoli_ids = {articolo["codice"] for articolo in page_articoli if "codice" in articolo}
        articoli_ids.update(page_articoli_ids)
        all_articoli.extend(page_articoli)

        # Check if the size of the set has not changed
        if len(articoli_ids) == old_size:
            print(f"No new Articoli found on page {page}. Stopping.")
            break

        old_size = len(articoli_ids)
        print(f"Page {page}: Found {len(page_articoli_ids)} IDs. Total unique IDs: {old_size}.")
        page += 1

    print(f"Total unique Articoli IDs collected: {len(articoli_ids)}")

    # Process and store articoli in the database
    stored_count = 0
    for articolo in all_articoli:
        if not db.articoli.find_one({"codice": articolo["codice"]}):
            db.articoli.insert_one(articolo)
            stored_count += 1

    print(f"Stored {stored_count}/{len(articoli_ids)} new Articoli.")
    return list(articoli_ids)


# Fatture Parsing Functions
def parse_fattura_list(html):
    print("Parsing fattura list...")
    soup = BeautifulSoup(html, 'html.parser')
    fattura_ids = []

    rows = soup.find_all('tr', class_='grid-row')
    for row in rows:
        link = row.find('a', class_='btn btn-info')
        if link and 'href' in link.attrs:
            fattura_id = link['href'].split('/DataheaderInvoices/Details/')[-1]
            if fattura_id != link['href']:
                fattura_ids.append(fattura_id)

    return fattura_ids

def parse_servizio_details(html):

    def extract_metri_cubi(value):
        if value:
            parts = value.split("di", 1)
            if parts and len(parts) > 1:
                return parts[0].strip()
        return None

    print("Parsing servizio details...")
    soup = BeautifulSoup(html, 'html.parser')
    details = parse_form_groups(soup)

    mapped_details = {
        "riga": parse_number(details.get("Riga")),
        "nome_articolo": details.get("Articolo"),
        "descrizione": details.get("Descrizione"),
        "tipo_tariffa": details.get("Tipo tariffa"),
        "tipo_attivita": details.get("Tipo attività"),
        "metri_cubi": parse_number(extract_metri_cubi(details.get("m³"))),
        "prezzo": parse_number(details.get("Prezzo")),
        "valore_unitario": parse_number(details.get("Valore Unitario")),
        "tipo_quota": details.get("Tipo Quota"),
        "seriale_condominio": details.get("Seriale Condominio"),
        "lettura_precedente": details.get("Lettura Precedente"),
        "lettura_fatturazione": details.get("Lettura di fatturarazione"),
        "data_lettura": parse_date(details.get("Data Lettura")),
        "descrizione_attivita": details.get("Descr Attività"),
        "id_lettura": details.get("ID lettura"),
    }

    return mapped_details

def parse_fattura_details(html):
    print("Parsing fattura details...")
    soup = BeautifulSoup(html, 'html.parser')
    details = parse_form_groups(soup)

    # Special handling for the "Confermata" checkbox
    checkbox = soup.find('input', id='IsflgConfirmed', type='checkbox')
    is_confermata = checkbox.has_attr('checked') if checkbox else False
    details['Confermata'] = is_confermata

    mapped_details = {
        "tipo_documento": details.get("Tipo Documento"),
        "ragione_sociale": details.get("Ragione Sociale"),
        "confermata": parse_bool(details.get("Confermata")),
        "anno": parse_number(details.get("Anno")),
        "numero": parse_number(details.get("Numero")),
        "data_fattura": parse_date(details.get("Data Fattura")),
        "codice": details.get("Codice"),
        "cognome": details.get("Cognome"),
        "nome": details.get("Nome"),
        "destinazione": details.get("Destinazione"),
        "imponibile": parse_number(details.get("Imponibile")),
        "iva": parse_number(details.get("Iva")),
        "sconto_imponibile": parse_number(details.get("Sconto Imponibile")),
        "totale_fattura": parse_number(details.get("TOTALE FATTURA")),
        "data_fattura_elettronica": parse_date(details.get("Data Fattura Elettronica")),
        "data_invio_fattura": parse_date(details.get("Data Invio Fattura")),
        "tipo_pagamento": details.get("Tipo Pagamento"),
    }

    return mapped_details

def parse_servizi(html, fattura_mongo_id, session_cookie, db):
    print(f"Parsing servizi for Fattura ID {fattura_mongo_id}...")
    soup = BeautifulSoup(html, 'html.parser')
    servizi = []

    tab_righe = soup.find('div', id='tabRighe')
    table = tab_righe.find('table', class_='table-hover') if tab_righe else None
    rows = table.find_all('tr')[1:] if table else []

    for row in rows:
        detail_button = row.find('button', class_='btn btn-info')
        onclick = detail_button and detail_button.attrs.get('onclick')
        servizio_id = extract_id_from_onclick(onclick or "", "/DataRowsInvoices/Details/")
        if not servizio_id:
            continue

        servizio_url = fasttools_url(f"/DataRowsInvoices/Details/{servizio_id}")
        servizio_html = fetch_html(session_cookie, servizio_url)
        servizio_details = parse_servizio_details(servizio_html)

        id_lettura = servizio_details.pop("id_lettura", None)
        lettura = db.letture.find_one({"id_lettura": id_lettura}) if id_lettura else None
        servizio_details["lettura"] = lettura["_id"] if lettura else None

        nome_articolo = servizio_details.pop("nome_articolo", None)
        articolo = db.articoli.find_one({"codice": nome_articolo}) if nome_articolo else None
        servizio_details["articolo"] = articolo["_id"] if articolo else None

        servizio_details["fattura"] = fattura_mongo_id
        servizi.append(servizio_details)

    return servizi

def fetch_fattura_and_servizi(session_cookie, fattura_id, db):
    fattura_url = fasttools_url(f"/DataHeaderInvoices/Details/{fattura_id}")
    fattura_html = fetch_html(session_cookie, fattura_url)
    fattura_details = parse_fattura_details(fattura_html)
    # cliente
    nome = fattura_details.get("nome", "")
    cognome = fattura_details.get("cognome", "")
    client = db.clienti.find_one({"nome": nome, "cognome": cognome})
    # scadenza
    scadenza = db.scadenze.find_one({
        "anno": fattura_details.get("anno"),
        "totale": fattura_details.get("totale_fattura"),
        "nome": nome,
        "cognome": cognome
    })

    if scadenza:
        print("(nome = %s, cognome = %s) (scdenza nome = %s, scadenza cognome = %s)" % (nome, cognome, scadenza["nome"], scadenza["cognome"]))
    if client:
        fattura_details["cliente"] = client["_id"]
    else:
        fattura_details["cliente"] = None
    del fattura_details["cognome"]
    del fattura_details["nome"]

    if scadenza:
        fattura_details["scadenza"] = scadenza["_id"]
    else:
        fattura_details["scadenza"] = None
    # update database
    fattura_mongo_id = db.fatture.insert_one(fattura_details).inserted_id
    # servizi
    servizi = parse_servizi(fattura_html, fattura_mongo_id, session_cookie, db)
    if servizi:
        db.servizi.insert_many(servizi)
    print(f"Inserted Fattura {fattura_id} and {len(servizi)} Servizi.")

def fetch_all_fatture(session_cookie, db):
    fattura_id_list = collect_paged_ids(
        session_cookie,
        "fattura",
        lambda page: fasttools_url(f"/DataHeaderInvoices?grid-page={page}"),
        parse_fattura_list,
    )
    run_threaded(
        fattura_id_list,
        lambda fattura_id: fetch_fattura_and_servizi(session_cookie, fattura_id, db),
        env_int("IMPORT_FATTURE_WORKERS", 40),
    )

    print("All fatture and servizi have been processed.")
    return fattura_id_list

def parse_scadenze_table(html):
    """
    Parses the Scadenze table grid directly from the HTML.
    """
    print("Parsing Scadenze table grid...")
    soup = BeautifulSoup(html, 'html.parser')
    scadenze = []

    # Find the table containing the Scadenze data
    table = soup.find('table', class_='grid-table')
    if not table:
        print("No Scadenze table found.")
        return scadenze

    for scadenza_details in table_dicts(table, row_class='grid-row', skip_header=False):
        scadenze.append({
            "scadenza": parse_date(scadenza_details.get("Scadenza")),
            "saldo": parse_number(scadenza_details.get("Saldo")),
            "pagamento": parse_date(scadenza_details.get("Pagamento")),
            "ritardo": parse_number(scadenza_details.get("Ritardo")),
            "anno": parse_number(scadenza_details.get("Anno")),
            "numero": parse_number(scadenza_details.get("N.")),
            "cognome": scadenza_details.get("Cognome"),
            "nome": scadenza_details.get("Nome"),
            "totale": parse_number(scadenza_details.get("Totale")),
            "solleciti": parse_number(scadenza_details.get("Solleciti")),
        })

    print(f"Parsed {len(scadenze)} Scadenze entries.")
    return scadenze

def fetch_all_scadenze(session_cookie, db):
    """
    Fetches and parses all Scadenze data from the grid across all pages.
    """
    old_size = 0
    page = 1
    all_scadenze = []

    while page < env_int("IMPORT_SCADENZE_MAX_PAGES", 28):
        print(f"Fetching Scadenze list, page {page}...")
        scadenze_url = fasttools_url(f"/DataHeaderInvoices/Scadenze?grid-page={page}")
        html = fetch_html(session_cookie, scadenze_url)

        # Parse the Scadenze table on the current page
        page_scadenze = parse_scadenze_table(html)

        # Update Scadenze and old size
        all_scadenze.extend(page_scadenze)

        # Stop if no new Scadenze found
        if not page_scadenze or len(all_scadenze) == old_size:
            print(f"No new Scadenze found on page {page}. Stopping.")
            break

        old_size = len(all_scadenze)
        print(f"Page {page}: Found {len(page_scadenze)} Scadenze. Total so far: {old_size}.")
        page += 1

    # Insert Scadenze into the database
    inserted_count = len(all_scadenze)
    if all_scadenze:
        db.scadenze.insert_many(all_scadenze)

    print(f"Stored {inserted_count}/{len(all_scadenze)} new Scadenze.")
    return all_scadenze

def get_import_steps() -> list[str]:
    requested_steps = env_list("IMPORT_STEPS", DEFAULT_IMPORT_ORDER)
    unknown_steps = [step for step in requested_steps if step not in IMPORT_STEPS]
    if unknown_steps:
        valid_steps = ", ".join(IMPORT_STEPS)
        raise RuntimeError(f"Unknown IMPORT_STEPS values: {', '.join(unknown_steps)}. Valid values: {valid_steps}.")
    return requested_steps

def run_import(session_cookie, db):
    steps = get_import_steps()
    print(f"Import steps: {', '.join(steps)}")
    for step in steps:
        globals()[IMPORT_STEPS[step]](session_cookie, db)

if __name__ == "__main__":
    email = os.getenv("FASTTOOLS_EMAIL")
    password = os.getenv("FASTTOOLS_PASSWORD")
    session_cookie = os.getenv("FASTTOOLS_SESSION_COOKIE")
    mongo_client, db = get_database()

    try:
        print(f"Import target database: {db.name}")
        if env_flag("IMPORT_RESET_DB"):
            reset_import_collections(db)

        if not session_cookie:
            if not email or not password:
                raise RuntimeError(
                    "Set FASTTOOLS_SESSION_COOKIE or FASTTOOLS_EMAIL and FASTTOOLS_PASSWORD in .env."
                )
            session_cookie = get_session_cookie(email, password)

        if session_cookie:
            print("Session cookie retrieved successfully!")
            run_import(session_cookie, db)
        else:
            print("Failed to retrieve session cookie.")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        mongo_client.close()
