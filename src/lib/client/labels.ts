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
  deliverable_submitted: "Студія надіслала результат етапу на погодження",
  deliverable_approved: "Ви погодили результат етапу",
  deliverable_changes_requested: "Ви попросили правок до результату етапу",
  file_uploaded: "Завантажено файл",
  file_shared: "Студія поділилася файлом",
  invoice_issued: "Студія виставила рахунок",
  invoice_voided: "Рахунок анульовано",
  payment_reported: "Ви повідомили про оплату; очікуємо підтвердження студії",
  payment_confirmed: "Студія підтвердила надходження оплати",
  payment_rejected: "Студія не підтвердила платіж",
  payment_refunded: "Записано повернення коштів",
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

const moneyFixed = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Для фінансових зведень: завжди дві цифри після коми, щоб копійки не зникали. */
export function formatMoneyFixed(amount: number | string, currency: string): string {
  return `${moneyFixed.format(Number(amount))} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

export function formatMoney(amount: number | string, currency: string): string {
  return `${money.format(Number(amount))} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

export const DELIVERABLE_STATUS_LABELS: Record<string, string> = {
  draft: "Чернетка",
  submitted: "Очікує вашого рішення",
  approved: "Погоджено",
  changes_requested: "Запитано правки",
  superseded: "Замінено новою версією",
};

export const PAYMENT_STATE_LABELS: Record<string, string> = {
  unpaid: "Не сплачено",
  awaiting_confirmation: "Очікує підтвердження студією",
  partial: "Сплачено частково",
  paid: "Сплачено",
  void: "Анульовано",
};

export const FILE_CATEGORY_LABELS: Record<string, string> = {
  logo: "Логотипи",
  text: "Тексти",
  mockup: "Макети й референси",
  document: "Документи",
  final: "Фінальні файли",
  handover: "Передача проєкту",
  attachment: "Вкладення в чаті",
  other: "Інше",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export const DELIVERABLE_STAGES = ["design", "development", "qa", "delivery"] as const;

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  tech_spec: "Технічне завдання",
  contract: "Договір на розробку",
  amendment: "Додаткова угода",
  stage_act: "Акт завершення етапу",
  handover_act: "Акт приймання-передачі",
  access_handover: "Передача доступів",
  warranty_terms: "Умови гарантійної підтримки",
  other: "Інший документ",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Чернетка",
  sent: "Очікує вашого рішення",
  approved: "Погоджено",
  changes_requested: "Запитано зміни",
  void: "Недійсний",
};

export const CHANGE_STATUS_LABELS: Record<string, string> = {
  submitted: "Студія оцінює",
  quoted: "Оцінено — потрібне ваше рішення",
  approved: "Погоджено",
  rejected: "Відхилено",
  withdrawn: "Відкликано",
  in_progress: "У роботі",
  done: "Виконано",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: "Нова — студія ще не відповіла",
  in_review: "Студія розглядає",
  accepted: "Прийнята в роботу",
  in_progress: "У роботі",
  done: "Завершена",
  rejected: "Відхилена",
};

export const DECISION_LABELS: Record<string, string> = {
  approved: "Погоджено",
  changes_requested: "Запитано зміни",
  rejected: "Відхилено",
};

export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  bug: "Помилка в роботі",
  warranty_fix: "Гарантійне виправлення",
  paid_work: "Платне доопрацювання",
  tech_question: "Технічне питання",
  hosting: "Проблема з хостингом",
  post_update: "Проблема після оновлення",
  other: "Інше",
};
export const TICKET_STATUS_LABELS: Record<string, string> = {
  new: "Нове",
  in_progress: "В роботі",
  waiting_client: "Очікує вашої відповіді",
  resolved: "Вирішено",
  closed: "Закрито",
};
export const TICKET_PRIORITY_LABELS: Record<string, string> = { low: "Низький", normal: "Звичайний", high: "Високий", urgent: "Терміново" };
export const HANDOVER_KIND_LABELS: Record<string, string> = { website: "Сайт", mobile: "Мобільний застосунок", other: "Інший продукт" };
export const HANDOVER_STATUS_LABELS: Record<string, string> = { draft: "Чернетка", submitted: "Очікує вашого приймання", accepted: "Прийнято", changes_requested: "Потрібні правки" };
