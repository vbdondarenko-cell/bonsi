import { z } from "zod";
import { SERVICE_IDS } from "@/lib/orders/options";

export const ORDER_STATUSES = ["new", "in_review", "accepted", "in_progress", "done", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Нова",
  in_review: "У розгляді",
  accepted: "Прийнята",
  in_progress: "У роботі",
  done: "Завершена",
  rejected: "Відхилена",
};

export const PAGE_SIZE = 20;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
  .optional();

const filterSchema = z.object({
  q: optionalText(100),
  status: z.enum(ORDER_STATUSES).optional(),
  service: z.enum(SERVICE_IDS).optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type OrderFilters = {
  q?: string;
  status?: OrderStatus;
  service?: (typeof SERVICE_IDS)[number];
  from?: string;
  to?: string;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

/** Некоректні значення фільтрів не ламають сторінку — просто відкидаються. */
export function parseOrderFilters(params: RawParams): OrderFilters {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const result: OrderFilters = { page: 1 };
  const raw = {
    q: first("q"),
    status: first("status"),
    service: first("service"),
    from: first("from"),
    to: first("to"),
    page: first("page") ?? 1,
  };
  const parsedPage = filterSchema.shape.page.parse(raw.page);
  result.page = parsedPage;
  const q = optionalText(100).safeParse(raw.q);
  if (q.success && q.data) result.q = q.data;
  const status = z.enum(ORDER_STATUSES).safeParse(raw.status);
  if (status.success) result.status = status.data;
  const service = z.enum(SERVICE_IDS).safeParse(raw.service);
  if (service.success) result.service = service.data;
  const from = optionalDate.safeParse(raw.from);
  if (from.success && from.data) result.from = from.data;
  const to = optionalDate.safeParse(raw.to);
  if (to.success && to.data) result.to = to.data;
  return result;
}

/** Аргументи для SQL-функції admin_search_orders (діапазон дат — за UTC, «до» включно). */
export function toSearchArgs(filters: OrderFilters) {
  const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
  return {
    p_q: filters.q ?? null,
    p_status: filters.status ?? null,
    p_service: filters.service ?? null,
    p_from: filters.from ? `${filters.from}T00:00:00Z` : null,
    p_to: filters.to ? nextDay(filters.to) : null,
    p_limit: PAGE_SIZE,
    p_offset: (filters.page - 1) * PAGE_SIZE,
  };
}

export function filtersToQuery(filters: Partial<OrderFilters>, overrides: Partial<OrderFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const search = new URLSearchParams();
  if (merged.q) search.set("q", merged.q);
  if (merged.status) search.set("status", merged.status);
  if (merged.service) search.set("service", merged.service);
  if (merged.from) search.set("from", merged.from);
  if (merged.to) search.set("to", merged.to);
  if (merged.page && merged.page > 1) search.set("page", String(merged.page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const uuidSchema = z.string().uuid();

export const statusInput = z.object({ orderId: uuidSchema, status: z.enum(ORDER_STATUSES) });
export const assignInput = z.object({
  orderId: uuidSchema,
  assignee: z.union([z.literal(""), uuidSchema]).transform((value) => (value === "" ? null : value)),
});
export const noteInput = z.object({
  orderId: uuidSchema,
  body: z.string().trim().min(1, "Введіть текст нотатки").max(4000, "Максимум 4000 символів"),
});
