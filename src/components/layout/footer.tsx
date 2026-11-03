import Link from "next/link";
import { Container } from "@/components/ui/container";
import { footerNav, nav, site } from "@/lib/site";

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
          {[...nav, ...footerNav].map((item) => (
            <Link key={item.href} href={item.href} className="text-muted transition-colors hover:text-fg">
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="text-accent-soft transition-colors hover:text-fg">
            Кабінет клієнта
          </Link>
        </nav>
      </Container>
      <Container className="border-t border-line py-6">
        <div className="flex flex-col gap-2 text-sm text-muted sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.name}. Усі права захищено.
          </p>
          <nav aria-label="Правові документи" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="transition-colors hover:text-fg">
              Політика конфіденційності
            </Link>
            <Link href="/terms" className="transition-colors hover:text-fg">
              Умови користування
            </Link>
            <Link href="/cooperation" className="transition-colors hover:text-fg">
              Умови співпраці
            </Link>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
