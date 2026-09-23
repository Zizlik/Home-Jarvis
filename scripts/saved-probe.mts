import { findSaved, overlap } from "../src/lib/jarvis/saved";
const list = [
  { id: 3, intent: "event", summary: "Oběd · Zítra, 12:00", text: "oběd s Janou zítra v poledne", createdAt: 3 },
  { id: 2, intent: "todo", summary: "3 položky · Mléko, Rohlíky, Máslo", text: "koupit mléko, rohlíky a máslo", createdAt: 2 },
  { id: 1, intent: "event", summary: "Večeře · Pátek, 20:00", text: "večeře s Petrem v pátek v 8 večer přes zoom", createdAt: 1 },
] as never;
for (const q of ["smaž tu večeři", "přesuň večeři s Petrem na sobotu", "smaž ten nákup mléka", "zruš oběd s Janou", "smaž tu poslední", "zruš to", "smaž schůzku s Karlem"]) {
  const f = findSaved(q, list);
  console.log(q.padEnd(34), f ? `${(f.item as { text: string }).text} (${f.score})` : "-", "| vs pole 'koupit mléko':", overlap(q, "koupit mléko"));
}
