import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asServiceCommit, asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/**
 * Аудит: пагінація чату на великих обсягах, лічильники непрочитаних, стани оплат одним запитом, черга листів,
 * матриця прав на RPC для ролей anon / клієнт A / клієнт B / адміністратор без MFA / адміністратор з MFA / service_role.
 */
describe.skipIf(!dbEnabled)("аудит БД (PostgreSQL)", () => {
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
  let invoiceA = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
    await resetDatabase(pool);
    await pool.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'a@example.com',now()),($3,'b@example.com',now())`,
      [ADMIN, CLIENT_A, CLIENT_B],
    );
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін')", [ADMIN]);
    for (const [i, email] of ["a@example.com", "b@example.com"].entries()) {
      await pool.query(`select public.create_order_v2('webapp', null, null, null, 'Клієнт', $1, null, '{}'::jsonb, '{}', $2, 'vitest', '2026-11-04', false)`, [email, `ip-audit-${i}`]);
    }
    await asUserCommit(pool, a, (q) => q("select public.client_claim_orders()"));
    await asUserCommit(pool, b, (q) => q("select public.client_claim_orders()"));
    projectA = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_A])).rows[0].id;
    projectB = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_B])).rows[0].id;
    invoiceA = await asUserCommit(pool, admin, async (q) => {
      const id = (await q("select public.admin_create_invoice($1,'Аванс',1000,'UAH',null) as id", [projectA])).rows[0].id as string;
      await q("select public.admin_issue_invoice($1)", [id]);
      return id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("чат: 600 повідомлень, курсорна пагінація, непрочитані", () => {
    beforeAll(async () => {
      await pool.query(
        `insert into public.project_messages (project_id, author_id, author_role, body)
         select $1, case when g % 2 = 0 then $2::uuid else $3::uuid end, case when g % 2 = 0 then 'admin' else 'client' end, 'повідомлення ' || g
         from generate_series(1, 600) g`,
        [projectA, ADMIN, CLIENT_A],
      );
      await pool.query(`insert into public.project_messages (project_id, author_id, author_role, body) select $1, $2, 'admin', 'чуже ' || g from generate_series(1, 5) g`, [projectB, ADMIN]);
    });

    const page = (session: Session, project: string, before: number | null, limit = 50) =>
      asUser(pool, session, (q) =>
        q(
          `select id, body from public.project_messages where project_id = $1 and ($2::bigint is null or id < $2) order by id desc limit $3`,
          [project, before, limit],
        ),
      );

    it("остання сторінка містить найновіші повідомлення, а не перші 500", async () => {
      const latest = await page(a, projectA, null);
      expect(latest.rows).toHaveLength(50);
      expect(latest.rows[0].body).toBe("повідомлення 600");
      expect(latest.rows.at(-1).body).toBe("повідомлення 551");
    });

    it("курсор проходить усю історію без пропусків і дублікатів", async () => {
      const seen: number[] = [];
      let cursor: number | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const rows: Array<{ id: string }> = (await page(a, projectA, cursor, 100)).rows;
        if (rows.length === 0) break;
        for (const row of rows) seen.push(Number(row.id));
        cursor = Number(rows.at(-1)!.id);
      }
      expect(seen).toHaveLength(600);
      expect(new Set(seen).size).toBe(600);
      expect([...seen].sort((x, y) => y - x)).toEqual(seen);
    });

    it("нові повідомлення забираються за курсором «після», без повторів", async () => {
      const before = await asUser(pool, a, (q) => q("select max(id) as m from public.project_messages where project_id=$1", [projectA]));
      await asUserCommit(pool, a, (q) => q("select public.client_send_message($1,'нове 1')", [projectA]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_send_message($1,'нове 2')", [projectA]));
      const after = await asUser(pool, a, (q) => q("select body from public.project_messages where project_id=$1 and id > $2 order by id", [projectA, before.rows[0].m]));
      expect(after.rows.map((r) => r.body)).toEqual(["нове 1", "нове 2"]);
    });

    it("клієнт B не бачить жодного повідомлення проєкту A на будь-якій сторінці", async () => {
      expect((await page(b, projectA, null)).rows).toHaveLength(0);
      expect((await page(b, projectA, 999999)).rows).toHaveLength(0);
      expect((await page(b, projectB, null)).rows).toHaveLength(5);
    });

    it("непрочитані: рахує лише повідомлення студії після прочитаного, тільки для власних проєктів", async () => {
      const unreadA = await asUser(pool, a, (q) => q("select project_id, unread from public.client_unread_counts()"));
      expect(unreadA.rows).toHaveLength(1);
      expect(unreadA.rows[0].project_id).toBe(projectA);
      expect(Number(unreadA.rows[0].unread)).toBe(301); // 300 парних + «нове 2»
      await asUserCommit(pool, a, (q) => q("select public.client_mark_read($1)", [projectA]));
      expect(Number((await asUser(pool, a, (q) => q("select unread from public.client_unread_counts()"))).rows[0].unread)).toBe(0);
      await asUserCommit(pool, admin, (q) => q("select public.admin_send_message($1,'ще одне')", [projectA]));
      expect(Number((await asUser(pool, a, (q) => q("select unread from public.client_unread_counts()"))).rows[0].unread)).toBe(1);
      const unreadB = await asUser(pool, b, (q) => q("select project_id, unread from public.client_unread_counts()"));
      expect(unreadB.rows).toEqual([{ project_id: projectB, unread: "5" }]);
    });

    it("anon не викликає лічильник", async () => {
      await expect(asUser(pool, null, (q) => q("select * from public.client_unread_counts()"))).rejects.toThrow(/permission denied/);
    });
  });

  describe("стани оплат проєкту одним запитом", () => {
    it("збігається з invoice_payment_state, чернетки й чужі проєкти недоступні", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_create_invoice($1,'Чернетка',500,'UAH',null)", [projectA]));
      const rows = await asUser(pool, a, (q) => q("select invoice_id, state from public.project_invoice_states($1)", [projectA]));
      expect(rows.rows).toEqual([{ invoice_id: invoiceA, state: "unpaid" }]);
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'p1')", [invoiceA]));
      expect((await asUser(pool, a, (q) => q("select state from public.project_invoice_states($1)", [projectA]))).rows[0].state).toBe("awaiting_confirmation");
      expect((await asUser(pool, b, (q) => q("select * from public.project_invoice_states($1)", [projectA]))).rows).toHaveLength(0);
      expect((await asUser(pool, admin, (q) => q("select * from public.project_invoice_states($1)", [projectA]))).rows).toHaveLength(2); // адмін бачить і чернетку
    });
  });

  describe("черга листів", () => {
    const enqueue = (key: string, template = "new_message", to = "Client@Example.com") =>
      asServiceCommit(pool, (q) => q("select public.email_enqueue($1,$2,$3,'Імʼя','uk','{\"project\":\"BON-1\"}'::jsonb,$4,null) as id", [key, template, to, projectA]));

    it("додавання ідемпотентне: той самий ключ повертає той самий запис", async () => {
      const first = (await enqueue("msg:project-a:1001")).rows[0].id;
      const again = (await enqueue("msg:project-a:1001")).rows[0].id;
      expect(again).toBe(first);
      expect((await pool.query("select count(*)::int as n from public.email_outbox where idempotency_key='msg:project-a:1001'")).rows[0].n).toBe(1);
      expect((await pool.query("select to_email from public.email_outbox where id=$1", [first])).rows[0].to_email).toBe("client@example.com");
    });

    it("відхиляє невідомий шаблон і занадто короткий ключ", async () => {
      await expect(enqueue("msg:project-a:1002", "spam")).rejects.toThrow(/email_outbox_template_check/);
      await expect(enqueue("short")).rejects.toThrow(/idempotency_key_check/);
    });

    it("claim: два паралельні воркери отримують різні листи; зайнятий лист не видається вдруге", async () => {
      for (let i = 0; i < 12; i++) await enqueue(`msg:claim-test:${i}`);
      const [x, y] = await Promise.all([
        asServiceCommit(pool, (q) => q("select id from public.email_claim(8)")),
        asServiceCommit(pool, (q) => q("select id from public.email_claim(8)")),
      ]);
      const ids = [...x.rows, ...y.rows].map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(12);
      const again = await asServiceCommit(pool, (q) => q("select id from public.email_claim(50)"));
      expect(again.rows.filter((r) => ids.includes(r.id))).toHaveLength(0);
    });

    it("успіх позначає лист відправленим; повторне завершення відхиляється", async () => {
      const id = (await enqueue("msg:complete:ok")).rows[0].id;
      await asServiceCommit(pool, (q) => q("select * from public.email_claim(50)"));
      expect((await asServiceCommit(pool, (q) => q("select public.email_complete($1,null,'msg-1',6) as r", [id]))).rows[0].r).toBe("sent");
      expect((await asServiceCommit(pool, (q) => q("select public.email_complete($1,null,'msg-1',6) as r", [id]))).rows[0].r).toBe("not_sending");
      const row = (await pool.query("select status, provider_message_id, sent_at from public.email_outbox where id=$1", [id])).rows[0];
      expect(row.status).toBe("sent");
      expect(row.provider_message_id).toBe("msg-1");
      expect(row.sent_at).toBeInstanceOf(Date);
    });

    it("помилка: повтор із зростаючою затримкою, після межі спроб — failed", async () => {
      const id = (await enqueue("msg:complete:fail")).rows[0].id;
      const delays: number[] = [];
      let status = "pending";
      for (let attempt = 1; attempt <= 3; attempt++) {
        await pool.query("update public.email_outbox set next_attempt_at = now() - interval '1 second', status = case when status='pending' then 'pending' else status end where id=$1", [id]);
        const claimed = await asServiceCommit(pool, (q) => q("select id, attempts from public.email_claim(50)"));
        expect(claimed.rows.map((r) => r.id)).toContain(id);
        status = (await asServiceCommit(pool, (q) => q("select public.email_complete($1,'SMTP timeout',null,3) as r", [id]))).rows[0].r;
        const next = await pool.query("select extract(epoch from (next_attempt_at - now()))::int as s, last_error from public.email_outbox where id=$1", [id]);
        delays.push(next.rows[0].s);
        expect(next.rows[0].last_error).toBe("SMTP timeout");
      }
      expect(status).toBe("failed");
      expect(delays[1]!).toBeGreaterThan(delays[0]!);
      expect((await asServiceCommit(pool, (q) => q("select count(*)::int as n from public.email_claim(50) where id=$1", [id]))).rows[0].n).toBe(0);
    });

    it("недоступна браузерним ролям; адміністратор лише читає чергу, клієнт не бачить нічого", async () => {
      for (const session of [null, a, admin]) {
        await expect(asUser(pool, session, (q) => q("select public.email_enqueue('msg:hack:1001','new_message','x@example.com',null,'uk','{}'::jsonb,null,null)"))).rejects.toThrow(/permission denied/);
        await expect(asUser(pool, session, (q) => q("select * from public.email_claim(5)"))).rejects.toThrow(/permission denied/);
      }
      expect((await asUser(pool, a, (q) => q("select id from public.email_outbox"))).rows).toHaveLength(0);
      expect((await asUser(pool, admin, (q) => q("select id from public.email_outbox"))).rows.length).toBeGreaterThan(0);
      await expect(asUser(pool, admin, (q) => q("update public.email_outbox set status='sent'"))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, admin, (q) => q("select payload from public.email_outbox"))).rejects.toThrow(/permission denied/);
    });
  });

  describe("черга листів: експлуатація", () => {
    it("backfill ставить у чергу заявки без листа, ідемпотентно; запит без прав відхиляється", async () => {
      await pool.query("delete from public.email_outbox where template = 'order_received'");
      const first = (await asServiceCommit(pool, (q) => q("select public.email_backfill_order_received() as n"))).rows[0].n;
      expect(first).toBeGreaterThanOrEqual(2);
      expect((await asServiceCommit(pool, (q) => q("select public.email_backfill_order_received() as n"))).rows[0].n).toBe(0);
      const row = (await pool.query("select template, to_email, payload from public.email_outbox where template='order_received' limit 1")).rows[0];
      expect(row.to_email).toBe(row.to_email.toLowerCase());
      expect(Object.keys(row.payload)).toEqual(["ticket"]);
      await expect(asUser(pool, a, (q) => q("select public.email_backfill_order_received()"))).rejects.toThrow(/permission denied/);
    });

    it("застарілі листи (понад 7 діб) не відправляються: claim переводить їх у failed/expired", async () => {
      await pool.query("delete from public.email_outbox");
      const id = (await asServiceCommit(pool, (q) => q("select public.email_enqueue('old-mail-0001','new_message','old@example.com',null,'uk','{}'::jsonb,null,null) as id"))).rows[0].id;
      await pool.query("update public.email_outbox set created_at = now() - interval '8 days' where id=$1", [id]);
      const claimed = await asServiceCommit(pool, (q) => q("select * from public.email_claim(10)"));
      expect(claimed.rows).toHaveLength(0);
      expect((await pool.query("select status, last_error from public.email_outbox where id=$1", [id])).rows[0]).toEqual({ status: "failed", last_error: "expired" });
    });

    it("зведення черги бачить лише адміністратор з MFA", async () => {
      await asServiceCommit(pool, (q) => q("select public.email_enqueue('stat-mail-0001','new_message','s@example.com',null,'uk','{}'::jsonb,null,null)"));
      const adminStats = await asUser(pool, admin, (q) => q("select status, total from public.email_queue_stats()"));
      expect(adminStats.rows.some((r) => r.status === "pending")).toBe(true);
      expect((await asUser(pool, a, (q) => q("select * from public.email_queue_stats()"))).rows).toHaveLength(0);
      expect((await asUser(pool, adminNoMfa, (q) => q("select * from public.email_queue_stats()"))).rows).toHaveLength(0);
      await expect(asUser(pool, null, (q) => q("select * from public.email_queue_stats()"))).rejects.toThrow(/permission denied/);
    });
  });

  describe("оплата: конкурентність, залишок і повернення", () => {
    const mkInvoice = async (label: string, amount: number) => {
      let id = "";
      await asUserCommit(pool, admin, async (q) => {
        id = (await q("select public.admin_create_invoice($1,$2,$3,'UAH',null) as id", [projectA, label, amount])).rows[0].id;
        await q("select public.admin_issue_invoice($1)", [id]);
      });
      return id;
    };
    const paid = async (id: string) => (await pool.query("select public.invoice_paid_raw($1)::text as p", [id])).rows[0].p as string;
    const state = async (id: string) => (await asUser(pool, a, (q) => q("select public.invoice_payment_state($1) as s", [id]))).rows[0].s as string;

    it("два адміністратори одночасно підтверджують один платіж: підтвердження одне", async () => {
      const inv = await mkInvoice("Гонка адмінів", 1000);
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'гонка')", [inv]));
      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [inv])).rows[0].id;
      const results = await Promise.allSettled([
        asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,'A')", [pid])),
        asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,'B')", [pid])),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/not_pending/);
      expect(await paid(inv)).toBe("1000.00");
      expect(await state(inv)).toBe("paid");
    });

    it("вебхук провайдера й ручне підтвердження одночасно на повну суму: оплачено рівно один раз", async () => {
      const inv = await mkInvoice("Гонка вебхук/адмін", 1000);
      const number = (await pool.query("select number from public.invoices where id=$1", [inv])).rows[0].number;
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'вручну')", [inv]));
      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [inv])).rows[0].id;
      const results = await Promise.allSettled([
        asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,null,'ручне')", [pid])),
        asServiceCommit(pool, (q) => q("select public.payments_apply_provider_event('liqpay','e-race-1',$1,1000,'UAH','success','pay-race-1','{}'::jsonb) as r", [number])),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      // Що б не виграло, сума оплат не перевищує рахунок і не менша за нього.
      expect(await paid(inv)).toBe("1000.00");
      expect(await state(inv)).toBe("paid");
    });

    it("залишок до копійки: часткові оплати 333.33 + 333.33 лишають 333.34, повернення зменшує оплачене", async () => {
      const inv = await mkInvoice("Копійки", 1000);
      for (const amount of [333.33, 333.33]) {
        await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'частина')", [inv]));
        const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [inv])).rows[0].id;
        await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1,$2,null)", [pid, amount]));
      }
      expect(await paid(inv)).toBe("666.66");
      expect(await state(inv)).toBe("partial");
      await expect(asUser(pool, admin, (q) => q("select public.admin_record_refund($1, 666.67, 'x')", [inv]))).rejects.toThrow(/refund_exceeds_paid/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_record_refund($1, 100.01, 'повернення')", [inv]));
      expect(await paid(inv)).toBe("566.65");
      // Залишок до оплати = сума рахунку − оплачене = 433.35; перевищення відхиляється, точний залишок проходить.
      await asUserCommit(pool, a, (q) => q("select public.client_report_payment($1,'залишок')", [inv]));
      const pid = (await pool.query("select id from public.payments where invoice_id=$1 and status='pending'", [inv])).rows[0].id;
      await expect(asUser(pool, admin, (q) => q("select public.admin_confirm_payment($1, 433.36, null)", [pid]))).rejects.toThrow(/overpayment/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_payment($1, 433.35, null)", [pid]));
      expect(await paid(inv)).toBe("1000.00");
      expect(await state(inv)).toBe("paid");
    });

    it("повтор вебхука з іншим event id для того самого платежу провайдера не подвоює суму; оплачений рахунок не приймає другу оплату", async () => {
      const inv = await mkInvoice("Повтор вебхука", 700);
      const number = (await pool.query("select number from public.invoices where id=$1", [inv])).rows[0].number;
      const call = (event: string, pay: string) =>
        pool.query("select public.payments_apply_provider_event('liqpay',$1,$2,700,'UAH','success',$3,'{}'::jsonb) as r", [event, number, pay]);
      expect((await call("e-dup-1", "pay-dup")).rows[0].r).toBe("confirmed");
      expect((await call("e-dup-2", "pay-dup")).rows[0].r).not.toBe("confirmed");
      expect(await paid(inv)).toBe("700.00");
      const second = await call("e-dup-3", "pay-other").then((r) => r.rows[0].r as string, (e: Error) => e.message);
      expect(second).not.toBe("confirmed");
      expect(await paid(inv)).toBe("700.00");
    });
  });

  describe("матриця прав на RPC", () => {
    type Role = "anon" | "clientA" | "clientB" | "adminNoMfa" | "admin" | "service";
    const sessions: Record<Exclude<Role, "service">, Session | null> = { anon: null, clientA: a, clientB: b, adminNoMfa, admin };
    const call = async (role: Role, sql: string, values: unknown[] = []) => {
      try {
        if (role === "service") await asService(pool, (q) => q(sql, values));
        else await asUser(pool, sessions[role], (q) => q(sql, values));
        return "allowed";
      } catch (error) {
        const message = (error as Error).message;
        if (/permission denied/.test(message)) return "denied";
        if (/forbidden/.test(message)) return "forbidden";
        return `other:${message}`;
      }
    };

    const cases: Array<{ name: string; sql: () => [string, unknown[]]; expected: Record<Role, string> }> = [
      {
        name: "client_send_message (проєкт A)",
        sql: () => ["select public.client_send_message($1,'матриця')", [projectA]],
        expected: { anon: "denied", clientA: "allowed", clientB: "forbidden", adminNoMfa: "forbidden", admin: "forbidden", service: "denied" },
      },
      {
        name: "client_report_payment (рахунок A)",
        sql: () => ["select public.client_report_payment($1,'x')", [invoiceA]],
        // рахунок A уже очікує підтвердження: власник отримує бізнес-відмову, не права
        expected: { anon: "denied", clientA: "other:already_reported", clientB: "forbidden", adminNoMfa: "forbidden", admin: "forbidden", service: "denied" },
      },
      {
        name: "client_mark_read (проєкт A)",
        sql: () => ["select public.client_mark_read($1)", [projectA]],
        expected: { anon: "denied", clientA: "allowed", clientB: "forbidden", adminNoMfa: "forbidden", admin: "forbidden", service: "denied" },
      },
      {
        name: "admin_send_message (проєкт A)",
        sql: () => ["select public.admin_send_message($1,'матриця')", [projectA]],
        expected: { anon: "denied", clientA: "forbidden", clientB: "forbidden", adminNoMfa: "forbidden", admin: "allowed", service: "denied" },
      },
      {
        name: "admin_set_project_stage",
        sql: () => ["select public.admin_set_project_stage($1,'design')", [projectB]],
        expected: { anon: "denied", clientA: "forbidden", clientB: "forbidden", adminNoMfa: "forbidden", admin: "allowed", service: "denied" },
      },
      {
        name: "admin_create_invoice",
        sql: () => ["select public.admin_create_invoice($1,'матриця',10,'UAH',null)", [projectA]],
        expected: { anon: "denied", clientA: "forbidden", clientB: "forbidden", adminNoMfa: "forbidden", admin: "allowed", service: "denied" },
      },
      {
        name: "admin_update_payment_settings",
        sql: () => ["select public.admin_update_payment_settings('Х','','','','')", []],
        expected: { anon: "denied", clientA: "forbidden", clientB: "forbidden", adminNoMfa: "forbidden", admin: "allowed", service: "denied" },
      },
      {
        name: "delete_project_file (неіснуючий файл)",
        sql: () => ["select public.delete_project_file('00000000-0000-4000-8000-000000000000')", []],
        expected: { anon: "denied", clientA: "other:not_found", clientB: "other:not_found", adminNoMfa: "other:not_found", admin: "other:not_found", service: "denied" },
      },
      {
        name: "client_bank_details",
        sql: () => ["select public.client_bank_details()", []],
        expected: { anon: "denied", clientA: "allowed", clientB: "allowed", adminNoMfa: "allowed", admin: "allowed", service: "denied" },
      },
      {
        name: "client_claim_orders",
        sql: () => ["select public.client_claim_orders()", []],
        expected: { anon: "denied", clientA: "allowed", clientB: "allowed", adminNoMfa: "allowed", admin: "allowed", service: "denied" },
      },
      {
        name: "payments_apply_provider_event (лише service_role)",
        sql: () => ["select public.payments_apply_provider_event('liqpay','matrix-1','INV-0000-00000',1,'UAH','success','p','{}'::jsonb)", []],
        expected: { anon: "denied", clientA: "denied", clientB: "denied", adminNoMfa: "denied", admin: "denied", service: "allowed" },
      },
      {
        name: "auth_throttle_hit (лише service_role)",
        sql: () => ["select public.auth_throttle_hit('matrix',100,interval '1 hour')", []],
        expected: { anon: "denied", clientA: "denied", clientB: "denied", adminNoMfa: "denied", admin: "denied", service: "allowed" },
      },
      {
        name: "create_order_v2 (лише service_role)",
        sql: () => ["select public.create_order_v2('landing',null,null,null,'Марія Тест','matrix@example.com',null,'{}'::jsonb,'{}','ip-matrix','x','x',false)", []],
        expected: { anon: "denied", clientA: "denied", clientB: "denied", adminNoMfa: "denied", admin: "denied", service: "allowed" },
      },
    ];

    for (const entry of cases) {
      it(entry.name, async () => {
        const [sql, values] = entry.sql();
        const actual: Record<string, string> = {};
        for (const role of Object.keys(entry.expected) as Role[]) actual[role] = await call(role, sql, values);
        expect(actual).toEqual(entry.expected);
      });
    }

    it("жодна security definer-функція не виконується роллю anon", async () => {
      const rows = await pool.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`,
      );
      expect(rows.rows.map((r) => r.proname)).toEqual([]);
    });

    it("службові функції (журнали, хеші, внутрішні підрахунки) недоступні authenticated", async () => {
      const rows = await pool.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1) and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
        [["project_log", "create_project_stages", "invoice_paid_raw", "file_mime_allowed", "proposal_content_hash", "payments_apply_provider_event", "auth_throttle_hit", "email_enqueue", "email_claim", "email_complete", "create_order_v2", "create_order"]],
      );
      expect(rows.rows.map((r) => r.proname)).toEqual([]);
    });

    it("повний перелік security definer-функцій, доступних authenticated, збігається зі схваленим (захист від випадкового розширення прав)", async () => {
      const rows = await pool.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
      );
      expect(rows.rows.map((r) => r.proname)).toMatchInlineSnapshot(`
        [
          "admin_add_internal_note",
          "admin_add_note",
          "admin_assign_order",
          "admin_confirm_payment",
          "admin_create_deliverable",
          "admin_create_invoice",
          "admin_create_invoices_from_proposal",
          "admin_create_proposal",
          "admin_is_allowlisted",
          "admin_issue_invoice",
          "admin_mark_read",
          "admin_record_refund",
          "admin_register_file",
          "admin_reject_payment",
          "admin_send_message",
          "admin_send_proposal",
          "admin_set_order_status",
          "admin_set_project_stage",
          "admin_submit_deliverable",
          "admin_update_deliverable",
          "admin_update_payment_settings",
          "admin_update_project",
          "admin_update_proposal",
          "admin_void_invoice",
          "attach_files_to_message",
          "client_bank_details",
          "client_claim_orders",
          "client_decide_deliverable",
          "client_decide_proposal",
          "client_mark_read",
          "client_register_file",
          "client_report_payment",
          "client_send_message",
          "client_unread_counts",
          "client_update_profile",
          "delete_project_file",
          "email_queue_stats",
          "invoice_paid_amount",
          "invoice_payment_state",
          "is_admin",
          "is_project_client",
          "project_assignee_name",
          "project_invoice_states",
        ]
      `);
    });
  });
});
