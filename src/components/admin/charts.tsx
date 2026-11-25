import { formatNumber } from "@/components/admin/ui";

type Day = { day: string; views: number; visitors: number; leads: number };

const shortDate = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", timeZone: "UTC" });

function label(day: string) {
  return shortDate.format(new Date(`${day}T00:00:00Z`));
}

/** Стовпчики відвідувачів по днях; крапка над стовпчиком — день, коли були заявки. */
export function DailyChart({ data }: { data: Day[] }) {
  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 8, bottom: 28, left: 36 };
  const max = Math.max(1, ...data.map((d) => d.visitors));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const total = data.reduce((sum, d) => sum + d.visitors, 0);
  const ticks = [0, Math.ceil(max / 2), max];
  // Підписи по осі X: не більше ~7, щоб не злипалися.
  const step = Math.max(1, Math.ceil(data.length / 7));

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Відвідувачі по днях, разом ${formatNumber(total)}`}
        className="h-auto w-full"
      >
        {ticks.map((tick) => {
          const y = pad.top + innerH - (tick / max) * innerH;
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="currentColor" className="text-line" strokeWidth={1} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" className="fill-muted" fontSize={11}>
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}
        {data.map((d, index) => {
          const h = (d.visitors / max) * innerH;
          const x = pad.left + slot * index + (slot - barW) / 2;
          const y = pad.top + innerH - h;
          return (
            <g key={d.day}>
              <title>{`${label(d.day)}: ${formatNumber(d.visitors)} відвідувачів, ${formatNumber(d.views)} переглядів, ${formatNumber(d.leads)} заявок`}</title>
              <rect x={x} y={y} width={barW} height={Math.max(h, d.visitors > 0 ? 2 : 0)} rx={3} className="fill-accent-soft/70" />
              {d.leads > 0 ? <circle cx={x + barW / 2} cy={y - 7} r={4} className="fill-ok" /> : null}
              {index % step === 0 ? (
                <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="fill-muted" fontSize={11}>
                  {label(d.day)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-accent-soft/70" /> відвідувачі
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-ok" /> були заявки
        </span>
      </figcaption>
    </figure>
  );
}

export type BarItem = { key: string; label: string; value: number; hint?: string };

/** Список із горизонтальними смугами: найкраще читається для «джерела / сторінки / країни». */
export function BarList({ items, empty = "Поки немає даних." }: { items: BarItem[]; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {formatNumber(item.value)}
              {item.hint ? <span className="ml-2 text-xs">{item.hint}</span> : null}
            </span>
          </div>
          <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent-soft/70" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface/70 p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
