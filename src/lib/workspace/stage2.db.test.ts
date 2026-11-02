import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/**
 * Етап 2 на справжньому PostgreSQL: результати етапів із погодженнями, приватні файли, рахунки та облік оплат.
 * Головні гарантії: клієнт A не бачить дані клієнта B; клієнт не може підтвердити платіж; «оплачено» лише з підтвердженого
 * журналу; події провайдера ідемпотентні; суми, валюта й рахунок перевіряються.
 */
describe.skipIf(!dbEnabled)("етап 2: етапи, файли, оплати (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CLIENT_A = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const CLIENT_B = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const adminNoMfa: Session = { sub: ADMIN, aal: "aal1" };
  const a: Session = { sub: CLIENT_A, aal: "aal1" };
  const b: Session = { sub: CLIENT_B, aal: "aal1" };
  let projectA = "";
  let projectB = "";
  let proposalA = "";
  let invoices: string[] = [];

  async function mkOrder(email: string, n: number) {
    await pool.query(
      `select public.create_order_v2('webapp', null, null, null, 'Клієнт', $1, null, '{}'::jsonb, '{}', $2, 'vitest', '2026-11-03', false)`,
      [email, `ip-s2-${n}`],
    );
  }
  const state = async (s: Session | null, id: string) =>
    (await asUser(pool, s, (q) => q("select public.invoice_payment_state($1) as s", [id]))).rows[0]?.s as string | null;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
    await resetDatabase(pool);
    await pool.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'a@example.com',now()),($3,'b@example.com',now())`,
      [ADMIN, CLIENT_A, CLIENT_B],
    );
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін')", [ADMIN]);
    await mkOrder("a@example.com", 1);
    await mkOrder("b@example.com", 2);
    await asUserCommit(pool, a, (q) => q("select public.client_claim_orders()"));
    await asUserCommit(pool, b, (q) => q("select public.client_claim_orders()"));
    projectA = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_A])).rows[0].id;
    projectB = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_B])).rows[0].id;
    // Погоджена пропозиція проєкту A (30/40/30, 100000.01 ₴) — основа для рахунків.
    await asUserCommit(pool, admin, async (q) => {
      const p = await q("select public.admin_create_proposal($1) as id", [projectA]);
      proposalA = p.rows[0].id;
      await q(
        `select public.admin_update_proposal($1,'Сайт','Опис','["Дизайн","Розробка"]'::jsonb,100000.01,'UAH',30,
           '[{"label":"Аванс","percent":30},{"label":"Дизайн","percent":40},{"label":"Здача","percent":30}]'::jsonb,2,'')`,
        [proposalA],
      );
      await q("select public.admin_send_proposal($1)", [proposalA]);
    });
    await asUserCommit(pool, a, (q) => q("select public.client_decide_proposal($1,'approved','ok')", [proposalA]));
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("результати етапів і погодження", () => {
    let d1 = "";
    it("клієнт не може створювати результати; адміністратор створює чернетку, яку клієнт не бачить", async () => {
      await expect(asUser(pool, a, (q) => q("select public.admin_create_deliverable($1,'design','Макети','','https://figma.com/x')", [projectA]))).rejects.toThrow(/forbidden/);
      await asUserCommit(pool, admin, async (q) => {
        d1 = (await q("select public.admin_create_deliverable($1,'design','Макети головної','Три екрани','https://example.com/preview') as id", [projectA])).rows[0].id;
      });
      expect((await asUser(pool, a, (q) => q("select id from public.deliverables"))).rows).toHaveLength(0);
    });

    it("відхиляє небезпечне посилання прев'ю", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_create_deliverable($1,'qa','x','','javascript:alert(1)')", [projectA]))).rejects.toThrow(/deliverables_preview_url_check/);
    });

    it("після відправки клієнт бачить результат, проєкт чекає на його дію, зміст заморожено", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_submit_deliverable($1)", [d1]));
      const seen = await asUser(pool, a, (q) => q("select status, version, title from public.deliverables"));
      expect(seen.rows).toEqual([{ status: "submitted", version: 1, title: "Макети головної" }]);
      const proj = await asUser(pool, a, (q) => q("select next_action_owner from public.projects"));
      expect(proj.rows[0].next_action_owner).toBe("client");
      await expect(pool.query("update public.deliverables set title='підміна' where id=$1", [d1])).rejects.toThrow(/deliverable_frozen/);
    });

    it("клієнт B не бачить і не може вирішувати чужі результати", async () => {
      expect((await asUser(pool, b, (q) => q("select id from public.deliverables"))).rows).toHaveLength(0);
      await expect(asUser(pool, b, (q) => q("select public.client_decide_deliverable($1,'approved',null)", [d1]))).rejects.toThrow(/forbidden/);
    });

    it("правки потребують коментаря; рішення фіксується; повторне відхиляється; нова версія замінює стару", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_decide_deliverable($1,'changes_requested',' ')", [d1]))).rejects.toThrow(/comment_required/);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_deliverable($1,'changes_requested','Змінити кольори')", [d1]));
      await expect(asUser(pool, a, (q) => q("select public.client_decide_deliverable($1,'approved',null)", [d1]))).rejects.toThrow(/not_pending/);
      let d2 = "";
      await asUserCommit(pool, admin, async (q) => {
        d2 = (await q("select public.admin_create_deliverable($1,'design','Макети головної v2','Нові кольори',null) as id", [projectA])).rows[0].id;
        await q("select public.admin_submit_deliverable($1)", [d2]);
      });
      const versions = await asUser(pool, a, (q) => q("select version, status from public.deliverables order by version"));
      expect(versions.rows).toEqual([
        { version: 1, status: "superseded" },
        { version: 2, status: "submitted" },
      ]);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_deliverable($1,'approved','Чудово')", [d2]));
      const log = await asUser(pool, a, (q) => q("select version, decision from public.deliverable_decisions order by id"));
      expect(log.rows).toEqual([
        { version: 1, decision: "changes_requested" },
        { version: 2, decision: "approved" },
      ]);
      expect((await asUser(pool, b, (q) => q("select id from public.deliverable_decisions"))).rows).toHaveLength(0);
    });

    it("журнал рішень незмінний", async () => {
      await expect(pool.query("update public.deliverable_decisions set comment='x'")).rejects.toThrow(/append_only/);
      await expect(pool.query("delete from public.deliverable_decisions")).rejects.toThrow(/append_only/);
    });
  });

  describe("файли", () => {
    let fileA = "";
    let adminHidden = "";
    let adminShared = "";
    const path = (project: string) => `${project}/${Math.random().toString(16).slice(2)}-file.png`;

    it("клієнт реєструє файл свого проєкту; лише дозволені типи й категорії", async () => {
      fileA = (await asUserCommit(pool, a, (q) => q("select public.client_register_file($1,'logo','logo.png','image/png',1024,$2) as id", [projectA, path(projectA)]))).rows[0].id;
      await expect(asUser(pool, a, (q) => q("select public.client_register_file($1,'logo','x.exe','application/x-msdownload',10,$2)", [projectA, path(projectA)]))).rejects.toThrow(/mime_not_allowed/);
      await expect(asUser(pool, a, (q) => q("select public.client_register_file($1,'final','x.png','image/png',10,$2)", [projectA, path(projectA)]))).rejects.toThrow(/invalid_category/);
      await expect(asUser(pool, a, (q) => q("select public.client_register_file($1,'logo','x.png','image/png',30000000,$2)", [projectA, path(projectA)]))).rejects.toThrow(/project_files_size_bytes_check/);
    });

    it("не можна зареєструвати файл у чужому проєкті або з чужим шляхом сховища", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_register_file($1,'logo','x.png','image/png',10,$2)", [projectB, path(projectB)]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, a, (q) => q("select public.client_register_file($1,'logo','x.png','image/png',10,$2)", [projectA, path(projectB)]))).rejects.toThrow(/project_files_check/);
    });

    it("адміністратор ділиться файлом або тримає його прихованим; клієнт бачить лише видимі", async () => {
      await asUserCommit(pool, admin, async (q) => {
        adminHidden = (await q("select public.admin_register_file($1,'document','internal.pdf','application/pdf',2048,$2,false) as id", [projectA, path(projectA)])).rows[0].id;
        adminShared = (await q("select public.admin_register_file($1,'final','site.zip','application/zip',4096,$2,true) as id", [projectA, path(projectA)])).rows[0].id;
      });
      const seen = await asUser(pool, a, (q) => q("select id from public.project_files order by created_at"));
      const ids = seen.rows.map((r) => r.id);
      expect(ids).toContain(fileA);
      expect(ids).toContain(adminShared);
      expect(ids).not.toContain(adminHidden);
    });

    it("клієнт B не бачить файлів клієнта A, anon нічого не читає", async () => {
      expect((await asUser(pool, b, (q) => q("select id from public.project_files"))).rows).toHaveLength(0);
      await expect(asUser(pool, null, (q) => q("select * from public.project_files"))).rejects.toThrow(/permission denied/);
    });

    it("вкладення до повідомлення: лише власні файли, до 5, без повторного прикріплення", async () => {
      const msg = (await asUserCommit(pool, a, (q) => q("select public.client_send_message($1,'Ось матеріали') as id", [projectA]))).rows[0].id;
      await asUserCommit(pool, a, (q) => q("select public.attach_files_to_message($1, array[$2]::uuid[])", [msg, fileA]));
      await expect(asUser(pool, a, (q) => q("select public.attach_files_to_message($1, array[$2]::uuid[])", [msg, fileA]))).rejects.toThrow(/invalid_files/);
      await expect(asUser(pool, a, (q) => q("select public.attach_files_to_message($1, array[$2]::uuid[])", [msg, adminShared]))).rejects.toThrow(/invalid_files/);
      await expect(asUser(pool, b, (q) => q("select public.attach_files_to_message($1, array[$2]::uuid[])", [msg, fileA]))).rejects.toThrow(/forbidden/);
      const six = Array.from({ length: 6 }, () => "00000000-0000-4000-8000-000000000000");
      await expect(asUser(pool, a, (q) => q("select public.attach_files_to_message($1, $2::uuid[])", [msg, six]))).rejects.toThrow(/too_many_files/);
    });

    it("видалення: клієнт — лише власні файли без вкладення; адміністратор — будь-які; видалені не видно", async () => {
      const loose = (await asUserCommit(pool, a, (q) => q("select public.client_register_file($1,'text','texts.txt','text/plain',10,$2) as id", [projectA, path(projectA)]))).rows[0].id;
      await expect(asUser(pool, a, (q) => q("select public.delete_project_file($1)", [fileA]))).rejects.toThrow(/forbidden/); // уже у повідомленні
      await expect(asUser(pool, a, (q) => q("select public.delete_project_file($1)", [adminShared]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, b, (q) => q("select public.delete_project_file($1)", [loose]))).rejects.toThrow(/forbidden/);
      await asUserCommit(pool, a, (q) => q("select public.delete_project_file($1)", [loose]));
      expect((await asUser(pool, a, (q) => q("select id from public.project_files where id=$1", [loose]))).rows).toHaveLength(0);
      await asUserCommit(pool, admin, (q) => q("select public.delete_project_file($1)", [adminShared]));
      expect((await asUser(pool, a, (q) => q("select id from public.project_files where id=$1", [adminShared]))).rows).toHaveLength(0);
    });
  });

  describe("рахунки й оплати", () => {
    it("чернетки рахунків за погодженою пропозицією: суми збігаються до копійки, повторний виклик нічого не дублює", async () => {
      expect((await asUserCommit(pool, admin, (q) => q("select public.admin_create_invoices_from_proposal($1) as n", [proposalA]))).rows[0].n).toBe(3);
      expect((await asUserCommit(pool, admin, (q) => q("select public.admin_create_invoices_from_proposal($1) as n", [proposalA]))).rows[0].n).toBe(0);
      const rows = (await pool.query("select id, amount, label from public.invoices where project_id=$1 order by schedule_index", [projectA])).rows;
      invoices = rows.map((r) => r.id);
      expect(rows.map((r) => r.amount)).toEqual(["30000.00", "40000.00", "30000.01"]);
      expect(rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)).toBe(10000001);
    });

    it("не створює рахунків за пропозицією, що не погоджена", async () => {
      let p = "";
      await asUserCommit(pool, admin, async (q) => {
        p = (await q("select public.admin_create_proposal($1) as id", [projectB])).rows[0].id;
      });
      await expect(asUser(pool, admin, (q) => q("select public.admin_create_invoices_from_proposal($1)", [p]))).rejects.toThrow(/proposal_not_approved/);
    });

    it("чернетки рахунків і реквізити клієнт не бачить; після виставлення — бачить свої", async () => {
      expect((await asUser(pool, a, (q) => q("select id from public.invoices"))).rows).toHaveLength(0);
      await asUserCommit(pool, admin, (q) =>
        q("select public.admin_update_payment_settings('ФОП Тест','UA213223130000026007233566001','Банк','1234567890','Оплата, рахунок {number}')"),
      );
      expect((await asUser(pool, a, (q) => q("select public.client_bank_details() as d"))).rows[0].d).toBeNull();
      await asUserCommit(pool, admin, (q) => q("select public.admin_issue_invoice($1, '2026-12-01')", [invoices[0]]));
      expect((await asUser(pool, a, (q) => q("select number, status from public.invoices"))).rows).toHaveLength(1);
      expect((await asUser(pool, a, (q) => q("select public.client_bank_details() as d"))).rows[0].d).toMatchObject({ iban: "UA213223130000026007233566001" });
      expect((await asUser(pool, b, (q) => q("select public.client_bank_details() as d"))).rows[0].d).toBeNull();
      expect((await asUser(pool, b, (q) => q("select id from public.invoices"))).rows).toHaveLength(0);
      await expect(asUser(pool, a, (q) => q("select * from public.payment_settings"))).resolves.toMatchObject({ rows: [] });
    });

    it("виставлений рахунок незмінний за сумою; клієнт B не бачить його стан і не може заявити оплату", async () => {
      await expect(pool.query("update public.invoices set amount = 1 where id=$1", [invoices[0]])).rejects.toThrow(/invoice_frozen/);
      expect(await state(b, invoices[0]!)).toBeNull();
      expect(await state(a, invoices[0]!)).toBe("unpaid");
      await expect(asUser(pool, b, (q) => q("select public.client_report_payment($1,'x')", [invoices[0]]))).rejects.toThrow(/forbidden/);
      // чернетка недоступна клієнту навіть для стану
      expect(await state(a, invoices[1]!)).toBeNull();
    });

    it("повідомлення клієнта про оплату НЕ робить рахунок оплаченим", async () => {
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'платіж №123')", [invoices[0]]));
      expect(await state(a, invoices[0]!)).toBe("awaiting_confirmation");
      expect((await asUser(pool, admin, (q) => q("select public.invoice_paid_amount($1) as p", [invoices[0]]))).rows[0].p).toBe("0");
      await expect(asUser(pool, a, (q) => q("select public.client_report_payment($1,'ще раз')", [invoices[0]]))).rejects.toThrow(/already_reported/);
    });

    it("клієнт не може підтвердити, відхилити платіж чи змінити журнал напряму", async () => {
      const pid = (await pool.query("select id from public.payments where invoice_id=$1", [invoices[0]])).rows[0].id;
      await expect(asUser(pool, a, (q) => q("select public.admin_confirm_payment($1,null,null)", [pid]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, a, (q) => q("select public.admin_reject_payment($1,null)", [pid]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, adminNoMfa, (q) => q("select public.admin_confirm_payment($1,null,null)", [pid]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, a, (q) => q(`update public.payments set status='confirmed' where id='${pid}'`))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, a, (q) => q(`insert into public.payments (invoice_id, project_id, method, amount, currency, status) values ('${invoices[0]}','${projectA}','bank_transfer',1,'UAH','confirmed')`))).rejects.toThrow(/permission denied/);
    });

    it("відхилення залишає рахунок несплаченим; після нового повідомлення адміністратор підтверджує — тоді «оплачено»", async () => {
      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [invoices[0]])).rows[0].id;
      await asUserCommit(pool, admin, (q) => q("select public.admin_reject_payment($1,'Надходження не знайдено')", [pid]));
      expect(await state(a, invoices[0]!)).toBe("unpaid");
      await expect(pool.query("update public.payments set status='confirmed' where id=$1", [pid])).rejects.toThrow(/payment_decided/);

      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'платіж №124')", [invoices[0]]));
      const pid2 = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [invoices[0]])).rows[0].id;
      await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,'Надійшло на рахунок')", [pid2]));
      expect(await state(a, invoices[0]!)).toBe("paid");
      await expect(asUser(pool, a, (q) => q("select public.client_report_payment($1,'x')", [invoices[0]]))).rejects.toThrow(/already_paid/);
      const history = await asUser(pool, a, (q) => q("select status from public.payments where invoice_id=$1 order by created_at", [invoices[0]]));
      expect(history.rows.map((r) => r.status)).toEqual(["failed", "confirmed"]);
    });

    it("часткова оплата: фактична сума фіксується, залишок лишається несплаченим; перевищення рахунку відхиляється", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_issue_invoice($1)", [invoices[1]]));
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'часткова')", [invoices[1]]));
      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [invoices[1]])).rows[0].id;
      await expect(asUser(pool, admin, (q) => q("select public.admin_confirm_payment($1, 50000, null)", [pid]))).rejects.toThrow(/overpayment/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1, 15000, 'Частина')", [pid]));
      expect(await state(a, invoices[1]!)).toBe("partial");
      expect((await asUser(pool, a, (q) => q("select public.invoice_paid_amount($1) as p", [invoices[1]]))).rows[0].p).toBe("15000.00");
      // довнесення залишку
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'залишок')", [invoices[1]]));
      const rest = (await pool.query("select id, amount from public.payments where invoice_id=$1 and status='pending'", [invoices[1]])).rows[0];
      expect(rest.amount).toBe("25000.00");
      await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,null)", [rest.id]));
      expect(await state(a, invoices[1]!)).toBe("paid");
    });

    it("повернення зменшує оплачене і не перевищує його", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_record_refund($1, 99999, 'x')", [invoices[1]]))).rejects.toThrow(/refund_exceeds_paid/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_record_refund($1, 10000, 'Часткове повернення')", [invoices[1]]));
      expect(await state(a, invoices[1]!)).toBe("partial");
      await expect(pool.query("delete from public.payments")).rejects.toThrow(/append_only/);
    });

    it("анулювати можна лише рахунок без платежів", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_void_invoice($1)", [invoices[0]]))).rejects.toThrow(/has_payments/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_void_invoice($1)", [invoices[2]]));
      expect(await state(admin, invoices[2]!)).toBe("void");
    });
  });

  describe("події платіжного провайдера (service_role)", () => {
    let inv = "";
    let number = "";
    const apply = (event: string, over: Partial<{ number: string; amount: number; currency: string; status: string; pid: string }> = {}) =>
      pool.query("select public.payments_apply_provider_event('liqpay',$1,$2,$3,$4,$5,$6,'{}'::jsonb) as r", [
        event,
        over.number ?? number,
        over.amount ?? 30000.01,
        over.currency ?? "UAH",
        over.status ?? "success",
        over.pid ?? `pay-${event}`,
      ]);

    beforeAll(async () => {
      // Новий рахунок 30000.01 ₴ у проєкті A для перевірок провайдера.
      await asUserCommit(pool, admin, async (q) => {
        inv = (await q("select public.admin_create_invoice($1,'Здача (онлайн)',30000.01,'UAH',null) as id", [projectA])).rows[0].id;
        await q("select public.admin_issue_invoice($1)", [inv]);
      });
      number = (await pool.query("select number from public.invoices where id=$1", [inv])).rows[0].number;
    });

    it("недоступна браузерним ролям", async () => {
      for (const s of [null, a, admin]) {
        await expect(asUser(pool, s, (q) => q("select public.payments_apply_provider_event('liqpay','e-x','n',1,'UAH','success','p','{}'::jsonb)"))).rejects.toThrow(/permission denied/);
      }
    });

    it("відхиляє невідомий рахунок, невідповідну суму й валюту — без підтвердження оплати", async () => {
      expect((await apply("e1", { number: "INV-0000-00000" })).rows[0].r).toBe("unknown_invoice");
      expect((await apply("e2", { amount: 1 })).rows[0].r).toBe("amount_mismatch");
      expect((await apply("e3", { currency: "USD" })).rows[0].r).toBe("currency_mismatch");
      expect(await state(admin, inv)).toBe("unpaid");
      expect((await pool.query("select count(*)::int as n from public.payments where invoice_id=$1 and status='confirmed'", [inv])).rows[0].n).toBe(0);
    });

    it("неуспішний платіж пишеться як failed і не змінює статус рахунку", async () => {
      expect((await apply("e4", { status: "failure", pid: "pay-fail-1" })).rows[0].r).toBe("provider_failed");
      expect(await state(admin, inv)).toBe("unpaid");
      const failed = await pool.query("select status from public.payments where invoice_id=$1", [inv]);
      expect(failed.rows).toEqual([{ status: "failed" }]);
    });

    it("успішна подія підтверджує рівно раз; повтор тієї ж події — duplicate; інша подія з тим самим платежем не дублює", async () => {
      expect((await apply("e5")).rows[0].r).toBe("confirmed");
      expect((await apply("e5")).rows[0].r).toBe("duplicate");
      expect((await apply("e6", { pid: "pay-e5" })).rows[0].r).toBe("amount_mismatch");
      expect(await state(admin, inv)).toBe("paid");
      expect((await pool.query("select count(*)::int as n from public.payments where invoice_id=$1 and status='confirmed'", [inv])).rows[0].n).toBe(1);
    });

    it("20 паралельних повторів однієї події дають одне підтвердження", async () => {
      let inv2 = "";
      await asUserCommit(pool, admin, async (q) => {
        inv2 = (await q("select public.admin_create_invoice($1,'Паралельний',500,'UAH',null) as id", [projectA])).rows[0].id;
        await q("select public.admin_issue_invoice($1)", [inv2]);
      });
      const n2 = (await pool.query("select number from public.invoices where id=$1", [inv2])).rows[0].number;
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          pool.query("select public.payments_apply_provider_event('liqpay','e-par',$1,500,'UAH','success','pay-par','{}'::jsonb) as r", [n2]),
        ),
      );
      const outcomes = results.map((r) => r.rows[0].r as string);
      expect(outcomes.filter((o) => o === "confirmed")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(19);
      expect((await pool.query("select count(*)::int as n from public.payments where invoice_id=$1 and status='confirmed'", [inv2])).rows[0].n).toBe(1);
    });

    it("журнал подій видно лише адміністратору й він незмінний", async () => {
      expect((await asUser(pool, a, (q) => q("select id from public.payment_events"))).rows).toHaveLength(0);
      expect((await asUser(pool, admin, (q) => q("select id from public.payment_events"))).rows.length).toBeGreaterThan(5);
      await expect(pool.query("update public.payment_events set outcome='x'")).rejects.toThrow(/append_only/);
    });
  });
});
