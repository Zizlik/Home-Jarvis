import OpenAI from "openai";
import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { minutesSchema, type Segment } from "@/lib/meeting/minutes";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

let client: OpenAI | null = null;

const INSTRUCTIONS = `Píšeš finální zápis z meetingu z celého přepisu (česky; přepis řeči může mít chyby).
Mluvčí jsou v přepisu označeni jménem, kde je známé, jinak písmenem (A, B, …). Dostaneš i seznam účastníků.
Na meetingu může mluvit i hlasový asistent Jarvis (odpovídá lidem, kteří ho oslovili „Jarvisi…“); když je z přepisu zřejmé, že písmeno mluví jako asistent, pojmenuj ho „Jarvis“.
V zápisu NIKDY nepiš „Mluvčí A“ ani samotná písmena: použij jméno, když ho znáš (i odhadnuté z přepisu), jinak piš neurčitě („jeden z účastníků“).
Vrať:
- title: název meetingu. Když ho uživatel zadal, použij přesně ten; jinak krátký výstižný název podle obsahu.
- overview: souhrn celého meetingu v jednom odstavci (3–6 vět): o čem byl, k čemu se došlo, co dál.
- summary: hlavní body v pořadí, jak zazněly.
- decisions: co se rozhodlo nebo dohodlo.
- actions: úkoly; owner = jméno účastníka, který ho má (použij jména, ne písmena), nebo null; due = termín jak zazněl, nebo null.
- questions: co zůstalo otevřené.
- speakers: přiřazení písmen ke jménům, kde to z přepisu vyplývá: představení („já jsem Petr“, „tady Jana“), oslovení („Jano, nastavíš…?“ → odpovídá Jana), podpis, kontext. Jména ber z účastníků, nebo z přepisu, když zazní. Např. [{"label":"A","name":"Petr"}]. Když si opravdu nejsi jistý, dané písmeno vynech.
Na meetingu je i hlasový asistent Jarvis: otázky, které mu lidé kladou („Jarvisi, …“), a jeho odpovědi do zápisu nepatří. Úkoly, které si nechali zapsat, ano.
Piš věcně, česky, nic si nevymýšlej. Opravuj zjevné chyby přepisu podle kontextu (např. „eŠOK“ → „e-shop“).`;

const str = { type: "string" };
const FORMAT = {
  type: "json_schema" as const,
  name: "final_minutes",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "overview", "summary", "decisions", "actions", "questions", "speakers"],
    properties: {
      title: str,
      overview: str,
      summary: { type: "array", items: str },
      decisions: { type: "array", items: str },
      actions: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["task", "owner", "due"], properties: { task: str, owner: { type: ["string", "null"] }, due: { type: ["string", "null"] } } },
      },
      questions: { type: "array", items: str },
      speakers: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "name"], properties: { label: str, name: str } } },
    },
  },
};

/** End of a meeting: minutes from the whole transcript, plus a guess who each speaker is. */
export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Chybí OPENAI_API_KEY." }, { status: 503 });
  const b = (await request.json().catch(() => null)) as { title?: string; participants?: string[]; segments?: Segment[]; speakers?: Record<string, string> } | null;
  // Names the user already confirmed ("A" → "Petr") go straight into the transcript.
  const known = b?.speakers && typeof b.speakers === "object" ? b.speakers : {};
  const segments = Array.isArray(b?.segments) ? b.segments : [];
  if (!segments.length) return Response.json({ error: "Chybí přepis." }, { status: 400 });
  const participants = (b?.participants ?? []).filter((p) => typeof p === "string" && p.trim()).slice(0, 30);
  // The model's context is large, but keep the request bounded: the end of very long meetings matters less than none at all.
  const transcript = segments
    .map((s) => `${s.speaker ? `${known[s.speaker] ?? s.speaker}: ` : ""}${s.text}`)
    .join("\n")
    .slice(0, 300_000);

  client ??= new OpenAI({ maxRetries: 1 });
  const settings = await readSettings();
  try {
    const res = await client.responses.create(
      {
        model: settings.agentModel,
        instructions: settings.vocabulary.trim() ? `${INSTRUCTIONS}\nSprávný pravopis jmen a pojmů (přepis je může komolit): ${settings.vocabulary.trim()}.` : INSTRUCTIONS,
        input: `Název od uživatele: ${b?.title?.trim() || "(nezadán)"}\nÚčastníci: ${participants.join(", ") || "(nezadáni)"}\n\nPřepis:\n${transcript}`,
        reasoning: { effort: "none" },
        text: { format: FORMAT },
        max_output_tokens: 6000,
        store: false,
      },
      { signal: AbortSignal.timeout(240_000) },
    );
    const out = JSON.parse(res.output_text) as { speakers: { label: string; name: string }[] } & Record<string, unknown>;
    const minutes = minutesSchema.parse(out);
    // The user's names win over the model's guesses.
    const speakers = { ...Object.fromEntries(out.speakers.filter((s) => s.label && s.name && /^[A-Z]{1,2}$/.test(s.label)).map((s) => [s.label, s.name])), ...known };
    return Response.json({ minutes, speakers });
  } catch (err) {
    console.warn(`[meeting] finalize failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Finální zápis se nepodařilo vytvořit." }, { status: 502 });
  }
}
