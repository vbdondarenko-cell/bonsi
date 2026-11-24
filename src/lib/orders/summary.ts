import { services } from "@/lib/services";
import { telegram } from "@/lib/site";
import { DEADLINE_LABELS, SERVICE_QUESTIONS, type DeadlineId, type ServiceId } from "./options";

export type SummaryInput = {
  service: ServiceId;
  details?: Record<string, string>;
  deadline?: string;
  idea?: string;
  links?: string[];
};

export type SummaryLine = { label: string; value: string };

/** Людський підсумок відповідей: однаково показується клієнту й іде в повідомлення для Telegram. */
export function buildSummary(input: SummaryInput): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const service = services.find((item) => item.id === input.service);
  lines.push({ label: "Послуга", value: service?.title ?? input.service });

  for (const question of SERVICE_QUESTIONS[input.service]) {
    const answer = input.details?.[question.id];
    const option = question.options.find((item) => item.id === answer);
    if (option) lines.push({ label: question.label.replace(/[?:]$/, ""), value: option.label });
  }

  const deadline = input.deadline ? DEADLINE_LABELS[input.deadline as DeadlineId] : undefined;
  if (deadline) lines.push({ label: "Терміни", value: deadline });
  if (input.idea?.trim()) lines.push({ label: "Задача", value: input.idea.trim() });
  if (input.links?.length) lines.push({ label: "Приклади", value: input.links.join(", ") });
  return lines;
}

const IDEA_LIMIT = 300;
const MESSAGE_LIMIT = 900;

/**
 * Посилання `t.me/bonsi_studio?text=…`: чат відкривається з уже підготовленим повідомленням,
 * де є номер звернення. Текст короткий — кирилиця в URL «важить» у 6 разів більше. Повні дані в адмінпанелі.
 */
export function buildTelegramLink(ticket: string | null, name: string, lines: SummaryLine[]): string {
  const body = lines
    .map((line) => {
      const value = line.label === "Задача" && line.value.length > IDEA_LIMIT ? `${line.value.slice(0, IDEA_LIMIT)}…` : line.value;
      return `${line.label}: ${value}`;
    })
    .join("\n");
  const intro = ticket
    ? `Залишив(-ла) заявку на сайті, номер ${ticket}.`
    : "Хочу залишити заявку, але сайт не зберіг її.";
  let text = `Вітаю! Мене звати ${name.trim()}. ${intro}\n\n${body}`;
  if (text.length > MESSAGE_LIMIT) text = `${text.slice(0, MESSAGE_LIMIT - 1)}…`;
  return `${telegram.url}?text=${encodeURIComponent(text)}`;
}
