"use client";

import { ArrowLeft, KeyRound, Loader2, Pencil, Plug, Plus, Server, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/lib/notify";
import type { PublicSettings } from "@/lib/settings";
import { CONNECTORS, type ConnectorId, DEFAULT_AGENT_MODEL, VOICES } from "@/lib/settings-shared";
import { cn } from "@/lib/utils";

type McpItem = PublicSettings["mcp"][number] & { clearAuthorization?: boolean };
type State = Omit<PublicSettings, "mcp"> & { mcp: McpItem[] };
type TestResult = { pending: true } | { ok: true; tools: string[] } | { ok: false; error: string };

type Draft = {
  id: string;
  isNew: boolean;
  kind: "url" | "connector";
  label: string;
  description: string;
  url: string;
  connectorId: ConnectorId;
  /** Masked stored token ("••••abcd") or "". */
  storedToken: string;
  token: string;
  clearToken: boolean;
  headers: { key: string; value: string }[];
  allowedTools: string;
  enabled: boolean;
};

const blankDraft = (): Draft => ({
  id: crypto.randomUUID(),
  isNew: true,
  kind: "url",
  label: "",
  description: "",
  url: "",
  connectorId: "connector_googlecalendar",
  storedToken: "",
  token: "",
  clearToken: false,
  headers: [],
  allowedTools: "",
  enabled: true,
});

const toDraft = (s: McpItem): Draft => ({
  id: s.id,
  isNew: false,
  kind: s.kind,
  label: s.label,
  description: s.description,
  url: s.url ?? "",
  connectorId: s.connectorId ?? "connector_googlecalendar",
  storedToken: s.clearAuthorization ? "" : (s.authorization ?? ""),
  token: "",
  clearToken: false,
  headers: Object.entries(s.headers).map(([key, value]) => ({ key, value })),
  allowedTools: s.allowedTools.join(", "),
  enabled: s.enabled,
});

const fromDraft = (d: Draft, prev?: McpItem): McpItem => {
  const cleared = d.clearToken || (!!prev?.clearAuthorization && !d.token);
  return {
    id: d.id,
    kind: d.kind,
    label: d.label.trim(),
    description: d.description.trim(),
    url: d.kind === "url" ? d.url.trim() : undefined,
    connectorId: d.kind === "connector" ? d.connectorId : undefined,
    // Empty or masked token = the server keeps the stored one.
    authorization: d.token.trim() || (cleared ? "" : d.storedToken),
    clearAuthorization: cleared && !d.token.trim() ? true : undefined,
    headers: d.kind === "url" ? Object.fromEntries(d.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])) : {},
    allowedTools: d.allowedTools
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    enabled: d.enabled,
  };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !("ok" in data)) throw new Error(data.error ?? `Chyba ${res.status}`);
  return data as T;
}

export function Settings() {
  const [settings, setSettings] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    api<PublicSettings>("/api/settings")
      .then(setSettings)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const update = (patch: Partial<State>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };
  const updateServers = (fn: (list: McpItem[]) => McpItem[]) => {
    setSettings((s) => (s ? { ...s, mcp: fn(s.mcp) } : s));
    setDirty(true);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(next);
      setDirty(false);
      notify("Nastavení uloženo.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Uložení se nepovedlo.", { lead: "Chyba" });
    } finally {
      setSaving(false);
    }
  };

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { pending: true } }));
    try {
      const result = await api<{ ok: true; tools: string[] } | { ok: false; error: string }>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      setTests((t) => ({ ...t, [id]: result }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: e instanceof Error ? e.message : "Test selhal." } }));
    }
  };

  const applyDraft = () => {
    if (!draft) return;
    updateServers((list) => {
      const prev = list.find((s) => s.id === draft.id);
      const next = fromDraft(draft, prev);
      return prev ? list.map((s) => (s.id === draft.id ? next : s)) : [...list, next];
    });
    setTests((t) => {
      const rest = { ...t };
      delete rest[draft.id];
      return rest;
    });
    setDraft(null);
  };

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pt-[6vh] pb-28">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Zpět na Jarvise">
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nastavení</h1>
          <p className="text-sm text-muted-foreground">Hlas, model a nástroje, které Jarvis může použít.</p>
        </div>
      </header>

      {!settings ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {loadError ? (
            `Nastavení se nepodařilo načíst: ${loadError}`
          ) : (
            <>
              <Loader2 className="size-4 animate-spin" /> Načítám…
            </>
          )}
        </p>
      ) : (
        <>
          <Section title="Hlas" hint="Jakým hlasem Jarvis mluví. Projeví se v dalším rozhovoru.">
            <Select value={settings.voice} onValueChange={(voice) => update({ voice: voice as State["voice"] })}>
              <SelectTrigger className="w-full sm:w-60" aria-label="Hlas">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section title="Model pro otázky a MCP" hint="Model, který odpovídá na otázky a pracuje s MCP servery, když na to nestačí karta.">
            <Input
              value={settings.agentModel}
              onChange={(e) => update({ agentModel: e.target.value })}
              placeholder={DEFAULT_AGENT_MODEL}
              aria-label="Model"
              className="font-mono sm:w-60"
              spellCheck={false}
            />
          </Section>

          <Section
            title="MCP servery"
            hint="Nástroje z těchto serverů může Jarvis použít. Podle popisu se rozhoduje, kdy který server zavolat."
            action={
              <Button variant="outline" size="sm" onClick={() => setDraft(blankDraft())}>
                <Plus /> Přidat server
              </Button>
            }
          >
            {settings.mcp.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Zatím žádný server.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {settings.mcp.map((s) => (
                  <ServerCard
                    key={s.id}
                    server={s}
                    result={tests[s.id]}
                    canTest={!dirty}
                    onToggle={(enabled) => updateServers((list) => list.map((x) => (x.id === s.id ? { ...x, enabled } : x)))}
                    onTest={() => test(s.id)}
                    onEdit={() => setDraft(toDraft(s))}
                    onDelete={() => updateServers((list) => list.filter((x) => x.id !== s.id))}
                  />
                ))}
              </ul>
            )}
            {dirty && settings.mcp.length > 0 && <p className="text-xs text-muted-foreground">Otestovat jde až uložené nastavení.</p>}
          </Section>
        </>
      )}

      {settings && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3 pb-[env(safe-area-inset-bottom)]">
          {dirty && <span className="text-sm text-muted-foreground">Neuložené změny</span>}
          <Button onClick={save} disabled={!dirty || saving} size="lg" className="px-5 shadow-sm">
            {saving && <Loader2 className="animate-spin" />}
            Uložit
          </Button>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          {draft && <ServerForm draft={draft} onChange={setDraft} onSubmit={applyDraft} onCancel={() => setDraft(null)} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        checked ? "bg-brand" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("size-5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

function ServerCard({
  server: s,
  result,
  canTest,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: {
  server: McpItem;
  result?: TestResult;
  canTest: boolean;
  onToggle: (v: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = s.kind === "connector" ? Plug : Server;
  const target = s.kind === "connector" ? (s.connectorId ? CONNECTORS[s.connectorId] : "konektor") : s.url;
  const pending = !!result && "pending" in result;
  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border px-4 py-3", !s.enabled && "opacity-70")}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{s.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {s.kind === "connector" ? "Konektor OpenAI" : "Vlastní MCP server"} · {target}
            {s.authorization && !s.clearAuthorization && (
              <>
                {" "}
                · <KeyRound className="inline size-3 align-[-1px]" /> {s.authorization}
              </>
            )}
          </p>
          {s.description && <p className="mt-1 text-sm text-pretty text-muted-foreground">{s.description}</p>}
        </div>
        <Toggle checked={s.enabled} onChange={onToggle} label={s.enabled ? "Vypnout server" : "Zapnout server"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onTest} disabled={!canTest || pending}>
          {pending && <Loader2 className="animate-spin" />}
          Otestovat
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil /> Upravit
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2 /> Smazat
        </Button>
      </div>
      {result && !pending && (
        <div className={cn("rounded-lg px-3 py-2 text-sm", result.ok ? "bg-muted" : "bg-destructive/10 text-destructive")}>
          {result.ok ? (
            result.tools.length ? (
              <>
                <span className="text-muted-foreground">Nástroje ({result.tools.length}): </span>
                <span className="font-mono text-[13px] break-words">{result.tools.join(", ")}</span>
              </>
            ) : (
              "Spojení funguje, ale server nenabízí žádné nástroje."
            )
          ) : (
            <span className="break-words">{result.error}</span>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ServerForm({ draft: d, onChange, onSubmit, onCancel }: { draft: Draft; onChange: (d: Draft) => void; onSubmit: () => void; onCancel: () => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const setHeader = (i: number, patch: Partial<Draft["headers"][number]>) => set({ headers: d.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const urlValid = (() => {
    try {
      return /^https?:$/.test(new URL(d.url.trim()).protocol);
    } catch {
      return false;
    }
  })();
  const valid = !!d.label.trim() && (d.kind === "connector" || urlValid);
  const hasStored = !!d.storedToken && !d.clearToken;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{d.isNew ? "Přidat server" : "Upravit server"}</DialogTitle>
        <DialogDescription>Změny se projeví po uložení nastavení.</DialogDescription>
      </DialogHeader>

      <Field label="Typ">
        <Select value={d.kind} onValueChange={(kind) => set({ kind: kind as Draft["kind"] })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="url">Vlastní MCP server (URL)</SelectItem>
            <SelectItem value="connector">Konektor OpenAI</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {d.kind === "connector" && (
        <>
          <Field label="Konektor">
            <Select value={d.connectorId} onValueChange={(connectorId) => set({ connectorId: connectorId as ConnectorId })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(CONNECTORS) as [ConnectorId, string][]).map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-pretty text-muted-foreground">
            Konektory OpenAI potřebují OAuth access token dané služby (třeba od Googlu). Ten po čase vyprší a bude potřeba ho vložit znovu. Pro trvalé
            napojení je lepší vlastní MCP server.
          </p>
        </>
      )}

      <Field label="Název">
        <Input value={d.label} onChange={(e) => set({ label: e.target.value })} maxLength={64} placeholder="Třeba Domácnost" required />
      </Field>

      <Field label="Popis" hint="K čemu server slouží. Jarvis se podle toho rozhoduje, kdy ho použít.">
        <Textarea value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} rows={2} placeholder="Ovládání světel a termostatu doma." />
      </Field>

      {d.kind === "url" && (
        <Field label="URL">
          <Input
            type="url"
            value={d.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://mcp.example.com/mcp"
            aria-invalid={!!d.url && !urlValid}
            spellCheck={false}
            required
          />
        </Field>
      )}

      <Field label="Token" hint={d.kind === "connector" ? "OAuth access token služby." : "Posílá se jako Bearer token. Nepovinné."}>
        <div className="flex gap-2">
          <Input
            type="password"
            value={d.token}
            onChange={(e) => set({ token: e.target.value })}
            placeholder={hasStored ? `ponechat (${d.storedToken})` : d.clearToken ? "token bude smazán" : ""}
            autoComplete="off"
            spellCheck={false}
          />
          {(d.storedToken || d.clearToken) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => set(d.clearToken ? { clearToken: false } : { clearToken: true, token: "" })}
            >
              {d.clearToken ? "Vrátit" : "Smazat token"}
            </Button>
          )}
        </div>
      </Field>

      {d.kind === "url" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Hlavičky</span>
          {d.headers.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input value={h.key} onChange={(e) => setHeader(i, { key: e.target.value })} placeholder="Název" aria-label="Název hlavičky" className="w-2/5" spellCheck={false} />
              <Input
                type="password"
                value={h.value}
                onChange={(e) => setHeader(i, { value: e.target.value })}
                placeholder="Hodnota"
                aria-label="Hodnota hlavičky"
                autoComplete="off"
              />
              <Button type="button" variant="ghost" size="icon" aria-label="Odebrat hlavičku" onClick={() => set({ headers: d.headers.filter((_, j) => j !== i) })}>
                <X />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => set({ headers: [...d.headers, { key: "", value: "" }] })}>
            <Plus /> Přidat hlavičku
          </Button>
        </div>
      )}

      <Field label="Povolené nástroje" hint="Názvy oddělené čárkami. Prázdné = všechny.">
        <Input value={d.allowedTools} onChange={(e) => set({ allowedTools: e.target.value })} placeholder="search, get_events" spellCheck={false} />
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Zrušit
        </Button>
        <Button type="submit" disabled={!valid}>
          {d.isNew ? "Přidat" : "Použít"}
        </Button>
      </DialogFooter>
    </form>
  );
}
