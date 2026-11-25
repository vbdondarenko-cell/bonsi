import "server-only";
import { createHmac } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp, ipBucket, parseTrustedProxy } from "@/lib/orders/client-ip";
import { cleanCountry, parseDevice, type Attribution, type Device } from "./attribution";

export type SiteEventKind = "pageview" | "scan" | "lead";

export type SiteEvent = {
  kind: SiteEventKind;
  visitor: string;
  path: string;
  attribution: Attribution;
  referrerHost: string | null;
  country: string | null;
  device: Device;
  landing: boolean;
};

/** Доба за київським часом: від неї залежить сіль хешу відвідувача. */
function kyivDay(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(date);
}

/**
 * Анонімний ідентифікатор відвідувача на одну добу: HMAC(сіль, доба + підмережа IP + User-Agent).
 * IP і User-Agent у базу не потрапляють, а завтра хеш буде іншим, тож це не відстеження людини.
 */
export function visitorHash(headers: Headers): string | null {
  const salt = process.env.ORDER_HASH_SALT;
  if (!salt || salt.length < 16) return null;
  let bucket: string | null = null;
  try {
    bucket = ipBucket(getClientIp(headers, parseTrustedProxy(process.env.TRUSTED_PROXY)));
  } catch {
    bucket = null;
  }
  const userAgent = headers.get("user-agent") ?? "";
  return createHmac("sha256", salt).update(`visitor:${kyivDay()}:${bucket ?? "noip"}:${userAgent}`).digest("hex").slice(0, 32);
}

/** Країна й тип пристрою з заголовків запиту (країну проставляє Vercel). */
export function requestMeta(headers: Headers): { country: string | null; device: Device } {
  return {
    country: cleanCountry(headers.get("x-vercel-ip-country")),
    device: parseDevice(headers.get("user-agent") ?? ""),
  };
}

/** Записує подію. Помилки не прокидаються далі: аналітика ніколи не має ламати сайт. */
export async function recordEvent(event: SiteEvent): Promise<boolean> {
  try {
    const { error } = await createSupabaseServiceClient()
      .from("site_events")
      .insert({
        kind: event.kind,
        visitor: event.visitor,
        path: event.path,
        source: event.attribution.source,
        medium: event.attribution.medium,
        campaign: event.attribution.campaign,
        content: event.attribution.content,
        link_code: event.attribution.linkCode,
        referrer_host: event.referrerHost,
        country: event.country,
        device: event.device,
        landing: event.landing,
      });
    if (error) {
      console.error("[analytics] insert failed:", error.code ?? error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[analytics] insert failed:", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}
