import { exchangeCode } from "@/lib/google/auth";

export const runtime = "nodejs";

const back = (query: string) => new Response(null, { status: 302, headers: { location: `/nastaveni?${query}`, "set-cookie": "google_oauth_state=; Path=/api/google; Max-Age=0" } });

/** Google redirects here after consent. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = request.headers.get("cookie")?.match(/(?:^|;\s*)google_oauth_state=([^;]+)/)?.[1];
  if (url.searchParams.get("error")) return back(`google=error&reason=${encodeURIComponent(url.searchParams.get("error")!)}`);
  if (!state || state !== url.searchParams.get("state")) return back("google=error&reason=state");
  try {
    await exchangeCode(request, url.searchParams.get("code") ?? "");
    return back("google=ok");
  } catch (err) {
    console.warn(`[google] sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    return back(`google=error&reason=${encodeURIComponent(err instanceof Error ? err.message : "exchange")}`);
  }
}
