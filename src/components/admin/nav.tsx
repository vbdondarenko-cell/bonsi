"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const items = [
  { href: "/admin", label: "Статистика", exact: true },
  { href: "/admin/links", label: "Посилання та QR", exact: false },
  { href: "/admin/finance", label: "Фінанси", exact: false },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Розділи адмінпанелі"
      className={
        // Телефон: нижня панель, як у застосунку; на ПК — бічне меню.
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-1 border-t border-line bg-bg/95 px-3 pt-2 backdrop-blur " +
        "pb-[max(0.5rem,env(safe-area-inset-bottom))] " +
        "lg:static lg:z-auto lg:flex lg:flex-col lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
      }
    >
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            prefetch={false}
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-xl px-4 py-3 text-center text-sm font-medium transition-colors lg:py-2.5 lg:text-left",
              active ? "bg-accent/15 text-fg ring-1 ring-accent-soft/40" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
