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

export type ServiceQuestion = {
  id: string;
  label: string;
  options: ReadonlyArray<{ id: string; label: string }>;
};

/**
 * Уточнення, які показуються ЛИШЕ для обраної послуги. Усі необов'язкові: клієнт не мусить відповідати на те,
 * що вже відомо або що ще не визначено. Ідентифікатори зберігаються в orders.details і валідуються на сервері.
 */
export const SERVICE_QUESTIONS: Record<ServiceId, ReadonlyArray<ServiceQuestion>> = {
  landing: [
    {
      id: "goal",
      label: "Яка головна мета сторінки?",
      options: [
        { id: "leads", label: "Збирати заявки" },
        { id: "sell", label: "Продавати продукт" },
        { id: "present", label: "Презентувати продукт або подію" },
      ],
    },
    {
      id: "content",
      label: "Чи є тексти й матеріали?",
      options: [
        { id: "ready", label: "Є, готові" },
        { id: "help", label: "Потрібна допомога з текстами" },
        { id: "unsure", label: "Ще не визначився" },
      ],
    },
  ],
  corporate: [
    {
      id: "pages",
      label: "Скільки сторінок орієнтовно?",
      options: [
        { id: "le5", label: "До 5" },
        { id: "6-15", label: "6–15" },
        { id: "gt15", label: "Понад 15" },
      ],
    },
    {
      id: "languages",
      label: "Скільки мов потрібно?",
      options: [
        { id: "one", label: "Одна" },
        { id: "two", label: "Дві" },
        { id: "three-plus", label: "Три і більше" },
      ],
    },
  ],
  shop: [
    {
      id: "catalog",
      label: "Розмір каталогу",
      options: [
        { id: "le50", label: "До 50 товарів" },
        { id: "50-500", label: "50–500 товарів" },
        { id: "gt500", label: "Понад 500 товарів" },
      ],
    },
    {
      id: "payments",
      label: "Як приймати оплату?",
      options: [
        { id: "online", label: "Онлайн на сайті" },
        { id: "offline", label: "При отриманні" },
        { id: "advice", label: "Потрібна порада" },
      ],
    },
  ],
  webapp: [
    {
      id: "kind",
      label: "Що саме потрібно?",
      options: [
        { id: "cabinet", label: "Кабінет клієнта" },
        { id: "admin", label: "Адмінпанель" },
        { id: "platform", label: "Платформа або маркетплейс" },
        { id: "internal", label: "Внутрішній інструмент" },
      ],
    },
    {
      id: "integrations",
      label: "Чи потрібні інтеграції?",
      options: [
        { id: "none", label: "Ні" },
        { id: "payments", label: "Платежі" },
        { id: "crm", label: "CRM або інші сервіси" },
      ],
    },
  ],
  mobile: [
    {
      id: "platform",
      label: "Для якої платформи?",
      options: [
        { id: "android", label: "Android" },
        { id: "ios", label: "iOS" },
        { id: "both", label: "Обидві" },
      ],
    },
    {
      id: "backend",
      label: "Серверна частина",
      options: [
        { id: "have", label: "Вже є API" },
        { id: "need", label: "Потрібно створити" },
        { id: "unsure", label: "Ще не визначився" },
      ],
    },
  ],
  design: [
    {
      id: "scope",
      label: "Який результат потрібен?",
      options: [
        { id: "new", label: "Новий інтерфейс" },
        { id: "redesign", label: "Редизайн наявного" },
        { id: "system", label: "Дизайн-система" },
        { id: "audit", label: "UX-аудит" },
      ],
    },
    {
      id: "brand",
      label: "Чи є фірмовий стиль?",
      options: [
        { id: "have", label: "Так" },
        { id: "need", label: "Потрібно створити" },
      ],
    },
  ],
  support: [
    {
      id: "product",
      label: "Що потрібно підтримувати?",
      options: [
        { id: "site", label: "Сайт" },
        { id: "webapp", label: "Вебзастосунок" },
        { id: "mobile", label: "Мобільний додаток" },
      ],
    },
    {
      id: "need",
      label: "Що саме потрібно?",
      options: [
        { id: "fixes", label: "Виправлення помилок" },
        { id: "features", label: "Нові функції" },
        { id: "audit", label: "Аудит стану" },
        { id: "maintenance", label: "Постійний супровід" },
      ],
    },
  ],
};

export const MAX_LINKS = 5;

export function isServiceId(value: string | undefined): value is ServiceId {
  return SERVICE_IDS.some((id) => id === value);
}

/** Розбирає поле «посилання»: по одному в рядок (або через пробіл), порожні відкидаються. */
export function parseLinks(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
