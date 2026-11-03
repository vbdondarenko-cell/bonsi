export const site = {
  name: "BONSI Studios",
  shortName: "BONSI",
  tagline: "Створюємо цифрові продукти, які працюють",
  description:
    "BONSI Studios — студія двох розробників. Сайти, вебплатформи та мобільні додатки на замовлення: від ідеї й дизайну до запуску та підтримки.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  locale: "uk_UA",
} as const;

export const nav = [
  { href: "/services", label: "Послуги" },
  { href: "/portfolio", label: "Портфоліо" },
  { href: "/about", label: "Про нас" },
  { href: "/contact", label: "Контакти" },
] as const;

/** Додаткові сторінки: лише у футері, щоб не перевантажувати шапку на планшетах. */
export const footerNav = [
  { href: "/process", label: "Як ми працюємо" },
  { href: "/faq", label: "FAQ" },
] as const;
