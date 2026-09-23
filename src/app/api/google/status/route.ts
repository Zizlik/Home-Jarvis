import { status } from "@/lib/google/auth";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await status());
}
