export type TeamMember = {
  /** Заповніть, щоб показати імʼя на сторінці «Про нас». */
  name?: string;
  role: string;
  about: string;
};

export const team: TeamMember[] = [
  {
    role: "Засновник",
    about: "Відповідає за повний цикл проєкту: від дизайну до запуску.",
  },
  {
    role: "Співзасновник",
    about: "Відповідає за повний цикл проєкту: від дизайну до запуску.",
  },
];
