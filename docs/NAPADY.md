# Nápady do budoucna

## Subagenti na pozadí a režim meetingu

Jarvis může během rozhovoru spouštět další agenty, kteří mezitím něco udělají, a sám se ozve, až mají hotovo.

Příklad: na meetingu mluví dva lidé a Jarvis poslouchá a píše zápis. Napadne ho, že by se hodil graf nebo výpočet. Spustí na to subagenta a poslouchá dál. Až subagent skončí, Jarvis vstoupí do hovoru („Mám hotový ten graf“) a výsledek se ukáže na obrazovce jako karta.

### Z čeho se to dá postavit

- **Úkoly na pozadí:** Jarvis už teď předává práci aplikaci (client delegation). Přibude typ „udělej to na pozadí“: aplikace spustí samostatného agenta a hovor běží dál.
- **Agent se sám ozve:** `gpt-live-1` přijímá zprávy od aplikace kdykoliv (`session.commentary.append`, `delegation_id: null`). Výsledek se zobrazí jako karta: graf, tabulka, výpočet, text.
- **Kdo práci dělá:** grafy a výpočty OpenAI s code interpreterem (vrátí obrázek grafu). Větší věci („naprogramuj…“) Claude Code nebo Codex na serveru, jako OpenClaw.

### Režim meetingu

- Poslouchá pořád, ale levným přepisem (`gpt-live-transcribe`, asi 1 $ za hodinu), ne drahým hlasovým modelem.
- Průběžně píše zápis. Každých pár minut se levný model podívá, jestli z hovoru neplyne něco k udělání (graf, výpočet, úkol).
- Když ano, spustí subagenta. Výsledek na obrazovce, hlasem se Jarvis ozve jen když je to užitečné, aby lidi nepřerušoval.

### Postup

1. Úkoly na pozadí na povel („Jarvisi, udělej z toho graf“): ověřit, jak se agent ozývá zpátky.
2. Režim meetingu se zápisem.
3. Proaktivní nápady: Jarvis sám navrhne, co udělat.

## Další

- Kalendář a e-mail přes vlastní MCP server (OpenAI konektory potřebují OAuth token, který po hodině vyprší).
- Mazat a upravovat uložené karty hlasem („smaž tu večeři“).
- Přihlášení, kdyby Jarvis měl běžet mimo VPN/LAN (nastavení obsahuje tokeny).
