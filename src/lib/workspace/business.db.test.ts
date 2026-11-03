import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/**
 * V0.5 фаза 1: заявка ≠ активний проєкт; умови активації; відхилення заявки; документи (версії, хеш, погодження);
 * запити на зміни та незмінний Scope of Work. Усі перевірки — на справжньому PostgreSQL із RLS-ролями.
 */
describe.skipIf(!dbEnabled)("бізнес-процес V0.5 (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ADMIN2 = "abababab-abab-4bab-8bab-abababababab";
  const CLIENT_A = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const CLIENT_B = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const admin2: Session = { sub: ADMIN2, aal: "aal2" };
  const adminNoMfa: Session = { sub: ADMIN, aal: "aal1" };
  const a: Session = { sub: CLIENT_A, aal: "aal1" };
  const b: Session = { sub: CLIENT_B, aal: "aal1" };
  let projectA = "";
  let projectB = "";
  let orderA = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
    await resetDatabase(pool);
    await pool.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'admin2@bonsi.test',now()),($3,'a@example.com',now()),($4,'b@example.com',now())`,
      [ADMIN, ADMIN2, CLIENT_A, CLIENT_B],
    );
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін 1'),($2,'admin2@bonsi.test','Адмін 2')", [ADMIN, ADMIN2]);
    for (const [i, email] of ["a@example.com", "b@example.com"].entries()) {
      await pool.query(`select public.create_order_v2('webapp', 'Потрібен сайт', null, null, 'Клієнт Тест', $1, null, '{}'::jsonb, '{}', $2, 'vitest', '2026-11-04', false)`, [email, `ip-biz-${i}`]);
    }
    await asUserCommit(pool, a, (q) => q("select public.client_claim_orders()"));
    await asUserCommit(pool, b, (q) => q("select public.client_claim_orders()"));
    const pa = (await pool.query("select id, order_id from public.projects where client_id=$1", [CLIENT_A])).rows[0];
    projectA = pa.id;
    orderA = pa.order_id;
    projectB = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_B])).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  const status = async (session: Session, project: string) =>
    (await asUser(pool, session, (q) => q("select public.project_activation_status($1) as s", [project]))).rows[0].s as Record<string, boolean> | null;

  describe("заявка ≠ активний проєкт", () => {
    it("після прив'язки заявки створюється робочий простір, але не активний проєкт", async () => {
      const row = (await pool.query("select activated_at, status from public.projects where id=$1", [projectA])).rows[0];
      expect(row.activated_at).toBeNull();
      const requests = await asUser(pool, a, (q) => q("select ticket, activated, order_status from public.client_requests()"));
      expect(requests.rows).toHaveLength(1);
      expect(requests.rows[0]).toMatchObject({ activated: false, order_status: "new" });
    });

    it("клієнт A не бачить заявок клієнта B; anon не викликає функцію", async () => {
      expect((await asUser(pool, b, (q) => q("select ticket from public.client_requests()"))).rows).toHaveLength(1);
      const tickets = (await asUser(pool, a, (q) => q("select ticket from public.client_requests()"))).rows.map((r) => r.ticket);
      const bTickets = (await asUser(pool, b, (q) => q("select ticket from public.client_requests()"))).rows.map((r) => r.ticket);
      expect(tickets.some((t) => bTickets.includes(t))).toBe(false);
      await expect(asUser(pool, null, (q) => q("select * from public.client_requests()"))).rejects.toThrow(/permission denied/);
    });

    it("етапи роботи (дизайн і далі) недоступні, доки проєкт не активовано", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_set_project_stage($1,'design')", [projectA]))).rejects.toThrow(/not_activated/);
      await expect(pool.query("update public.projects set stage='development' where id=$1", [projectA])).rejects.toThrow(/not_activated/);
    });

    it("підготовчі етапи (бриф, пропозиція, договір) дозволені до активації", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_set_project_stage($1,'proposal')", [projectA]));
      expect((await pool.query("select stage from public.projects where id=$1", [projectA])).rows[0].stage).toBe("proposal");
    });
  });

  describe("відхилення заявки з причиною", () => {
    it("причина обов'язкова (від 10 символів), лише адміністратор з MFA", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_reject_order($1,'нє')", [orderA]))).rejects.toThrow(/reason_required/);
      await expect(asUser(pool, adminNoMfa, (q) => q("select public.admin_reject_order($1,'Недостатньо ресурсів на проєкт')", [orderA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, a, (q) => q("select public.admin_reject_order($1,'Недостатньо ресурсів на проєкт')", [orderA]))).rejects.toThrow(/forbidden/);
    });

    it("клієнт бачить статус і причину; робочий простір закривається, активний проєкт не зачіпається", async () => {
      // Окрема заявка клієнта B, щоб не ламати основний сценарій A.
      const orderB = (await pool.query("select order_id from public.projects where id=$1", [projectB])).rows[0].order_id;
      await asUserCommit(pool, admin, (q) => q("select public.admin_reject_order($1,'Зараз немає вільних виконавців')", [orderB]));
      const row = (await asUser(pool, b, (q) => q("select order_status, rejection_reason, project_status from public.client_requests()"))).rows[0];
      expect(row).toEqual({ order_status: "rejected", rejection_reason: "Зараз немає вільних виконавців", project_status: "cancelled" });
      const events = await pool.query("select type, data from public.order_events where order_id=$1 and type='rejected'", [orderB]);
      expect(events.rows).toHaveLength(1);
    });
  });

  describe("умови активації проєкту", () => {
    let proposal = "";
    let contract = "";
    let preInvoice = "";

    it("без пропозиції й договору проєкт не активується", async () => {
      expect(await status(a, projectA)).toMatchObject({ ready: false, proposal_approved: false, contract_approved: false });
      await expect(asUser(pool, admin, (q) => q("select public.admin_activate_project($1)", [projectA]))).rejects.toThrow(/conditions_not_met/);
    });

    it("погоджена пропозиція сама по собі недостатня — потрібен договір", async () => {
      await asUserCommit(pool, admin, async (q) => {
        proposal = (await q("select public.admin_create_proposal($1) as id", [projectA])).rows[0].id;
        await q(
          `select public.admin_update_proposal($1,'Сайт','Опис','["Дизайн","Розробка"]'::jsonb,100000.01,'UAH',30,
             '[{"label":"Аванс","percent":30},{"label":"Здача","percent":70}]'::jsonb,2,'')`,
          [proposal],
        );
        await q("select public.admin_send_proposal($1)", [proposal]);
      });
      await asUserCommit(pool, a, (q) => q("select public.client_decide_proposal($1,'approved','ок')", [proposal]));
      expect(await status(a, projectA)).toMatchObject({ proposal_approved: true, contract_approved: false, ready: false });
    });

    it("договір створюється, відправляється й погоджується клієнтом (запис у журналі рішень)", async () => {
      await asUserCommit(pool, admin, async (q) => {
        contract = (await q("select public.admin_create_document($1,'contract','Договір на розробку','# Договір\\n\\nПредмет: розробка сайту.') as id", [projectA])).rows[0].id;
        await q("select public.admin_send_document($1)", [contract]);
      });
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'approved','Погоджую')", [contract]));
      expect(await status(a, projectA)).toMatchObject({ proposal_approved: true, contract_approved: true, prepayment_required: false, ready: true });
    });

    it("рахунок-передоплата, поки не оплачений, блокує активацію; оплата підтвердженим платежем знімає блокування", async () => {
      await asUserCommit(pool, admin, async (q) => {
        preInvoice = (await q("select public.admin_create_invoice($1,'Передоплата 30%',30000,'UAH',null) as id", [projectA])).rows[0].id;
        await q("select public.admin_set_invoice_purpose($1,'prepayment')", [preInvoice]);
      });
      expect(await status(a, projectA)).toMatchObject({ prepayment_required: true, prepayment_paid: false, ready: false });
      await expect(asUser(pool, admin, (q) => q("select public.admin_activate_project($1)", [projectA]))).rejects.toThrow(/conditions_not_met/);

      await asUserCommit(pool, admin, (q) => q("select public.admin_issue_invoice($1)", [preInvoice]));
      // Заява клієнта «я сплатив» оплатою НЕ є.
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'платіж 1')", [preInvoice]));
      expect(await status(a, projectA)).toMatchObject({ prepayment_paid: false, ready: false });
      await expect(asUser(pool, admin, (q) => q("select public.admin_activate_project($1)", [projectA]))).rejects.toThrow(/conditions_not_met/);

      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [preInvoice])).rows[0].id;
      await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,'Надійшло')", [pid]));
      expect(await status(a, projectA)).toMatchObject({ prepayment_paid: true, ready: true });
    });

    it("рахунок з призначенням можна змінювати лише в чернетці; клієнт цього не може", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_set_invoice_purpose($1,'regular')", [preInvoice]))).rejects.toThrow(/invoice_frozen/);
      await expect(asUser(pool, a, (q) => q("select public.admin_set_invoice_purpose($1,'regular')", [preInvoice]))).rejects.toThrow(/forbidden/);
    });

    it("активувати може лише адміністратор з MFA; клієнти не можуть, чужий клієнт не бачить стану", async () => {
      await expect(asUser(pool, a, (q) => q("select public.admin_activate_project($1)", [projectA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, adminNoMfa, (q) => q("select public.admin_activate_project($1)", [projectA]))).rejects.toThrow(/forbidden/);
      expect(await status(b, projectA)).toBeNull();
    });

    it("два адміністратори активують одночасно: активація одна, базова лінія Scope одна", async () => {
      const results = await Promise.allSettled([
        asUserCommit(pool, admin, (q) => q("select public.admin_activate_project($1,'Домовились про старт')", [projectA])),
        asUserCommit(pool, admin2, (q) => q("select public.admin_activate_project($1)", [projectA])),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/already_active/);
      const scope = await pool.query("select kind, title, price_amount::text as price from public.project_scope where project_id=$1", [projectA]);
      expect(scope.rows).toEqual([{ kind: "baseline", title: "Сайт", price: "100000.01" }]);
      const row = (await pool.query("select activated_at, stage, status from public.projects where id=$1", [projectA])).rows[0];
      expect(row.activated_at).not.toBeNull();
      expect(row).toMatchObject({ stage: "design", status: "active" });
    });

    it("після активації дата незмінна, Scope лише для читання, етапи доступні", async () => {
      await expect(pool.query("update public.projects set activated_at = now() where id=$1", [projectA])).rejects.toThrow(/activation_immutable/);
      await expect(pool.query("update public.project_scope set title='підміна' where project_id=$1", [projectA])).rejects.toThrow(/append_only/);
      await expect(pool.query("delete from public.project_scope where project_id=$1", [projectA])).rejects.toThrow(/append_only/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_set_project_stage($1,'development')", [projectA]));
      expect((await asUser(pool, a, (q) => q("select count(*)::int as n from public.project_scope"))).rows[0].n).toBe(1);
      expect((await asUser(pool, b, (q) => q("select count(*)::int as n from public.project_scope"))).rows[0].n).toBe(0);
    });
  });

  describe("документи: версії, хеш, погодження", () => {
    let doc = "";
    const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

    it("чернетку клієнт не бачить; вона редагується на місці", async () => {
      await asUserCommit(pool, admin, async (q) => {
        doc = (await q("select public.admin_create_document($1,'tech_spec','Технічне завдання','# ТЗ\\n\\nВерсія 1') as id", [projectA])).rows[0].id;
      });
      expect((await asUser(pool, a, (q) => q("select id from public.documents where id=$1", [doc]))).rows).toHaveLength(0);
      expect((await asUser(pool, a, (q) => q("select id from public.document_versions where document_id=$1", [doc]))).rows).toHaveLength(0);
      await asUserCommit(pool, admin, (q) => q("select public.admin_save_document($1,'Технічне завдання','# ТЗ\\n\\nВерсія 1, уточнена')", [doc]));
      expect((await pool.query("select count(*)::int as n from public.document_versions where document_id=$1", [doc])).rows[0].n).toBe(1);
    });

    it("відправлена версія фіксується; хеш збігається з SHA-256 тексту, який бачить клієнт", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_send_document($1)", [doc]));
      const v = (await asUser(pool, a, (q) => q("select version, body, content_hash, frozen_at from public.document_versions where document_id=$1", [doc]))).rows[0];
      expect(v.frozen_at).not.toBeNull();
      expect(v.content_hash).toBe(sha(v.body));
    });

    it("відправлений документ не можна змінити ні через функцію, ні напряму", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_document($1,'x','підміна')", [doc]))).rejects.toThrow(/document_locked/);
      await expect(pool.query("update public.document_versions set body='підміна' where document_id=$1", [doc])).rejects.toThrow(/document_frozen/);
      await expect(pool.query("update public.documents set status='approved' where id=$1 and false", [doc])).resolves.toBeDefined();
    });

    it("клієнт B не бачить документ і не може вирішувати; anon не читає", async () => {
      expect((await asUser(pool, b, (q) => q("select id from public.documents where id=$1", [doc]))).rows).toHaveLength(0);
      await expect(asUser(pool, b, (q) => q("select public.client_decide_document($1,'approved',null)", [doc]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, null, (q) => q("select id from public.documents"))).rejects.toThrow(/permission denied/);
    });

    it("зміни вимагають коментаря; рішення фіксує версію й хеш; повторне рішення відхиляється", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_decide_document($1,'changes_requested',' ')", [doc]))).rejects.toThrow(/comment_required/);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'changes_requested','Додайте розділ про хостинг')", [doc]));
      await expect(asUser(pool, a, (q) => q("select public.client_decide_document($1,'approved',null)", [doc]))).rejects.toThrow(/not_pending/);
      const d = (await pool.query("select version, content_hash, decision from public.document_decisions where document_id=$1", [doc])).rows[0];
      expect(d).toMatchObject({ version: 1, decision: "changes_requested" });
      expect(d.content_hash).toHaveLength(64);
    });

    it("після запиту змін створюється НОВА версія; стара лишається незмінною", async () => {
      const v = (await asUserCommit(pool, admin, (q) => q("select public.admin_save_document($1,'Технічне завдання','# ТЗ\\n\\nВерсія 2 з хостингом') as v", [doc]))).rows[0].v;
      expect(v).toBe(2);
      const versions = (await pool.query("select version, frozen_at is not null as frozen, body from public.document_versions where document_id=$1 order by version", [doc])).rows;
      expect(versions.map((x) => x.frozen)).toEqual([true, false]);
      expect(versions[0].body).toContain("Версія 1, уточнена");
      await asUserCommit(pool, admin, (q) => q("select public.admin_send_document($1)", [doc]));
    });

    it("клієнт погоджує версію 2; журнал рішень містить обидва рішення і не редагується", async () => {
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'approved','Тепер усе гаразд')", [doc]));
      const log = (await asUser(pool, a, (q) => q("select version, decision from public.document_decisions where document_id=$1 order by id", [doc]))).rows;
      expect(log).toEqual([{ version: 1, decision: "changes_requested" }, { version: 2, decision: "approved" }]);
      await expect(pool.query("update public.document_decisions set comment='x'")).rejects.toThrow(/append_only/);
      await expect(pool.query("delete from public.document_decisions")).rejects.toThrow(/append_only/);
    });

    it("погоджений документ незмінний: ні редагування, ні скасування; зміна лише новою додатковою угодою", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_document($1,'x','підміна')", [doc]))).rejects.toThrow(/document_locked/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_void_document($1,'передумали')", [doc]))).rejects.toThrow(/document_locked/);
      await expect(pool.query("update public.document_versions set body='підміна' where document_id=$1", [doc])).rejects.toThrow(/document_frozen/);
    });

    it("клієнт може відхилити документ повністю (потрібен коментар) — він стає недійсним", async () => {
      let other = "";
      await asUserCommit(pool, admin, async (q) => {
        other = (await q("select public.admin_create_document($1,'warranty_terms','Умови гарантії','Текст') as id", [projectA])).rows[0].id;
        await q("select public.admin_send_document($1)", [other]);
      });
      await expect(asUser(pool, a, (q) => q("select public.client_decide_document($1,'rejected',null)", [other]))).rejects.toThrow(/comment_required/);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'rejected','Не підходить')", [other]));
      expect((await pool.query("select status from public.documents where id=$1", [other])).rows[0].status).toBe("void");
    });

    it("конкурентні рішення клієнта: рівно одне проходить", async () => {
      let other = "";
      await asUserCommit(pool, admin, async (q) => {
        other = (await q("select public.admin_create_document($1,'stage_act','Акт етапу','Акт') as id", [projectA])).rows[0].id;
        await q("select public.admin_send_document($1)", [other]);
      });
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'approved',null)", [other]))),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await pool.query("select count(*)::int as n from public.document_decisions where document_id=$1", [other])).rows[0].n).toBe(1);
    });
  });

  describe("запити на зміни і Scope of Work", () => {
    let cr = "";
    let amendment = "";
    const baseline = async () => (await pool.query("select title, items, price_amount::text as price from public.project_scope where project_id=$1 and kind='baseline'", [projectA])).rows[0];

    it("запит доступний лише власнику активного проєкту", async () => {
      await expect(asUser(pool, b, (q) => q("select public.client_submit_change_request($1,'Магазин','Додати інтернет-магазин із оплатою')", [projectA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, b, (q) => q("select public.client_submit_change_request($1,'Магазин','Додати інтернет-магазин із оплатою')", [projectB]))).rejects.toThrow(/project_not_active/);
      await expect(asUser(pool, a, (q) => q("select public.client_submit_change_request($1,'ab','коротко')", [projectA]))).rejects.toThrow(/check constraint/);
    });

    it("прохання про магазин не стає безкоштовною роботою: Scope не змінюється до погодження", async () => {
      const before = await baseline();
      cr = (await asUserCommit(pool, a, (q) => q("select public.client_submit_change_request($1,'Інтернет-магазин','Потрібно додати каталог товарів і кошик замість односторінкового сайту') as id", [projectA]))).rows[0].id;
      expect((await pool.query("select status from public.change_requests where id=$1", [cr])).rows[0].status).toBe("submitted");
      expect((await pool.query("select count(*)::int as n from public.project_scope where project_id=$1", [projectA])).rows[0].n).toBe(1);
      expect(await baseline()).toEqual(before);
      await expect(asUser(pool, admin, (q) => q("select public.admin_set_change_request_status($1,'in_progress')", [cr]))).rejects.toThrow(/invalid_transition/);
    });

    it("клієнт B не бачить запит клієнта A", async () => {
      expect((await asUser(pool, b, (q) => q("select id from public.change_requests"))).rows).toHaveLength(0);
      await expect(asUser(pool, b, (q) => q("select public.client_withdraw_change_request($1)", [cr]))).rejects.toThrow(/forbidden/);
    });

    it("оцінка створює додаткову угоду з ціною й термінами та відправляє її клієнту; некоректна оцінка відхиляється", async () => {
      await expect(asUser(pool, a, (q) => q("select public.admin_quote_change_request($1,'Дві тижні роботи',50000,'UAH',14)", [cr]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_quote_change_request($1,'короткий',-1,'UAH',14)", [cr]))).rejects.toThrow(/invalid_quote/);
      amendment = (await asUserCommit(pool, admin, (q) => q("select public.admin_quote_change_request($1,'Каталог, кошик і оформлення замовлення, 4 тижні роботи',48000.5,'UAH',28) as d", [cr]))).rows[0].d;
      const doc = (await asUser(pool, a, (q) => q("select kind, status from public.documents where id=$1", [amendment]))).rows[0];
      expect(doc).toEqual({ kind: "amendment", status: "sent" });
      const body = (await asUser(pool, a, (q) => q("select body from public.document_versions where document_id=$1", [amendment]))).rows[0].body as string;
      expect(body).toContain("48000.50 UAH");
      expect(body).toContain("28 дн.");
      expect(body).toContain("Первинний обсяг робіт");
    });

    it("рахунок і робота неможливі до погодження; погодження створює доповнення Scope, базова лінія незмінна", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_create_change_invoice($1)", [cr]))).rejects.toThrow(/invalid_transition/);
      const before = await baseline();
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'approved','Погоджую додаткову угоду')", [amendment]));
      expect((await pool.query("select status from public.change_requests where id=$1", [cr])).rows[0].status).toBe("approved");
      const scope = (await pool.query("select kind, title, price_amount::text as price, duration_days from public.project_scope where project_id=$1 order by id", [projectA])).rows;
      expect(scope).toEqual([
        { kind: "baseline", title: "Сайт", price: "100000.01", duration_days: 30 },
        { kind: "amendment", title: "Інтернет-магазин", price: "48000.50", duration_days: 28 },
      ]);
      expect(await baseline()).toEqual(before);
    });

    it("рахунок на зміну створюється один раз; робота: погоджено → у роботі → виконано", async () => {
      const invoice = (await asUserCommit(pool, admin, (q) => q("select public.admin_create_change_invoice($1) as id", [cr]))).rows[0].id;
      const row = (await pool.query("select purpose, amount::text as amount, status, change_request_id from public.invoices where id=$1", [invoice])).rows[0];
      expect(row).toEqual({ purpose: "change", amount: "48000.50", status: "draft", change_request_id: cr });
      await expect(asUser(pool, admin, (q) => q("select public.admin_create_change_invoice($1)", [cr]))).rejects.toThrow(/invoice_exists/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_set_change_request_status($1,'in_progress')", [cr]));
      await expect(asUser(pool, admin, (q) => q("select public.admin_set_change_request_status($1,'in_progress')", [cr]))).rejects.toThrow(/invalid_transition/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_set_change_request_status($1,'done')", [cr]));
    });

    it("відхилена клієнтом пропозиція не потрапляє в Scope", async () => {
      const cr2 = (await asUserCommit(pool, a, (q) => q("select public.client_submit_change_request($1,'Редизайн логотипу','Потрібен новий логотип у три варіанти') as id", [projectA]))).rows[0].id;
      const doc = (await asUserCommit(pool, admin, (q) => q("select public.admin_quote_change_request($1,'Три варіанти логотипу, 1 тиждень',9000,'UAH',7) as d", [cr2]))).rows[0].d;
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'rejected','Занадто дорого')", [doc]));
      expect((await pool.query("select status, rejection_reason from public.change_requests where id=$1", [cr2])).rows[0]).toEqual({ status: "rejected", rejection_reason: "Занадто дорого" });
      expect((await pool.query("select count(*)::int as n from public.project_scope where project_id=$1", [projectA])).rows[0].n).toBe(2);
    });

    it("адміністратор може відхилити запит з причиною; клієнт може відкликати власний запит", async () => {
      const cr3 = (await asUserCommit(pool, a, (q) => q("select public.client_submit_change_request($1,'Мобільний додаток','Потрібен ще й мобільний додаток для замовлень') as id", [projectA]))).rows[0].id;
      await expect(asUser(pool, admin, (q) => q("select public.admin_reject_change_request($1,'нє')", [cr3]))).rejects.toThrow(/reason_required/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_reject_change_request($1,'Це окремий проєкт, не зміна поточного')", [cr3]));
      expect((await pool.query("select status from public.change_requests where id=$1", [cr3])).rows[0].status).toBe("rejected");
      const cr4 = (await asUserCommit(pool, a, (q) => q("select public.client_submit_change_request($1,'Інша ідея','Передумав, потрібно інше розташування блоків') as id", [projectA]))).rows[0].id;
      await asUserCommit(pool, a, (q) => q("select public.client_withdraw_change_request($1)", [cr4]));
      await expect(asUser(pool, a, (q) => q("select public.client_withdraw_change_request($1)", [cr4]))).rejects.toThrow(/not_pending/);
    });

    it("подія журналу проєкту фіксує критичні кроки (активація, документи, зміни)", async () => {
      const types = (await pool.query("select distinct type from public.project_events where project_id=$1", [projectA])).rows.map((r) => r.type);
      for (const expected of ["project_activated", "document_sent", "document_approved", "change_requested", "change_quoted", "document_rejected"]) {
        expect(types).toContain(expected);
      }
    });
  });

  describe("зворотна сумісність міграції", () => {
    it("проєкти, що існували до V0.5, лишаються активними (activated_at = created_at), нові — ні", async () => {
      const legacy = new pg.Pool({ connectionString: dbUrl, max: 2 });
      try {
        await resetDatabase(legacy, { before: "20261106" });
        await legacy.query("insert into auth.users (id, email, email_confirmed_at) values ($1,'old@example.com',now())", [CLIENT_A]);
        await legacy.query(`select public.create_order_v2('webapp', null, null, null, 'Старий клієнт', 'old@example.com', null, '{}'::jsonb, '{}', 'ip-old', 'vitest', '2026-11-01', false)`);
        await asUserCommit(legacy, a, (q) => q("select public.client_claim_orders()"));
        const sql = readFileSync(join(process.cwd(), "supabase", "migrations", readdirSync(join(process.cwd(), "supabase", "migrations")).find((f) => f.startsWith("20261106"))!), "utf8");
        await legacy.query(sql);
        const row = (await legacy.query("select activated_at = created_at as same from public.projects")).rows[0];
        expect(row.same).toBe(true);
        // Повторне застосування не «активує» нічого нового.
        await legacy.query(`select public.create_order_v2('landing', null, null, null, 'Новий', 'old@example.com', null, '{}'::jsonb, '{}', 'ip-old2', 'vitest', '2026-11-06', false)`);
        await asUserCommit(legacy, a, (q) => q("select public.client_claim_orders()"));
        await legacy.query(sql);
        const rows = (await legacy.query("select activated_at is not null as active from public.projects order by created_at")).rows;
        expect(rows.map((r) => r.active)).toEqual([true, false]);
      } finally {
        await legacy.end();
      }
    });
  });
});
