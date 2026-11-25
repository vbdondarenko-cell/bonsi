import { after, NextResponse } from "next/server";
import { cleanLinkCode, isBot } from "@/lib/analytics/attribution";
import { recordEvent, requestMeta, visitorHash } from "@/lib/analytics/events";
import { hasIgnoreCookie } from "@/lib/analytics/ignore";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkRow = {
  code: string;
  destination: string;
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
};

function redirect(request: Request, target: string) {
  const response = NextResponse.redirect(new URL(target, request.url), 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * Короткий відстежуваний лінк для QR-стікерів і реклами: /go/<code>.
 * Рахує скан на сервері (працює навіть без JavaScript) і перенаправляє на сторінку з UTM-мітками,
 * за якими трекер на сайті прив'яже перегляди й заявки до цього лінка.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = cleanLinkCode((await params).code);
  if (!code) return redirect(request, "/");

  let link: LinkRow | null = null;
  try {
    const { data } = await createSupabaseServiceClient()
      .from("tracking_links")
      .select("code, destination, source, medium, campaign, content")
      .eq("code", code)
      .eq("active", true)
      .maybeSingle();
    link = (data as LinkRow | null) ?? null;
  } catch {
    link = null;
  }
  // Невідомий чи вимкнений лінк не повинен лишати людину перед помилкою: ведемо на головну.
  if (!link) return redirect(request, "/");

  const target = new URL(link.destination, "https://placeholder.invalid");
  target.searchParams.set("utm_source", link.source);
  target.searchParams.set("utm_medium", link.medium);
  if (link.campaign) target.searchParams.set("utm_campaign", link.campaign);
  if (link.content) target.searchParams.set("utm_content", link.content);
  target.searchParams.set("lc", link.code);

  const visitor = isBot(request.headers.get("user-agent")) ? null : visitorHash(request.headers);
  // Власні тестові скани (свій пристрій із позначкою) не рахуємо, але ведемо на сторінку як звичайно.
  const dnt =
    request.headers.get("dnt") === "1" ||
    request.headers.get("sec-gpc") === "1" ||
    hasIgnoreCookie(request.headers.get("cookie"));
  if (visitor && !dnt) {
    const { country, device } = requestMeta(request.headers);
    const event = {
      kind: "scan" as const,
      visitor,
      path: `/go/${link.code}`,
      attribution: {
        source: link.source,
        medium: link.medium,
        campaign: link.campaign,
        content: link.content,
        linkCode: link.code,
      },
      referrerHost: null,
      country,
      device,
      landing: true,
    };
    try {
      after(() => recordEvent(event));
    } catch {
      await recordEvent(event);
    }
  }

  return redirect(request, `${target.pathname}${target.search}`);
}
