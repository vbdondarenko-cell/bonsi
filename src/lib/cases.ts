export type CaseStudy = {
  slug: string;
  title: string;
  /** Одне речення для картки в списку. */
  summary: string;
  /** Шлях до зображення в /public, напр. "/cases/my-case/cover.jpg". */
  cover?: { src: string; alt: string };
  /** Знімки живого проєкту: як він виглядає на ПК і на телефоні (файли в /public/cases). */
  shots?: { desktop?: string; mobile?: string };
  /** Посилання на працюючий проєкт. */
  liveUrl?: string;
  /** Етап проєкту: працює чи ще в розробці. */
  status?: "live" | "in-progress";
  /** Тип продукту: "website" | "web_app" | "mobile" | "other". */
  productType?: string;
  /** Платформи (для мобільного застосунку). */
  platforms?: string[];
  stack: string[];
  task: string;
  result: string;
};

/**
 * Реальні проєкти студії. Додавайте сюди лише виконані проєкти
 * з перевіреними даними — клієнти, результати й відгуки не вигадуються.
 */
export const cases: CaseStudy[] = [
  {
    slug: "santehnik-cherkasy",
    title: "Сантехнік та електрик у Черкасах",
    summary: "Сайт сервісу з монтажу та ремонту сантехніки й електрики: зрозумілі послуги, вартість і швидкий зв’язок із диспетчером.",
    shots: { desktop: "/cases/santehnik-cherkasy-desktop.png", mobile: "/cases/santehnik-cherkasy-mobile.png" },
    liveUrl: "https://santehnik-cherkasy.com/",
    status: "live",
    productType: "website",
    stack: ["Сайт", "Адаптивна верстка", "SEO"],
    task: "Потрібен був сайт, на якому людина з проблемою вдома швидко бачить, чим займається сервіс, скільки це коштує, і може одразу зателефонувати або написати у Viber чи Telegram.",
    result: "Сайт опубліковано й працює: послуги, приклади робіт, порядок замовлення, вартість, відповіді на питання та контакти зібрані на одній сторінці, а дзвінок чи повідомлення диспетчеру доступні з першого екрана — і на ПК, і на телефоні.",
  },
  {
    slug: "lex-ck-ua",
    title: "Адвокатське об’єднання, Черкаси",
    summary: "Сайт адвокатів із правовими послугами для населення та бізнесу: категорії справ, контакти й зворотний зв’язок.",
    shots: { desktop: "/cases/lex-ck-desktop.png", mobile: "/cases/lex-ck-mobile.png" },
    liveUrl: "https://lex.ck.ua/",
    status: "live",
    productType: "website",
    stack: ["Сайт", "Адаптивна верстка", "SEO"],
    task: "Потрібен був стриманий сайт для адвокатів, який пояснює, з якими питаннями можна звернутися, показує команду та дає змогу швидко записатися на консультацію.",
    result: "Сайт опубліковано й працює: адвокати, категорії справ, контакти, графік роботи, маршрут на карті та форма зворотного зв’язку доступні на всіх пристроях.",
  },
  {
    slug: "mobile-app",
    title: "Мобільний застосунок для Android та iOS",
    summary: "Застосунок для двох платформ, який зараз перебуває в розробці.",
    status: "in-progress",
    productType: "mobile",
    platforms: ["Android", "iOS"],
    stack: ["Android", "iOS", "Мобільна розробка"],
    task: "Розробляємо мобільний застосунок, що працюватиме і на Android, і на iOS.",
    result: "Проєкт у розробці. Подробиці та знімки інтерфейсу опублікуємо після релізу.",
  },
];

export function getCase(slug: string): CaseStudy | undefined {
  return cases.find((item) => item.slug === slug);
}
