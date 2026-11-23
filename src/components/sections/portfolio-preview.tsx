import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PortfolioShowcase } from "@/components/sections/portfolio-showcase";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { listPublishedCases } from "@/lib/portfolio";

export async function PortfolioPreview() {
  const cases = await listPublishedCases();
  const featured = cases.slice(0, 3);

  return (
    <Section id="portfolio">
      <Reveal>
        <SectionHeading
          eyebrow="Портфоліо"
          title="Наші проєкти"
          description="Реальні роботи: як вони виглядають на комп’ютері та на телефоні. Відкрийте сайт і подивіться наживо."
        />
      </Reveal>
      <div className="mt-10 sm:mt-14">
        {featured.length === 0 ? (
          <EmptyState
            title="Перші кейси зʼявляться тут"
            description="Ми ще наповнюємо портфоліо й не публікуємо вигаданих проєктів чи відгуків. Розкажіть про свою задачу — можливо, наступний кейс буде вашим."
            action={<ButtonLink href="#order">Обговорити проєкт</ButtonLink>}
          />
        ) : (
          <PortfolioShowcase items={featured} />
        )}
      </div>
    </Section>
  );
}
