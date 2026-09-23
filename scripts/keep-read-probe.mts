// Read-only: why Keep listing fails (prints the error or the note count).
import { runGoogleTool } from "../src/lib/google/tools";

try {
  const r = (await runGoogleTool("keep_notes", { query: null }, "")) as unknown[] | { chyba: string };
  console.log(Array.isArray(r) ? `OK: ${r.length} poznámek` : r);
} catch (e) {
  console.log("CHYBA:", (e as Error).message);
}
