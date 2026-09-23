import { actionText, clock, type MeetingRecord, speakerName } from "./minutes";

/** Date and time as the user reads them. */
export const meetingWhen = (iso: string) => new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "long", timeStyle: "short" });

/** Obsidian-ready note: YAML frontmatter, the minutes, the full transcript at the end. */
export function meetingMarkdown(r: MeetingRecord, { transcript: withTranscript = true } = {}) {
  const m = r.minutes;
  const yaml = (s: string) => JSON.stringify(s);
  const minutesLen = Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 60_000);
  const list = (title: string, items: string[]) => (items.length ? `## ${title}\n\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  const actions = m.actions.length ? `## Úkoly\n\n${m.actions.map((a) => `- [ ] ${actionText(a)}`).join("\n")}\n` : "";
  const transcript = withTranscript && r.segments.length
    ? `## Celý přepis\n\n${r.segments
        .map((s) => {
          const who = speakerName(r, s.speaker);
          return `**${clock(s.at)}**${who ? ` **${who}:**` : ""} ${s.text}`;
        })
        .join("\n\n")}\n`
    : "";
  const frontmatter = [
    "---",
    `title: ${yaml(r.title || m.title || "Meeting")}`,
    `date: ${r.startedAt.slice(0, 10)}`,
    `start: ${yaml(r.startedAt)}`,
    `duration_min: ${Math.max(0, minutesLen)}`,
    `participants: [${r.participants.map(yaml).join(", ")}]`,
    "tags: [meeting, jarvis]",
    "---",
  ].join("\n");
  const head = [`**Kdy:** ${meetingWhen(r.startedAt)} (${Math.max(1, minutesLen)} min)`, r.participants.length ? `**Účastníci:** ${r.participants.map((p) => `[[${p}]]`).join(", ")}` : ""]
    .filter(Boolean)
    .join("  \n");
  // Blocks separated by one blank line, as Obsidian expects.
  return [
    frontmatter,
    `# ${r.title || m.title || "Meeting"}`,
    head,
    m.overview ? `## Shrnutí\n\n${m.overview}` : "",
    list(m.overview ? "Hlavní body" : "Shrnutí", m.summary),
    list("Rozhodnutí", m.decisions),
    actions,
    list("Otevřené otázky", m.questions),
    transcript,
  ]
    .map((b) => b.trim())
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

/** A safe file name for the download: "2026-09-23 Spuštění e-shopu.md". */
export const meetingFileName = (r: MeetingRecord) =>
  `${r.startedAt.slice(0, 10)} ${(r.title || r.minutes.title || "Meeting").replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim()}.md`;
