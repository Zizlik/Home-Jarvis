import type { MediaSessionConfig } from "openai/resources/live/live";

/** Frontend prompt: how the voice talks and when it hands work to the backend. */
export const LIVE_INSTRUCTIONS = `Jsi Jarvis, osobní hlasový asistent. Mluv vždy česky, přirozeně a krátce (jedna až dvě věty).
Na obrazovce uživatel vidí karty, které tvoří aplikace.
Kdykoliv uživatel říká něco k zapsání nebo spočítání (schůzka, událost, připomínka, nákupní seznam, výdaj, rozdělení účtu, časovač, návyk, převod jednotek, výpočet, čas v jiném městě, odpočet dní, anketa, kontakt, odkaz, poznámka), předej to backendu. Stejně tak když chce kartu uložit, zahodit nebo změnit.
Když backend vrátí výsledek, krátce potvrď, co karta ukazuje. Nic si nedomýšlej a neopakuj celou větu uživatele.
Když výsledek chybí nebo je nejasný, zeptej se.`;

/** Backend prompt: turn the request into a card tool call with the user's own words. */
export const BACKEND_INSTRUCTIONS = `Ovládáš karty v aplikaci Jarvis. Uživatel mluví česky.
- Nový záznam: zavolej create_card. Do "text" dej to, co uživatel chce zapsat, česky a jeho vlastními slovy, včetně dat, časů, částek a jmen. Nepřekládej, neparafrázuj, nic nepřidávej. Vynech jen oslovení a úvod ("Jarvisi", "zapiš mi", "prosím tě") a to, co bylo předmětem úvodu, dej do 1. pádu ("zapiš mi večeři s Petrem v pátek" → "večeře s Petrem v pátek").
- Úprava zobrazené karty ("posuň to na sobotu", "přidej máslo"): zavolej update_card s celým novým textem karty česky.
- "ulož to", "potvrď": save_card. "zruš to", "zahoď": discard_card.
Výsledek nástroje shrň jednou krátkou českou větou. Nevymýšlej hodnoty, které nástroj nevrátil.`;

const text = { type: "object", properties: { text: { type: "string", description: "Text karty česky, slovy uživatele." } }, required: ["text"], additionalProperties: false };
const none = { type: "object", properties: {}, additionalProperties: false };

export function sessionConfig(voice: string): MediaSessionConfig {
  return {
    model: "gpt-live-1",
    instructions: LIVE_INSTRUCTIONS,
    audio: { output: { voice } },
    delegation: {
      type: "responses",
      responses: {
        model: process.env.JARVIS_BACKEND_MODEL || "gpt-5.6-luna",
        instructions: BACKEND_INSTRUCTIONS,
        reasoning: { effort: "low" },
        tool_choice: "auto",
        parallel_tool_calls: false,
        tools: [
          { type: "function", name: "create_card", strict: true, description: "Zobrazí novou kartu z českého textu uživatele. Vrátí typ karty a její obsah.", parameters: text },
          { type: "function", name: "update_card", strict: true, description: "Nahradí text zobrazené karty novým celým textem.", parameters: text },
          { type: "function", name: "save_card", strict: true, description: "Uloží zobrazenou kartu do seznamu.", parameters: none },
          { type: "function", name: "discard_card", strict: true, description: "Zahodí zobrazenou kartu.", parameters: none },
        ],
      },
    },
  };
}
