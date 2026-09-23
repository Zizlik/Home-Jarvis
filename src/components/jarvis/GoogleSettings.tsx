"use client";

import { Loader2, LogOut, NotebookPen, Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GoogleSyncPrefs } from "@/lib/google/cards";
import { notify } from "@/lib/notify";

type Status = { configured: boolean; connected: boolean; email: string | null; keep: boolean };

const REASONS: Record<string, string> = {
  access_denied: "přístup nebyl povolen",
  state: "vypršelo přihlášení, zkus to znovu",
  admin_policy_enforced: "správce domény tuhle aplikaci zatím nepovolil",
};

/** Google sign-in and where saved cards are also written. `value`/`onChange` are part of the page's settings. */
export function GoogleSettings({ value, onChange }: { value: GoogleSyncPrefs; onChange: (patch: Partial<GoogleSyncPrefs>) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, connected: false, email: null, keep: false }));
    // Back from Google's consent screen.
    const q = new URLSearchParams(window.location.search);
    const result = q.get("google");
    if (result) {
      const reason = q.get("reason") ?? "";
      notify(result === "ok" ? "Google připojen." : `Google se nepodařilo připojit: ${REASONS[reason] ?? reason}`, { id: "google" });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const disconnect = async () => {
    setBusy(true);
    await fetch("/api/google/disconnect", { method: "POST" }).catch(() => undefined);
    setStatus((s) => (s ? { ...s, connected: false, email: null, keep: false } : s));
    setBusy(false);
  };

  if (!status) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </p>
    );
  }
  if (!status.configured) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">
        Chybí přihlašovací údaje aplikace. Na serveru doplň <code className="font-mono">GOOGLE_CLIENT_ID</code> a <code className="font-mono">GOOGLE_CLIENT_SECRET</code> do{" "}
        <code className="font-mono">.env.local</code> a restartuj Jarvise.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
        <p className="text-sm">
          {status.connected ? (
            <>
              Připojeno jako <b className="font-medium">{status.email ?? "Google účet"}</b>
              {status.keep ? " · včetně Keep" : ""}
            </>
          ) : (
            <span className="text-muted-foreground">Google není připojený.</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {!status.connected && (
            <Button asChild size="sm">
              <a href="/api/google/login">
                <Plug /> Připojit Google
              </a>
            </Button>
          )}
          {status.connected && !status.keep && (
            <Button asChild variant="outline" size="sm">
              <a href="/api/google/login?keep=1">
                <NotebookPen /> Povolit Keep
              </a>
            </Button>
          )}
          {status.connected && (
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
              <LogOut /> Odpojit
            </Button>
          )}
        </div>
      </div>

      {status.connected && !status.keep && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Keep povolíš takto: v Admin konzoli Google Workspace otevři Zabezpečení → Ovládací prvky API → Delegování v rámci celé domény, přidej Client ID této aplikace se
          scope <code className="font-mono">https://www.googleapis.com/auth/keep</code>, v Google Cloud zapni Google Keep API a pak klikni na „Povolit Keep“.
        </p>
      )}

      <fieldset className="flex flex-col gap-3" disabled={!status.connected}>
        <legend className="mb-1 text-sm font-medium">Při uložení karty zapsat také do Googlu</legend>
        <label className="flex items-center gap-3 text-sm">
          <Checkbox checked={value.event} onCheckedChange={(v) => onChange({ event: v === true })} />
          Události do Google Kalendáře
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Checkbox checked={value.reminder} onCheckedChange={(v) => onChange({ reminder: v === true })} />
          Připomínky do Google Tasks
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Seznamy</span>
          <Select value={value.todo} onValueChange={(todo) => onChange({ todo: todo as GoogleSyncPrefs["todo"] })}>
            <SelectTrigger className="w-56" aria-label="Seznamy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tasks">do Google Tasks</SelectItem>
              <SelectItem value="keep">do Google Keep</SelectItem>
              <SelectItem value="off">nezapisovat</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Poznámky</span>
          <Select value={value.note} onValueChange={(note) => onChange({ note: note as GoogleSyncPrefs["note"] })}>
            <SelectTrigger className="w-56" aria-label="Poznámky">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">do Google Keep</SelectItem>
              <SelectItem value="off">nezapisovat</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {status.connected && !status.keep && (value.note === "keep" || value.todo === "keep") && (
          <p className="text-xs text-amber-700">Keep ještě není povolený, poznámky a seznamy do Keep se zatím nezapíšou.</p>
        )}
      </fieldset>
    </div>
  );
}
