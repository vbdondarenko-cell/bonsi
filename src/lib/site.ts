export const site = {
  name: "BONSI Studios",
  shortName: "BONSI",
  tagline: "Створюємо цифрові продукти, які працюють",
  description:
    "BONSI Studios розробляє сайти, інтернет-магазини й вебзастосунки для бізнесу — від дизайну та структури до запуску й технічної підтримки.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  locale: "uk_UA",
} as const;

/** Прямий чат студії в Telegram: сюди клієнт потрапляє після заявки. */
export const telegram = {
  handle: "@bonsi_studio",
  url: "https://t.me/bonsi_studio",
} as const;

export const nav = [
  { href: "/services", label: "Послуги" },
  { href: "/pricing", label: "Ціни" },
  { href: "/portfolio", label: "Портфоліо" },
  { href: "/about", label: "Про нас" },
  { href: "/contact", label: "Контакти" },
] as const;

/** Додаткові сторінки: лише у футері, щоб не перевантажувати шапку на планшетах. */
export const footerNav = [
  { href: "/process", label: "Як ми працюємо" },
  { href: "/faq", label: "FAQ" },
] as const;
