import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[70] rounded-full bg-accent px-5 py-3 font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Перейти до вмісту
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer />
    </>
  );
}
