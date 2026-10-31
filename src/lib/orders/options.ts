export const SERVICE_IDS = [
  "landing",
  "corporate",
  "shop",
  "webapp",
  "mobile",
  "design",
  "support",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const BUDGET_IDS = [
  "lt-50k",
  "50-150k",
  "150-400k",
  "gt-400k",
  "discuss",
] as const;
export type BudgetId = (typeof BUDGET_IDS)[number];

export const BUDGET_LABELS: Record<BudgetId, string> = {
  "lt-50k": "До 50 000 ₴",
  "50-150k": "50 000 – 150 000 ₴",
  "150-400k": "150 000 – 400 000 ₴",
  "gt-400k": "Понад 400 000 ₴",
  discuss: "Ще не визначився — обговоримо",
};

export const DEADLINE_IDS = [
  "asap",
  "1-month",
  "1-3-months",
  "flexible",
] as const;
export type DeadlineId = (typeof DEADLINE_IDS)[number];

export const DEADLINE_LABELS: Record<DeadlineId, string> = {
  asap: "Якнайшвидше",
  "1-month": "Протягом місяця",
  "1-3-months": "1–3 місяці",
  flexible: "Терміни гнучкі",
};
