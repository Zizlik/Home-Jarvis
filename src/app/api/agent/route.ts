import OpenAI from "openai";
import { AGENT_INSTRUCTIONS } from "@/lib/jarvis/config";
import { mcpTools, readSettings } from "@/lib/settings";

export const runtime = "nodejs";

let client: OpenAI | null = null;

type Body = { question?: unknown; context?: unknown; previousResponseId?: unknown };

/**
 * Questions and MCP work: one Responses call, no reasoning, with the user's MCP
 * servers as tools. `previousResponseId` keeps the thread across a conversation,
 * so "yes, send it" after a proposed email has its context.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: "Neočekávaný původ požadavku." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Chybí OPENAI_API_KEY." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
  if (!question) return Response.json({ error: "Chybí otázka." }, { status: 400 });
  const context = typeof body?.context === "string" ? body.context.slice(0, 4000) : "";
  const previous = typeof body?.previousResponseId === "string" ? body.previousResponseId : undefined;

  const settings = await readSettings();
  const now = new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "full", timeStyle: "short" });
  client ??= new OpenAI({ maxRetries: 0 });
  const started = performance.now();
  const ask = (tools: OpenAI.Responses.Tool[]) =>
    client!.responses.create(
      {
        model: settings.agentModel,
        instructions: `${AGENT_INSTRUCTIONS}\nTeď je ${now} (Praha).`,
        input: context ? `${context}\n\nUživatel: ${question}` : question,
        tools,
        reasoning: { effort: "none" },
        max_output_tokens: 400,
        store: true,
        ...(previous ? { previous_response_id: previous } : {}),
      },
      { signal: AbortSignal.timeout(30_000) },
    );
  const web: OpenAI.Responses.Tool[] = [{ type: "web_search" }];
  const mcp = mcpTools(settings) as OpenAI.Responses.Tool[];
  try {
    let res: OpenAI.Responses.Response;
    try {
      res = await ask([...web, ...mcp]);
    } catch (err) {
      // An unreachable MCP server (424) must not take ordinary questions down with it.
      if (!(err instanceof OpenAI.APIError && err.status === 424 && mcp.length)) throw err;
      console.warn(`[agent] MCP server unavailable, answering without MCP: ${err.message}`);
      res = await ask(web);
    }
    const used = res.output.filter((o) => o.type === "mcp_call" || o.type === "web_search_call").map((o) => (o.type === "mcp_call" ? `${o.server_label}.${o.name}` : "web_search"));
    console.info(`[agent] ${Math.round(performance.now() - started)}ms tools=[${used.join(",")}] "${question.slice(0, 50)}"`);
    // Spoken and shown as plain text: drop citations and Markdown links.
    const answer = res.output_text
      .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_#`]/g, "")
      .trim();
    return Response.json({ answer, responseId: res.id, tools: used });
  } catch (err) {
    console.warn(`[agent] failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Na tohle teď nedokážu odpovědět." }, { status: 502 });
  }
}
