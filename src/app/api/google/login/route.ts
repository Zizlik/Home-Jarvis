import { randomBytes } from "node:crypto";
import { configured, consentUrl } from "@/lib/google/auth";

export const runtime = "nodejs";

/** Starts Google sign-in. `?keep=1` also asks for Google Keep (needs the Workspace admin step first). */
export async function GET(request: Request) {
  if (!configured()) return Response.json({ error: "Chybí GOOGLE_CLIENT_ID a GOOGLE_CLIENT_SECRET v .env.local." }, { status: 503 });
  const state = randomBytes(16).toString("hex");
  const keep = new URL(request.url).searchParams.get("keep") === "1";
  return new Response(null, {
    status: 302,
    headers: {
      location: consentUrl(request, state, keep),
      "set-cookie": `google_oauth_state=${state}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
