// Prints the Czech rewrite and parsed card for a text: npx tsx scripts/rewrite-probe.mts <intent> "<text>"…
import { parseTextFor } from "../src/lib/cs";
import type { CardIntent } from "../src/lib/jev/types";
import { parseFor } from "../src/lib/parse";

const [intent, ...texts] = process.argv.slice(2) as [CardIntent, ...string[]];
for (const t of texts) {
  const r = parseTextFor(intent, t);
  console.log(`${t}\n  → ${r}\n  → ${JSON.stringify(parseFor(intent, r))}`);
}
