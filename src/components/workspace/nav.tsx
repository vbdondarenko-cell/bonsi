"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const items = [
  { href: "/app", label: "Дашборд", exact: true },
  { href: "/app/projects", label: "Мої проєкти", exact: false },
  { href: "/app/support", label: "Підтримка", exact: true },
  { href: "/app/profile", label: "Профіль і безпека", exact: true },
];

export function ClientNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Розділи кабінету" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            prefetch={false}
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

/** Вкладки проєкту. Розділи, яких ще немає, не імітуються кнопками: вони позначені як «скоро». */
export function ProjectTabs({ projectId, unread }: { projectId: string; unread: number }) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Огляд", exact: true },
    { href: `${base}/messages`, label: "Повідомлення", exact: false, badge: unread },
    { href: `${base}/proposal`, label: "Пропозиція", exact: false },
  ];
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Розділи проєкту" className="flex gap-1 overflow-x-auto border-b border-line pb-px">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              prefetch={false}
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                active ? "border-accent-soft text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {tab.label}
              {tab.badge ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-white" aria-label={`Непрочитаних: ${tab.badge}`}>
                  {tab.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <p className="text-xs text-muted">
        Скоро в кабінеті: дизайн-рев’ю, файли, оплата й документи — поки ці розділи недоступні, зверніться до студії в повідомленнях.
      </p>
    </div>
  );
}
