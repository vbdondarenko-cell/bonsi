import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  formatOrderMessage,
  getTelegramConfig,
  sendTelegramMessage,
  type OrderBrief,
  type OrderNotice,
} from "./telegram";

export type DispatchResult = {
  disabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
};

type ClaimedRow = {
  outbox_id: number;
  attempts: number;
  order_id: string;
  ticket_number: string;
  service: string;
  name: string;
  created_at: string;
};

type Db = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function defaultDb(): Db {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не задані");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Db;
}

/** Читає з БД повну заявку (контакти, відповіді, опис) для внутрішньої групи. */
async function loadBriefFromDb(orderId: string): Promise<OrderBrief | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client
    .from("orders")
    .select("email, phone, idea, deadline, details, links")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return null;
  return data as OrderBrief;
}

/**
 * Забирає з outbox готові повідомлення й доставляє їх у Telegram. Кожна невдача
 * повертає запис у чергу з експоненційною затримкою (див. complete_notification);
 * після 8 спроб запис стає `dead` і лишається в базі для розбору.
 */
export async function dispatchNotifications(
  options: {
    db?: Db;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    limit?: number;
    /** Завантаження повної заявки; за замовчуванням читається з БД, а в тестах з підставною `db` — вимкнено. */
    loadBrief?: (orderId: string) => Promise<OrderBrief | null>;
  } = {},
): Promise<DispatchResult> {
  const loadBrief = options.loadBrief ?? (options.db ? undefined : loadBriefFromDb);
  const config = getTelegramConfig(options.env ?? process.env);
  if (!config) return { disabled: true, claimed: 0, sent: 0, failed: 0 };

  const db = options.db ?? defaultDb();
  const { data, error } = await db.rpc("claim_notifications", { p_limit: options.limit ?? 10 });
  if (error) throw new Error(`claim_notifications: ${error.message}`);

  const rows = (data ?? []) as ClaimedRow[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const notice: OrderNotice = {
      orderId: row.order_id,
      ticket: row.ticket_number,
      service: row.service,
      name: row.name,
      createdAt: row.created_at,
    };
    let failure: string | null = null;
    try {
      // Без повної заявки повідомлення все одно йде (мінімальне): збій читання не блокує сповіщення.
      const brief = loadBrief ? await loadBrief(row.order_id).catch(() => null) : null;
      if (brief) notice.brief = brief;
      const text = formatOrderMessage(notice);
      for (const target of config.targets) {
        await sendTelegramMessage(config, target, text, options.fetchImpl);
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : "unknown error";
    }

    const done = await db.rpc("complete_notification", { p_id: row.outbox_id, p_error: failure });
    if (done.error) throw new Error(`complete_notification: ${done.error.message}`);
    if (failure) failed += 1;
    else sent += 1;
  }

  return { disabled: false, claimed: rows.length, sent, failed };
}

/** Запускає доставку після відповіді користувачу; помилка не впливає на приймання заявки. */
export async function dispatchSafely(): Promise<void> {
  try {
    await dispatchNotifications();
  } catch (err) {
    console.error("[notifications] dispatch failed:", err instanceof Error ? err.message : "unknown error");
  }
}
