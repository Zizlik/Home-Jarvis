// Prints the Obsidian note for a sample meeting: npx tsx scripts/meeting-md-probe.mts
import { meetingMarkdown } from "../src/lib/meeting/markdown";

console.log(
  meetingMarkdown({
    id: "x",
    title: "Spuštění e-shopu",
    startedAt: "2026-09-23T12:00:00.000Z",
    endedAt: "2026-09-23T12:25:00.000Z",
    participants: ["Petr", "Jana"],
    speakers: { A: "Petr", B: "Jana" },
    segments: [
      { at: 0, text: "Ahoj, dneska probereme spuštění e-shopu.", speaker: "A" },
      { at: 7, text: "Web je skoro hotový.", speaker: "B" },
    ],
    minutes: { title: "", overview: "Krátký souhrn.", summary: ["Bod jedna"], decisions: ["Comgate"], actions: [{ task: "Nastavit bránu", owner: "Jana", due: "do pátku" }], questions: [] },
  }),
);
