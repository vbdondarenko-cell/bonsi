import type { Metadata } from "next";
import { CopyButton } from "@/components/admin/copy-button";
import { LinkForm } from "@/components/admin/link-form";
import { PageHeader, Panel, formatDateTime, formatNumber } from "@/components/admin/ui";
import { loadLinks, type TrackingLink } from "@/lib/admin/analytics";
import { requireAdmin } from "@/lib/admin/guard";
import { shortUrl, utmUrl } from "@/lib/analytics/links";
import { renderQrSvg } from "@/lib/analytics/qr";
import { cn } from "@/lib/cn";
import { site } from "@/lib/site";
import { toggleLinkAction } from "./actions";

export const metadata: Metadata = { title: "Посилання та QR" };
export const dynamic = "force-dynamic";

export default async function AdminLinksPage() {
  const admin = await requireAdmin();
  const result = await loadLinks(admin.supabase);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Реклама та стікери" title="Посилання та QR-коди" />

      <Panel title="Нове відстежуване посилання">
        <p className="mb-5 max-w-2xl text-sm text-muted">
          Для кожного стікера чи оголошення створіть окреме посилання: тоді в статистиці буде видно, скільки людей прийшло саме
          звідти й скільки з них залишило заявку. QR-код веде на коротку адресу, яка рахує скан і відкриває потрібну сторінку.
        </p>
        <LinkForm />
      </Panel>

      {!result.ok ? (
        <Panel>
          <p role="alert" className="font-medium">
            {result.reason === "not_ready" ? "Посилання ще не підключені до бази." : "Не вдалося завантажити посилання."}
          </p>
          <p className="mt-2 text-sm text-muted">
            {result.reason === "not_ready"
              ? "Застосуйте міграцію supabase/migrations/20261125000000_site_analytics.sql у проєкті Supabase."
              : "Спробуйте оновити сторінку."}
          </p>
        </Panel>
      ) : result.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted">Посилань ще немає. Створіть перше вище.</p>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.map((link) => (
            <LinkCard key={link.code} link={link} />
          ))}
        </ul>
      )}
    </div>
  );
}

async function LinkCard({ link }: { link: TrackingLink }) {
  const short = shortUrl(site.url, link.code);
  const direct = utmUrl(site.url, link);
  const svg = await renderQrSvg(short);
  const qrSrc = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;

  return (
    <li className={cn("rounded-[var(--radius-card)] border border-line bg-surface/70 p-5 sm:p-6", !link.active && "opacity-60")}>
      <div className="flex flex-col gap-5 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{link.name}</h3>
            {!link.active ? (
              <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">вимкнено</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {link.source} / {link.medium}
            {link.campaign ? ` · ${link.campaign}` : ""}
            {link.content ? ` · ${link.content}` : ""} · веде на {link.destination} · створено {formatDateTime(link.created_at)}
          </p>
          {link.note ? <p className="mt-2 text-sm">{link.note}</p> : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Скани й кліки", link.scans],
              ["За 30 днів", link.scans_30d],
              ["Відвідувачі", link.visitors],
              ["Заявки", link.leads],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{formatNumber(value as number)}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-muted">Для QR/стікера</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs" title={short}>
                {short}
              </code>
              <CopyButton value={short} label={`коротка адреса ${link.name}`} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-muted">Для реклами</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs" title={direct}>
                {direct}
              </code>
              <CopyButton value={direct} label={`UTM-адреса ${link.name}`} />
            </div>
          </div>

          <form action={toggleLinkAction} className="mt-4">
            <input type="hidden" name="code" value={link.code} />
            <input type="hidden" name="active" value={link.active ? "false" : "true"} />
            <button type="submit" className="text-sm text-muted underline underline-offset-4 hover:text-fg">
              {link.active ? "Вимкнути (QR поведе на головну)" : "Увімкнути знову"}
            </button>
          </form>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-center">
          {qrSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- локальний data URI, оптимізація не потрібна */}
              <img src={qrSrc} alt={`QR-код: ${link.name}`} width={160} height={160} className="rounded-xl bg-white p-1" />
              <a
                href={qrSrc}
                download={`bonsi-qr-${link.code}.svg`}
                className="text-sm text-accent-soft underline underline-offset-4"
              >
                Завантажити SVG для друку
              </a>
            </>
          ) : (
            <p className="max-w-40 rounded-xl border border-line bg-surface-2/60 p-3 text-xs text-muted">
              Генератор QR ще не підключено. Адреса зліва вже працює й рахує переходи.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
