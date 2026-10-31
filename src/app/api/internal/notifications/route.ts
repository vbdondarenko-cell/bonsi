import { timingSafeEqual } from "node:crypto";
import { dispatchNotifications } from "@/lib/notifications/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await dispatchNotifications();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[notifications] dispatch failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

/** GET — для планувальників на кшталт Vercel Cron, POST — для ручного/зовнішнього виклику. */
export const GET = handle;
export const POST = handle;
