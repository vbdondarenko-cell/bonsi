import { PROMO_DISCOUNT, discounted, formatUah } from "@/lib/promo";

/**
 * Ціна з акційною версією. Звичайний підпис видно завжди, крім акції; під час акції (html[data-promo="on"])
 * показується закреслена стара ціна й нова. Якщо підпис не збігається з priceFrom (напр. «/міс»), лишається як є.
 */
export function Price({ label, from, className, stacked = false }: { label: string; from: number | null; className?: string; stacked?: boolean }) {
  const old = from ? formatUah(from) : null;
  if (!from || !old || !label.includes(old)) return <span className={className}>{label}</span>;
  const next = label.replace(old, formatUah(discounted(from)));
  return (
    <>
      <span className={`promo-hide ${className ?? ""}`}>{label}</span>
      <span className={`promo-inline ${className ?? ""}`}>
        <s className={`${stacked ? "mb-2 block" : "mr-2"} text-[0.6em] font-normal text-muted decoration-accent decoration-2`}>{label}</s>
        <span className="whitespace-nowrap text-[var(--color-gold)]">{next}</span>
        <span className="ml-2 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 align-middle font-mono text-[0.55em] font-semibold text-white">−{PROMO_DISCOUNT}%</span>
      </span>
    </>
  );
}
