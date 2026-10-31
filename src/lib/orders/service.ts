import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { OrderInput } from "./schema";

/** Сервер не налаштований (немає змінних середовища). */
export class ConfigError extends Error {}
/** Забагато заявок з однієї адреси за короткий час. */
export class RateLimitError extends Error {}
/** База даних недоступна або повернула помилку. */
export class StorageError extends Error {}

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ConfigError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не задані");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hashIp(ip: string): string {
  const salt = process.env.ORDER_HASH_SALT;
  if (!salt) throw new ConfigError("ORDER_HASH_SALT не заданий");
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export type OrderMeta = { ip: string; userAgent: string };

/**
 * Зберігає заявку в PostgreSQL (Supabase) і повертає номер звернення.
 * Ніколи не повертає «успіх», якщо запис не збережено.
 */
export async function createOrder(
  input: OrderInput,
  meta: OrderMeta,
): Promise<{ ticket: string }> {
  const db = getClient();
  const ipHash = hashIp(meta.ip);

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error: countError } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (countError) throw new StorageError(countError.message);
  if ((count ?? 0) >= MAX_PER_WINDOW) throw new RateLimitError();

  const { data, error } = await db
    .from("orders")
    .insert({
      service: input.service,
      idea: input.idea,
      budget: input.budget,
      deadline: input.deadline,
      name: input.name,
      email: input.email,
      phone: input.phone ? input.phone : null,
      ip_hash: ipHash,
      user_agent: meta.userAgent.slice(0, 300),
    })
    .select("ticket_number")
    .single();

  if (error || !data) {
    throw new StorageError(error?.message ?? "Порожня відповідь бази даних");
  }
  return { ticket: String(data.ticket_number) };
}
