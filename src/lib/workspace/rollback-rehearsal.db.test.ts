import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbEnabled, dbUrl, resetDatabase } from "@/test/pg-harness";

/** Відкат схеми 20261106…20261110 повертає базу до стану після 20261105 (структура, функції, політики, тригери, індекси). */
describe.skipIf(!dbEnabled)("відкат схеми 20261106…20261110 (PostgreSQL)", () => {
  let pool: pg.Pool;
  const dir = join(process.cwd(), "supabase", "migrations");
  const rollback = readFileSync(join(process.cwd(), "supabase", "rollback", "20261106_20261110_rollback.sql"), "utf8");
  const forward = ["20261106000000_business_workflow.sql", "20261107000000_studio_operations.sql", "20261108000000_delivery_support.sql", "20261109000000_portfolio.sql", "20261110000000_operations.sql"];
  // Ці два обмеження повертаються як NOT VALID (щоб не видаляти наявні рядки): порівнюємо їх окремо.
  const SKIP_CONSTRAINTS = ["order_events_type_check", "email_outbox_template_check"];

  const snapshot = async () => {
    const q = async (sql: string) => (await pool.query(sql)).rows.map((r) => Object.values(r).join("|"));
    return {
      columns: await q(`select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns where table_schema='public' order by 1,2`),
      functions: await q(`select p.proname, p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace order by 1,2`),
      constraints: await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and conname <> all ($$${"{" + SKIP_CONSTRAINTS.join(",") + "}"}$$::text[]) order by 1,2`.replace(/\$\$\{/, "'{").replace(/\}\$\$/, "}'")),
      triggers: await q(`select tgrelid::regclass::text, tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%' order by 1,2`),
      indexes: await q(`select indexname, indexdef from pg_indexes where schemaname='public' order by 1`),
      policies: await q(`select tablename, policyname, cmd, coalesce(qual,''), coalesce(with_check,'') from pg_policies where schemaname='public' order by 1,2`),
      rls: await q(`select c.relname, c.relrowsecurity from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1`),
      sequences: await q(`select sequencename from pg_sequences where schemaname='public' order by 1`),
    };
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 3 });
    await resetDatabase(pool, { before: "20261106000000" });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("після відкату схема збігається зі станом до 20261106", async () => {
    const before = await snapshot();
    expect(before.columns.length).toBeGreaterThan(150);
    expect(before.functions.length).toBeGreaterThan(60);
    expect(before.policies.length).toBeGreaterThan(20);
    for (const file of forward) await pool.query(readFileSync(join(dir, file), "utf8"));
    expect((await snapshot()).functions.length).toBeGreaterThan(before.functions.length);
    await pool.query(rollback);
    const after = await snapshot();
    for (const key of Object.keys(before) as Array<keyof typeof before>) expect(after[key], key).toEqual(before[key]);
  });

  it("негативний контроль: відкат без однієї команди виявляється порівнянням знімків", async () => {
    const before = await snapshot();
    for (const file of forward) await pool.query(readFileSync(join(dir, file), "utf8"));
    await pool.query(rollback.replace("drop table if exists public.portfolio_items cascade;", "-- пропущено"));
    const after = await snapshot();
    expect(after.columns).not.toEqual(before.columns);
    await pool.query("drop table public.portfolio_items cascade");
    expect(await snapshot()).toEqual(before);
  });

  it("відкат повертає обмеження order_events і email_outbox у старий вигляд без видалення наявних рядків (NOT VALID)", async () => {
    const defs = await pool.query(`select conname, convalidated, pg_get_constraintdef(oid) as def from pg_constraint where conname = any ($1)`, [["order_events_type_check", "email_outbox_template_check"]]);
    expect(defs.rows.map((r) => r.conname).sort()).toEqual(["email_outbox_template_check", "order_events_type_check"]);
    expect(defs.rows.every((r) => r.convalidated === false)).toBe(true);
    expect(defs.rows.find((r) => r.conname === "order_events_type_check").def).not.toContain("rejected");
  });

  it("відкат відмовляється видаляти дані без явного підтвердження", async () => {
    for (const file of forward) await pool.query(readFileSync(join(dir, file), "utf8"));
    await pool.query(`insert into public.portfolio_items (slug, title, summary, task, result, product_type) values ('x-case','Кейс','Короткий опис кейсу','Завдання кейсу тут','Результат кейсу тут','website')`);
    const client = await pool.connect();
    try {
      await expect(client.query(rollback)).rejects.toThrow(/allow_data_loss/);
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect((await pool.query("select count(*)::int as n from public.portfolio_items")).rows[0].n).toBe(1);
    const confirmed = await pool.connect();
    try {
      await confirmed.query("set bonsi.allow_data_loss = 'yes'");
      await confirmed.query(rollback);
    } finally {
      confirmed.release();
    }
    expect((await pool.query("select to_regclass('public.portfolio_items') as t")).rows[0].t).toBeNull();
  });
});
