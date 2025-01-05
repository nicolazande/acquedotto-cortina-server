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

def parse_number(value: str) -> float | int | None:
    """Converts a string to float or int if possible."""
    if not value:
        return None
    try:
        value = value.replace(",", ".")
        return int(value) if value.isdigit() else float(value)
    except ValueError:
        return None

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
    driver = webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()))
    try:
        print("Opening login page...")
        login_url = "https://zuel.fast.tools/Account/Login"
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
                print(f"Session cookie found: {cookie['value']}")
                return cookie['value']

        print("Session cookie not found.")
        return None
    finally:
        driver.quit()

def fetch_html(session_cookie, url):
    print(f"Fetching URL: {url}")
    headers = {
        'Cookie': f'.AspNet.ApplicationCookie={session_cookie}',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    }
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.text

def parse_client_list(html):
    print("Parsing client list...")
    soup = BeautifulSoup(html, 'html.parser')
    client_ids = []

    rows = soup.find_all('div', class_='form-group')
    for row in rows:
        detail_button = row.find('button', class_='btn btn-info')
        if detail_button and 'onclick' in detail_button.attrs:
            onclick_value = detail_button['onclick']
            if "location.href='/Customers/Details/" in onclick_value:
                client_id = onclick_value.split("/Customers/Details/")[1].split("'")[0]
                client_ids.append(client_id)

    return client_ids

def parse_client_details(html):
    print("Parsing client details...")
    soup = BeautifulSoup(html, 'html.parser')
    details = {}

    # Track current section to associate fields correctly
    current_section = None

    # Locate all form-group elements
    form_groups = soup.find_all('div', class_='form-group')

    for group in form_groups:
        # Check for section headers (e.g., "INDIRIZZO RESIDENZA")
        section_label = group.find('label')
        if section_label and section_label.text.strip() in ["INDIRIZZO RESIDENZA", "INDIRIZZO FATTURAZIONE", "ALTRI DATI"]:
            current_section = section_label.text.strip()
            continue  # Skip further processing for section headers

        # Find all columns in the form-group
        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for i in range(0, len(columns) - 1, 2):  # Process labels and values in pairs
            label = columns[i].text.strip()  # Extract label text
            value = columns[i + 1].text.strip() if i + 1 < len(columns) else ""

            # Skip empty labels or values
            if not label or not value:
                continue

            # Store fields under their respective sections
            if current_section == "INDIRIZZO RESIDENZA":
                details.setdefault("indirizzo_residenza", {})[label] = value
            elif current_section == "INDIRIZZO FATTURAZIONE":
                details.setdefault("indirizzo_fatturazione", {})[label] = value
            elif current_section == "ALTRI DATI":
                details.setdefault("altri_dati", {})[label] = value
            else:
                details[label] = value  # Default section for other fields

    mapped_details = {
        "ragione_sociale": details.get("Ragione sociale"),
        "cognome": details.get("Cognome"),
        "nome": details.get("Nome"),
        "sesso": details.get("Sesso"),
        "socio": True if details.get("Socio") == "true" else False,
        "quote": parse_number(details.get("Quote")),
        "con_commerciali": details.get("Con Commerciali"),
        "data_nascita": parse_date(details.get("Data di Nascita")),
        "comune_nascita": details.get("Comune Nascita"),
        "provincia_nascita": details.get("Prov Nascita"),
        "indirizzo_residenza": details.get("indirizzo_residenza", {}).get("Indirizzo"),
        "numero_residenza": details.get("indirizzo_residenza", {}).get("Numero"),
        "cap_residenza": details.get("indirizzo_residenza", {}).get("CAP"),
        "localita_residenza": details.get("indirizzo_residenza", {}).get("Località"),
        "provincia_residenza": details.get("indirizzo_residenza", {}).get("Provincia"),
        "nazione_residenza": details.get("indirizzo_residenza", {}).get("Nazione"),
        "destinazione_fatturazione": details.get("indirizzo_fatturazione", {}).get("Destinazione"),
        "indirizzo_fatturazione": details.get("indirizzo_fatturazione", {}).get("Indirizzo"),
        "numero_fatturazione": details.get("indirizzo_fatturazione", {}).get("Numero"),
        "cap_fatturazione": details.get("indirizzo_fatturazione", {}).get("CAP"),
        "localita_fatturazione": details.get("indirizzo_fatturazione", {}).get("Località"),
        "provincia_fatturazione": details.get("indirizzo_fatturazione", {}).get("Provincia"),
        "nazione_fatturazione": details.get("indirizzo_fatturazione", {}).get("Nazione"),
        "codice_fiscale": details.get("altri_dati", {}).get("Codice Fiscale"),
        "partita_iva": details.get("altri_dati", {}).get("PIVA"),
        "stampa_cortesia": details.get("altri_dati", {}).get("Stampa cortesia"),
        "telefono": details.get("altri_dati", {}).get("Telefono"),
        "cellulare": details.get("altri_dati", {}).get("Cellulare"),
        "cellulare2": details.get("altri_dati", {}).get("Cellulare2"),
        "email": details.get("altri_dati", {}).get("email"),
        "pagamento": details.get("altri_dati", {}).get("Pagamento"),
        "data_mandato_sdd": parse_date(details.get("altri_dati", {}).get("Data Mandato SDD")),
        "email_pec": details.get("altri_dati", {}).get("email PEC"),
        "codice_destinatario": details.get("altri_dati", {}).get("Codice Destinatario"),
        "fattura_elettronica": True if details.get("altri_dati", {}).get("Fattura Elettronica") == "true" else False,
        "codice_cliente_erp": details.get("altri_dati", {}).get("Codice Cliente ERP"),
        "iban": details.get("altri_dati", {}).get("IBAN"),
        "note": details.get("altri_dati", {}).get("Note")
    }

    print(f"Mapped Client Details: {mapped_details}")
    return mapped_details

def parse_letture_from_counter(html, counter_mongo_id):
    print(f"Parsing Letture for Counter ID {counter_mongo_id}...")
    soup = BeautifulSoup(html, 'html.parser')
    letture = []

    letture_table = soup.find('table', class_='grid-table')
    if letture_table:
        headers = [th.text.strip() for th in letture_table.find_all('th')]
        rows = letture_table.find_all('tr', class_='grid-row')
        for row in rows:
            cols = row.find_all('td')
            # Reference to the counter
            details = {}
            for i, col in enumerate(cols):
                if i < len(headers):
                    details[headers[i]] = col.text.strip()

            mapped_details = {
                "id_lettura": details.get("ID"),
                "data_lettura": parse_date(details.get("Data Lettura")),
                "unita_misura": details.get("UM"),
                "consumo": parse_number(details.get("Consumo")),
                "fatturata": True if details.get("Fatturata", "").lower() == "true" else False,
                "tipo": details.get("Tipo"),
                "note": details.get("Note"),
                "contatore": counter_mongo_id
            }

            letture.append(mapped_details)

    return letture

def parse_counter_details(html):
    print("Parsing counter details (Consuntivo)...")
    soup = BeautifulSoup(html, 'html.parser')
    details = {}

    # Locate all form-group elements
    form_groups = soup.find_all('div', class_='form-group')

    for group in form_groups:
        # Find all columns in the form-group
        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for i in range(0, len(columns) - 1, 2):  # Process labels and values in pairs
            label = columns[i].text.strip()  # Label in the first column
            value = columns[i + 1].text.strip() if i + 1 < len(columns) else None  # Value in the next column
            if label:
                details[label] = value or None  # Assign None if value is empty

    mapped_details = {
        "tipo_contatore": details.get("Tipo Contatore"),
        "codice": details.get("Codice"),
        "nome_cliente": details.get("Cliente"),
        "seriale_interno": details.get("Seriale Interno"),
        "nome_edificio": details.get("Edificio"),
        "tipo_attivita": details.get("Tipo attività"),
        "seriale": details.get("Seriale"),
        "inattivo": True if parse_number(details.get("Inattivo")) == "true" else False,
        "consumo": parse_number(details.get("% Consumo")),
        "subentro": True if details.get("Subentro") == "true" else False,
        "sostituzione": True if details.get("Sostituzione") == "true" else False,
        "condominiale": True if details.get("Condominiale") == "true" else False,
        "inizio": parse_date(details.get("Dalla data")),
        "scadenza": parse_date(details.get("Alla data")),
        "causale": details.get("Causale No Dati Catasto"),
        "note": details.get("Note"),
        "foto": details.get("Foto Contatore"),
    }

    return mapped_details

def fetch_client_and_counters_with_letture(session_cookie, client_id, db):
    client_url = f"https://zuel.fast.tools/Customers/Details/{client_id}"
    client_html = fetch_html(session_cookie, client_url)
    client_details = parse_client_details(client_html)
    client_mongo_id = db.clienti.insert_one(client_details).inserted_id
    # Parse and fetch counters with details
    parse_and_fetch_counters_from_client(client_html, session_cookie, client_mongo_id, db)
    print(f"Inserted Client {client_id} and all associated Counters and Letture.")

def parse_edifici_list(html):
    print("Parsing Edifici list...")
    soup = BeautifulSoup(html, 'html.parser')
    edifici_ids = []

    rows = soup.find_all('tr')
    for row in rows:
        detail_button = row.find('button', class_='btn btn-info')
        if detail_button and 'onclick' in detail_button.attrs:
            onclick_value = detail_button['onclick']
            if "location.href='/Buildings/Details/" in onclick_value:
                edificio_id = onclick_value.split("/Buildings/Details/")[1].split("'")[0]
                edifici_ids.append(edificio_id)

    return edifici_ids

def parse_edificio_details(html, edificio_id, edificio_mongo_id, db):
    print(f"Parsing Edificio details for ID {edificio_id}...")
    soup = BeautifulSoup(html, 'html.parser')
    details = {}

    # Locate all form-group elements for Edificio details
    form_groups = soup.find_all('div', class_='form-group')
    for group in form_groups:
        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for i in range(0, len(columns) - 1, 2):
            label = columns[i].text.strip()
            value = columns[i + 1].text.strip() if i + 1 < len(columns) else None
            if label:
                details[label] = value

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
    if counters_table:
        headers = [th.text.strip() for th in counters_table.find_all('th')]
        rows = counters_table.find_all('tr')[1:]  # Skip header row
        for row in rows:
            cols = row.find_all('td')
            counter_data = {headers[i]: cols[i].text.strip() for i in range(len(headers))}

            # Match Contatori in the database by Seriale
            seriale = counter_data.get("Seriale")
            if seriale:
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
    edificio_url = f"https://zuel.fast.tools/Buildings/Details/{edificio_id}"
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
    counters = []

    counters_table = soup.find('table', class_='table-hover')
    if counters_table:
        headers = [th.text.strip() for th in counters_table.find_all('th')]
        rows = counters_table.find_all('tr')[1:]  # Skip the header row

        for row in rows:
            cols = row.find_all('td')

            consuntivo_button = row.find('button', class_='btn btn-info')
            if consuntivo_button and 'onclick' in consuntivo_button.attrs:
                onclick_value = consuntivo_button['onclick']
                if "location.href='/Counters/Details/" in onclick_value:
                    counter_id = onclick_value.split("/Counters/Details/")[1].split("'")[0]
                    counter_url = f"https://zuel.fast.tools/Counters/Details/{counter_id}"

                    # Fetch and parse counter details
                    counter_html = fetch_html(session_cookie, counter_url)
                    counter_details = parse_counter_details(counter_html)

                    existing_listino = db.listini.find_one({"categoria": counter_details["tipo_attivita"]})
                    if existing_listino:
                        counter_details["listino"] = existing_listino["_id"]
                    counter_details["cliente"] = client_mongo_id  # Reference to the client
                    
                    # Insert into the database
                    counter_mongo_id = db.contatori.insert_one(counter_details).inserted_id

                    # Parse and insert Letture
                    letture = parse_letture_from_counter(counter_html, counter_mongo_id)
                    if letture:
                        db.letture.insert_many(letture)

                    print(f"Inserted Counter {counter_id} with {len(letture)} Letture.")
    return counters

def parse_listino_list(html):
    print("Parsing Listini list...")
    soup = BeautifulSoup(html, 'html.parser')
    listino_ids = []

    rows = soup.find_all('tr')
    for row in rows:
        detail_button = row.find('button', class_='btn btn-info')
        if detail_button and 'onclick' in detail_button.attrs:
            onclick_value = detail_button['onclick']
            if "location.href='/Prices/Details/" in onclick_value:
                listino_id = onclick_value.split("/Prices/Details/")[1].split("'")[0]
                listino_ids.append(listino_id)

    print(f"Found {len(listino_ids)} Listini IDs.")
    return listino_ids

def parse_listino_details(html):
    print("Parsing Listino details...")
    soup = BeautifulSoup(html, 'html.parser')
    details = {}

    form_groups = soup.find_all('div', class_='form-group')
    for group in form_groups:
        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for i in range(0, len(columns) - 1, 2):
            label = columns[i].text.strip()
            value = columns[i + 1].text.strip() if i + 1 < len(columns) else ""
            if label and value:
                details[label] = value

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
    if table:
        headers = [th.text.strip() for th in table.find_all('th')]
        rows = table.find_all('tr')[1:]  # Skip the header row
        for row in rows:
            cols = row.find_all('td')
            details = {}
            for i, col in enumerate(cols):
                if i < len(headers):
                    details[headers[i]] = col.text.strip()

            mapped_details = {
                "tipo": details.get("Tipo"),
                "min": parse_number(details.get("Qta da")),
                "max": parse_number(details.get("Qta a")),
                "prezzo": parse_number(details.get("Prezzo")),
                "inizio": parse_date(details.get("Validità da")),
                "scadenza": parse_date(details.get("Validità a")),
                "listino": listino_mongo_id
            }
            fasce.append(mapped_details)

    print(f"Found {len(fasce)} Fasce.")
    return fasce


def fetch_listino_and_fasce(session_cookie, listino_id, db):
    listino_url = f"https://zuel.fast.tools/Prices/Details/{listino_id}"
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
    listino_ids = set()  # Use a set to store unique IDs
    old_size = 0
    page = 1

    while True:
        print(f"Fetching listini list, page {page}...")
        listino_list_url = f"https://zuel.fast.tools/Prices?page={page}"
        listino_list_html = fetch_html(session_cookie, listino_list_url)
        page_listino_ids = parse_listino_list(listino_list_html)

        # Update the set of IDs with the current page's results
        listino_ids.update(page_listino_ids)

        # Check if the size of the set has not changed (i.e., no new IDs added)
        if not page_listino_ids or len(listino_ids) == old_size:
            print(f"No new Listini IDs found on page {page}. Stopping.")
            break

        # Update the old_size to the current size
        old_size = len(listino_ids)
        print(f"Page {page}: Found {len(page_listino_ids)} IDs. Total unique IDs: {old_size}.")
        page += 1

    # Convert the set to a list before returning
    listino_id_list = list(listino_ids)
    print(f"Total unique Listini IDs collected: {len(listino_id_list)}")

    # Process all collected IDs using a thread pool
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(fetch_listino_and_fasce, session_cookie, listino_id, db)
            for listino_id in listino_id_list
        ]
        for future in futures:
            future.result()

    print("All Listini and Fasce have been processed.")
    return listino_id_list

def fetch_all_clients(session_cookie, db):
    """
    Fetch all client IDs and process them to store client details, counters, and letture.
    """
    client_ids = set()  # Use a set to store unique IDs
    old_size = 0
    page = 1

    while True:
        print(f"Fetching clients list, page {page}...")
        client_list_url = f"https://zuel.fast.tools/Customers?page={page}"
        client_list_html = fetch_html(session_cookie, client_list_url)
        page_client_ids = parse_client_list(client_list_html)

        # Update the set of IDs with the current page's results
        client_ids.update(page_client_ids)

        # Check if the size of the set has not changed (i.e., no new IDs added)
        if not page_client_ids or len(client_ids) == old_size:
            print(f"No new Client IDs found on page {page}. Stopping.")
            break

        # Update the old_size to the current size
        old_size = len(client_ids)
        print(f"Page {page}: Found {len(page_client_ids)} IDs. Total unique IDs: {old_size}.")
        page += 1

    # Convert the set to a list before processing
    client_id_list = list(client_ids)
    print(f"Total unique Client IDs collected: {len(client_id_list)}")

    # Process all collected IDs using a thread pool
    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = [
            executor.submit(fetch_client_and_counters_with_letture, session_cookie, client_id, db)
            for client_id in client_id_list
        ]
        for future in futures:
            future.result()

    print("All clients, counters, and letture have been processed and imported into MongoDB.")
    return client_id_list

def fetch_all_edifici(session_cookie, db):
    """
    Fetch all Edifici IDs and process them to store Edifici details in the database.
    """
    edifici_ids = set()  # Use a set to store unique IDs
    old_size = 0
    page = 1

    while True:
        print(f"Fetching Edifici list, page {page}...")
        edifici_list_url = f"https://zuel.fast.tools/Buildings?page={page}"
        edifici_list_html = fetch_html(session_cookie, edifici_list_url)
        page_edifici_ids = parse_edifici_list(edifici_list_html)

        # Update the set of IDs with the current page's results
        edifici_ids.update(page_edifici_ids)

        # Check if the size of the set has not changed (i.e., no new IDs added)
        if not page_edifici_ids or len(edifici_ids) == old_size:
            print(f"No new Edifici IDs found on page {page}. Stopping.")
            break

        # Update the old_size to the current size
        old_size = len(edifici_ids)
        print(f"Page {page}: Found {len(page_edifici_ids)} IDs. Total unique IDs: {old_size}.")
        page += 1

    # Convert the set to a list before processing
    edifici_id_list = list(edifici_ids)
    print(f"Total unique Edifici IDs collected: {len(edifici_id_list)}")

    # Process all collected IDs using a thread pool
    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = [
            executor.submit(fetch_and_store_edificio, session_cookie, edificio_id, db)
            for edificio_id in edifici_id_list
        ]
        for future in futures:
            future.result()

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

    # Extract table headers
    headers = [th.text.strip() for th in table.find_all('th')]
    rows = table.find_all('tr')[1:]  # Skip the header row

    for row in rows:
        cols = row.find_all('td')
        details = {}

        # Map table columns to headers
        for i, col in enumerate(cols):
            if i < len(headers):
                details[headers[i]] = col.text.strip()

        # Map to desired format
        mapped_details = {
            "codice": details.get("Codice"),  # Adjust header name as needed
            "descrizione": details.get("Descrizione"),
            "iva": details.get("IVA"),
        }
        articoli.append(mapped_details)

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
        articoli_list_url = f"https://zuel.fast.tools/Products?page={page}"
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
            fattura_id = link['href'].split('/DataheaderInvoices/Details/')[1]
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
    details = {}

    form_groups = soup.find_all('div', class_='form-group')
    for group in form_groups:
        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for i in range(0, len(columns) - 1, 2):
            label = columns[i].text.strip()
            value = columns[i + 1].text.strip() if i + 1 < len(columns) else ""
            if label and value:
                details[label] = value

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
    details = {}

    form_groups = soup.find_all('div', class_='form-group')
    for group in form_groups:
        columns = group.find_all('div', class_=lambda x: x and x.startswith('col-sm-'))
        for i in range(0, len(columns) - 1, 2):
            label = columns[i].text.strip()
            value = columns[i + 1].text.strip() if i + 1 < len(columns) else ""
            if label and value:
                details[label] = value

    # Special handling for the "Confermata" checkbox
    checkbox = soup.find('input', id='IsflgConfirmed', type='checkbox')
    is_confermata = checkbox.get('checked') == 'checked' if checkbox else False
    details['Confermata'] = is_confermata

    mapped_details = {
        "tipo_documento": details.get("Tipo Documento"),
        "ragione_sociale": details.get("Ragione Sociale"),
        "confermata": True if details["Confermata"] == "true" else False,
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
    if tab_righe:
        table = tab_righe.find('table', class_='table-hover')
        if table:
            rows = table.find_all('tr')[1:]
            for row in rows:
                detail_button = row.find('button', class_='btn btn-info')
                if detail_button and 'onclick' in detail_button.attrs:
                    onclick_value = detail_button['onclick']
                    servizio_id = onclick_value.split('/DataRowsInvoices/Details/')[1].split("'")[0]

                    servizio_url = f"https://zuel.fast.tools/DataRowsInvoices/Details/{servizio_id}"
                    servizio_html = fetch_html(session_cookie, servizio_url)
                    servizio_details = parse_servizio_details(servizio_html)

                    id_lettura = servizio_details.get("id_lettura")
                    lettura_id = None
                    if id_lettura:
                        lettura = db.letture.find_one({"id_lettura": id_lettura})
                        if lettura:
                            lettura_id = lettura["_id"]
                    servizio_details["lettura"] = lettura_id
                    del servizio_details["id_lettura"]

                    nome_articolo = servizio_details.get("nome_articolo")
                    articolo_id = None
                    if nome_articolo:
                        articolo = db.articoli.find_one({"codice": nome_articolo})
                        if articolo:
                            articolo_id = articolo["_id"]
                    servizio_details["articolo"] = articolo_id
                    del servizio_details["nome_articolo"]

                    servizio_details["fattura"] = fattura_mongo_id

                    servizi.append(servizio_details)

    return servizi

def fetch_fattura_and_servizi(session_cookie, fattura_id, db):
    fattura_url = f"https://zuel.fast.tools/DataHeaderInvoices/Details/{fattura_id}"
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
    fattura_ids = set()
    old_size = 0
    page = 1

    while True:
        print(f"Fetching fattura list, page {page}...")
        fattura_list_url = f"https://zuel.fast.tools/DataHeaderInvoices?grid-page={page}"
        fattura_list_html = fetch_html(session_cookie, fattura_list_url)
        page_fattura_ids = parse_fattura_list(fattura_list_html)

        # Update the set of IDs with the current page's results
        fattura_ids.update(page_fattura_ids)

        # Check if the size of the set has not changed (i.e., no new IDs added)
        if not page_fattura_ids or len(fattura_ids) == old_size:
            print(f"No new fattura IDs found on page {page}. Stopping.")
            break

        # Update the old_size to the current size
        old_size = len(fattura_ids)
        print(f"Page {page}: Found {len(page_fattura_ids)} IDs. Total unique IDs: {old_size}.")
        page += 1

    # Convert the set to a list before returning
    fattura_id_list = list(fattura_ids)
    print(f"Total unique fattura IDs collected: {len(fattura_id_list)}")

    # Process all collected IDs using a thread pool
    with ThreadPoolExecutor(max_workers=40) as executor:
        futures = [
            executor.submit(fetch_fattura_and_servizi, session_cookie, fattura_id, db)
            for fattura_id in fattura_id_list
        ]
        for future in futures:
            future.result()

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

    # Extract the headers
    headers = [header.text.strip() for header in table.find_all('th')]

    # Iterate through the rows of the table
    rows = table.find_all('tr', class_='grid-row')
    for row in rows:
        columns = row.find_all('td')
        scadenza_details = {}

        # Map columns to their respective headers
        for index, column in enumerate(columns):
            if index < len(headers):
                header = headers[index]
                value = column.text.strip()
                scadenza_details[header] = value

        # Map and format the details
        mapped_details = {
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
        }
        
        scadenze.append(mapped_details)

    print(f"Parsed {len(scadenze)} Scadenze entries.")
    return scadenze

def fetch_all_scadenze(session_cookie, db):
    """
    Fetches and parses all Scadenze data from the grid across all pages.
    """
    old_size = 0
    page = 1
    all_scadenze = []

    while True and page < 28:
        print(f"Fetching Scadenze list, page {page}...")
        scadenze_url = f"https://zuel.fast.tools/DataHeaderInvoices/Scadenze?grid-page={page}"
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
    inserted_count = 0
    for scadenza in all_scadenze:
        if True: #not db.scadenze.find_one({"data_pagamento": scadenza["data_pagamento"]}):
            db.scadenze.insert_one(scadenza)
            inserted_count += 1

    print(f"Stored {inserted_count}/{len(all_scadenze)} new Scadenze.")
    return all_scadenze


if __name__ == "__main__":
    email = 'zuel@gesco.it'
    password = '!Zz123456'
    mongo_client = MongoClient("mongodb://localhost:27017/")
    db = mongo_client['gigi']

    try:
        session_cookie = get_session_cookie(email, password)
        if session_cookie:
            print("Session cookie retrieved successfully!")
            fetch_all_listini(session_cookie, db)
            fetch_all_articoli(session_cookie, db)
            fetch_all_clients(session_cookie, db)
            fetch_all_edifici(session_cookie, db)
            fetch_all_scadenze(session_cookie, db)
            fetch_all_fatture(session_cookie, db)
        else:
            print("Failed to retrieve session cookie.")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        mongo_client.close()
