// How Jev files questions: npx tsx scripts/jev-topic-probe.mts
import { classifyWithJev } from "../src/lib/jev/client";

for (const t of ["A jaké mám splněné úkoly", "jaké mám splněné úkoly?", "a co mám v pátek?", "co mám zítra v kalendáři"]) {
  const s = performance.now();
  const r = await classifyWithJev(t);
  console.log(`${Math.round(performance.now() - s)}ms ${r.action?.value.padEnd(7)} ${r.askTopic?.value.padEnd(9)} ${r.askTopic?.confidence.toFixed(2)} ${t}`);
}
