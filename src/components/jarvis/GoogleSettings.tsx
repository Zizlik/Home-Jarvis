"use client";

import { Loader2, LogOut, Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GoogleSyncPrefs } from "@/lib/google/cards";
import { notify } from "@/lib/notify";

type Status = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  needsReconnect?: boolean;
  keep: boolean;
  keepError?: string | null;
  keepClientId?: string | null;
};

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
          {(!status.connected || status.needsReconnect) && (
            <Button asChild size="sm">
              <a href="/api/google/login">
                <Plug /> {status.connected ? "Připojit znovu" : "Připojit Google"}
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

      {status.needsReconnect && (
        <p className="text-xs text-amber-700">Jarvis teď potřebuje o jedno oprávnění víc (pro Keep). Klikni na „Připojit znovu“ a potvrď přístup.</p>
      )}
      {status.connected && !status.keep && <KeepSetup status={status} />}

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

/** Keep only works through a Workspace service account with domain-wide delegation (no key file needed). */
function KeepSetup({ status }: { status: Status }) {
  const code = (t: string) => <code className="rounded bg-muted px-1 font-mono text-[11px] break-all">{t}</code>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">Google Keep zatím není povolený</p>
      {status.keepError === "no-account" ? (
        <ol className="list-decimal space-y-1 ps-4">
          <li>V Google Cloud Console (stejný projekt) zapni Google Keep API a IAM Service Account Credentials API.</li>
          <li>IAM a správa → Servisní účty → Vytvořit servisní účet (např. „jarvis-keep“). Role ani klíč nejsou potřeba.</li>
          <li>U účtu záložka Oprávnění → Udělit přístup: tvůj účet ({status.email}) s rolí „Service Account Token Creator“.</li>
          <li>E-mail servisního účtu (…@….iam.gserviceaccount.com) doplň do {code(".env.local")} jako {code("GOOGLE_KEEP_SERVICE_ACCOUNT=")} a restartuj Jarvise.</li>
        </ol>
      ) : (
        <>
          <p>V Admin konzoli Google Workspace otevři Zabezpečení → Ovládací prvky API → Delegování v rámci celé domény → Přidat nový a zadej:</p>
          <p>ID klienta: {code(status.keepClientId ?? "(Unique ID servisního účtu z Cloud Console)")}</p>
          <p>Rozsahy OAuth: {code("https://www.googleapis.com/auth/keep")}</p>
          {status.keepError && status.keepError !== "not-connected" && <p className="text-amber-700">Teď Google hlásí: {status.keepError}</p>}
          <p>Změna se může projevit až za pár minut, pak obnov stránku.</p>
        </>
      )}
    </div>
  );
}
