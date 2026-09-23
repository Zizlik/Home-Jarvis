# Home Jarvis

Hlasový asistent: mluvíš s ním česky (OpenAI `gpt-live-1`) a on ti živě ukazuje, co udělal, jako karty ze [Shapeshiftu](https://github.com/Zizlik/shapeshift). Kartu vybírá Jev, hodnoty (data, časy, částky) počítají české parsery, agent je jen čte.

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
