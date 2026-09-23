// Jev with context: does it get "to" / "tam" and where things go? npx tsx --conditions=react-server scripts/jev-context-probe.mts
import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { questions } from "../src/lib/jev/questions";

const extra = {
  target: choice("Where does the person want the item to be kept", {
    calendar: "In the calendar, as an event at a time",
    tasks: "In the task list, as a to-do",
    notes: "In notes",
    unspecified: "Not said",
  }),
  aboutShown: noul("The person is talking about the item that is already shown on the screen (it, that, the card), not a new one"),
  hangUp: noul("The person wants to end the conversation with the assistant right now"),
  confirm: noul("The person says yes / agrees to what the assistant just proposed or asked"),
};
const c = new TypeSafeClient({ defaultModel: "jev-1.13.0", retry: { maxRetries: 0 }, timeout: 5000 });
const shown = "Na obrazovce je připomínka „zítra vyzvednout Alza box“.";
const cases: [string, string][] = [
  ["hoď to do toho kalendáře", shown],
  ["šoupni to radši do kalendáře", shown],
  ["jo, přidej to", shown],
  ["tak to tam dej", shown],
  ["ne, tohle nechci", shown],
  ["a zítra ve tři zubař", shown],
  ["dej mi do kalendáře zítra oběd s Janou", ""],
  ["zapiš si, že musím koupit dárek", ""],
  ["tak díky, to by bylo všechno", ""],
  ["můžeš jít", ""],
  ["jo, smaž to", "Jarvis se zeptal: Mám smazat zítřejší poradu?"],
];
for (const [text, context] of cases) {
  const s = performance.now();
  const r = await c.systemOne({ state: context ? { context, text } : { text }, questions: { ...questions, ...extra } });
  const a = r.answers;
  console.log(
    `${Math.round(performance.now() - s)}ms ${a.action.choice.padEnd(7)} ${a.intent.choice.padEnd(8)} cíl:${a.target.choice.padEnd(11)}${a.target.confidence.toFixed(2)} karta:${a.aboutShown.noul.toFixed(2)} konec:${a.hangUp.noul.toFixed(2)} ano:${a.confirm.noul.toFixed(2)}  ${text}`,
  );
}
