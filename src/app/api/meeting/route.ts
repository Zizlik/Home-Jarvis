import { meetingWhen } from "@/lib/meeting/markdown";
import { listMeetings } from "@/lib/meeting/store";

export const runtime = "nodejs";

/** The archive, newest first (without transcripts: /api/meeting/<id> has the rest). */
export async function GET() {
  const all = await listMeetings();
  return Response.json({
    meetings: all.slice(0, 50).map((m) => ({
      id: m.id,
      title: m.title || m.minutes.title || "Meeting",
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      when: meetingWhen(m.startedAt),
      participants: m.participants,
      minutes: m.minutes,
      keep: !!m.keepNote,
    })),
  });
}
