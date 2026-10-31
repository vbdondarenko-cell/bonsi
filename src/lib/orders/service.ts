import "server-only";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal";
import { isTelegramEnabled } from "@/lib/notifications/telegram";
import type { OrderInput } from "./schema";

/** Сервер не налаштований (немає змінних середовища). */
export class ConfigError extends Error {}
/** Забагато заявок з однієї адреси / email за короткий час. */
export class RateLimitError extends Error {}
/** База даних недоступна або повернула помилку. */
export class StorageError extends Error {}

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

/** Солоний HMAC: у базі лежить лише хеш підмережі IP, а не сама адреса. */
export function hashValue(value: string): string {
  const salt = process.env.ORDER_HASH_SALT;
  if (!salt || salt.length < 16) {
    throw new ConfigError("ORDER_HASH_SALT не заданий або занадто короткий");
  }
  return createHmac("sha256", salt).update(value).digest("hex");
}

export type OrderMeta = {
  /** Ключ ліміту (IPv4 або IPv6 /64) з довіреного джерела; null, якщо IP невідомий. */
  ipBucket: string | null;
  userAgent: string;
};

/**
 * Зберігає заявку в PostgreSQL (Supabase) через атомарну функцію `create_order`,
 * яка в одній транзакції перевіряє ліміти й вставляє рядок. Повертає номер звернення.
 * Ніколи не повертає «успіх», якщо запис не збережено.
 */
export async function createOrder(
  input: OrderInput,
  meta: OrderMeta,
): Promise<{ ticket: string }> {
  const db = getClient();
  const ipHash = meta.ipBucket ? hashValue(`ip:${meta.ipBucket}`) : null;

  const { data, error } = await db.rpc("create_order", {
    p_service: input.service,
    p_idea: input.idea,
    p_budget: input.budget,
    p_deadline: input.deadline,
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone ? input.phone : null,
    p_ip_hash: ipHash,
    p_user_agent: meta.userAgent.slice(0, 300),
    p_consent_policy_version: PRIVACY_POLICY_VERSION,
    p_notify: isTelegramEnabled(),
  });

  if (error) {
    if (error.message.includes("rate_limited")) throw new RateLimitError();
    throw new StorageError(error.message);
  }
  if (typeof data !== "string" || data === "") {
    throw new StorageError("Порожня відповідь бази даних");
  }
  return { ticket: data };
}
