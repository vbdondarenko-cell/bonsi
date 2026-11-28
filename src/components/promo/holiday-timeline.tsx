import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { TiltCard } from "@/components/ui/tilt-card";

const stops = [
  { date: "6 грудня", title: "День святого Миколая", text: "Стартує акція. Перший подарунок — −40% на будь-який сайт.", glyph: "❄" },
  { date: "25 грудня", title: "Різдво", text: "Фіксуємо бриф і дизайн-концепцію у святковому темпі.", glyph: "✦" },
  { date: "1 січня", title: "Новий рік", text: "Нова ідея — новий старт. Знижка діє й у перші дні року.", glyph: "★" },
  { date: "2 січня", title: "Фінал акції", text: "Останній день, щоб зафіксувати ціну з мінус 40%.", glyph: "⏳" },
];

/** Шлях акції по святах: чотири «ворота» з 3D-карток, з'єднані світною лінією. */
export function HolidayTimeline() {
  return (
    <div className="promo-only">
      <Section id="holidays">
        <Reveal>
          <SectionHeading
            eyebrow="Від Миколая до Нового року"
            title={<>Чотири дати, одна <span className="winter-gradient-text">вигідна пропозиція</span></>}
          />
        </Reveal>
        <ol className="relative mt-14 grid gap-5 [perspective:1400px] sm:grid-cols-2 lg:grid-cols-4">
          <span aria-hidden="true" className="winter-line absolute left-0 right-0 top-[3.1rem] hidden h-px lg:block" />
          {stops.map((stop, index) => (
            <li key={stop.date} className="relative">
              <Reveal delay={index * 0.1} className="h-full">
                <TiltCard className="h-full" max={11}>
                  <div className="card-shadow winter-card h-full rounded-[var(--radius-card)] border border-line p-6">
                    <span
                      aria-hidden="true"
                      className="winter-bauble winter-bauble-red relative mb-6 flex !size-12 items-center justify-center text-lg text-white"
                    >
                      {stop.glyph}
                    </span>
                    <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#ffd98a]">{stop.date}</p>
                    <h3 className="mt-3 text-xl font-semibold tracking-tight">{stop.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted">{stop.text}</p>
                  </div>
                </TiltCard>
              </Reveal>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
