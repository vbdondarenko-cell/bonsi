export type EmailTemplate =
  | "order_received" | "login_code" | "cabinet_invite" | "new_message" | "new_proposal"
  | "proposal_decision" | "deliverable_decision" | "invoice_issued" | "payment_confirmed" | "project_completed";

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  "order_received", "login_code", "cabinet_invite", "new_message", "new_proposal",
  "proposal_decision", "deliverable_decision", "invoice_issued", "payment_confirmed", "project_completed",
];

export type Rendered = { subject: string; html: string; text: string };
type Vars = Record<string, unknown>;

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Листи містять лише змінні шаблону (номер, назва, сума) і посилання на кабінет; коди входу й токени сюди не потрапляють. */
const COPY: Record<EmailTemplate, Record<"uk" | "en", { subject: string; body: string }>> = {
  order_received: { uk: { subject: "Заявку {ticket} отримано", body: "Дякуємо! Ми отримали вашу заявку {ticket} і відповімо найближчим часом." }, en: { subject: "Request {ticket} received", body: "Thank you! We received your request {ticket} and will reply soon." } },
  login_code: { uk: { subject: "Вхід у кабінет BONSI", body: "Лист із кодом входу надсилає сервіс авторизації. Якщо ви не запитували вхід, проігноруйте цей лист." }, en: { subject: "BONSI sign-in", body: "The sign-in code is sent by the auth service. Ignore this email if you did not request it." } },
  cabinet_invite: { uk: { subject: "Ваш кабінет BONSI готовий", body: "Для заявки {ticket} відкрито кабінет клієнта: статус, повідомлення, файли й оплата в одному місці." }, en: { subject: "Your BONSI workspace is ready", body: "A client workspace for {ticket} is open: status, messages, files and payments in one place." } },
  new_message: { uk: { subject: "Нове повідомлення від студії", body: "У проєкті «{title}» є нове повідомлення." }, en: { subject: "New message from the studio", body: "There is a new message in project “{title}”." } },
  new_proposal: { uk: { subject: "Нова комерційна пропозиція", body: "Для проєкту «{title}» готова пропозиція (версія {version}). Перегляньте й ухваліть рішення в кабінеті." }, en: { subject: "New proposal", body: "A proposal (v{version}) for “{title}” is ready for your decision." } },
  proposal_decision: { uk: { subject: "Рішення щодо пропозиції збережено", body: "Рішення щодо пропозиції проєкту «{title}» зафіксовано." }, en: { subject: "Proposal decision recorded", body: "Your decision on the proposal for “{title}” has been recorded." } },
  deliverable_decision: { uk: { subject: "Результат етапу: рішення збережено", body: "Рішення щодо етапу проєкту «{title}» зафіксовано." }, en: { subject: "Milestone decision recorded", body: "Your decision on a milestone of “{title}” has been recorded." } },
  invoice_issued: { uk: { subject: "Виставлено рахунок {number}", body: "Рахунок {number} на {amount} {currency} доступний у розділі «Оплата». Оплата — банківським переказом; статус «Сплачено» зʼявиться після підтвердження надходження." }, en: { subject: "Invoice {number} issued", body: "Invoice {number} for {amount} {currency} is in Payments. Pay by bank transfer; it is marked paid only after the studio confirms receipt." } },
  payment_confirmed: { uk: { subject: "Оплату рахунку {number} підтверджено", body: "Ми підтвердили надходження {amount} {currency} за рахунком {number}. Дякуємо!" }, en: { subject: "Payment for invoice {number} confirmed", body: "We confirmed receipt of {amount} {currency} for invoice {number}. Thank you!" } },
  project_completed: { uk: { subject: "Проєкт «{title}» завершено", body: "Фінальні файли й документи доступні в кабінеті." }, en: { subject: "Project “{title}” completed", body: "Final files and documents are available in your workspace." } },
};

const fill = (text: string, vars: Vars, escape: boolean) =>
  text.replace(/\{(\w+)\}/g, (_, key) => (escape ? escapeHtml(vars[key] ?? "") : String(vars[key] ?? "")));

export function renderEmail(template: EmailTemplate, locale: "uk" | "en", vars: Vars, siteUrl: string): Rendered {
  const copy = COPY[template][locale] ?? COPY[template].uk;
  const link = `${siteUrl.replace(/\/$/, "")}/login`;
  const subject = fill(copy.subject, vars, false).replace(/[\r\n]+/g, " ").slice(0, 200);
  const body = fill(copy.body, vars, true);
  const cta = locale === "uk" ? "Відкрити кабінет" : "Open workspace";
  return {
    subject,
    html: `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto"><p>${body}</p><p><a href="${escapeHtml(link)}">${cta}</a></p><p style="color:#666;font-size:12px">BONSI Studios</p></body></html>`,
    text: `${fill(copy.body, vars, false)}\n\n${cta}: ${link}\n\nBONSI Studios`,
  };
}

/**
 * Лист із кодом входу. Окремо від черги: код — секрет, тож його ніколи не записують у email_outbox (там лише змінні шаблонів).
 * Лист відправляється одразу з Send Email Hook; якщо провайдер недоступний, хук повертає помилку, і вхід чесно повідомляє про збій.
 */
export function renderLoginCodeEmail(input: { code: string; link: string; locale?: "uk" | "en" }): Rendered {
  const locale = input.locale ?? "uk";
  const uk = locale === "uk";
  const subject = uk ? "Код входу в кабінет BONSI" : "Your BONSI sign-in code";
  const intro = uk ? "Ваш одноразовий код входу:" : "Your one-time sign-in code:";
  const linkText = uk ? "Або відкрийте посилання:" : "Or open this link:";
  const note = uk ? "Код дійсний обмежений час і спрацьовує один раз. Якщо ви не запитували вхід, проігноруйте цей лист." : "The code is valid for a short time and works once. Ignore this email if you did not request it.";
  const code = escapeHtml(input.code);
  const link = escapeHtml(input.link);
  return {
    subject,
    html: `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto"><p>${intro}</p><p style="font-size:28px;letter-spacing:6px;font-weight:600">${code}</p><p>${linkText} <a href="${link}">${link}</a></p><p style="color:#666;font-size:12px">${note}</p></body></html>`,
    text: `${intro} ${input.code}\n\n${linkText} ${input.link}\n\n${note}`,
  };
}
