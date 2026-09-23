import { minutesText } from "@/lib/meeting/minutes";
import { listMeetings } from "@/lib/meeting/store";

export const runtime = "nodejs";

/** The archive: newest first, minutes as text (transcripts stay on the server). */
export async function GET() {
  const all = await listMeetings();
  return Response.json({
    meetings: all.slice(0, 30).map((m) => ({
      id: m.id,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      title: m.minutes.title || "Meeting",
      text: minutesText(m.minutes, new Date(m.startedAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", timeStyle: "short" })),
      keep: !!m.keepNote,
    })),
  });
}
