import "server-only";

/**
 * Czech → parser English. The value parsers (chrono, regexes) only read English,
 * so Gemini rewrites the structure words (dates, times, units, connectors) into
 * English and keeps the content (items, names, titles) in Czech.
 * Gemini rewrites, code computes. Any failure returns null and the raw text is used.
 */

const MODEL = process.env.GEMINI_NORMALIZE_MODEL || "gemini-3.1-flash-lite";

const SYSTEM = `You convert a short Czech (or mixed) note into the English phrasing that an English rule-based parser understands. Output ONLY the rewritten text on one line.

Rules:
- Translate grammar, command words, dates, times, weekdays, durations, frequencies, units, quantities and connectors into plain English. Examples: "zítra"→"tomorrow", "pozítří"→"in 2 days", "v pátek"→"friday", "příští týden"→"next week", "každý den"→"every day", "3x týdně"→"3x a week", "rozděl X mezi 3"→"split X between 3", "18 % z 3450"→"18% of 3450", "kolik je"→"what is", "připomeň mi"→"remind me to", "nezapomeň"→"remind me to", "koupit / nakoupit"→"buy", "utratil jsem 450 za oběd"→"spent 450 on oběd", "dní do"→"days until", "hoď kostkou"→"roll a die", "hoď mincí"→"flip a coin", "náhodné číslo 1 až 10"→"random number 1 to 10", "vyber jedno: a, b nebo c"→"pick one: a, b or c", "přes zoom"→"via zoom", "s Petrem"→"with Petr", "v kavárně"→"at kavárna", "let do Barcelony"→"flight to Barcelona", "vlakem do Brna"→"train to Brno", "4 hotové"→"4 done".
- KEEP content words in Czech, in their basic nominative form: shopping items, tasks, names, places, note text, event titles, poll options. Example: "koupit mléko, vejce a chleba"→"buy mléko, vejce and chleba"; "večeře s Petrem v pátek v 8 večer"→"večeře with Petr friday 8pm"; "připomeň mi zaplatit nájem zítra"→"remind me to zaplatit nájem tomorrow"; "přečíst 12 knih letos, 4 hotové"→"přečíst knihy 12 this year, 4 done".
- Polls (asking a group to choose): translate only the word "nebo" to "or" and keep everything else in Czech: "pizza nebo burgery na pátek?"→"pizza or burgery na pátek?".
- Countdowns: keep holiday names in Czech nominative: "kolik dní do Vánoc"→"days until Vánoce", "do Silvestra"→"days until Silvestr".
- Cities for time zones in English: "Praha"→"Prague", "Tokio"→"Tokyo", "Londýn"→"London", "Vídeň"→"Vienna". Time zone questions: "15:00 v Praze kolik je v Tokiu"→"3pm prague in tokyo", "kolik je hodin v New Yorku"→"what time is it in new york".
- Unit conversions: "5 mil na km"→"5 miles in km", "72 °F na °C"→"72f to c", "3 libry na kg"→"3 lb in kg".
- Timers: translate only the duration, keep the label in Czech: "25 minut soustředění"→"25 min soustředění", "pauza 5 minut"→"pauza 5 min", "stopky"→"stopwatch".
- Habits: translate only the frequency, keep the activity in Czech: "běhat každé ráno"→"běhat every morning", "meditace každý den"→"meditace every day".
- Links: keep the note in Czech: "https://seznam.cz přečíst později"→"https://seznam.cz přečíst později".
- Goals: keep the goal title in Czech: "ušetřit 50 tisíc, zatím 12 tisíc"→"ušetřit 50000, 12000 done", "přečíst 12 knih letos, 4 hotové"→"přečíst knihy 12 this year, 4 done".
- Urgency words become English "urgent" at the end: "zaplatit nájem zítra, je to urgentní"→"remind me to zaplatit nájem tomorrow urgent", "hned", "důležité", "spěchá" → "urgent".
- Convert Czech number words to digits. Keep numbers, amounts, currencies (Kč, €, $), %, e-mails, phone numbers, URLs and hex colors exactly.
- Times: "v 8 večer"→"8pm", "v 8 ráno"→"8am", "ve 14:30"→"2:30pm", "v poledne"→"noon", "v půl třetí"→"2:30pm".
- Czech color names → English color names ("tyrkysová"→"turquoise", "tmavě modrá"→"dark blue").
- A plain note, thought or diary sentence with no command, date or number: return it unchanged.
- Unfinished input: rewrite what is there, never complete it. Already English: return unchanged. Never add explanations or quotes.`;

const CZECH_HINT =
  /[áčďéěíňóřšťúůýž]|\b(?:zitra|dnes|koupit|nakoupit|pripomen|rozdel|mezi|minut|kolik|hodin|patek|pondeli|utery|streda|ctvrtek|sobota|nedele|tyden|tydne|denne|mesic|rano|vecer|nebo|jsem|utratil|vanoc|hod|kostk|minc|prevod|do|na|za|s|se|ve?)\b/i;

/** English input (or bare numbers, URLs, hex) goes straight to the parsers. */
export function needsNormalize(text: string) {
  return CZECH_HINT.test(text);
}

export async function normalizeCzech(text: string, signal?: AbortSignal): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || !needsNormalize(text)) return null;

  const timeout = AbortSignal.timeout(3000);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  return out ? out.replace(/^["'„“]+|["'“”]+$/g, "").split("\n")[0].trim() : null;
}
