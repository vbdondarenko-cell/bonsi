import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { faq } from "@/lib/faq";
import { faqJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Питання та відповіді",
  description: "Відповіді на часті питання про замовлення, оплату, зміни, передачу та підтримку.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqJsonLd(faq)} />
      <Container className="pt-20 sm:pt-28">
        <SectionHeading as="h1" eyebrow="FAQ" title="Питання та відповіді" />
      </Container>
      <Section>
        <div className="mx-auto max-w-3xl divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {faq.map((item) => (
            <details key={item.q} className="group p-6">
              <summary className="cursor-pointer list-none text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4">{item.q}</summary>
              <p className="mt-3 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-12 text-center">
          <ButtonLink href="/contact">Не знайшли відповідь? Напишіть нам</ButtonLink>
        </div>
      </Section>
    </>
  );
}
