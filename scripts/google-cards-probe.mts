// What a saved card would write to Google: npx tsx scripts/google-cards-probe.mts
import { toGoogle } from "../src/lib/google/cards";

const prefs = { event: true, reminder: true, todo: "tasks", note: "keep" } as const;
const cards = [
  ["event", "večeře s Petrem v pátek v 8 večer přes zoom"],
  ["event", "porada ve čtvrtek"],
  ["reminder", "připomeň mi zítra v 6 večer zavolat mámě"],
  ["todo", "Příprava na meeting: bod 12, bod 54 a bod 32"],
  ["note", "Nápad na projekt. Jarvis by mohl dělat zápisy z meetingů."],
  ["expense", "utratil jsem 450 za taxi"],
] as const;
for (const [intent, text] of cards) {
  console.log(intent.padEnd(9), text, "\n   →", JSON.stringify(toGoogle({ id: 1, intent, text, summary: text, createdAt: 0 }, prefs)));
}
