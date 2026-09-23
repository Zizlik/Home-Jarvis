// End-to-end check for Czech input: live /api/intent (Jev) → built-in Czech rewrite (lib/cs) → value parser.
// No Gemini: this is what the card shows instantly. "fallback" marks cards that would ask Gemini.
// Usage: npx tsx scripts/cs-e2e.ts [base-url]
import { completenessFor, parseFor } from "../src/lib/parse";
import { needsFallback, parseTextFor } from "../src/lib/cs";
import type { CardIntent } from "../src/lib/jev/types";

const BASE = process.argv[2] ?? "http://127.0.0.1:3030";

const CASES: [string, string][] = [
  ["večeře s Petrem v pátek v 8 večer přes zoom", "event"],
  ["oběd s Janou a Tomášem zítra ve 12:30", "event"],
  ["připomeň mi zaplatit nájem zítra, je to urgentní", "reminder"],
  ["koupit mléko, vejce, chleba a kávu", "todo"],
  ["25 minut soustředění", "timer"],
  ["posilovna 3x týdně", "habit"],
  ["běhat každé ráno", "habit"],
  ["tyrkysová", "color"],
  ["#ff6b35", "color"],
  ["rozděl 2400 Kč mezi 3", "split"],
  ["utratil jsem 450 za taxi", "expense"],
  ["5 mil na km", "convert"],
  ["72 °F na °C", "convert"],
  ["kolik je 18 % z 3450", "calc"],
  ["let do Barcelony příští víkend", "travel"],
  ["pizza nebo burgery na pátek?", "poll"],
  ["Petr 777 123 456 petr@mail.cz", "contact"],
  ["https://seznam.cz přečíst později", "link"],
  ["kolik dní do Vánoc", "countdown"],
  ["15:00 v Praze kolik je v Tokiu", "timezone"],
  ["kolik je hodin v New Yorku", "timezone"],
  ["meditace každý den v 7 ráno", "habit"],
  ["náhodné číslo 1 až 50", "random"],
  ["pauza 5 minut", "timer"],
  ["schůzka v kanceláři v pondělí v 9", "event"],
  ["ušetřit 50 tisíc, zatím 12 tisíc", "goal"],
  ["vlakem do Brna v sobotu", "travel"],
  ["zaplatil jsem 1200 Kč za nákup", "expense"],
  ["hoď 2 kostkami", "random"],
  ["hoď mincí", "random"],
  ["vyber jedno: tacos, sushi nebo pizza", "poll"],
  ["přečíst 12 knih letos, 4 hotové", "goal"],
  ["dnes jsem měl skvělý den a konečně dokončil projekt", "note"],
  // bez diakritiky
  ["vecere s Petrem v patek v 8 vecer", "event"],
  ["pripomen mi zitra zavolat mame", "reminder"],
  ["rozdel 900 mezi 4", "split"],
  ["kolik dni do vanoc", "countdown"],
  // další formulace
  ["porada ve čtvrtek v půl třetí odpoledne přes teams", "event"],
  ["zubař 15. 10. v 9:30", "event"],
  ["tmavě modrá", "color"],
  ["za 20 minut vytáhnout prádlo", "reminder|timer"],
  ["hodina jógy", "timer|habit|note"],
  ["ulož kontakt Tomáš Dvořák 602 555 111", "contact"],
  ["kolik je 15 % z 2 400", "calc"],
  ["nakoupit rohlíky, sýr, mouku a zeleninu", "todo"],
  ["kam půjdeme na oběd: Lokál, Pho nebo pizza", "poll"],
  ["kolik je hodin v Londýně", "timezone"],
  ["3 libry na kg", "convert"],
];

const show = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "string" && /^\d{4}-\d\d-\d\dT/.test(x) ? new Date(x).toLocaleString("cs-CZ") : x));

let ok = 0;
let fb = 0;
for (const [text, expected] of CASES) {
  const res = await fetch(`${BASE}/api/intent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const r = await res.json();
  const intent = r.intent.value as CardIntent;
  const none = (intent as string) === "none";
  const rewritten = none ? text : parseTextFor(intent, text);
  const parsed = none ? null : parseFor(intent, rewritten);
  const full = none ? 0 : completenessFor(intent, rewritten);
  const fallback = none ? false : needsFallback(intent, text);
  const pass = expected.split("|").includes(intent);
  if (pass) ok++;
  if (fallback) fb++;
  console.log(`${pass ? "OK " : "XX "} ${text}\n    → ${intent} ${r.intent.confidence.toFixed(2)} | ${rewritten}${fallback ? `  [fallback, úplnost ${full.toFixed(2)}]` : ""}\n    → ${show(parsed)}`);
}
console.log(`\n${ok}/${CASES.length} intentů správně, ${fb} karet by volalo Gemini`);
