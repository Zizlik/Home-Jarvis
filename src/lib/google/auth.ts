import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { keepStatus } from "./keep";

/**
 * Google sign-in for Jarvis: one OAuth consent, then a refresh token kept
 * server-side in data/google.json (gitignored). Access tokens are minted on demand.
 */

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  // Keep without a key file: Google signs the service account's JWT for us (lib/google/keep.ts).
  "https://www.googleapis.com/auth/iam",
];


type Stored = { refreshToken: string; accessToken?: string; expiresAt?: number; email?: string; scopes: string[] };

const FILE = join(process.cwd(), "data", "google.json");

export const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** The callback URL as the browser sees this app (behind Caddy). */
export function redirectUri(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? (host?.startsWith("127.0.0.1") || host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/google/callback`;
}

async function load(): Promise<Stored | null> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Stored;
  } catch {
    return null;
  }
}

async function save(s: Stored) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(s, null, 2), { mode: 0o600 });
  await rename(`${FILE}.tmp`, FILE);
}

export function consentUrl(request: Request, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? `Google ${res.status}`);
  return data;
}

/** Finish the consent: store the refresh token and who signed in. */
export async function exchangeCode(request: Request, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(request) });
  if (!t.refresh_token) throw new Error("Google nevrátil obnovovací token. Zkus se přihlásit znovu.");
  let email: string | undefined;
  try {
    const payload = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    email = payload.email;
  } catch {
    // no id token: the status just won't show the address
  }
  await save({ refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, email, scopes: (t.scope ?? "").split(" ") });
}

/** A valid access token, refreshed when it is about to expire. Null when not signed in. */
export async function accessToken(): Promise<string | null> {
  const s = await load();
  if (!s) return null;
  if (s.accessToken && s.expiresAt && s.expiresAt - Date.now() > 60_000) return s.accessToken;
  const t = await tokenRequest({ refresh_token: s.refreshToken, grant_type: "refresh_token" });
  await save({ ...s, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, scopes: t.scope ? t.scope.split(" ") : s.scopes });
  return t.access_token!;
}

/** The signed-in Google account, or null. */
export async function account() {
  return (await load())?.email ?? null;
}

export async function status() {
  const s = await load();
  const keep = await keepStatus(s?.email ?? null);
  // Signed in before a scope was added (e.g. the IAM one for Keep): sign in again to grant it.
  const missing = s ? SCOPES.filter((x) => x.startsWith("https://") && !s.scopes.includes(x)) : [];
  return { configured: configured(), connected: !!s, email: s?.email ?? null, needsReconnect: missing.length > 0, keep: keep.ready, keepError: keep.error, keepClientId: keep.clientId };
}

export async function disconnect() {
  const s = await load();
  if (s) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refreshToken)}`, { method: "POST" }).catch(() => undefined);
  await rm(FILE, { force: true });
}

/** Authorized call to a Google REST API; throws with Google's message on failure. `token` overrides the user's (Keep). */
export async function google<T>(url: string, init: RequestInit = {}, token?: string): Promise<T> {
  token ??= (await accessToken()) ?? undefined;
  if (!token) throw new Error("Google není připojený.");
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Google ${res.status}`);
  return data;
}
