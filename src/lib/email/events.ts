import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueEmail } from "./service";
import type { EmailTemplate } from "./templates";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type ProjectContext = { title: string; clientEmail: string | null; clientName: string | null };

/** Назва проєкту й пошта клієнта (з Auth). Без клієнта (проєкт ще не привʼязаний) листа немає — це не помилка. */
export async function projectContext(db: SupabaseClient, projectId: string): Promise<ProjectContext | null> {
  const project = await db.from("projects").select("title, client_id").eq("id", projectId).maybeSingle();
  if (project.error || !project.data?.client_id) return null;
  const user = await db.auth.admin.getUserById(project.data.client_id as string);
  const email = user.data.user?.email?.trim().toLowerCase() ?? null;
  return { title: project.data.title as string, clientEmail: email, clientName: null };
}

export type ProjectEmail = {
  projectId: string;
  template: EmailTemplate;
  /** Стабільний ключ події: повтор дії не створює другого листа. */
  key: string;
  payload?: Record<string, unknown>;
};

/**
 * Ставить лист клієнту проєкту в чергу. Ніколи не кидає помилку: подію (повідомлення, рахунок, оплата) вже збережено,
 * а лист — наслідок; якщо черги ще немає (міграцію не застосовано) або сервіс недоступний, дія студії не ламається.
 * Порожні листи не створюються: немає адресата — немає запису.
 */
export async function queueProjectEmail(input: ProjectEmail, db?: SupabaseClient): Promise<boolean> {
  try {
    const service = db ?? createSupabaseServiceClient();
    const context = await projectContext(service, input.projectId);
    if (!context?.clientEmail) return false;
    await enqueueEmail(service, {
      key: input.key,
      template: input.template,
      to: context.clientEmail,
      locale: "uk",
      payload: { title: context.title, ...input.payload },
      projectId: input.projectId,
    });
    return true;
  } catch (error) {
    console.error("[email] enqueue failed:", input.template, error instanceof Error ? error.message : "unknown");
    return false;
  }
}

/** Вікно для листів, що можуть повторюватися часто (чат): не більше одного листа на проєкт за 15 хвилин. */
export const quarterHour = (now = Date.now()) => Math.floor(now / (15 * 60_000));
