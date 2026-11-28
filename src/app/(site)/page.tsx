import type { Metadata } from "next";
import { HomeIntro } from "@/components/intro/home-intro";
import { Advantages } from "@/components/sections/advantages";
import { FaqPreview } from "@/components/sections/faq-preview";
import { Hero } from "@/components/sections/hero";
import { OrderSection } from "@/components/sections/order-section";
import { PortfolioPreview } from "@/components/sections/portfolio-preview";
import { Process } from "@/components/sections/process";
import { ServicesBento } from "@/components/sections/services-bento";
import { HolidayTimeline } from "@/components/promo/holiday-timeline";
import { PromoOffer } from "@/components/promo/promo-offer";
import { WinterHero } from "@/components/promo/winter-hero";
import { StatsBand } from "@/components/sections/stats-band";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export const revalidate = 60;

export default function HomePage() {
  return (
    <>
      {/* Вирішує ДО першого малювання, чи грати вступ: раз за сесію, не при Reduce Motion і не під автотестами; /?intro=1 — примусово. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            // У dev (npm run dev) інтро грає при кожному завантаженні, щоб його було видно; у продакшні — раз за сесію.
            `(function(){try{var d=document.documentElement;var f=location.search.indexOf("intro=1")>-1;var once=${process.env.NODE_ENV === "production" ? 'sessionStorage.getItem("bonsi-intro")' : "false"};var s=!f&&(navigator.webdriver||once||matchMedia("(prefers-reduced-motion: reduce)").matches);if(!s)d.setAttribute("data-intro","play")}catch(e){}})()`,
        }}
      />
      <HomeIntro />
      {/* Зимова акція (6 грудня — 2 січня): html[data-promo="on"] показує .promo-only і ховає .promo-hide. */}
      <WinterHero />
      <div className="promo-hide">
        <Hero />
      </div>
      <StatsBand />
      <PromoOffer />
      <ServicesBento />
      <PortfolioPreview />
      <HolidayTimeline />
      <Process />
      <Advantages />
      <FaqPreview />
      <OrderSection />
    </>
  );
}
