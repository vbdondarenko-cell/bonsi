import { timingSafeEqual } from "node:crypto";
import { dispatchEmails, providerFromEnv } from "@/lib/email/service";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return false;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    const result = await dispatchEmails(createSupabaseServiceClient(), providerFromEnv(), {
      from: process.env.EMAIL_FROM ?? "BONSI <no-reply@localhost>",
      replyTo: process.env.EMAIL_REPLY_TO,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("[emails] dispatch failed:", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "server_error" }, { status: 500, headers });
  }
}

export const GET = handle;
export const POST = handle;
