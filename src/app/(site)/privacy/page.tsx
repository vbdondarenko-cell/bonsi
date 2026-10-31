import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { PRIVACY_POLICY_DATE_LABEL, PRIVACY_POLICY_VERSION, legal } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Політика конфіденційності",
  description: "Які дані ми збираємо через форму заявки, навіщо, як довго зберігаємо та які у вас права.",
  alternates: { canonical: "/privacy" },
};

const sections: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "1. Хто обробляє дані",
    body: (
      <p>
        Володілець даних — {legal.operatorName}. Зв’язатися з нами щодо ваших даних можна{" "}
        {legal.contactEmail ? (
          <>
            за адресою <a className="text-accent-soft underline" href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>
          </>
        ) : (
          <>
            через <Link className="text-accent-soft underline" href="/contact">форму на сторінці «Контакти»</Link>
          </>
        )}
        .
      </p>
    ),
  },
  {
    title: "2. Які дані ми збираємо",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>Те, що ви вводите у форму заявки: імʼя, email, телефон (необов’язково), тип послуги, бюджет, терміни та опис ідеї.</li>
        <li>Технічні дані для захисту від спаму: хеш підмережі IP-адреси (саму адресу ми не зберігаємо) і заголовок User-Agent браузера.</li>
        <li>Факт вашої згоди, час її надання та версію цієї політики ({PRIVACY_POLICY_VERSION}).</li>
      </ul>
    ),
  },
  {
    title: "3. Навіщо і на якій підставі",
    body: (
      <p>
        Щоб відповісти на вашу заявку та обговорити проєкт — на підставі вашої згоди, яку ви надаєте, поставивши позначку у формі.
        Технічні дані використовуємо для захисту форми від зловживань (легітимний інтерес). Ми не використовуємо дані для
        розсилок і не продаємо їх.
      </p>
    ),
  },
  {
    title: "4. Кому передаємо",
    body: (
      <p>
        Дані зберігаються у хмарній базі даних (Supabase) і обробляються на хостингу сайту. Ці постачальники діють як наші
        обробники і не мають права використовувати дані у власних цілях. Інакше ми передаємо дані третім особам лише
        за вимогою закону.
      </p>
    ),
  },
  {
    title: "5. Скільки зберігаємо",
    body: (
      <p>
        Зберігаємо стільки, скільки потрібно для опрацювання заявки й подальшого спілкування з вами. Ви можете будь-коли
        попросити видалити свої дані — ми зробимо це без зайвих запитань, окрім випадків, коли закон вимагає зберігання.
      </p>
    ),
  },
  {
    title: "6. Ваші права",
    body: (
      <p>
        Ви можете запросити доступ до своїх даних, їх виправлення чи видалення, відкликати згоду та заперечити проти обробки.
        Якщо вважаєте, що ми порушуємо ваші права, ви можете звернутися до Уповноваженого Верховної Ради України з прав людини.
      </p>
    ),
  },
  {
    title: "7. Cookies і трекери",
    body: <p>Сайт не використовує cookies для аналітики чи реклами і не підключає сторонні трекери.</p>,
  },
  {
    title: "8. Безпека",
    body: (
      <p>
        Дані передаються через HTTPS. Доступ до бази мають лише серверні ключі, які не потрапляють у браузер; публічного
        доступу до таблиці заявок немає.
      </p>
    ),
  },
  {
    title: "9. Зміни політики",
    body: <p>Якщо політика зміниться, ми оновимо дату та версію на цій сторінці. Поточна версія: {PRIVACY_POLICY_VERSION}.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <Container className="max-w-3xl pb-24 pt-20 sm:pt-28">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">Документи</p>
      <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Політика конфіденційності</h1>
      <p className="mt-4 text-muted">Оновлено: {PRIVACY_POLICY_DATE_LABEL}</p>
      <div className="mt-12 space-y-10 leading-relaxed text-muted">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="mb-3 text-xl font-semibold text-fg">{s.title}</h2>
            {s.body}
          </section>
        ))}
      </div>
    </Container>
  );
}
