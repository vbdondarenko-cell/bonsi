import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/**
 * Репетиція розгортання: схема «як у production» (міграції до 20261103) + дані → нові міграції по одній → дані не змінились,
 * RLS і права на місці, повторне застосування відомих міграцій безпечне. Це не замінює перевірку на копії реального production.
 */
const NEW_FROM = "20261104000000";

describe.skipIf(!dbEnabled)("репетиція міграцій 20261104…20261110 (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CLIENT = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const client: Session = { sub: CLIENT, aal: "aal1" };
  const dir = join(process.cwd(), "supabase", "migrations");
  const newFiles = readdirSync(dir).filter((n) => n.endsWith(".sql") && n >= NEW_FROM).sort();
  const original = new Map<string, string[]>(); // таблиця -> колонки до міграцій
  let before: Record<string, { n: number; hash: string }> = {};
  const timings: Array<{ file: string; ms: number }> = [];

  const rowsBefore = new Map<string, Array<Record<string, unknown>>>();
  /** Діагностика: які саме колонки початкової таблиці змінились (для зрозумілого повідомлення про збій). */
  const changedColumns = async (table: string) => {
    const columns = original.get(table)!;
    const list = columns.map((c) => `"${c}"`).join(", ");
    const now = (await pool.query(`select ${list} from public."${table}" order by 1`)).rows as Array<Record<string, unknown>>;
    const old = rowsBefore.get(table) ?? [];
    const changed = new Set<string>();
    old.forEach((row, i) => columns.forEach((c) => JSON.stringify(row[c]) !== JSON.stringify(now[i]?.[c]) && changed.add(c)));
    return [...changed];
  };
  const snapshot = async () => {
    const out: Record<string, { n: number; hash: string }> = {};
    for (const [table, columns] of original) {
      const list = columns.map((c) => `"${c}"`).join(", ");
      const r = await pool.query(`select count(*)::int as n, coalesce(md5(string_agg(sub::text, '|' order by sub::text)), '') as hash from (select ${list} from public."${table}") sub`);
      out[table] = r.rows[0];
    }
    return out;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
    await resetDatabase(pool, { before: NEW_FROM });
    await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'client@example.com',now())", [ADMIN, CLIENT]);
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін')", [ADMIN]);
    for (let i = 1; i <= 3; i++) {
      await pool.query(`select public.create_order_v2('webapp', $1, null, null, 'Клієнт', 'client@example.com', null, '{}'::jsonb, '{}', $2, 'vitest', '2026-11-03', false)`, [`Ідея ${i}`, `ip-${i}`]);
    }
    await asUserCommit(pool, client, (q) => q("select public.client_claim_orders()"));
    const projects = (await pool.query("select id from public.projects order by created_at")).rows;
    const project = projects[0].id as string;
    await asUserCommit(pool, admin, async (q) => {
      await q("select public.admin_send_message($1,'Вітаємо')", [project]);
      await q("select public.admin_add_internal_note($1,'Нотатка')", [project]);
      const proposal = (await q("select public.admin_create_proposal($1, null) as id", [project])).rows[0].id;
      await q("select public.admin_update_proposal($1,'Сайт','Опис','[\"Дизайн\"]'::jsonb,1000,'UAH',30,'[{\"label\":\"Оплата\",\"percent\":100}]'::jsonb,2,'Умови')", [proposal]);
      await q("select public.admin_send_proposal($1)", [proposal]);
    });
    const proposal = (await pool.query("select id from public.proposals where project_id=$1", [project])).rows[0].id;
    await asUserCommit(pool, client, (q) => q("select public.client_decide_proposal($1,'approved',null)", [proposal]));
    await asUserCommit(pool, admin, async (q) => {
      const inv = (await q("select public.admin_create_invoice($1,'Оплата',1000,'UAH',null) as id", [project])).rows[0].id;
      await q("select public.admin_issue_invoice($1)", [inv]);
    });
    const inv = (await pool.query("select id from public.invoices limit 1")).rows[0].id;
    await asUserCommit(pool, client, (q) => q("select public.client_report_payment($1,'ref')", [inv]));
    const pay = (await pool.query("select id from public.payments where status='pending' limit 1")).rows[0].id;
    await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,'ok')", [pay]));

    const cols = await pool.query("select table_name, array_agg(column_name::text order by ordinal_position) as cols from information_schema.columns where table_schema='public' group by 1");
    for (const r of cols.rows) original.set(r.table_name, r.cols);
    before = await snapshot();
    for (const [table, columns] of original) rowsBefore.set(table, (await pool.query(`select ${columns.map((c) => `"${c}"`).join(", ")} from public."${table}" order by 1`)).rows);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("початкові дані «production-подібні» і непорожні", () => {
    expect(before.orders.n).toBe(3);
    expect(before.projects.n).toBe(3);
    expect(before.payments.n).toBeGreaterThanOrEqual(1);
    expect(before.invoices.n).toBe(1);
  });

  it("міграції застосовуються по одній без помилок", async () => {
    expect(newFiles).toEqual(["20261104000000_audit_hardening.sql", "20261105000000_email_queue_ops.sql", "20261106000000_business_workflow.sql", "20261107000000_studio_operations.sql", "20261108000000_delivery_support.sql", "20261109000000_portfolio.sql", "20261110000000_operations.sql"]);
    for (const file of newFiles) {
      const t0 = Date.now();
      await pool.query(readFileSync(join(dir, file), "utf8"));
      timings.push({ file, ms: Date.now() - t0 });
    }
    console.info("[rehearsal] timings", JSON.stringify(timings));
  });

  it("дані, що існували до міграцій, не змінились (кількість і вміст початкових колонок)", async () => {
    const after = await snapshot();
    for (const table of Object.keys(before)) {
      if (JSON.stringify(after[table]) !== JSON.stringify(before[table])) expect.fail(`таблиця ${table}: змінились колонки ${(await changedColumns(table)).join(", ")}`);
    }
  });

  it("існуючі проєкти зберігають чинність (activated_at заповнено), а старі заявки не втрачені", async () => {
    expect((await pool.query("select count(*)::int as n from public.projects where activated_at is null")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from public.orders")).rows[0].n).toBe(3);
  });

  it("RLS увімкнено на всіх таблицях public; anon не має прав на таблиці", async () => {
    const off = await pool.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
    expect(off.rows.map((r) => r.relname)).toEqual([]);
    const anon = await pool.query("select table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon'");
    expect(anon.rows.map((r) => r.table_name)).toEqual([]);
  });

  it("усі SECURITY DEFINER-функції мають фіксований search_path", async () => {
    const bad = await pool.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`);
    expect(bad.rows.map((r) => r.proname)).toEqual([]);
  });

  it("anon/PUBLIC не можуть виконувати жодну функцію public", async () => {
    const open = await pool.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and has_function_privilege('anon', p.oid, 'execute')
        and p.prorettype <> 'pg_catalog.trigger'::regtype -- тригерні функції не можна викликати напряму
      order by 1`);
    // Виключення: чисті IMMUTABLE-валідатори для CHECK-обмежень (не читають таблиць, не мають побічних ефектів).
    const allowed = ["valid_task_checklist", "valid_task_links"];
    expect(open.rows.map((r) => r.proname).filter((n) => !allowed.includes(n))).toEqual([]);
  });

  it("повторне застосування: яка міграція безпечно повторюється", async () => {
    const results: Record<string, "ok" | string> = {};
    for (const file of newFiles) {
      try {
        await pool.query(readFileSync(join(dir, file), "utf8"));
        results[file] = "ok";
      } catch (e) {
        results[file] = (e as Error).message.slice(0, 80);
      }
    }
    console.info("[rehearsal] re-apply", JSON.stringify(results));
    // Дані після повторного застосування не змінились, навіть якщо міграція відхилила повтор.
    const after = await snapshot();
    for (const table of Object.keys(before)) expect(after[table], `таблиця ${table}`).toEqual(before[table]);
  });
});
