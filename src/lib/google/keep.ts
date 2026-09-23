import "server-only";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Google Keep has no user consent: Google only opens it to a Workspace service
 * account with domain-wide delegation, acting as the signed-in user.
 * The key file lives in data/ (gitignored); the Workspace admin allows the
 * service account's client id for the Keep scope.
 */

const SCOPE = "https://www.googleapis.com/auth/keep";
const FILE = () => process.env.GOOGLE_SERVICE_ACCOUNT_FILE || join(process.cwd(), "data", "google-service-account.json");

type Key = { client_email: string; private_key: string; token_uri?: string; client_id?: string };
let cached: { user: string; token: string; expiresAt: number } | null = null;

async function key(): Promise<Key | null> {
  try {
    return JSON.parse(await readFile(FILE(), "utf8")) as Key;
  } catch {
    return null;
  }
}

/** The service account's client id: what the admin enters in domain-wide delegation. */
export async function serviceAccountClientId() {
  return (await key())?.client_id ?? null;
}

/** An access token for Keep, acting as `user`. Throws with Google's reason when not allowed. */
export async function keepToken(user: string): Promise<string> {
  if (cached && cached.user === user && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const k = await key();
  if (!k) throw new Error("Chybí servisní účet pro Keep (data/google-service-account.json).");
  const aud = k.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: k.client_email, sub: user, scope: SCOPE, aud, iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(k.private_key, "base64url");
  const res = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!data.access_token) {
    // unauthorized_client = the admin hasn't allowed this client id for the Keep scope yet.
    throw new Error(data.error === "unauthorized_client" ? "Správce domény zatím nepovolil servisnímu účtu přístup ke Keep." : (data.error_description ?? data.error ?? `Google ${res.status}`));
  }
  cached = { user, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

/** Keep usable for this user? `null` error means yes. */
export async function keepStatus(user: string | null): Promise<{ ready: boolean; error: string | null; clientId: string | null }> {
  const clientId = await serviceAccountClientId();
  if (!clientId) return { ready: false, error: "no-key", clientId: null };
  if (!user) return { ready: false, error: "not-connected", clientId };
  try {
    await keepToken(user);
    return { ready: true, error: null, clientId };
  } catch (e) {
    return { ready: false, error: (e as Error).message, clientId };
  }
}
