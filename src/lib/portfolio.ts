import "server-only";
import { cases, type CaseStudy } from "@/lib/cases";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const PRODUCT_TYPE_LABELS: Record<string, string> = { website: "Сайт", web_app: "Вебзастосунок", mobile: "Мобільний застосунок", other: "Інше" };

export type PublicCase = CaseStudy & { productType?: string; liveUrl?: string; remoteCover?: { src: string; alt: string } };

type Row = { slug: string; title: string; summary: string; task: string; result: string; stack: string[]; product_type: string; cover_url: string | null; cover_alt: string | null; live_url: string | null };

/**
 * Опубліковані кейси: лише записи з підтвердженою згодою власника (гарантує обмеження в БД).
 * Якщо БД недоступна або не налаштована — повертаємо статичний список із `cases.ts`, а не вигадані дані.
 */
export async function listPublishedCases(): Promise<PublicCase[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("portfolio_items")
      .select("slug,title,summary,task,result,stack,product_type,cover_url,cover_alt,live_url")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const fromDb = ((data ?? []) as Row[]).map(toCase);
    const known = new Set(fromDb.map((c) => c.slug));
    return [...fromDb, ...cases.filter((c) => !known.has(c.slug))];
  } catch {
    return cases;
  }
}

export async function getPublishedCase(slug: string): Promise<PublicCase | undefined> {
  return (await listPublishedCases()).find((c) => c.slug === slug);
}

function toCase(r: Row): PublicCase {
  return {
    slug: r.slug, title: r.title, summary: r.summary, task: r.task, result: r.result, stack: r.stack,
    productType: r.product_type, liveUrl: r.live_url ?? undefined,
    remoteCover: r.cover_url ? { src: r.cover_url, alt: r.cover_alt || r.title } : undefined,
  };
}
