import { z } from "zod";
import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { status } from "@/lib/google/auth";
import { create } from "@/lib/google/sync";
import { minutesSchema, minutesText } from "@/lib/meeting/minutes";
import { saveMeeting } from "@/lib/meeting/store";

export const runtime = "nodejs";

const body = z.object({
  id: z.string().min(1).max(64),
  startedAt: z.string(),
  endedAt: z.string(),
  transcript: z.string().max(500_000),
  minutes: minutesSchema,
  /** Also write the minutes to Google Keep. */
  keep: z.boolean(),
  /** Action items to add to Google Tasks (the ones the user ticked). */
  tasks: z.array(z.object({ task: z.string().min(1), owner: z.string().nullable(), due: z.string().nullable() })).max(50),
});

/** End of a meeting: archive it, and optionally write minutes to Keep and action items to Tasks. */
export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Neplatný zápis." }, { status: 400 });
  const m = parsed.data;
  const when = new Date(m.startedAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", timeStyle: "short" });
  const text = minutesText(m.minutes, when);
  const errors: string[] = [];
  let keepNote: string | undefined;

  const g = await status();
  if (m.keep && g.keep) {
    try {
      keepNote = (await create({ kind: "keep-note", title: `Zápis: ${m.minutes.title || "meeting"}`, text })).id;
    } catch (e) {
      errors.push(`Keep: ${(e as Error).message}`);
    }
  } else if (m.keep) errors.push("Keep není připojený.");

  let tasks = 0;
  if (m.tasks.length && g.connected) {
    for (const a of m.tasks) {
      try {
        const notes = [a.owner && `Kdo: ${a.owner}`, a.due && `Termín: ${a.due}`, `Z meetingu: ${m.minutes.title || when}`].filter(Boolean).join("\n");
        await create({ kind: "task", title: a.task, notes });
        tasks++;
      } catch (e) {
        errors.push(`Tasks: ${(e as Error).message}`);
        break;
      }
    }
  }

  await saveMeeting({ id: m.id, startedAt: m.startedAt, endedAt: m.endedAt, transcript: m.transcript, minutes: m.minutes, keepNote });
  console.info(`[meeting] saved ${m.id} keep=${!!keepNote} tasks=${tasks}`);
  return Response.json({ ok: true, text, keep: !!keepNote, tasks, errors });
}
