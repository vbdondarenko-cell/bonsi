import type { ReactNode } from "react";

/**
 * Плавна поява сторінки при переході між маршрутами. CSS-анімація замість JS: раніше контент у серверному HTML мав opacity: 0
 * до гідратації бібліотеки анімацій, що відкладало LCP на всіх сторінках (≈3 с на мобільному профілі Lighthouse).
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
