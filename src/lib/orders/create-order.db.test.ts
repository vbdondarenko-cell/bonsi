import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Інтеграційні тести SQL-функції public.create_order на справжньому PostgreSQL.
 * Запускаються лише в CI (сервіс postgres) або за явного дозволу, бо скидають схему public.
 *   DATABASE_URL=postgres://... ALLOW_DESTRUCTIVE_DB_TEST=1 npm test
 */
const url = process.env.DATABASE_URL;
const enabled = Boolean(url) && process.env.ALLOW_DESTRUCTIVE_DB_TEST === "1";

const { Pool } = pg;

const TICKET = /^BON-\d{4}-\d{5}$/;

describe.skipIf(!enabled)("public.create_order (PostgreSQL)", () => {
  let pool: pg.Pool;
  let counter = 0;

  const call = (
    client: { query: (sql: string, values: unknown[]) => Promise<{ rows: Array<{ ticket: string }> }> },
    { ip, email }: { ip: string | null; email?: string },
  ) => {
    counter += 1;
    return client.query(
      `select public.create_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as ticket`,
      [
        "landing",
        "Потрібен односторінковий сайт для нового продукту.",
        "lt-50k",
        "1-month",
        "Тест",
        email ?? `user${counter}@example.com`,
        null,
        ip,
        "vitest",
        "2026-10-31",
      ],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 60 });
    await pool.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end $$;
    `);
    await pool.query("drop schema public cascade; create schema public;");
    await pool.query("grant usage on schema public to anon, authenticated, service_role;");

    const dir = join(process.cwd(), "supabase", "migrations");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(join(dir, file), "utf8"));
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("створює заявку й повертає номер звернення у форматі BON-YYYY-NNNNN", async () => {
    const { rows } = await call(pool, { ip: "ip-single" });
    expect(rows[0]!.ticket).toMatch(TICKET);

    const stored = await pool.query(
      "select email, consent_policy_version, consent_at, status from public.orders where ticket_number = $1",
      [rows[0]!.ticket],
    );
    expect(stored.rows[0]).toMatchObject({ consent_policy_version: "2026-10-31", status: "new" });
    expect(stored.rows[0].consent_at).toBeInstanceOf(Date);
  });

  it("точно дотримується ліміту IP під 25 паралельними запитами (5 з однієї підмережі)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => call(pool, { ip: "ip-concurrent" })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(20);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason.message).toBe("rate_limited");
    }
    const tickets = ok.map((r) => (r as PromiseFulfilledResult<{ rows: Array<{ ticket: string }> }>).value.rows[0]!.ticket);
    expect(new Set(tickets).size).toBe(5);

    const count = await pool.query("select count(*)::int as n from public.orders where ip_hash = 'ip-concurrent'");
    expect(count.rows[0].n).toBe(5);
  });

  it("точно дотримується ліміту email під 20 паралельними запитами з різних IP (3 з одного email)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => call(pool, { ip: `ip-email-${i}`, email: "Same.Person@Example.com" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(17);

    const count = await pool.query("select count(*)::int as n from public.orders where email = 'same.person@example.com'");
    expect(count.rows[0].n).toBe(3);
  });

  it("невідомий IP (null) ділить спільний ліміт 30/год, а не необмежений", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => call(pool, { ip: null })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(10);
  });

  it("не дає anon і authenticated ні читати таблицю, ні викликати функцію", async () => {
    for (const role of ["anon", "authenticated"]) {
      const client = await pool.connect();
      try {
        await client.query(`set role ${role}`);
        await expect(client.query("select * from public.orders")).rejects.toThrow(/permission denied/);
        await client.query("rollback").catch(() => undefined);
        await expect(call(client, { ip: "ip-forbidden" })).rejects.toThrow(/permission denied/);
      } finally {
        await client.query("reset role").catch(() => undefined);
        client.release();
      }
    }
  });

  it("дозволяє service_role викликати функцію", async () => {
    const client = await pool.connect();
    try {
      await client.query("set role service_role");
      const { rows } = await call(client, { ip: "ip-service-role" });
      expect(rows[0]!.ticket).toMatch(TICKET);
    } finally {
      await client.query("reset role").catch(() => undefined);
      client.release();
    }
  });

  it("відхиляє email у змішаному регістрі в самій таблиці (нормалізація обов'язкова)", async () => {
    await expect(
      pool.query(
        `insert into public.orders (service, idea, budget, deadline, name, email, consent_at, consent_policy_version)
         values ('landing', 'Потрібен односторінковий сайт.', 'lt-50k', '1-month', 'Тест', 'Mixed@Example.com', now(), 'x')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
