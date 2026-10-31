import { z } from "zod";
import { BUDGET_IDS, DEADLINE_IDS, SERVICE_IDS } from "./options";

/**
 * Єдина схема для клієнта і сервера. Клієнтська перевірка — лише зручність,
 * остаточна валідація завжди відбувається в route handler.
 */
export const orderSchema = z.object({
  service: z.enum(SERVICE_IDS, {
    errorMap: () => ({ message: "Оберіть тип послуги" }),
  }),
  idea: z
    .string({ required_error: "Опишіть ідею проєкту" })
    .trim()
    .min(20, "Опишіть ідею детальніше — щонайменше 20 символів")
    .max(3000, "Максимум 3000 символів"),
  budget: z.enum(BUDGET_IDS, {
    errorMap: () => ({ message: "Оберіть орієнтовний бюджет" }),
  }),
  deadline: z.enum(DEADLINE_IDS, {
    errorMap: () => ({ message: "Оберіть бажані терміни" }),
  }),
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

export type OrderInput = z.infer<typeof orderSchema>;
export type OrderFieldErrors = Partial<Record<keyof OrderInput, string[]>>;
