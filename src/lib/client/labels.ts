/** Підписи й чисті обчислення для кабінету. Статуси заявки, проєкту, пропозиції й платежу — незалежні. */

export const STAGES = ["brief", "proposal", "agreement", "design", "development", "qa", "delivery", "support"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  brief: "Бриф",
  proposal: "Пропозиція",
  agreement: "Домовленості",
  design: "Дизайн",
  development: "Розробка",
  qa: "Тестування",
  delivery: "Передача",
  support: "Підтримка",
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "Активний",
  on_hold: "На паузі",
  completed: "Завершено",
  cancelled: "Скасовано",
};

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  draft: "Чернетка",
  sent: "Очікує вашого рішення",
  approved: "Погоджено",
  changes_requested: "Запитано зміни",
  superseded: "Замінено новою версією",
};

export const EVENT_LABELS: Record<string, string> = {
  project_created: "Проєкт створено з вашої заявки",
  status_changed: "Змінено статус проєкту",
  stage_changed: "Змінено етап проєкту",
  proposal_sent: "Студія надіслала комерційну пропозицію",
  proposal_approved: "Ви погодили комерційну пропозицію",
  proposal_changes_requested: "Ви попросили змін у комерційній пропозиції",
};

export type StageRow = { stage: string; state: string; position: number };

/** Прогрес — лише реально завершені етапи: ніяких вигаданих відсотків. */
export function stageProgress(rows: ReadonlyArray<StageRow>): { done: number; total: number; current: Stage | null } {
  const total = rows.length || STAGES.length;
  const done = rows.filter((row) => row.state === "done").length;
  const current = rows.find((row) => row.state === "in_progress");
  return { done, total, current: current && (STAGES as readonly string[]).includes(current.stage) ? (current.stage as Stage) : null };
}

export type ProposalSchedule = Array<{ label: string; percent: number }>;

/** Графік платежів → суми. Залишок від округлення віддається останньому платежу, тож сума завжди збігається з ціною. */
export function scheduleAmounts(total: number, schedule: ProposalSchedule): Array<{ label: string; percent: number; amount: number }> {
  const cents = Math.round(total * 100);
  let allocated = 0;
  return schedule.map((item, index) => {
    const isLast = index === schedule.length - 1;
    const part = isLast ? cents - allocated : Math.round((cents * item.percent) / 100);
    allocated += part;
    return { label: item.label, percent: item.percent, amount: part / 100 };
  });
}

export const SCHEDULE_PRESETS: Record<string, ProposalSchedule> = {
  "30-40-30": [
    { label: "Аванс", percent: 30 },
    { label: "Після дизайну", percent: 40 },
    { label: "Після здачі", percent: 30 },
  ],
  "50-50": [
    { label: "Аванс", percent: 50 },
    { label: "Після здачі", percent: 50 },
  ],
};

export function scheduleTotal(schedule: ProposalSchedule): number {
  return schedule.reduce((sum, item) => sum + item.percent, 0);
}

const money = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const CURRENCY_SYMBOL: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€" };

export function formatMoney(amount: number | string, currency: string): string {
  return `${money.format(Number(amount))} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}
