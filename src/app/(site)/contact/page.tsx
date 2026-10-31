import type { Metadata } from "next";
import { OrderSection } from "@/components/sections/order-section";

export const metadata: Metadata = {
  title: "Контакти та замовлення",
  description: "Залиште заявку на розробку сайту, вебплатформи чи мобільного додатка — ви отримаєте номер звернення.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return <OrderSection headingAs="h1" />;
}
