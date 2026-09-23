import { z } from "zod";
import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { create, remove, type SyncCard, type SyncRef } from "@/lib/google/sync";

export const runtime = "nodejs";

const iso = z.string().datetime({ offset: true });
const card = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), title: z.string().min(1).max(300), start: iso, end: iso.nullish(), allDay: z.boolean(), description: z.string().max(4000).optional(), location: z.string().max(300).nullish() }),
  z.object({ kind: z.literal("task"), title: z.string().min(1).max(300), due: iso.nullish(), notes: z.string().max(4000).optional() }),
  z.object({ kind: z.literal("tasklist"), title: z.string().min(1).max(300), items: z.array(z.string().min(1).max(300)).min(1).max(100) }),
  z.object({ kind: z.literal("keep-note"), title: z.string().max(300), text: z.string().max(20000) }),
  z.object({ kind: z.literal("keep-list"), title: z.string().max(300), items: z.array(z.string().min(1).max(300)).min(1).max(100) }),
]);
const ref = z.object({ target: z.enum(["calendar", "tasks", "keep"]), id: z.string().min(1), parentIds: z.array(z.string()).optional(), url: z.string().optional() });
const body = z.discriminatedUnion("op", [z.object({ op: z.literal("create"), card }), z.object({ op: z.literal("remove"), ref })]);

/** Write a saved card to Google, or remove what an earlier write created. */
export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Neplatný požadavek." }, { status: 400 });
  try {
    if (parsed.data.op === "create") {
      const r = await create(parsed.data.card as SyncCard);
      console.info(`[google] ${parsed.data.card.kind} → ${r.target}`);
      return Response.json({ ref: r });
    }
    await remove(parsed.data.ref as SyncRef);
    console.info(`[google] removed ${parsed.data.ref.target}`);
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[google] sync failed: ${msg}`);
    return Response.json({ error: msg }, { status: 502 });
  }
}
