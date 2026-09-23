import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Minutes, minutesSchema } from "./minutes";

/** Meeting archive: data/meetings/<id>.json (gitignored), transcript + minutes. */
export type Meeting = { id: string; startedAt: string; endedAt: string; transcript: string; minutes: Minutes; keepNote?: string };

const DIR = join(process.cwd(), "data", "meetings");

export async function saveMeeting(m: Meeting) {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${m.id.replace(/[^\w-]/g, "")}.json`), JSON.stringify(m, null, 2), { mode: 0o600 });
}

export async function listMeetings(): Promise<Meeting[]> {
  const files = await readdir(DIR).catch(() => [] as string[]);
  const all = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          const m = JSON.parse(await readFile(join(DIR, f), "utf8")) as Meeting;
          return { ...m, minutes: minutesSchema.parse(m.minutes) };
        } catch {
          return null;
        }
      }),
  );
  return all.filter((m): m is Meeting => !!m).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
