"use client";

import { ArrowLeft, Loader2, Mic, RefreshCw, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useMeeting } from "@/hooks/useMeeting";
import { actionText, type Minutes } from "@/lib/meeting/minutes";
import { notify } from "@/lib/notify";
import { newId, savedItems } from "@/lib/savedItems";
import { cn } from "@/lib/utils";

type Archived = { id: string; startedAt: string; title: string; text: string; keep: boolean };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function MinutesView({ m, empty }: { m: Minutes; empty: string }) {
  const block = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-[15px] leading-relaxed">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  if (!m.title && !m.summary.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col gap-4">
      {m.title && <p className="text-lg font-medium">{m.title}</p>}
      {block("Shrnutí", m.summary)}
      {block("Rozhodnutí", m.decisions)}
      {block("Úkoly", m.actions.map(actionText))}
      {block("Otevřené otázky", m.questions)}
    </div>
  );
}

/** Meeting mode: live transcript and minutes, then save to Keep, Tasks and the archive. */
export function Meeting() {
  const meeting = useMeeting();
  const { status, segments, partial, minutes, startedAt } = meeting;
  const [now, setNow] = useState(() => Date.now());
  const [keepReady, setKeepReady] = useState(false);
  const [toKeep, setToKeep] = useState(true);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [archive, setArchive] = useState<Archived[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const loadArchive = () =>
    fetch("/api/meeting")
      .then((r) => r.json())
      .then((d: { meetings: Archived[] }) => setArchive(d.meetings))
      .catch(() => undefined);

  useEffect(() => {
    void loadArchive();
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((s: { keep?: boolean }) => setKeepReady(!!s.keep))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (status !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const live = status === "live";
  const busy = status === "connecting" || status === "stopping";

  const save = async () => {
    if (!startedAt) return;
    setSaving(true);
    const tasks = minutes.actions.filter((_, i) => picked[i] ?? true);
    const res = await fetch("/api/meeting/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}`,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        transcript: segments.map((s) => `[${clock(s.at)}] ${s.text}`).join("\n"),
        minutes,
        keep: keepReady && toKeep,
        tasks,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { text?: string; keep?: boolean; tasks?: number; errors?: string[]; error?: string };
    setSaving(false);
    if (!body.text) {
      notify(body.error ?? "Uložení se nepovedlo.", { lead: "Chyba" });
      return;
    }
    // The minutes also land in Jarvis's saved cards, as a note.
    savedItems.update((list) => [{ id: newId(), intent: "note", summary: `Zápis: ${minutes.title || "meeting"}`, text: body.text!, createdAt: Date.now() }, ...list]);
    const done = [body.keep && "Keep", body.tasks ? `${body.tasks} úkolů do Tasks` : ""].filter(Boolean).join(", ");
    notify(`Zápis uložen${done ? ` (${done})` : ""}.${body.errors?.length ? ` Problém: ${body.errors[0]}` : ""}`);
    meeting.reset();
    setPicked({});
    void loadArchive();
  };

  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 pt-[5vh] pb-24">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Zpět na Jarvise">
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Meeting</h1>
          <p className="text-sm text-muted-foreground">Jarvis poslouchá a průběžně píše zápis. Nemluví do toho.</p>
        </div>
        {status !== "done" && (
          <Button
            size="lg"
            onClick={() => (live ? void meeting.stop() : void meeting.start())}
            disabled={busy}
            className={cn("min-w-36", live && "bg-red-600 text-white hover:bg-red-700")}
          >
            {busy ? <Loader2 className="animate-spin" /> : live ? <Square className="fill-current" /> : <Mic />}
            {status === "connecting" ? "Připojuji…" : status === "stopping" ? "Dokončuji…" : live ? `Konec · ${clock(elapsed)}` : "Začít meeting"}
          </Button>
        )}
      </header>

      {meeting.error && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{meeting.error}</p>}

      {status !== "idle" && (
        <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
          <section aria-label="Zápis" className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Zápis</h2>
              {live && (
                <Button variant="ghost" size="sm" onClick={() => void meeting.updateMinutes()} disabled={meeting.updating}>
                  <RefreshCw className={cn(meeting.updating && "animate-spin")} /> {meeting.updating ? "Aktualizuji…" : "Aktualizovat"}
                </Button>
              )}
            </div>
            <MinutesView m={minutes} empty={live ? "Zápis se objeví během první minuty." : "Zatím nic."} />
          </section>

          <section aria-label="Přepis" className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-2xl border p-5 text-sm">
            <h2 className="font-medium">Přepis</h2>
            {segments.map((s, i) => (
              <p key={i}>
                <span className="me-2 text-xs text-muted-foreground tabular-nums">{clock(s.at)}</span>
                {s.text}
              </p>
            ))}
            {partial && <p className="text-muted-foreground">{partial}</p>}
            {!segments.length && !partial && <p className="text-muted-foreground">{live ? "Poslouchám…" : ""}</p>}
          </section>
        </div>
      )}

      {status === "done" && (
        <section aria-label="Uložení" className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="font-medium">Uložit zápis</h2>
          {minutes.actions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Úkoly do Google Tasks:</p>
              {minutes.actions.map((a, i) => (
                <label key={i} className="flex items-start gap-3 text-sm">
                  <Checkbox checked={picked[i] ?? true} onCheckedChange={(v) => setPicked((p) => ({ ...p, [i]: v === true }))} className="mt-0.5" />
                  <span>{actionText(a)}</span>
                </label>
              ))}
            </div>
          )}
          <label className={cn("flex items-center gap-3 text-sm", !keepReady && "text-muted-foreground")}>
            <Checkbox checked={keepReady && toKeep} disabled={!keepReady} onCheckedChange={(v) => setToKeep(v === true)} />
            Zápis do Google Keep{!keepReady && " (Keep není připojený)"}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Uložit
            </Button>
            <Button variant="ghost" onClick={() => meeting.reset()} disabled={saving}>
              Zahodit
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Zápis se vždy uloží i do archivu na serveru a do uložených karet v Jarvisovi.</p>
        </section>
      )}

      {archive.length > 0 && (
        <section aria-label="Archiv" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Minulé meetingy</h2>
          {archive.map((m) => (
            <div key={m.id} className="rounded-xl border">
              <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className="flex w-full items-center justify-between px-4 py-3 text-start text-sm">
                <span className="font-medium">{m.title}</span>
                <span className="text-muted-foreground">{new Date(m.startedAt).toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" })}</span>
              </button>
              {open === m.id && <pre className="border-t px-4 py-3 font-sans text-sm whitespace-pre-wrap">{m.text}</pre>}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
