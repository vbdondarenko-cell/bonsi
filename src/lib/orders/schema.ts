import { z } from "zod";
import { BUDGET_IDS, DEADLINE_IDS, MAX_LINKS, SERVICE_IDS, SERVICE_QUESTIONS } from "./options";

/**
 * Єдина схема для клієнта і сервера. Клієнтська перевірка — лише зручність,
 * остаточна валідація завжди відбувається в route handler.
 */
export const orderSchema = z.object({
  service: z.enum(SERVICE_IDS, {
    errorMap: () => ({ message: "Оберіть тип послуги" }),
  }),
  /** Короткий довільний опис: необов'язковий. */
  idea: z.string().trim().max(3000, "Максимум 3000 символів").optional(),
  budget: z
    .enum(BUDGET_IDS, { errorMap: () => ({ message: "Оберіть значення зі списку" }) })
    .optional(),
  deadline: z
    .enum(DEADLINE_IDS, { errorMap: () => ({ message: "Оберіть значення зі списку" }) })
    .optional(),
  /** Відповіді на уточнення обраної послуги: { questionId: optionId }. Невідомі ключі й значення відхиляються. */
  details: z.record(z.string().max(40), z.string().max(40)).optional(),
  /** Посилання на приклади (https/http), до 5. */
  links: z
    .array(
      z
        .string()
        .trim()
        .max(300, "Посилання задовге")
        .url("Перевірте посилання")
        .refine((value) => /^https?:\/\//i.test(value), "Лише http(s)-посилання"),
    )
    .max(MAX_LINKS, `Не більше ${MAX_LINKS} посилань`)
    .optional(),
  name: z
    .string({ required_error: "Вкажіть імʼя" })
    .trim()
    .min(2, "Вкажіть імʼя")
    .max(100, "Максимум 100 символів"),
  email: z
    .string({ required_error: "Вкажіть email" })
    .trim()
    .toLowerCase()
    .max(200, "Максимум 200 символів")
    .email("Перевірте адресу email"),
  phone: z
    .string()
    .trim()
    .max(30, "Максимум 30 символів")
    .regex(/^[+\d\s()-]*$/, "Лише цифри, пробіли та символи + ( ) -")
    .optional(),
  consent: z.literal(true, {
    errorMap: () => ({
      message: "Потрібна згода на обробку контактних даних",
    }),
  }),
  /** Honeypot: люди це поле не бачать і не заповнюють. */
  website: z.string().max(200).optional(),
  /** Час (мс, epoch), коли користувач відкрив форму — для перевірки швидкості заповнення. */
  startedAt: z.number().int().nonnegative(),
});

/** Уточнення мають належати саме обраній послузі та мати відомі варіанти відповідей. */
export const checkedOrderSchema = orderSchema.superRefine((value, ctx) => {
  const questions = SERVICE_QUESTIONS[value.service];
  for (const [key, answer] of Object.entries(value.details ?? {})) {
    const question = questions.find((item) => item.id === key);
    if (!question || !question.options.some((option) => option.id === answer)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["details"], message: "Невідоме уточнення" });
      return;
    }
  }
});

export type OrderInput = z.infer<typeof orderSchema>;
export type OrderFieldErrors = Partial<Record<keyof OrderInput, string[]>>;
