"use client";

import { Check, ExternalLink, Loader2, Plus, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CatalogItem, CatalogResponse } from "@/lib/mcp-catalog-shared";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["calendar", "weather", "email", "notes", "news", "f1"];
const DEBOUNCE_MS = 350;

type Results = { q: string; items: CatalogItem[]; nextCursor: string | null; error: string | null };

const normUrl = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

async function fetchCatalog(q: string, cursor: string | null, signal?: AbortSignal): Promise<CatalogResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/mcp/catalog?${params}`, { signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Chyba ${res.status}`);
  return data as CatalogResponse;
}

/** Dialog with remote MCP servers from the official MCP Registry. */
export function McpCatalog({
  open,
  onOpenChange,
  existingUrls,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingUrls: string[];
  onPick: (item: CatalogItem) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-xl">
        {open && <CatalogBody existingUrls={existingUrls} onPick={onPick} />}
      </DialogContent>
    </Dialog>
  );
}

function CatalogBody({ existingUrls, onPick }: { existingUrls: string[]; onPick: (item: CatalogItem) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCatalog(debounced, null, ctrl.signal)
      .then((r) => setResults({ q: debounced, items: r.items, nextCursor: r.nextCursor, error: null }))
      .catch((e: Error) => {
        if (ctrl.signal.aborted) return;
        setResults({ q: debounced, items: [], nextCursor: null, error: e.message || "Katalog se nepodařilo načíst." });
      });
    return () => ctrl.abort();
  }, [debounced, reload]);

  const loading = !results || results.q !== debounced;
  const added = new Set(existingUrls.map(normUrl));

  const loadMore = async () => {
    if (!results?.nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetchCatalog(results.q, results.nextCursor);
      setResults((prev) => {
        if (!prev || prev.q !== results.q) return prev;
        const names = new Set(prev.items.map((i) => i.name));
        const urls = new Set(prev.items.map((i) => normUrl(i.url)));
        const fresh = r.items.filter((i) => !names.has(i.name) && !urls.has(normUrl(i.url)));
        return { ...prev, items: [...prev.items, ...fresh], nextCursor: r.nextCursor };
      });
    } catch (e) {
      setResults((prev) => (prev ? { ...prev, error: e instanceof Error ? e.message : "Další servery se nepodařilo načíst." } : prev));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Katalog MCP serverů</DialogTitle>
        <DialogDescription>Vzdálené servery z oficiálního MCP Registry. Vyber server a doplň přihlášení.</DialogDescription>
      </DialogHeader>

      <div className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-pretty text-muted-foreground">
        <ShieldAlert className="mt-px size-4 shrink-0" />
        <p>
          Servery z katalogu provozují třetí strany. Server pro kalendář nebo e-mail uvidí tvá data, vybírej známé poskytovatele. Servery s
          přihlášením přes okno Googlu nebo Microsoftu (OAuth) zatím nejdou, jen ty s tokenem nebo bez přihlášení.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat anglicky, třeba calendar"
            aria-label="Hledat v katalogu"
            className="pl-8"
            spellCheck={false}
            autoFocus
          />
          {loading && <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-muted",
                query.trim().toLowerCase() === s && "border-foreground/40 bg-muted",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-1 min-h-40 flex-1 overflow-y-auto px-1">
        {loading && !results ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Načítám katalog…
          </p>
        ) : results?.error && results.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm">
            <p className="text-destructive">{results.error}</p>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Zkusit znovu
            </Button>
          </div>
        ) : results && results.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nic jsme nenašli. Zkus jiné slovo, katalog je anglicky.</p>
        ) : (
          <ul className={cn("flex flex-col gap-2 transition-opacity", loading && "opacity-60")}>
            {results?.items.map((item) => (
              <CatalogRow key={item.name} item={item} added={added.has(normUrl(item.url))} onPick={() => onPick(item)} />
            ))}
          </ul>
        )}
        {results && !loading && results.items.length > 0 && (results.nextCursor || results.error) && (
          <div className="flex flex-col items-center gap-2 pt-3 pb-1">
            {results.error && <p className="text-sm text-destructive">{results.error}</p>}
            {results.nextCursor && (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" />}
                Načíst další
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const AUTH_LABEL: Record<CatalogItem["auth"], string> = {
  none: "bez přihlášení",
  token: "potřebuje token",
  headers: "potřebuje klíč",
};

function CatalogRow({ item, added, onPick }: { item: CatalogItem; added: boolean; onPick: () => void }) {
  const link = item.websiteUrl ?? item.repositoryUrl;
  return (
    <li className="flex items-start gap-3 rounded-xl border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.title}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span className="max-w-full truncate">{host(item.url)}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-px",
              item.auth === "none"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            {AUTH_LABEL[item.auth]}
          </span>
          {item.needsUrlEdit && (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-px text-amber-700 dark:text-amber-400">URL je potřeba doplnit</span>
          )}
        </p>
        {item.description && <p className="mt-1 line-clamp-2 text-sm text-pretty break-words text-muted-foreground">{item.description}</p>}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {item.websiteUrl ? "Web" : "Repozitář"} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {added ? (
        <span className="flex h-8 shrink-0 items-center gap-1 px-2 text-sm text-muted-foreground">
          <Check className="size-4" /> Přidáno
        </span>
      ) : (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onPick}>
          <Plus /> Přidat
        </Button>
      )}
    </li>
  );
}
