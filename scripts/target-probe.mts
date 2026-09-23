// Where an utterance says it belongs, and the card text left over: npx tsx scripts/target-probe.mts
import { cardText, targetIntent } from "../src/lib/jarvis/cards";

for (const t of [
  "Jarvisi, přidej mi do kalendáře zítra v deset poradu",
  "zapiš do kalendáře, že si mám zítra vyzvednout balík",
  "dej mi do úkolů koupit dárek pro mámu",
  "ulož do poznámek nápad na nový web",
  "opravdu to je v kalendáři?",
  "zítra v deset porada",
]) console.log(`${(targetIntent(t) ?? "-").padEnd(9)} „${cardText(t)}“  ← ${t}`);
