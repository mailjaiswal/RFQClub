// Server-side reader for the mirrored rc_token cookie (see lib/session.ts).
import "server-only";
import { cookies } from "next/headers";

export async function reqToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("rc_token")?.value ?? null;
}
