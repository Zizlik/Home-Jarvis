import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { disconnect } from "@/lib/google/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  await disconnect();
  return Response.json({ ok: true });
}
