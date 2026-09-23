import { meetingFileName, meetingMarkdown } from "@/lib/meeting/markdown";
import { getMeeting } from "@/lib/meeting/store";

export const runtime = "nodejs";

/** One archived meeting: JSON (with the full transcript), or `?format=md` as an Obsidian note download. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const m = await getMeeting((await ctx.params).id);
  if (!m) return Response.json({ error: "Meeting nenalezen." }, { status: 404 });
  if (new URL(request.url).searchParams.get("format") === "md") {
    return new Response(meetingMarkdown(m), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="meeting.md"; filename*=UTF-8''${encodeURIComponent(meetingFileName(m))}`,
      },
    });
  }
  return Response.json(m);
}
