import OpenAI from "openai";
import { mcpTools, readSettings } from "@/lib/settings";
import { rejectForeignOrigin } from "../origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let client: OpenAI | null = null;

/** Asks the agent model to list a stored MCP server's tools: proves URL, token and headers work. */
export async function POST(request: Request) {
  const denied = rejectForeignOrigin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id) return Response.json({ ok: false, error: "Chybí ID serveru." }, { status: 400 });

  const settings = await readSettings();
  const server = settings.mcp.find((m) => m.id === body.id);
  if (!server) return Response.json({ ok: false, error: "Server není v uloženém nastavení. Nejdřív ho ulož." }, { status: 404 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ ok: false, error: "Chybí OPENAI_API_KEY." }, { status: 503 });

  client ??= new OpenAI({ maxRetries: 0 });
  try {
    const response = await client.responses.create(
      {
        model: settings.agentModel,
        tools: mcpTools({ ...settings, mcp: [{ ...server, enabled: true }] }),
        input: "Vypiš názvy svých nástrojů.",
        reasoning: { effort: "none" },
        max_output_tokens: 200,
        store: false,
      },
      { signal: AbortSignal.timeout(20_000) },
    );
    const list = response.output.find((o) => o.type === "mcp_list_tools");
    if (!list) return Response.json({ ok: false, error: "Server nevrátil seznam nástrojů." });
    if (list.error) return Response.json({ ok: false, error: `Server nevrátil nástroje: ${list.error}` });
    return Response.json({ ok: true, tools: list.tools.map((t) => t.name) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err instanceof OpenAI.APIUserAbortError);
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[settings] mcp test ${server.id} failed: ${detail}`);
    return Response.json({ ok: false, error: timedOut ? "Test vypršel po 20 s." : `Test selhal: ${detail}` });
  }
}
