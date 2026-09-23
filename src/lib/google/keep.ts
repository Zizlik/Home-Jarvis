import "server-only";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { accessToken } from "./auth";

/**
 * Google Keep has no user consent: Google only opens it to a Workspace service
 * account with domain-wide delegation, acting as the signed-in user.
 *
 * Keyless by default: the service account's JWT is signed by Google (IAM
 * Credentials signJwt) on behalf of the signed-in user, who holds "Service
 * Account Token Creator" on it. Organizations often forbid key files
 * (iam.disableServiceAccountKeyCreation); a key in data/ still works if present.
 * Either way the Workspace admin allows the service account's client id for Keep.
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

/** GOOGLE_KEEP_SERVICE_ACCOUNT: the service account's e-mail, for the keyless path. */
const account = () => process.env.GOOGLE_KEEP_SERVICE_ACCOUNT?.trim() || null;

/** The service account's client id ("Unique ID"): what the admin enters in domain-wide delegation. */
export async function serviceAccountClientId(): Promise<string | null> {
  const k = await key();
  if (k?.client_id) return k.client_id;
  const email = account();
  const token = email ? await accessToken().catch(() => null) : null;
  if (!email || !token) return null;
  const res = await fetch(`https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { uniqueId?: string } | null;
  return data?.uniqueId ?? null;
}

/** Google signs the JWT for the service account; the caller needs Token Creator on it. */
async function signKeyless(email: string, claims: object) {
  const token = await accessToken();
  if (!token) throw new Error("Google není připojený.");
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:signJwt`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ payload: JSON.stringify(claims) }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { signedJwt?: string; error?: { message?: string; status?: string } };
  if (!data.signedJwt) {
    const msg = data.error?.message ?? `Google ${res.status}`;
    if (/insufficient.*scope/i.test(msg)) throw new Error("Odpoj a znovu připoj Google (chybí oprávnění pro podpis servisního účtu).");
    if (data.error?.status === "PERMISSION_DENIED") throw new Error(`Chybí role „Service Account Token Creator“ na servisním účtu, nebo je vypnuté IAM Service Account Credentials API. Google: ${msg}`);
    throw new Error(msg);
  }
  return data.signedJwt;
}

/** An access token for Keep, acting as `user`. Throws with Google's reason when not allowed. */
export async function keepToken(user: string): Promise<string> {
  if (cached && cached.user === user && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const k = await key();
  const email = k?.client_email ?? account();
  if (!email) throw new Error("no-account");
  const aud = k?.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: email, sub: user, scope: SCOPE, aud, iat: now, exp: now + 3600 };
  let assertion: string;
  if (k) {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
    assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(k.private_key, "base64url")}`;
  } else {
    assertion = await signKeyless(email, claims);
  }
  const res = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
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
  if (!(await key()) && !account()) return { ready: false, error: "no-account", clientId: null };
  if (!user) return { ready: false, error: "not-connected", clientId: null };
  const clientId = await serviceAccountClientId();
  try {
    await keepToken(user);
    return { ready: true, error: null, clientId };
  } catch (e) {
    return { ready: false, error: (e as Error).message, clientId };
  }
}
