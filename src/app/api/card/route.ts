import { reviseCard } from "@/lib/normalize";

export const runtime = "nodejs";

/** "posuň to na sobotu" + the shown card → the card's new full text. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { card?: unknown; change?: unknown } | null;
  const card = typeof body?.card === "string" ? body.card.slice(0, 500) : "";
  const change = typeof body?.change === "string" ? body.change.slice(0, 500) : "";
  if (!card || !change) return Response.json({ error: "Chybí karta nebo změna." }, { status: 400 });
  try {
    const text = await reviseCard(card, change, request.signal);
    return text ? Response.json({ text }) : Response.json({ error: "Změnu se nepodařilo použít." }, { status: 502 });
  } catch (err) {
    console.warn(`[card] revise failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Změnu se nepodařilo použít." }, { status: 502 });
  }
}
