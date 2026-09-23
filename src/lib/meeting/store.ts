import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { meetingMarkdown } from "./markdown";
import { type MeetingRecord, minutesSchema, type Segment } from "./minutes";

/** Meeting archive: data/meetings/<id>.json and an Obsidian-ready <id>.md (gitignored). */
const DIR = join(process.cwd(), "data", "meetings");
const safe = (id: string) => id.replace(/[^\w-]/g, "");

export async function saveMeeting(m: MeetingRecord) {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${safe(m.id)}.json`), JSON.stringify(m, null, 2), { mode: 0o600 });
  await writeFile(join(DIR, `${safe(m.id)}.md`), meetingMarkdown(m), { mode: 0o600 });
}

/** Older archives kept the transcript as one string; read them as segments. */
function upgrade(raw: MeetingRecord & { transcript?: string }): MeetingRecord {
  const segments: Segment[] =
    raw.segments ??
    (raw.transcript ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^\[(\d+):(\d+)\]\s*(.*)$/);
        return { at: m ? Number(m[1]) * 60 + Number(m[2]) : 0, text: m ? m[3] : line, speaker: null };
      });
  const minutes = minutesSchema.parse(raw.minutes);
  return { ...raw, title: raw.title || minutes.title, participants: raw.participants ?? [], speakers: raw.speakers ?? {}, segments, minutes };
}

export async function getMeeting(id: string): Promise<MeetingRecord | null> {
  try {
    return upgrade(JSON.parse(await readFile(join(DIR, `${safe(id)}.json`), "utf8")));
  } catch {
    return null;
  }
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  const files = await readdir(DIR).catch(() => [] as string[]);
  const all = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => getMeeting(f.slice(0, -5))));
  return all.filter((m): m is MeetingRecord => !!m).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
