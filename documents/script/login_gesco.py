"""Login a Gesco: apre il browser, attende il CAPTCHA e salva la sessione.

    .venv/bin/python documents/script/login_gesco.py

Serve perche il login richiede una persona: il CAPTCHA va risolto a mano. Questo
script fa solo quella parte e salva il cookie in `.fasttools-session`, cosi
l'import vero e proprio puo poi girare senza interazione:

    .venv/bin/python documents/script/main.py

Il cookie resta valido per la durata della sessione su Gesco: finche vale, si
possono ripetere o riprendere gli import senza nuovi CAPTCHA.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import COOKIE_CACHE, get_session_cookie, os  # noqa: E402


def main() -> int:
    email = os.getenv("FASTTOOLS_EMAIL")
    password = os.getenv("FASTTOOLS_PASSWORD")

    if not email or not password:
        print("Impostare FASTTOOLS_EMAIL e FASTTOOLS_PASSWORD nel file .env", file=sys.stderr)
        return 1

    print("Si aprira una finestra del browser sulla pagina di accesso a Gesco.")
    print("Le credenziali vengono inserite da sole: va risolto il CAPTCHA e completato")
    print("l'accesso, poi si torna qui e si preme Invio.\n")

    cookie = get_session_cookie(email, password)

    if not cookie:
        print("\nSessione non ottenuta: accesso non completato.", file=sys.stderr)
        return 1

    print(f"\nSessione salvata in {COOKIE_CACHE}")
    print("Ora l'import puo girare senza interazione:")
    print("  .venv/bin/python documents/script/main.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
