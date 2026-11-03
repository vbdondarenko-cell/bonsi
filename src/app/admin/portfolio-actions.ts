"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { once } from "@/lib/admin/once";
import type { ActionState } from "./actions";

const uuid = z.string().uuid();
const ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  not_found: "Запис не знайдено.",
  stale: "Запис уже змінив інший адміністратор. Оновіть сторінку й повторіть дію.",
  consent_required: "Опублікувати можна лише після підтвердження згоди власника проєкту.",
  consent_note_required: "Вкажіть, як саме отримано згоду власника (від 5 символів).",
  "duplicate key": "Запис із таким адресним ім'ям (slug) уже існує.",
  "check constraint": "Перевірте поля: slug — латиниця, цифри й дефіси; посилання — лише https; довжини текстів обмежені.",
};
const message = (e: { message: string }) => ERRORS[Object.keys(ERRORS).find((k) => e.message.includes(k)) ?? ""] ?? "Не вдалося виконати дію. Спробуйте ще раз.";
const text = (name: string, fd: FormData) => String(fd.get(name) ?? "").trim();

function fieldsOf(fd: FormData) {
  return {
    slug: text("slug", fd), title: text("title", fd), summary: text("summary", fd), task: text("task", fd), result: text("result", fd),
    stack: text("stack", fd).split(",").map((s) => s.trim()).filter(Boolean), product_type: text("product_type", fd),
    cover_url: text("cover_url", fd), cover_alt: text("cover_alt", fd), live_url: text("live_url", fd), project_id: text("project_id", fd),
  };
}

export const savePortfolioAction = once("savePortfolioAction", async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
  const admin = await requireAdmin();
  const id = z.union([uuid, z.literal("")]).safeParse(formData.get("id") ?? "");
  const expected = z.coerce.number().int().min(0).safeParse(formData.get("version") ?? 0);
  const fields = fieldsOf(formData);
  if (!id.success || !expected.success || !z.enum(["website", "web_app", "mobile", "other"]).safeParse(fields.product_type).success) return { error: "Некоректні дані." };
  if (fields.project_id && !uuid.safeParse(fields.project_id).success) return { error: "Некоректний проєкт." };
  const { data, error } = await admin.supabase.rpc("admin_save_portfolio_item", { p_id: id.data || null, p_expected: expected.data, p_fields: fields });
  if (error) return { error: message(error) };
  revalidatePath("/admin/portfolio");
  if (!id.data) redirect(`/admin/portfolio/${String(data)}`);
  revalidatePath(`/admin/portfolio/${id.data}`);
  revalidatePath("/portfolio");
  revalidatePath("/portfolio/[slug]", "page");
  return { ok: true, notice: "Збережено. Якщо запис був опублікований, його повернуто в чернетку — потрібне нове підтвердження згоди." };
});

export const confirmConsentAction = once("confirmConsentAction", async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
  const admin = await requireAdmin();
  const parsed = z.object({ id: uuid, note: z.string().trim().min(5, "Вкажіть, як отримано згоду (від 5 символів).").max(500) }).safeParse({ id: formData.get("id"), note: formData.get("note") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_confirm_portfolio_consent", { p_id: parsed.data.id, p_note: parsed.data.note });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/portfolio/${parsed.data.id}`);
  return { ok: true, notice: "Згоду власника підтверджено." };
});

export const setPortfolioStatusAction = once("setPortfolioStatusAction", async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
  const admin = await requireAdmin();
  const parsed = z.object({ id: uuid, version: z.coerce.number().int().min(1), status: z.enum(["draft", "published", "archived"]) }).safeParse({ id: formData.get("id"), version: formData.get("version"), status: formData.get("status") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_set_portfolio_status", { p_id: parsed.data.id, p_expected: parsed.data.version, p_status: parsed.data.status });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/portfolio/${parsed.data.id}`);
  revalidatePath("/admin/portfolio");
  revalidatePath("/portfolio");
  revalidatePath("/portfolio/[slug]", "page");
  revalidatePath("/sitemap.xml");
  return { ok: true, notice: parsed.data.status === "published" ? "Кейс опубліковано." : parsed.data.status === "archived" ? "Кейс заархівовано." : "Кейс знято з публікації." };
});
