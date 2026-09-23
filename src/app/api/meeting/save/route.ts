import { z } from "zod";
import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { account } from "@/lib/google/auth";
import { create } from "@/lib/google/sync";
import { meetingMarkdown, meetingWhen } from "@/lib/meeting/markdown";
import { minutesSchema } from "@/lib/meeting/minutes";
import { saveMeeting } from "@/lib/meeting/store";

export const runtime = "nodejs";

const action = z.object({ task: z.string().min(1).max(500), owner: z.string().nullable(), due: z.string().nullable() });
const body = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(300),
  startedAt: z.string(),
  endedAt: z.string(),
  participants: z.array(z.string().max(100)).max(50),
  speakers: z.record(z.string(), z.string()),
  segments: z.array(z.object({ at: z.number(), text: z.string(), speaker: z.string().nullable() })).max(20_000),
  minutes: minutesSchema,
  /** Also write the minutes to Google Keep. */
  keep: z.boolean(),
  /** Action items for Google Tasks, as subtasks of one "Meeting: …" task. */
  tasks: z.array(action).max(100),
});

/** End of a meeting: archive it (.json + .md), optionally minutes to Keep and action items to Tasks. */
export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Neplatný zápis." }, { status: 400 });
  const { keep, tasks, ...m } = parsed.data;
  const record = { ...m, title: m.title.trim() || m.minutes.title || "Meeting" };
  const date = new Date(record.startedAt).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
  const errors: string[] = [];
  const signedIn = !!(await account());
  let keepNote: string | undefined;

  if (keep && signedIn) {
    try {
      const text = meetingMarkdown(record, { transcript: false }).replace(/^---[\s\S]*?---\n+/, "").slice(0, 19_000);
      keepNote = (await create({ kind: "keep-note", title: `${record.title} (${date})`, text })).id;
    } catch (e) {
      errors.push(`Keep: ${(e as Error).message}`);
    }
  }

  let taskCount = 0;
  if (tasks.length && signedIn) {
    try {
      await create({
        kind: "tasktree",
        title: `Meeting: ${record.title} (${date})`,
        notes: `${meetingWhen(record.startedAt)}${record.participants.length ? `\nÚčastníci: ${record.participants.join(", ")}` : ""}`,
        items: tasks.map((a) => ({ title: a.task, notes: [a.owner && `Kdo: ${a.owner}`, a.due && `Termín: ${a.due}`].filter(Boolean).join("\n") || undefined })),
      });
      taskCount = tasks.length;
    } catch (e) {
      errors.push(`Tasks: ${(e as Error).message}`);
    }
  }

  await saveMeeting({ ...record, keepNote });
  console.info(`[meeting] saved ${record.id} keep=${!!keepNote} tasks=${taskCount}`);
  return Response.json({ ok: true, record: { ...record, keepNote }, keep: !!keepNote, tasks: taskCount, errors });
}
