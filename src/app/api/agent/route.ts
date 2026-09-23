import OpenAI from "openai";
import { AGENT_INSTRUCTIONS } from "@/lib/jarvis/config";
import { account as googleAccount } from "@/lib/google/auth";
import { GOOGLE_TOOLS, MEETING_TOOLS, runGoogleTool } from "@/lib/google/tools";
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
  // Signed-in check only: the full status also probes Keep over the network.
  const withGoogle = !!(await googleAccount());
  const call = (tools: OpenAI.Responses.Tool[], input: OpenAI.Responses.ResponseInput | string, prev?: string) =>
    client!.responses.create(
      {
        model: settings.agentModel,
        instructions: `${AGENT_INSTRUCTIONS}\nTeď je ${now} (Praha).`,
        input,
        tools,
        reasoning: { effort: "none" },
        max_output_tokens: 400,
        store: true,
        ...(prev ? { previous_response_id: prev } : {}),
      },
      { signal: AbortSignal.timeout(30_000) },
    );
  /** One question; Google function calls run here until the model has an answer. */
  const ask = async (tools: OpenAI.Responses.Tool[]) => {
    let res = await call(tools, context ? `${context}\n\nUživatel: ${question}` : question, previous);
    for (let round = 0; round < 4; round++) {
      const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
      if (!calls.length) break;
      const outputs = await Promise.all(
        calls.map(async (c) => {
          const out = await runGoogleTool(c.name, JSON.parse(c.arguments || "{}") as Record<string, unknown>, question).catch((e: Error) => ({ chyba: e.message }));
          used.push(`google.${c.name}`);
          return { type: "function_call_output" as const, call_id: c.call_id, output: JSON.stringify(out).slice(0, 12_000) };
        }),
      );
      res = await call(tools, outputs, res.id);
    }
    return res;
  };
  const used: string[] = [];
  const web: OpenAI.Responses.Tool[] = [{ type: "web_search" }, ...MEETING_TOOLS, ...(withGoogle ? GOOGLE_TOOLS : [])];
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
    used.push(...res.output.filter((o) => o.type === "mcp_call" || o.type === "web_search_call").map((o) => (o.type === "mcp_call" ? `${o.server_label}.${o.name}` : "web_search")));
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
