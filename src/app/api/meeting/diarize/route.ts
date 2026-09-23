import { rejectForeignOrigin } from "@/app/api/settings/origin";
import type { Segment } from "@/lib/meeting/minutes";

export const runtime = "nodejs";
export const maxDuration = 600;

/** OpenAI's per-file limit for transcription uploads. */
const MAX_BYTES = 25 * 1024 * 1024;

type Diarized = { segments?: { speaker?: string; start?: number; end?: number; text?: string }[]; error?: { message?: string } };

/**
 * Who said what: the meeting recording (webm/opus from the browser) goes to
 * gpt-4o-transcribe-diarize, which labels speakers A, B, …; consecutive pieces
 * of the same speaker are merged into one segment.
 */
export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return Response.json({ error: "Chybí OPENAI_API_KEY." }, { status: 503 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob) || !file.size) return Response.json({ error: "Chybí nahrávka." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Nahrávka je na rozlišení mluvčích moc dlouhá (limit 25 MB, zhruba 100 minut)." }, { status: 413 });

  const body = new FormData();
  // OpenAI goes by the file extension: name it after the browser's format.
  const ext = /ogg/.test(file.type) ? "ogg" : /wav/.test(file.type) ? "wav" : /mp4|m4a|aac/.test(file.type) ? "m4a" : /mpeg|mp3/.test(file.type) ? "mp3" : "webm";
  body.set("file", file, `meeting.${ext}`);
  body.set("model", process.env.OPENAI_DIARIZE_MODEL || "gpt-4o-transcribe-diarize");
  body.set("response_format", "diarized_json");
  body.set("chunking_strategy", "auto");
  body.set("language", "cs");
  const started = performance.now();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body,
    signal: AbortSignal.timeout(9 * 60_000),
  }).catch((e: Error) => e);
  if (res instanceof Error) return Response.json({ error: `Rozlišení mluvčích selhalo: ${res.message}` }, { status: 502 });
  const data = (await res.json().catch(() => ({}))) as Diarized;
  if (!res.ok) return Response.json({ error: `Rozlišení mluvčích selhalo: ${data.error?.message ?? res.status}` }, { status: 502 });

  const segments: Segment[] = [];
  for (const s of data.segments ?? []) {
    const text = (s.text ?? "").trim();
    if (!text) continue;
    const last = segments[segments.length - 1];
    if (last && last.speaker === (s.speaker ?? null)) last.text = `${last.text} ${text}`;
    else segments.push({ at: Math.round(s.start ?? 0), text, speaker: s.speaker ?? null });
  }
  console.info(`[meeting] diarized ${(file.size / 1e6).toFixed(1)} MB in ${Math.round(performance.now() - started)} ms, ${new Set(segments.map((s) => s.speaker)).size} speakers`);
  return Response.json({ segments });
}
