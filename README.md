# Home Jarvis

Hlasový asistent: mluvíš s ním česky (OpenAI `gpt-live-1`) a on ti živě ukazuje, co udělal, jako karty ze [Shapeshiftu](https://github.com/Zizlik/shapeshift). Kartu vybírá Jev, hodnoty (data, časy, částky) počítají české parsery, agent je jen čte.

## Původ

Projekt vychází z [**Shapeshift**](https://github.com/anishfn/shapeshift) od [anishfn](https://github.com/anishfn) (MIT licence, viz [LICENSE](LICENSE)): textové pole, které se podle napsaného mění na správnou kartu, a klasifikace přes Jev od TypeSafe AI. Z něj převzaté karty, výběr karty a parsery hodnot.

Oproti originálu přibylo:
- čeština: české parsery (`src/lib/cs`), české UI, měna Kč, Gemini jako záloha pro parsery;
- hlas: rozhovor s `gpt-live-1`, oslovení „Hey Jarvis“ v prohlížeči, diktování;
- práce s kartami hlasem (vytvořit, upravit, uložit, smazat i uložené karty) a nastavení s MCP servery.

Mezikrok s češtinou a diktováním je v [Zizlik/shapeshift](https://github.com/Zizlik/shapeshift). Detekce „Hey Jarvis“ používá modely z [openWakeWord](https://github.com/dscripka/openWakeWord) (kód Apache 2.0, modely CC BY-NC-SA 4.0, tedy jen nekomerčně).

## Stav

Hlas (`gpt-live-1`, oslovení „Hey Jarvis“ přímo v prohlížeči), karty a psaní ze Shapeshiftu, nastavení s MCP servery na `/nastaveni`. Nápady do budoucna jsou v [docs/NAPADY.md](docs/NAPADY.md).

## Spuštění

```bash
cp .env.example .env.local   # TYPESAFE_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
npm install
npm run build && npm start
```

Hlas se volí parametrem `?voice=` (marin, quartz, ripple, vesper, willow, stone, gleam, meridian, bossa, tempo, beacon, delta, cinder).

| Proměnná | Výchozí | K čemu |
| --- | --- | --- |
| `OPENAI_API_KEY` | | GPT-Live session (`/api/session`), jen na serveru |
| `JARVIS_BACKEND_MODEL` | `gpt-5.6-luna` | backend, který volá nástroje karet |
| `TYPESAFE_API_KEY` | | Jev, výběr karty |
| `GEMINI_API_KEY` | | záloha českého přepisu pro parsery |
