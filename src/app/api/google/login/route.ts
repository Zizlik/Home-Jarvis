import { randomBytes } from "node:crypto";
import { configured, consentUrl } from "@/lib/google/auth";

export const runtime = "nodejs";

/** Starts Google sign-in (Calendar, Tasks, Gmail; Keep goes through a service account, lib/google/keep.ts). */
export async function GET(request: Request) {
  if (!configured()) return Response.json({ error: "Chybí GOOGLE_CLIENT_ID a GOOGLE_CLIENT_SECRET v .env.local." }, { status: 503 });
  const state = randomBytes(16).toString("hex");
  return new Response(null, {
    status: 302,
    headers: {
      location: consentUrl(request, state),
      "set-cookie": `google_oauth_state=${state}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
