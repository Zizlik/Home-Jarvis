// Read-only check of the Google connection (counts only, no content printed).
import { runGoogleTool } from "../src/lib/google/tools";

const from = new Date();
const to = new Date(Date.now() + 7 * 86_400_000);
const checks: [string, () => Promise<unknown>][] = [
  ["Kalendář (7 dní)", () => runGoogleTool("calendar_events", { from: from.toISOString(), to: to.toISOString(), query: null }, "")],
  ["Tasks", () => runGoogleTool("tasks_list", {}, "")],
  ["Gmail (2 dny)", () => runGoogleTool("gmail_search", { query: "newer_than:2d" }, "")],
];
for (const [name, run] of checks) {
  try {
    const r = (await run()) as unknown[];
    console.log(`OK  ${name}: ${r.length} položek`);
  } catch (e) {
    console.log(`XX  ${name}: ${(e as Error).message.split(". ")[0]}`);
  }
}
