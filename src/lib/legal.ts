/**
 * Версія політики конфіденційності. Змінюючи текст на /privacy по суті,
 * оновіть цю константу: вона записується разом із кожною згодою.
 */
export const PRIVACY_POLICY_VERSION = "2026-11-28";
export const PRIVACY_POLICY_DATE_LABEL = "28 листопада 2026 року";

export const legal = {
  /** Назва оператора персональних даних (ФОП / ТОВ). До заповнення — назва студії. */
  operatorName: process.env.NEXT_PUBLIC_LEGAL_NAME || "BONSI Studios",
  /** Email для звернень щодо персональних даних. null — звернення приймаємо через форму. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || null,
} as const;
