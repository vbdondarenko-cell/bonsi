import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function NotFound() {
  return (
    <>
    <Header />
    <main id="main">
    <Container className="py-32 sm:py-44">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">Помилка 404</p>
      <h1 className="mt-6 text-[clamp(2.5rem,7vw,5rem)] font-semibold leading-none tracking-[-0.04em]">
        Сторінку не знайдено
      </h1>
      <p className="mt-6 max-w-lg text-lg text-muted">
        Можливо, посилання застаріло або сторінки більше не існує.
      </p>
      <div className="mt-10">
        <ButtonLink href="/">На головну</ButtonLink>
      </div>
    </Container>
    </main>
    <Footer />
    </>
  );
}
