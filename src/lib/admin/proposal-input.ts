import { z } from "zod";
import { SCHEDULE_PRESETS, scheduleTotal, type ProposalSchedule } from "@/lib/client/labels";

/** Склад функціоналу: по одному пункту в рядок; порожні рядки й дублікати відкидаються. */
export function parseFeatures(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const item = line.replace(/^[-*•]\s*/, "").trim();
    if (item && !seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      items.push(item.slice(0, 200));
    }
  }
  return items.slice(0, 60);
}

/** Індивідуальний графік: «Назва | відсоток» у кожному рядку. */
export function parseCustomSchedule(raw: string): ProposalSchedule | null {
  const rows: ProposalSchedule = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [label, percent] = line.split("|").map((part) => part.trim());
    const value = Number((percent ?? "").replace(",", ".").replace("%", ""));
    if (!label || !Number.isFinite(value) || value <= 0 || value > 100) return null;
    rows.push({ label: label.slice(0, 80), percent: value });
  }
  return rows.length > 0 && rows.length <= 12 ? rows : null;
}

export function buildSchedule(preset: string, custom: string): ProposalSchedule | null {
  if (preset in SCHEDULE_PRESETS) return SCHEDULE_PRESETS[preset]!;
  if (preset === "custom") return parseCustomSchedule(custom);
  return null;
}

export const proposalInput = z.object({
  proposalId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, "Вкажіть назву.").max(160),
  summary: z.string().trim().max(4000),
  features: z.string().max(12000),
  price: z.coerce.number({ invalid_type_error: "Вкажіть вартість числом." }).min(0).max(1_000_000_000),
  currency: z.enum(["UAH", "USD", "EUR"]),
  durationDays: z.coerce.number().int().min(1, "Термін: від 1 дня.").max(1000),
  preset: z.string().max(20),
  customSchedule: z.string().max(2000),
  revisions: z.coerce.number().int().min(0).max(50),
  terms: z.string().trim().max(4000),
});

export function validateSchedule(schedule: ProposalSchedule | null): string | null {
  if (!schedule) return "Графік платежів: перевірте формат «Назва | відсоток».";
  if (Math.abs(scheduleTotal(schedule) - 100) > 1e-9) return `Сума відсотків має дорівнювати 100 (зараз ${scheduleTotal(schedule)}).`;
  return null;
}
