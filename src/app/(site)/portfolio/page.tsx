import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PortfolioShowcase } from "@/components/sections/portfolio-showcase";
import { SectionHeading } from "@/components/ui/section-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { listPublishedCases } from "@/lib/portfolio";

export const metadata: Metadata = {
  title: "Портфоліо",
  description: "Виконані проєкти BONSI Studios: завдання, технології та результат.",
  alternates: { canonical: "/portfolio" },
};

export const revalidate = 60;

export default function PortfolioPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          eyebrow="Портфоліо"
          title="Кейси BONSI"
          description="Завдання, технології та результат — лише для реально виконаних проєктів."
        />
      </Container>
      <Section>
        <Suspense fallback={<PortfolioSkeleton />}>
          <PortfolioCases />
        </Suspense>
      </Section>
    </>
  );
}

async function PortfolioCases() {
  const cases = await listPublishedCases();
  return (
    <>
      {cases.length === 0 ? (
        <EmptyState
          title="Перші кейси зʼявляться тут"
          description="Ми не публікуємо вигаданих клієнтів, результатів чи відгуків. Щойно проєкти будуть готові до публікації, повні сторінки кейсів зʼявляться в цьому розділі."
          action={<ButtonLink href="/contact">Обговорити проєкт</ButtonLink>}
        />
      ) : (
        <PortfolioShowcase items={cases} />
      )}
    </>
  );
}

function PortfolioSkeleton() {
  return (
    <div role="status" aria-label="Завантаження портфоліо" className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
    </div>
  );
}
