import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ScrollBuilder } from "@/components/intro/scroll-builder";
import { Tracker } from "@/components/analytics/tracker";
import { PromoBar } from "@/components/promo/promo-bar";
import { promoBootScript } from "@/lib/promo";
import { SiteScene } from "@/components/three/site-scene";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-site relative isolate min-h-dvh">
      {/* Вирішує ДО першого малювання, чи збирати секції курсорами під час прокрутки. Запобіжник знімає атрибут, якщо ScrollBuilder не змонтувався. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            '(function(){try{var d=document.documentElement;var f=location.search.indexOf("intro=1")>-1;if(f||!(navigator.webdriver||matchMedia("(prefers-reduced-motion: reduce)").matches)){d.setAttribute("data-cursors","on");setTimeout(function(){if(!window.__cb)d.removeAttribute("data-cursors")},20000)}}catch(e){}})()',
        }}
      />
      <script dangerouslySetInnerHTML={{ __html: promoBootScript }} />
      <ScrollBuilder />
      <Tracker />
      <SiteScene />
      <div data-site-content className="relative z-10">
      <a
        href="#main"
        className="sr-only z-[70] rounded-full bg-accent px-5 py-3 font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Перейти до вмісту
      </a>
      <PromoBar />
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer />
      </div>
    </div>
  );
}
