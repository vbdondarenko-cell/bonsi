import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { TiltCard } from "@/components/ui/tilt-card";
import { PRODUCT_TYPE_LABELS, type PublicCase } from "@/lib/portfolio";

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Мітка «ПК» / «Телефон» біля макета. */
function DeviceTag({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={`absolute z-20 rounded-full border border-line bg-bg/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted backdrop-blur ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

/** Вікно браузера зі знімком сайту на ПК. */
function BrowserFrame({ src, host, alt }: { src: string; host: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="ml-3 truncate rounded-md bg-white/[0.06] px-3 py-0.5 font-mono text-[10px] text-muted">{host}</span>
      </div>
      <Image src={src} alt={alt} width={1440} height={900} sizes="(min-width:1024px) 520px, 90vw" unoptimized className="block h-auto w-full" />
    </div>
  );
}

/** Рамка телефона зі знімком мобільної версії. */
function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-[1.35rem] border-[3px] border-[#262833] bg-black shadow-[0_24px_60px_-20px_rgb(0_0_0/0.95)] ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Схематичний інтерфейс для проєкту, який ще в розробці: без вигаданих екранів, лише каркас. */
function AppPlaceholder() {
  return (
    <div className="flex aspect-[390/844] w-full flex-col gap-2 bg-gradient-to-b from-[#1b1740] to-[#0d0c1c] p-3">
      <div className="mx-auto h-1 w-8 rounded-full bg-white/20" />
      <div className="mt-2 h-14 rounded-lg bg-accent/40" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-16 rounded-lg bg-white/[0.07]" />
        <div className="h-16 rounded-lg bg-white/[0.07]" />
      </div>
      <div className="h-10 rounded-lg bg-white/[0.07]" />
      <div className="h-10 rounded-lg bg-white/[0.07]" />
      <div className="mt-auto flex justify-around pb-1">
        <span className="h-1.5 w-6 rounded-full bg-accent-soft/80" />
        <span className="h-1.5 w-6 rounded-full bg-white/20" />
        <span className="h-1.5 w-6 rounded-full bg-white/20" />
      </div>
    </div>
  );
}

function Devices({ item }: { item: PublicCase }) {
  const desktop = item.shots?.desktop;
  const mobile = item.shots?.mobile;
  const host = item.liveUrl ? hostOf(item.liveUrl) : item.slug;

  if (!desktop && !mobile) {
    // Застосунок у розробці: два телефони (Android та iOS) із каркасом інтерфейсу.
    return (
      <div className="relative mx-auto flex aspect-[16/10] w-full max-w-[520px] items-center justify-center gap-5">
        <div className="relative w-[28%] -rotate-6">
          <PhoneFrame>
            <AppPlaceholder />
          </PhoneFrame>
          <DeviceTag className="-bottom-3 left-1/2 -translate-x-1/2">Android</DeviceTag>
        </div>
        <div className="relative w-[28%] translate-y-4 rotate-6">
          <PhoneFrame>
            <AppPlaceholder />
          </PhoneFrame>
          <DeviceTag className="-bottom-3 left-1/2 -translate-x-1/2">iOS</DeviceTag>
        </div>
      </div>
    );
  }

  return (
    // Телефон: вікно ПК і телефон стоять поруч без перекриття (обидва повністю видно).
    // Від sm: телефон накладається на правий нижній кут вікна браузера.
    <div className="relative mx-auto flex w-full max-w-[520px] items-end gap-3 pt-4 sm:block sm:aspect-[16/11] sm:gap-0 sm:pt-0">
      {desktop ? (
        <div className="relative w-[70%] sm:absolute sm:left-0 sm:top-0 sm:w-[86%]">
          <BrowserFrame src={desktop} host={host} alt={`${item.title}: версія для ПК`} />
          <DeviceTag className="-top-3 left-3">ПК</DeviceTag>
        </div>
      ) : null}
      {mobile ? (
        <div className="relative mb-0 w-[28%] shrink-0 sm:absolute sm:bottom-0 sm:right-0 sm:w-[24%]">
          <PhoneFrame>
            <Image
              src={mobile}
              alt={`${item.title}: версія для телефона`}
              width={780}
              height={1688}
              sizes="130px"
              unoptimized
              className="block h-auto w-full"
            />
          </PhoneFrame>
          <DeviceTag className="-top-3 left-1/2 -translate-x-1/2">Телефон</DeviceTag>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status?: PublicCase["status"] }) {
  if (status === "in-progress") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> У розробці
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> Працює
    </span>
  );
}

/**
 * Портфоліо-вітрина: кожен проєкт — окрема велика картка з текстом ліворуч і макетами «ПК + телефон» праворуч.
 * Живі сайти відкриваються в новій вкладці, докладна інформація — на сторінці кейсу.
 */
export function PortfolioShowcase({ items }: { items: PublicCase[] }) {
  return (
    <ul className="flex flex-col gap-6 sm:gap-8">
      {items.map((item, index) => {
        const reverse = index % 2 === 1;
        return (
          <li key={item.slug}>
            <Reveal>
              <article className="card-shadow grid items-center gap-8 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-9 lg:grid-cols-2 lg:gap-12 lg:p-12">
                <div className={reverse ? "lg:order-2" : undefined}>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-mono text-xs tracking-[0.18em] text-accent-soft">
                      {String(index + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
                    </p>
                    <StatusBadge status={item.status} />
                    {item.productType ? (
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                        {PRODUCT_TYPE_LABELS[item.productType] ?? item.productType}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-5 text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">{item.title}</h3>
                  <p className="mt-4 max-w-md leading-relaxed text-muted">{item.summary}</p>
                  <ul className="mt-6 flex flex-wrap gap-2" aria-label="Технології">
                    {item.stack.map((tech) => (
                      <li key={tech} className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted">
                        {tech}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    {item.liveUrl ? (
                      <a
                        href={item.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-accent px-6 font-medium text-white transition-colors hover:bg-accent-hover"
                      >
                        Відкрити сайт <span aria-hidden="true">↗</span>
                        <span className="sr-only"> (у новій вкладці)</span>
                      </a>
                    ) : null}
                    <Link
                      href={`/portfolio/${item.slug}`}
                      className="inline-flex min-h-12 items-center justify-center rounded-[var(--radius-btn)] border border-line px-6 font-medium transition-colors hover:border-accent-soft/70"
                    >
                      Докладніше
                    </Link>
                  </div>
                </div>
                <div className={reverse ? "lg:order-1" : undefined}>
                  <TiltCard max={3}>
                    <Devices item={item} />
                  </TiltCard>
                </div>
              </article>
            </Reveal>
          </li>
        );
      })}
    </ul>
  );
}
