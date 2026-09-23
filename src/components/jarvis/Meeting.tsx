"use client";

import { ArrowLeft, ChevronDown, Download, Loader2, Mic, Plus, RefreshCw, Square, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useMeeting } from "@/hooks/useMeeting";
import { MeetingJarvis } from "./MeetingJarvis";
import { meetingFileName, meetingMarkdown, meetingWhen } from "@/lib/meeting/markdown";
import { actionText, clock, type MeetingRecord, type Minutes, speakerName } from "@/lib/meeting/minutes";
import { notify } from "@/lib/notify";
import { newId, savedItems } from "@/lib/savedItems";
import { cn } from "@/lib/utils";

type Archived = { id: string; title: string; startedAt: string; endedAt: string; when: string; participants: string[]; minutes: Minutes; keep: boolean };
type Action = Minutes["actions"][number];

/** Native select styled like the Input (works well on phones). */
const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30";

const CUSTOM = "\u0000custom";

const durationMin = (r: Pick<MeetingRecord, "startedAt" | "endedAt">) => Math.max(1, Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 60_000));

/** Names as removable chips; Enter or a comma adds one. */
function NameTags({ value, onChange, disabled, placeholder }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    const names = text
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const fresh = names.filter((n, i) => !value.includes(n) && names.indexOf(n) === i);
    if (fresh.length) onChange([...value, ...fresh]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
      setDraft("");
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled && "opacity-60",
      )}
    >
      {value.map((name) => (
        <span key={name} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 ps-2.5 pe-1 text-sm">
          {name}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((n) => n !== name))} aria-label={`Odebrat ${name}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          // A pasted "Petr, Jana" becomes two names right away.
          if (v.includes(",")) {
            const parts = v.split(",");
            add(parts.slice(0, -1).join(","));
            setDraft(parts.at(-1) ?? "");
          } else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          add(draft);
          setDraft("");
        }}
        placeholder={value.length ? "" : placeholder}
        aria-label="Přidat účastníka"
        className="min-w-24 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-[15px] leading-relaxed">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** The minutes: overview first, then points, decisions, (actions) and open questions. */
function MinutesView({ m, empty, actions = true, showTitle = false }: { m: Minutes; empty: string; actions?: boolean; showTitle?: boolean }) {
  const nothing = !m.overview && !m.summary.length && !m.decisions.length && !m.actions.length && !m.questions.length;
  if (nothing) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col gap-4">
      {showTitle && m.title && <p className="text-lg font-medium">{m.title}</p>}
      {m.overview && <p className="rounded-xl bg-muted/60 px-4 py-3 text-[15px] leading-relaxed">{m.overview}</p>}
      <Block title={m.overview ? "Hlavní body" : "Shrnutí"} items={m.summary} />
      <Block title="Rozhodnutí" items={m.decisions} />
      {actions && <Block title="Úkoly" items={m.actions.map(actionText)} />}
      <Block title="Otevřené otázky" items={m.questions} />
    </div>
  );
}

/** "0:12 Petr: …" lines, names in bold. */
function TranscriptLines({ r }: { r: Pick<MeetingRecord, "speakers" | "segments"> }) {
  if (!r.segments.length) return <p className="text-sm text-muted-foreground">Přepis je prázdný.</p>;
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {r.segments.map((s, i) => {
        const who = speakerName(r, s.speaker);
        return (
          <p key={i}>
            <span className="me-2 text-xs text-muted-foreground tabular-nums">{clock(s.at)}</span>
            {who && <strong className="me-1 font-semibold">{who}:</strong>}
            {s.text}
          </p>
        );
      })}
    </div>
  );
}

function Collapsible({ label, children, onOpen }: { label: string; children: ReactNode; onOpen?: () => void }) {
  return (
    <details className="group rounded-xl border" onToggle={(e) => (e.currentTarget.open ? onOpen?.() : undefined)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="max-h-[60vh] overflow-y-auto border-t px-4 py-3">{children}</div>
    </details>
  );
}

/** "Mluvčí A → Petr": a participant, or a name typed in. */
function SpeakerRow({ label, name, participants, onChange, onCustomDone }: { label: string; name: string; participants: string[]; onChange: (name: string) => void; onCustomDone: (name: string) => void }) {
  const [custom, setCustom] = useState(false);
  const typed = custom || (!!name && !participants.includes(name));
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2 sm:grid-cols-[6rem_1fr_1fr]">
      <span className="text-sm text-muted-foreground">Mluvčí {label}</span>
      <select
        className={selectClass}
        value={typed ? CUSTOM : name}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
        aria-label={`Kdo je mluvčí ${label}`}
      >
        <option value="">Nevím (Mluvčí {label})</option>
        {participants.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={CUSTOM}>Vlastní jméno…</option>
      </select>
      {typed && (
        <Input
          className="col-span-2 sm:col-span-1"
          value={name}
          autoFocus={custom}
          placeholder="Jméno"
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v) {
              onCustomDone(v);
              setCustom(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** Meeting mode: live transcript and minutes, then review and save to the archive, Keep and Tasks. */
export function Meeting() {
  const meeting = useMeeting();
  const { status, segments, partial, minutes, setMinutes, startedAt, title, setTitle, participants, setParticipants, speakers, setSpeakers } = meeting;
  const [now, setNow] = useState(() => Date.now());
  const [keepReady, setKeepReady] = useState(false);
  const [toKeep, setToKeep] = useState(true);
  /** Action index → left out of Tasks. */
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [archive, setArchive] = useState<Archived[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, MeetingRecord | "loading" | "error">>({});

  const loadArchive = () =>
    fetch("/api/meeting")
      .then((r) => r.json())
      .then((d: { meetings: Archived[] }) => setArchive(d.meetings ?? []))
      .catch(() => undefined);

  // "/meeting?start=1" (Jarvis: "začni meeting") starts recording right away.
  const startMeeting = meeting.start;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("start") !== "1") return;
    window.history.replaceState(null, "", window.location.pathname);
    void startMeeting();
  }, [startMeeting]);

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
  const busy = status === "connecting" || status === "stopping" || status === "processing";
  const working = status === "stopping" || status === "processing";
  const rec = status === "done" ? meeting.record() : null;
  const labels = [...new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s))].sort();

  const setAction = (i: number, patch: Partial<Action>) => setMinutes((m) => ({ ...m, actions: m.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const addAction = () => setMinutes((m) => ({ ...m, actions: [...m.actions, { task: "", owner: null, due: null }] }));
  const removeAction = (i: number) => {
    setMinutes((m) => ({ ...m, actions: m.actions.filter((_, j) => j !== i) }));
    setSkipped((s) => Object.fromEntries(Object.entries(s).flatMap(([k, v]) => (+k === i ? [] : [[+k > i ? +k - 1 : +k, v]]))));
  };
  const addParticipant = (name: string) => setParticipants((p) => (p.includes(name) ? p : [...p, name]));

  /** The record as saved: empty action rows dropped. */
  const finalRecord = (): { record: MeetingRecord; tasks: Action[] } | null => {
    const r = meeting.record();
    if (!r) return null;
    const clean = (a: Action): Action => ({ task: a.task.trim(), owner: a.owner?.trim() || null, due: a.due?.trim() || null });
    const tasks = r.minutes.actions.flatMap((a, i) => (a.task.trim() && !skipped[i] ? [clean(a)] : []));
    const actions = r.minutes.actions.filter((a) => a.task.trim()).map(clean);
    return { record: { ...r, minutes: { ...r.minutes, actions } }, tasks };
  };

  const download = () => {
    const f = finalRecord();
    if (!f) return;
    const url = URL.createObjectURL(new Blob([meetingMarkdown(f.record)], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = meetingFileName(f.record);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const save = async () => {
    const f = finalRecord();
    if (!f) return;
    setSaving(true);
    const res = await fetch("/api/meeting/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...f.record, keep: keepReady && toKeep, tasks: f.tasks }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; record?: MeetingRecord; keep?: boolean; tasks?: number; errors?: string[]; error?: string } | null;
    setSaving(false);
    if (!body?.ok || !body.record) {
      notify(body?.error ?? "Uložení se nepovedlo.", { lead: "Chyba" });
      return;
    }
    const saved = body.record;
    // The minutes also land in Jarvis's saved cards, as a note (without the YAML header).
    const text = meetingMarkdown(saved, { transcript: false }).replace(/^---[\s\S]*?---\n+/, "");
    savedItems.update((list) => [{ id: newId(), intent: "note", summary: `Zápis: ${saved.title}`, text, createdAt: Date.now() }, ...list]);
    const done = [body.keep && "Keep", body.tasks ? `${body.tasks} úkolů do Tasks` : ""].filter(Boolean).join(", ");
    notify(`Zápis uložen${done ? ` (${done})` : ""}.${body.errors?.length ? ` Problém: ${body.errors[0]}` : ""}`);
    meeting.reset();
    setSkipped({});
    void loadArchive();
  };

  const loadFull = (id: string) => {
    if (full[id] && full[id] !== "error") return;
    setFull((f) => ({ ...f, [id]: "loading" }));
    fetch(`/api/meeting/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<MeetingRecord>) : Promise.reject(new Error())))
      .then((m) => setFull((f) => ({ ...f, [id]: m })))
      .catch(() => setFull((f) => ({ ...f, [id]: "error" })));
  };

  const ownerOptions = (owner: string | null) => (owner && !participants.includes(owner) ? [...participants, owner] : participants);

  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 pt-[5vh] pb-24">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Zpět na Jarvise">
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Meeting</h1>
          <p className="text-sm text-muted-foreground">Jarvis poslouchá a průběžně píše zápis. Může být i účastníkem a odpovídat.</p>
        </div>
        {status !== "idle" && status !== "done" && (
          <Button
            size="lg"
            onClick={() => void meeting.stop()}
            disabled={!live}
            className={cn("min-w-32 sm:min-w-36", live && "bg-red-600 text-white hover:bg-red-700")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
            {status === "connecting" ? "Připojuji…" : working ? "Dokončuji…" : `Konec · ${clock(elapsed)}`}
          </Button>
        )}
      </header>

      {meeting.error && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{meeting.error}</p>}

      {/* Always mounted, so a Jarvis session never outlives the meeting; hidden on the review screen. */}
      <div hidden={status !== "idle" && status !== "connecting" && !live}>
        <MeetingJarvis meeting={meeting} />
      </div>

      {/* Before the start: name and who is there. */}
      {(status === "idle" || status === "connecting") && (
        <section aria-label="Nový meeting" className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Název meetingu</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vymyslí se podle obsahu" disabled={status === "connecting"} />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Účastníci</span>
            <NameTags value={participants} onChange={setParticipants} disabled={status === "connecting"} placeholder="Jméno, potvrď Enterem nebo čárkou" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => void meeting.start()} disabled={status === "connecting"} className="min-w-40">
              {status === "connecting" ? <Loader2 className="animate-spin" /> : <Mic />}
              {status === "connecting" ? "Připojuji…" : "Začít meeting"}
            </Button>
            <p className="text-xs text-muted-foreground">Datum a čas se zapíšou automaticky při startu.</p>
          </div>
        </section>
      )}

      {/* While it runs: compact, still editable header. */}
      {(live || working) && (
        <section aria-label="Údaje o meetingu" className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Název (vymyslí se podle obsahu)" disabled={working} className="font-medium sm:flex-1" aria-label="Název meetingu" />
            {startedAt && <span className="text-sm text-muted-foreground">{meetingWhen(new Date(startedAt).toISOString())}</span>}
          </div>
          <NameTags value={participants} onChange={setParticipants} disabled={working} placeholder="Účastníci" />
        </section>
      )}

      {working && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 shadow-sm">
          <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          <div>
            <p className="font-medium">{meeting.step ?? "Dokončuji přepis…"}</p>
            <p className="text-sm text-muted-foreground">Může to chvíli trvat, nech stránku otevřenou.</p>
          </div>
        </div>
      )}

      {(live || working) && (
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
            <MinutesView m={minutes} empty={live ? "Zápis se objeví během první minuty." : "Zatím nic."} showTitle />
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

      {/* Review and save. */}
      {status === "done" && rec && (
        <>
          <section aria-label="Údaje o meetingu" className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Název meetingu</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={minutes.title || "Meeting"} className="text-lg font-medium md:text-base" />
            </label>
            <p className="text-sm text-muted-foreground">
              {meetingWhen(rec.startedAt)} · {durationMin(rec)} min
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Účastníci</span>
              <NameTags value={participants} onChange={setParticipants} placeholder="Jméno, potvrď Enterem nebo čárkou" />
            </div>
          </section>

          <section aria-label="Kdo mluvil" className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="font-medium">Kdo mluvil</h2>
            {labels.length ? (
              <>
                <p className="text-sm text-muted-foreground">Jarvis jména odhadl podle obsahu, oprav je, pokud nesedí.</p>
                {labels.map((l) => (
                  <SpeakerRow
                    key={l}
                    label={l}
                    name={speakers[l] ?? ""}
                    participants={participants}
                    onChange={(name) =>
                      setSpeakers((s) => {
                        const next = { ...s };
                        if (name) next[l] = name;
                        else delete next[l];
                        return next;
                      })
                    }
                    onCustomDone={addParticipant}
                  />
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Rozlišení mluvčích nebylo k dispozici, přepis bude bez jmen.</p>
            )}
          </section>

          <section aria-label="Souhrnný zápis" className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="font-medium">Souhrnný zápis</h2>
            <MinutesView m={minutes} empty="Zápis je prázdný." actions={false} />
          </section>

          <section aria-label="Úkoly" className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <div>
              <h2 className="font-medium">Úkoly</h2>
              <p className="text-sm text-muted-foreground">
                Zaškrtnuté se uloží do Google Tasks jako podúkoly pod „Meeting: {rec.title} ({new Date(rec.startedAt).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" })})“.
              </p>
            </div>
            {minutes.actions.length === 0 && <p className="text-sm text-muted-foreground">Žádné úkoly.</p>}
            {minutes.actions.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border p-3">
                <Checkbox
                  checked={!skipped[i]}
                  onCheckedChange={(v) => setSkipped((s) => ({ ...s, [i]: v !== true }))}
                  className="mt-2.5"
                  aria-label="Uložit do Google Tasks"
                />
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_9rem_9rem]">
                  <Input value={a.task} onChange={(e) => setAction(i, { task: e.target.value })} placeholder="Co udělat" aria-label="Úkol" className="sm:col-span-3" />
                  <select className={selectClass} value={a.owner ?? ""} onChange={(e) => setAction(i, { owner: e.target.value || null })} aria-label="Kdo">
                    <option value="">Nikdo</option>
                    {ownerOptions(a.owner).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <Input value={a.due ?? ""} onChange={(e) => setAction(i, { due: e.target.value || null })} placeholder="Termín" aria-label="Termín" />
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => removeAction(i)} aria-label="Smazat úkol" className="mt-0.5 text-muted-foreground">
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addAction} className="self-start">
              <Plus /> Přidat úkol
            </Button>
          </section>

          <Collapsible label={`Celý přepis (${segments.length})`}>
            <TranscriptLines r={{ speakers, segments }} />
          </Collapsible>

          <section aria-label="Uložení" className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
            <label className={cn("flex items-center gap-3 text-sm", !keepReady && "text-muted-foreground")}>
              <Checkbox checked={keepReady && toKeep} disabled={!keepReady} onCheckedChange={(v) => setToKeep(v === true)} />
              Zápis do Google Keep{!keepReady && " (Keep není připojený)"}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="animate-spin" />} Uložit
              </Button>
              <Button variant="outline" onClick={download} disabled={saving}>
                <Download /> Stáhnout .md
              </Button>
              <Button variant="ghost" onClick={() => meeting.reset()} disabled={saving}>
                Zahodit
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Zápis se vždy uloží i do archivu na serveru a do uložených karet v Jarvisovi.</p>
          </section>
        </>
      )}

      {archive.length > 0 && (
        <section aria-label="Archiv" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Minulé meetingy</h2>
          {archive.map((m) => {
            const f = full[m.id];
            return (
              <div key={m.id} className="rounded-xl border">
                <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-start text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">{m.title}</span>
                    <span className="block text-muted-foreground">
                      {m.when}
                      {m.participants.length > 0 && ` · ${m.participants.join(", ")}`}
                    </span>
                  </span>
                  <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open === m.id && "rotate-180")} />
                </button>
                {open === m.id && (
                  <div className="flex flex-col gap-4 border-t px-4 py-4">
                    <MinutesView m={m.minutes} empty="Zápis je prázdný." />
                    <Collapsible label="Celý přepis" onOpen={() => loadFull(m.id)}>
                      {f === "loading" || !f ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" /> Načítám…
                        </p>
                      ) : f === "error" ? (
                        <p className="text-sm text-muted-foreground">Přepis se nepodařilo načíst.</p>
                      ) : (
                        <TranscriptLines r={f} />
                      )}
                    </Collapsible>
                    <Button asChild variant="outline" size="sm" className="self-start">
                      <a href={`/api/meeting/${encodeURIComponent(m.id)}?format=md`} download>
                        <Download /> Stáhnout .md
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
