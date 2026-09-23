import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { questions } from "../src/lib/jev/questions";
const c = new TypeSafeClient({ defaultModel: "jev-1.13.0", retry: { maxRetries: 0 }, timeout: 4000 });
const action = choice("What does the person want the assistant to do right now", {
  create: "Write down or calculate something new: an event, reminder, list, expense, timer, conversion, note",
  update: "Change the item that is already shown, e.g. move it to another day, add or remove something",
  save: "Confirm or save the item that is shown",
  discard: "Cancel, delete or throw away the item that is shown",
  ask: "Ask a question or request information that needs looking up or thinking",
  chat: "Greeting, thanks or small talk with no task",
});
const tests = ["Jarvisi, zapiš mi večeři s Petrem v pátek v osm večer přes zoom", "posuň to na sobotu", "přidej tam ještě máslo", "díky, ulož to", "ne, to zruš", "jaké bude zítra počasí v Praze?", "ahoj Jarvisi, jak se máš", "kolik je 15 % z 2400", "připomeň mi zítra zavolat mámě", "vlastně to dej až na devátou"];
for (const t of tests) {
  const s = performance.now();
  const r = await c.systemOne({ state: { text: t }, questions: { ...questions, action } });
  console.log(`${Math.round(performance.now() - s)}ms  ${r.answers.action.choice.padEnd(8)} ${r.answers.action.confidence.toFixed(2)}  ${r.answers.intent.choice.padEnd(9)} ${t}`);
}
