export type CaseStudy = {
  slug: string;
  title: string;
  /** Одне речення для картки в списку. */
  summary: string;
  /** Шлях до зображення в /public, напр. "/cases/my-case/cover.jpg". */
  cover?: { src: string; alt: string };
  stack: string[];
  task: string;
  result: string;
};

/**
 * Реальні кейси студії. Додавайте сюди лише виконані проєкти
 * з перевіреними даними — клієнти, результати й відгуки не вигадуються.
 * Поки масив порожній, сторінка «Портфоліо» показує порожній стан.
 */
export const cases: CaseStudy[] = [];

export function getCase(slug: string): CaseStudy | undefined {
  return cases.find((item) => item.slug === slug);
}
