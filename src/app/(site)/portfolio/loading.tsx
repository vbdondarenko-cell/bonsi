import { Container, Section } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortfolioLoading() {
  return (
    <div role="status" aria-label="Завантаження портфоліо">
      <Container className="pt-20 sm:pt-28">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-6 h-14 w-full max-w-xl" />
        <Skeleton className="mt-6 h-5 w-full max-w-lg" />
      </Container>
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </Section>
    </div>
  );
}
