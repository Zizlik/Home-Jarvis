import OpenAI from "openai";
import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { minutesSchema } from "@/lib/meeting/minutes";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";

let client: OpenAI | null = null;

const INSTRUCTIONS = `Píšeš průběžný zápis z meetingu podle živého přepisu řeči (česky, přepis může mít chyby a nedokončené věty).
Dostaneš dosavadní zápis a nový úsek přepisu. Vrať CELÝ aktualizovaný zápis.
- title: krátký název meetingu podle obsahu.
- summary: hlavní body, stručně, v pořadí jak zazněly (nejvýš 12).
- decisions: co se rozhodlo nebo dohodlo.
- actions: úkoly, owner = kdo ho má (jméno, nebo null), due = termín jak zazněl (nebo null).
- questions: co zůstalo otevřené.
Na meetingu je i hlasový asistent Jarvis: otázky, které mu lidé kladou („Jarvisi, …“), a jeho odpovědi do zápisu nepatří. Úkoly, které si nechali zapsat, ano.
Piš česky, věcně, bez vaty. Nic si nevymýšlej; co v přepisu není, do zápisu nepatří. Opravuj zjevné chyby přepisu podle kontextu.`;

const FORMAT = {
  type: "json_schema" as const,
  name: "minutes",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "decisions", "actions", "questions"],
    properties: {
      title: { type: "string" },
      summary: { type: "array", items: { type: "string" } },
      decisions: { type: "array", items: { type: "string" } },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["task", "owner", "due"],
          properties: { task: { type: "string" }, owner: { type: ["string", "null"] }, due: { type: ["string", "null"] } },
        },
      },
      questions: { type: "array", items: { type: "string" } },
    },
  },
};

/** Previous minutes + new transcript → updated minutes (incremental, so long meetings stay cheap). */
export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Chybí OPENAI_API_KEY." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { minutes?: unknown; transcript?: unknown } | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript.slice(-30_000) : "";
  if (!transcript.trim()) return Response.json({ error: "Chybí přepis." }, { status: 400 });
  const previous = minutesSchema.safeParse(body?.minutes);

  client ??= new OpenAI({ maxRetries: 1 });
  const settings = await readSettings();
  try {
    const res = await client.responses.create(
      {
        model: settings.agentModel,
        instructions: settings.vocabulary.trim() ? `${INSTRUCTIONS}\nSprávný pravopis jmen a pojmů (přepis je může komolit): ${settings.vocabulary.trim()}.` : INSTRUCTIONS,
        input: `Dosavadní zápis:\n${previous.success ? JSON.stringify(previous.data) : "(zatím žádný)"}\n\nNový přepis:\n${transcript}`,
        reasoning: { effort: "none" },
        text: { format: FORMAT },
        max_output_tokens: 2500,
        store: false,
      },
      { signal: AbortSignal.timeout(45_000) },
    );
    const minutes = minutesSchema.parse(JSON.parse(res.output_text));
    return Response.json({ minutes });
  } catch (err) {
    console.warn(`[meeting] minutes failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Zápis se nepodařilo aktualizovat." }, { status: 502 });
  }
}
