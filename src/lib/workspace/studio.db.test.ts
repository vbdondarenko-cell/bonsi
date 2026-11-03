import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/** V0.5 фаза 2: завдання (Kanban), кошториси, витрати й фінансове зведення. Усе — лише для адміністратора з MFA. */
describe.skipIf(!dbEnabled)("операції студії V0.5 (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ADMIN2 = "abababab-abab-4bab-8bab-abababababab";
  const CLIENT_A = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const admin2: Session = { sub: ADMIN2, aal: "aal2" };
  const adminNoMfa: Session = { sub: ADMIN, aal: "aal1" };
  const a: Session = { sub: CLIENT_A, aal: "aal1" };
  let projectA = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
    await resetDatabase(pool);
    await pool.query(`insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'admin2@bonsi.test',now()),($3,'a@example.com',now())`, [ADMIN, ADMIN2, CLIENT_A]);
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін 1'),($2,'admin2@bonsi.test','Адмін 2')", [ADMIN, ADMIN2]);
    await pool.query(`select public.create_order_v2('webapp', 'Сайт', null, null, 'Клієнт Тест', 'a@example.com', null, '{}'::jsonb, '{}', 'ip-studio', 'vitest', '2026-11-07', false)`);
    await asUserCommit(pool, a, (q) => q("select public.client_claim_orders()"));
    projectA = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_A])).rows[0].id;
    await pool.query("update public.projects set activated_at = now() where id=$1", [projectA]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("завдання", () => {
    let task = "";
    it("створення й читання: клієнт нічого не бачить і не може викликати функції", async () => {
      task = (await asUserCommit(pool, admin, (q) => q("select public.admin_create_task('Зверстати головну','Опис',$1,$2,'high','2026-12-01') as id", [projectA, ADMIN]))).rows[0].id;
      expect((await asUser(pool, admin2, (q) => q("select id from public.studio_tasks"))).rows).toHaveLength(1);
      for (const table of ["studio_tasks", "task_comments", "task_events", "estimates", "estimate_lines", "project_expenses"]) {
        expect((await asUser(pool, a, (q) => q(`select count(*)::int as n from public.${table}`))).rows[0].n, table).toBe(0);
        expect((await asUser(pool, adminNoMfa, (q) => q(`select count(*)::int as n from public.${table}`))).rows[0].n, `${table} без MFA`).toBe(0);
        await expect(asUser(pool, null, (q) => q(`select * from public.${table}`)), `${table} anon`).rejects.toThrow(/permission denied/);
      }
      await expect(asUser(pool, a, (q) => q("select public.admin_create_task('x','',null,null,'normal',null)"))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, adminNoMfa, (q) => q("select public.admin_create_task('x','',null,null,'normal',null)"))).rejects.toThrow(/forbidden/);
    });

    it("рух по дошці: заблокувати можна лише з причиною; завершення фіксує час; повернення очищує причину", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_move_task($1,1,'blocked',null)", [task]))).rejects.toThrow(/blocked_reason_required/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_move_task($1,1,'blocked','Чекаємо макети від клієнта')", [task]));
      let row = (await pool.query("select status, blocked_reason, version from public.studio_tasks where id=$1", [task])).rows[0];
      expect(row).toEqual({ status: "blocked", blocked_reason: "Чекаємо макети від клієнта", version: 2 });
      await asUserCommit(pool, admin, (q) => q("select public.admin_move_task($1,2,'in_progress')", [task]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_move_task($1,3,'done')", [task]));
      row = (await pool.query("select status, blocked_reason, done_at is not null as done, version from public.studio_tasks where id=$1", [task])).rows[0];
      expect(row).toEqual({ status: "done", blocked_reason: null, done: true, version: 4 });
    });

    it("історія змін незмінна й повна", async () => {
      const events = (await pool.query("select type from public.task_events where task_id=$1 order by id", [task])).rows.map((r) => r.type);
      expect(events).toEqual(["created", "status_changed", "status_changed", "status_changed"]);
      await expect(pool.query("update public.task_events set type='created'")).rejects.toThrow(/append_only/);
    });

    it("конкурентні зміни: двоє адміністраторів з однієї версії — проходить одна, друга отримує stale", async () => {
      const t = (await asUserCommit(pool, admin, (q) => q("select public.admin_create_task('Конкуренція','',null,null,'normal',null,'todo') as id"))).rows[0].id;
      const results = await Promise.allSettled([
        asUserCommit(pool, admin, (q) => q("select public.admin_move_task($1,1,'in_progress')", [t])),
        asUserCommit(pool, admin2, (q) => q("select public.admin_move_task($1,1,'in_review')", [t])),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/stale/);
      expect((await pool.query("select version from public.studio_tasks where id=$1", [t])).rows[0].version).toBe(2);
    });

    it("оновлення полів з перевіркою версії; чекліст і посилання валідуються (лише https, відомі типи)", async () => {
      const t = (await asUserCommit(pool, admin, (q) => q("select public.admin_create_task('Поля','',null,null,'normal',null,'todo') as id"))).rows[0].id;
      const links = JSON.stringify([{ kind: "github", url: "https://github.com/org/repo/pull/1" }, { kind: "figma", url: "https://www.figma.com/design/x" }]);
      const list = JSON.stringify([{ text: "Макет", done: true }, { text: "Тести", done: false }]);
      const v = (await asUserCommit(pool, admin, (q) => q("select public.admin_update_task($1,1,'Нова назва','Опис',null,$2,'urgent','2026-12-05','Залежить від API',$3::jsonb,$4::jsonb) as v", [t, ADMIN2, list, links]))).rows[0].v;
      expect(v).toBe(2);
      await expect(asUser(pool, admin, (q) => q("select public.admin_update_task($1,1,'x','',null,null,'normal',null,null,null,null)", [t]))).rejects.toThrow(/stale/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_update_task($1,2,'x','',null,null,'normal',null,null,null,$2::jsonb)", [t, JSON.stringify([{ kind: "github", url: "http://insecure.example" }])]))).rejects.toThrow(/studio_tasks_links_valid/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_update_task($1,2,'x','',null,null,'normal',null,null,null,$2::jsonb)", [t, JSON.stringify([{ kind: "evil", url: "https://x.example" }])]))).rejects.toThrow(/studio_tasks_links_valid/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_update_task($1,2,'x','',null,null,'normal',null,null,$2::jsonb,null)", [t, JSON.stringify([{ text: "", done: false }])]))).rejects.toThrow(/studio_tasks_links_valid/);
      const events = (await pool.query("select type from public.task_events where task_id=$1 order by id", [t])).rows.map((r) => r.type);
      expect(events).toEqual(["created", "updated", "assigned"]);
    });

    it("внутрішні коментарі бачать лише адміністратори", async () => {
      await asUserCommit(pool, admin2, (q) => q("select public.admin_comment_task($1,'Внутрішній технічний коментар')", [task]));
      expect((await asUser(pool, admin, (q) => q("select body from public.task_comments where task_id=$1", [task]))).rows).toHaveLength(1);
      expect((await asUser(pool, a, (q) => q("select body from public.task_comments"))).rows).toHaveLength(0);
    });
  });

  describe("кошторис", () => {
    let est = "";
    it("калькулятор: собівартість = Σ(год×ставка) + резерв + інші; рекомендована ціна = собівартість / (1 − маржа)", async () => {
      est = (await asUserCommit(pool, admin, (q) => q("select public.admin_create_estimate('Сайт-платформа',$1,null,'UAH') as id", [projectA]))).rows[0].id;
      await asUserCommit(pool, admin, (q) =>
        q("select public.admin_save_estimate($1,15,30,1000,null,'Внутрішнє',$2::jsonb)", [
          est,
          JSON.stringify([{ category: "design", hours: 10, rate: 1000 }, { category: "frontend", hours: 20, rate: 1000, note: "Next.js" }]),
        ]),
      );
      const t = (await asUser(pool, admin, (q) => q("select * from public.estimate_totals($1)", [est]))).rows[0];
      expect({ base: t.base_cost, reserve: t.reserve, total: t.total_cost, recommended: t.recommended_price, hours: t.hours }).toEqual({ base: "30000.00", reserve: "4500.00", total: "35500.00", recommended: "50714.29", hours: "30.00" });
      expect(t.final_price).toBeNull();
    });

    it("адміністратор може встановити свою ціну; клієнт кошторис не бачить; погоджений кошторис незмінний", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_save_estimate($1,15,30,1000,52000,'Округлили',$2::jsonb)", [est, JSON.stringify([{ category: "design", hours: 10, rate: 1000 }])]));
      expect((await asUser(pool, admin, (q) => q("select final_price::text as p from public.estimate_totals($1)", [est]))).rows[0].p).toBe("52000.00");
      expect((await asUser(pool, a, (q) => q("select * from public.estimate_totals($1)", [est]))).rows).toHaveLength(0);
      await asUserCommit(pool, admin, (q) => q("select public.admin_finalize_estimate($1)", [est]));
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_estimate($1,10,10,0,null,null,'[]'::jsonb)", [est]))).rejects.toThrow(/estimate_final/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_finalize_estimate($1)", [est]))).rejects.toThrow(/not_pending/);
    });

    it("некоректні рядки відхиляються (відʼємні години, невідома категорія, дублікат)", async () => {
      const e = (await asUserCommit(pool, admin, (q) => q("select public.admin_create_estimate('Тест',$1,null,'USD') as id", [projectA]))).rows[0].id;
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_estimate($1,10,10,0,null,null,$2::jsonb)", [e, JSON.stringify([{ category: "design", hours: -1, rate: 10 }])]))).rejects.toThrow(/check constraint/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_estimate($1,10,10,0,null,null,$2::jsonb)", [e, JSON.stringify([{ category: "magic", hours: 1, rate: 10 }])]))).rejects.toThrow(/check constraint/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_estimate($1,10,95,0,null,null,'[]'::jsonb)", [e]))).rejects.toThrow(/check constraint/);
    });
  });

  describe("фінансове зведення", () => {
    it("прогноз ≠ виставлено ≠ отримано: кожне число рахується окремо й у своїй валюті", async () => {
      let inv1 = "";
      let inv2 = "";
      await asUserCommit(pool, admin, async (q) => {
        const p = (await q("select public.admin_create_proposal($1) as id", [projectA])).rows[0].id;
        await q(`select public.admin_update_proposal($1,'Сайт','Опис','["Дизайн"]'::jsonb,100000.01,'UAH',30,'[{"label":"Аванс","percent":30},{"label":"Здача","percent":70}]'::jsonb,2,'')`, [p]);
        await q("select public.admin_send_proposal($1)", [p]);
      });
      await asUserCommit(pool, a, (q) => q("select public.client_decide_proposal((select id from public.proposals where project_id=$1), 'approved', 'ок')", [projectA]));
      await asUserCommit(pool, admin, async (q) => {
        inv1 = (await q("select public.admin_create_invoice($1,'Аванс',30000,'UAH',null) as id", [projectA])).rows[0].id;
        inv2 = (await q("select public.admin_create_invoice($1,'Здача',70000.01,'UAH',null) as id", [projectA])).rows[0].id;
        await q("select public.admin_issue_invoice($1, '2020-01-01')", [inv1]); // прострочений
        await q("select public.admin_issue_invoice($1, '2099-01-01')", [inv2]);
      });
      // Заява клієнта про оплату — ще не гроші.
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'платіж')", [inv1]));
      const empty = (await asUser(pool, admin, (q) => q("select received::text as r from public.admin_finance_summary() where currency='UAH'"))).rows[0].r;
      expect(empty).toBe("0.00");
      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [inv1])).rows[0].id;
      await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1, 10000, null)", [pid]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_record_refund($1, 1000, 'повернення')", [inv1]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_add_expense($1,'Хостинг',4000,'UAH',current_date,'рік')", [projectA]));

      const rows = (await asUser(pool, admin, (q) => q("select currency, contracts_total::text, invoiced::text, received::text, unpaid::text, overdue::text, refunds::text, expenses::text, margin::text, month_received::text from public.admin_finance_summary() order by currency"))).rows;
      const uah = rows.find((r) => r.currency === "UAH");
      expect(uah).toEqual({
        currency: "UAH",
        contracts_total: "100000.01",
        invoiced: "100000.01",
        received: "9000.00",
        unpaid: "91000.01",
        overdue: "21000.00",
        refunds: "1000.00",
        expenses: "4000.00",
        margin: "5000.00",
        month_received: "9000.00",
      });
      expect(rows.filter((r) => r.currency !== "UAH").every((r) => Number(r.invoiced) === 0 && Number(r.received) === 0)).toBe(true);
    });

    it("зведення доступне лише адміністратору з MFA; витрати — тільки адміністратору", async () => {
      await expect(asUser(pool, a, (q) => q("select * from public.admin_finance_summary()"))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, adminNoMfa, (q) => q("select * from public.admin_finance_summary()"))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, null, (q) => q("select * from public.admin_finance_summary()"))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, a, (q) => q("select public.admin_add_expense($1,'x',1,'UAH',null,null)", [projectA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_add_expense($1,'x',-5,'UAH',null,null)", [projectA]))).rejects.toThrow(/check constraint/);
    });
  });
});
