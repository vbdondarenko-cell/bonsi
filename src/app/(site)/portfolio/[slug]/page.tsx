import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { cases, getCase } from "@/lib/cases";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return cases.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = getCase(slug);
  if (!item) return { title: "Кейс не знайдено" };
  return {
    title: item.title,
    description: item.summary,
    alternates: { canonical: `/portfolio/${item.slug}` },
    openGraph: { title: item.title, description: item.summary, url: `/portfolio/${item.slug}` },
  };
}

export default async function CasePage({ params }: Props) {
  const { slug } = await params;
  const item = getCase(slug);
  if (!item) notFound();

  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading as="h1" eyebrow="Кейс" title={item.title} description={item.summary} />
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Стек технологій">
          {item.stack.map((tech) => (
            <li
              key={tech}
              className="rounded-full border border-line px-4 py-1.5 font-mono text-xs text-muted"
            >
              {tech}
            </li>
          ))}
        </ul>
      </Container>

      <Section>
        {item.cover ? (
          <Image
            src={item.cover.src}
            alt={item.cover.alt}
            width={1600}
            height={900}
            priority
            className="mb-14 h-auto w-full rounded-[var(--radius-card)] border border-line"
          />
        ) : null}
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <section aria-labelledby="case-task">
            <h2 id="case-task" className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">
              Завдання
            </h2>
            <p className="mt-5 text-lg leading-relaxed">{item.task}</p>
          </section>
          <section aria-labelledby="case-result">
            <h2 id="case-result" className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">
              Результат
            </h2>
            <p className="mt-5 text-lg leading-relaxed">{item.result}</p>
          </section>
        </div>
        <div className="mt-16 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/contact">Обговорити схожий проєкт</ButtonLink>
          <ButtonLink href="/portfolio" variant="ghost">
            Усі кейси
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
