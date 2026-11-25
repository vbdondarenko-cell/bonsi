import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PERIODS = [
  { days: 1, label: "Сьогодні" },
  { days: 7, label: "7 днів" },
  { days: 30, label: "30 днів" },
  { days: 90, label: "90 днів" },
] as const;

export type Analytics = {
  days: number;
  since: string;
  totals: { views: number; visitors: number; leads: number; scans: number };
  daily: { day: string; views: number; visitors: number; leads: number }[];
  sources: { source: string; medium: string; visitors: number; views: number; leads: number }[];
  campaigns: { campaign: string; source: string; medium: string; visitors: number; leads: number }[];
  referrers: { host: string; visitors: number }[];
  pages: { path: string; views: number; visitors: number }[];
  countries: { country: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  recent_leads: { created_at: string; source: string; medium: string; campaign: string | null; link_code: string | null }[];
};

export type TrackingLink = {
  code: string;
  name: string;
  destination: string;
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  note: string | null;
  active: boolean;
  created_at: string;
  scans: number;
  scans_30d: number;
  visitors: number;
  leads: number;
};

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "not_ready" | "failed" };

/** 42P01/42883/PGRST202: таблиці чи функції ще немає — міграцію не застосовано. */
function classify(error: { code?: string; message?: string }): "not_ready" | "failed" {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "42883" || code === "42P01" || code === "PGRST202" || /could not find the function|does not exist/i.test(message)) {
    return "not_ready";
  }
  return "failed";
}

export function parseDays(value: string | undefined): number {
  const days = Number(value);
  return PERIODS.some((period) => period.days === days) ? days : 30;
}

export async function loadAnalytics(supabase: SupabaseClient, days: number): Promise<Loaded<Analytics>> {
  const { data, error } = await supabase.rpc("admin_analytics", { p_days: days });
  if (error || !data) return { ok: false, reason: error ? classify(error) : "failed" };
  return { ok: true, data: data as Analytics };
}

export async function loadLinks(supabase: SupabaseClient): Promise<Loaded<TrackingLink[]>> {
  const { data, error } = await supabase.rpc("admin_list_links");
  if (error) return { ok: false, reason: classify(error) };
  return { ok: true, data: (data ?? []) as TrackingLink[] };
}
