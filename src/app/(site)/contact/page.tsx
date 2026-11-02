import type { Metadata } from "next";
import { isServiceId } from "@/lib/orders/options";
import { OrderSection } from "@/components/sections/order-section";

export const metadata: Metadata = {
  title: "Контакти та замовлення",
  description: "Залиште заявку на розробку сайту, вебплатформи чи мобільного додатка — ви отримаєте номер звернення.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const { service } = await searchParams;
  const value = Array.isArray(service) ? service[0] : service;
  return <OrderSection headingAs="h1" initialService={isServiceId(value) ? value : undefined} />;
}
