"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const items = [
  { href: "/admin", label: "Огляд", exact: true },
  { href: "/admin/orders", label: "Заявки", exact: false },
  { href: "/admin/settings", label: "Налаштування", exact: false },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Розділи адмінпанелі" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
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
