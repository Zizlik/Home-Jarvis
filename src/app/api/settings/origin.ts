/** Same-origin guard shared by the settings routes (mirrors api/session). Returns a 403 response or null. */
export function rejectForeignOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return null;
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    /* malformed Origin header: reject below */
  }
  return Response.json({ error: "Neočekávaný původ požadavku." }, { status: 403 });
}
