import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/**
 * run_operation: атомарне виконання неідемпотентних дій (захоплення ID + бізнес-функція + результат в одній транзакції).
 * Сценарії: подвійний клік, паралельні дублі, повтор після таймауту/перезапуску, чужий або перевикористаний ID,
 * відкат при помилці, повторні фінансові операції.
 */
describe.skipIf(!dbEnabled)("run_operation (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ADMIN2 = "abababab-abab-4bab-8bab-abababababab";
  const CLIENT = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const admin2: Session = { sub: ADMIN2, aal: "aal2" };
  const noMfa: Session = { sub: ADMIN, aal: "aal1" };
  const client: Session = { sub: CLIENT, aal: "aal1" };
  let projectId = "";
  let n = 0;
  const op = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  const run = (s: Session, id: string | null, fn: string, args: object) =>
    asUserCommit(pool, s, (q) => q("select public.run_operation($1, $2, $3::jsonb) as r", [id, fn, JSON.stringify(args)])).then((r) => r.rows[0].r as { replayed: boolean; result: unknown });
  const count = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0].n as number;
  const taskArgs = (title: string) => ({ p_title: title, p_description: "", p_project: projectId, p_assignee: null, p_priority: "high", p_deadline: null, p_status: "backlog" });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
    await resetDatabase(pool);
    await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1,'a1@bonsi.test',now()),($2,'a2@bonsi.test',now()),($3,'c@example.com',now())", [ADMIN, ADMIN2, CLIENT]);
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'a1@bonsi.test','A1'),($2,'a2@bonsi.test','A2')", [ADMIN, ADMIN2]);
    await pool.query(`select public.create_order_v2('webapp', 'Сайт', null, null, 'Клієнт', 'c@example.com', null, '{}'::jsonb, '{}', 'ip-ops', 'vitest', '2026-11-10', false)`);
    await asUserCommit(pool, client, (q) => q("select public.client_claim_orders()"));
    projectId = (await pool.query("select id from public.projects where client_id=$1", [CLIENT])).rows[0].id;
    await pool.query("update public.projects set activated_at = now() where id=$1", [projectId]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("основні стани", () => {
    it("нова операція виконується один раз; повтор (таймаут, подвійний клік) повертає збережений результат без нового запису", async () => {
      const id = op();
      const first = await run(admin, id, "admin_create_task", taskArgs("Подвійний клік"));
      expect(first.replayed).toBe(false);
      const again = await run(admin, id, "admin_create_task", taskArgs("Подвійний клік"));
      expect(again).toEqual({ replayed: true, result: first.result });
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Подвійний клік'")).toBe(1);
    });

    it("повтор після «перезапуску сервера» (новий пул з'єднань) також не виконує дію вдруге", async () => {
      const id = op();
      const first = await run(admin, id, "admin_create_task", taskArgs("Після перезапуску"));
      const fresh = new pg.Pool({ connectionString: dbUrl, max: 2 });
      try {
        const r = await asUserCommit(fresh, admin, (q) => q("select public.run_operation($1,'admin_create_task',$2::jsonb) as r", [id, JSON.stringify(taskArgs("Після перезапуску"))]));
        expect(r.rows[0].r).toEqual({ replayed: true, result: first.result });
      } finally {
        await fresh.end();
      }
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Після перезапуску'")).toBe(1);
    });

    it("паралельні дублі: виконується рівно один, решта отримують той самий результат", async () => {
      const id = op();
      const results = await Promise.all(Array.from({ length: 10 }, () => run(admin, id, "admin_create_task", taskArgs("Паралельно"))));
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(results.map((r) => JSON.stringify(r.result))).size).toBe(1);
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Паралельно'")).toBe(1);
      expect(await count("select count(*)::int as n from public.operations where op_id=$1", [id])).toBe(1);
    });

    it("помилка бізнес-функції відкочує все разом із записом операції: повтор з тим самим ID виконується", async () => {
      const id = op();
      await expect(run(admin, id, "admin_create_task", { ...taskArgs("Помилка"), p_priority: "неіснуючий" })).rejects.toThrow();
      expect(await count("select count(*)::int as n from public.operations where op_id=$1", [id])).toBe(0);
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Помилка'")).toBe(0);
      const ok = await run(admin, id, "admin_create_task", taskArgs("Помилка"));
      expect(ok.replayed).toBe(false);
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Помилка'")).toBe(1);
    });

    it("записи операцій не видаляються автоматично: пізній повтор лишається безпечним", async () => {
      const id = op();
      await run(admin, id, "admin_create_task", taskArgs("Пізній повтор"));
      await pool.query("update public.operations set created_at = now() - interval '400 days' where op_id=$1", [id]);
      await run(admin, op(), "admin_create_task", taskArgs("Інша дія"));
      expect(await count("select count(*)::int as n from public.operations where op_id=$1", [id])).toBe(1);
      expect((await run(admin, id, "admin_create_task", taskArgs("Пізній повтор"))).replayed).toBe(true);
    });
  });

  describe("конфлікти й права", () => {
    it("той самий ID для іншої функції або інших аргументів — operation_conflict", async () => {
      const id = op();
      await run(admin, id, "admin_create_task", taskArgs("Конфлікт"));
      await expect(run(admin, id, "admin_create_task", taskArgs("Інша назва"))).rejects.toThrow(/operation_conflict/);
      await expect(run(admin, id, "admin_comment_task", { p_id: "11111111-1111-4111-8111-111111111111", p_body: "x" })).rejects.toThrow(/operation_conflict/);
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Інша назва'")).toBe(0);
    });

    it("чужий ID: інший користувач не отримує результат і не виконує дію", async () => {
      const id = op();
      const first = await run(admin, id, "admin_create_task", taskArgs("Чужий ID"));
      await expect(run(admin2, id, "admin_create_task", taskArgs("Чужий ID"))).rejects.toThrow(/operation_conflict/);
      try {
        await run(admin2, id, "admin_create_task", taskArgs("Чужий ID"));
      } catch (e) {
        expect(String(e)).not.toContain(JSON.stringify(first.result).replace(/"/g, ""));
      }
      expect(await count("select count(*)::int as n from public.studio_tasks where title='Чужий ID'")).toBe(1);
    });

    it("клієнт не може викликати адмінську функцію, адмін без MFA — теж; невідомі функції заборонені", async () => {
      await expect(run(client, op(), "admin_create_task", taskArgs("Клієнт"))).rejects.toThrow(/forbidden/);
      await expect(run(noMfa, op(), "admin_create_task", taskArgs("Без MFA"))).rejects.toThrow(/forbidden/);
      await expect(run(admin, op(), "create_order_v2", {})).rejects.toThrow(/operation_not_allowed/);
      await expect(run(admin, op(), "drop_everything", {})).rejects.toThrow(/operation_not_allowed/);
      await expect(asUser(pool, null, (q) => q("select public.run_operation($1,'admin_create_task','{}'::jsonb)", [op()]))).rejects.toThrow(/permission denied/);
    });

    it("некоректні вхідні дані: відсутній ID, не-об'єкт, ключі не p_*", async () => {
      await expect(run(admin, null, "admin_create_task", taskArgs("x"))).rejects.toThrow(/operation_id_required/);
      await expect(asUserCommit(pool, admin, (q) => q("select public.run_operation($1,'admin_create_task','[]'::jsonb)", [op()]))).rejects.toThrow(/operation_args_invalid/);
      await expect(run(admin, op(), "admin_create_task", { "title; drop table x": "1" })).rejects.toThrow(/operation_args_invalid/);
      await expect(run(admin, op(), "admin_create_task", { "P_TITLE": "1" })).rejects.toThrow(/operation_args_invalid/);
    });

    it("значення аргументів не є SQL: лапки й спецсимволи зберігаються як текст", async () => {
      const title = "O'Reilly'; delete from public.studio_tasks; --";
      await run(admin, op(), "admin_create_task", taskArgs(title));
      expect(await count("select count(*)::int as n from public.studio_tasks where title=$1", [title])).toBe(1);
      expect(await count("select count(*)::int as n from public.studio_tasks")).toBeGreaterThan(3);
    });

    it("таблицю операцій не можна ні читати, ні змінювати з клієнтських ролей", async () => {
      await expect(asUser(pool, admin, (q) => q("select * from public.operations"))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, admin, (q) => q("delete from public.operations"))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, null, (q) => q("select * from public.operations"))).rejects.toThrow(/permission denied/);
    });
  });

  describe("фінансові повтори", () => {
    let invoice = "";
    const newPaidReport = async () => {
      await asUserCommit(pool, client, (q) => q("select public.client_report_payment($1,'ref')", [invoice]));
      return (await pool.query("select id from public.payments where invoice_id=$1 and status='pending' order by created_at desc limit 1", [invoice])).rows[0].id as string;
    };

    it("створення рахунку: повтор з тим самим ID дає один рахунок", async () => {
      const id = op();
      const args = { p_project: projectId, p_label: "Оплата 1", p_amount: 1000, p_currency: "UAH", p_due: null };
      const first = await run(admin, id, "admin_create_invoice", args);
      await run(admin, id, "admin_create_invoice", args);
      invoice = String(first.result);
      expect(await count("select count(*)::int as n from public.invoices where project_id=$1 and label='Оплата 1'", [projectId])).toBe(1);
      await asUserCommit(pool, admin, (q) => q("select public.admin_issue_invoice($1)", [invoice]));
    });

    it("підтвердження оплати: подвійний клік (той самий ID) і друге підтвердження (інший ID) не подвоюють платіж", async () => {
      const pid = await newPaidReport();
      const id = op();
      const args = { p_payment: pid, p_amount: null, p_note: "ok" };
      const results = await Promise.allSettled([run(admin, id, "admin_confirm_payment", args), run(admin, id, "admin_confirm_payment", args), run(admin2, op(), "admin_confirm_payment", args)]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
      const confirmed = await pool.query("select count(*)::int as n, coalesce(sum(amount),0)::text as s from public.payments where invoice_id=$1 and status='confirmed' and kind='payment'", [invoice]);
      expect(confirmed.rows[0]).toEqual({ n: 1, s: "1000.00" });
      // Повторне підтвердження вже підтвердженого платежу з новим ID відхиляється бізнес-правилом.
      await expect(run(admin, op(), "admin_confirm_payment", args)).rejects.toThrow(/not_pending/);
    });

    it("повернення коштів: подвійний клік з тим самим ID — одне повернення; нове повернення не перевищує сплачене", async () => {
      const id = op();
      const args = { p_invoice: invoice, p_amount: 400, p_note: "повернення" };
      await Promise.all([run(admin, id, "admin_record_refund", args), run(admin, id, "admin_record_refund", args)]);
      expect(await count("select count(*)::int as n from public.payments where invoice_id=$1 and kind='refund'", [invoice])).toBe(1);
      await expect(run(admin, op(), "admin_record_refund", { ...args, p_amount: 700 })).rejects.toThrow(/refund_exceeds_paid/);
      expect(await count("select count(*)::int as n from public.payments where invoice_id=$1 and kind='refund'", [invoice])).toBe(1);
    });
  });

  describe("клієнтські дії", () => {
    it("звернення й повідомлення: повтор з тим самим ID не створює дублікатів; чужий ID відхиляється", async () => {
      const t = op();
      const ticket = { p_project: projectId, p_category: "bug", p_priority: "normal", p_subject: "Повтор звернення", p_description: "Опис звернення для перевірки." };
      const a = await run(client, t, "client_create_ticket", ticket);
      const b = await run(client, t, "client_create_ticket", ticket);
      expect(b).toEqual({ replayed: true, result: a.result });
      expect(await count("select count(*)::int as n from public.support_tickets where subject='Повтор звернення'")).toBe(1);

      const m = op();
      await Promise.all([1, 2, 3].map(() => run(client, m, "client_send_message", { p_project: projectId, p_body: "Одне повідомлення" })));
      expect(await count("select count(*)::int as n from public.project_messages where body='Одне повідомлення'")).toBe(1);

      await expect(run(admin, t, "admin_create_task", taskArgs("Захоплений клієнтом ID"))).rejects.toThrow(/operation_conflict/);
      await expect(run(client, op(), "admin_create_task", taskArgs("Клієнт"))).rejects.toThrow(/forbidden/);
    });
  });
});
