import { Advantages } from "@/components/sections/advantages";
import { Hero } from "@/components/sections/hero";
import { OrderSection } from "@/components/sections/order-section";
import { PortfolioPreview } from "@/components/sections/portfolio-preview";
import { Process } from "@/components/sections/process";
import { ServicesBento } from "@/components/sections/services-bento";
import { Specialization } from "@/components/sections/specialization";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Specialization />
      <ServicesBento />
      <PortfolioPreview />
      <Process />
      <Advantages />
      <OrderSection />
    </>
  );
}
