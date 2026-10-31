import Link from "next/link";
import { Container } from "@/components/ui/container";
import { nav, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <Container className="flex flex-col gap-10 py-14 md:flex-row md:items-end md:justify-between">
        <div className="max-w-sm">
          <p className="font-mono text-lg font-semibold tracking-[0.2em]">
            BONSI<span className="text-accent-soft">.</span>
          </p>
          <p className="mt-4 leading-relaxed text-muted">
            Студія двох розробників. Сайти, вебплатформи та мобільні додатки на замовлення.
          </p>
        </div>
        <nav aria-label="Навігація у футері" className="flex flex-wrap gap-x-8 gap-y-3">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="text-muted transition-colors hover:text-fg">
              {item.label}
            </Link>
          ))}
        </nav>
      </Container>
      <Container className="border-t border-line py-6">
        <p className="text-sm text-muted">
          © {new Date().getFullYear()} {site.name}. Усі права захищено.
        </p>
      </Container>
    </footer>
  );
}
