import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asServiceCommit, asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/** V0.5 фаза 3: передача проєкту (Handover), гарантія, підтримка. */
describe.skipIf(!dbEnabled)("передача й підтримка V0.5 (PostgreSQL)", () => {
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

  const website = {
    product_kind: "website",
    production_url: "https://example-client.ua",
    domain: "example-client.ua",
    domain_owner: "Клієнт продовжує домен щороку",
    hosting: "Vercel, акаунт клієнта",
    repository_url: "https://github.com/client/site",
    docs_url: "https://docs.example-client.ua",
    backup_note: "Щоденні копії бази в Supabase",
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    await resetDatabase(pool);
    await pool.query(`insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'a@example.com',now()),($3,'b@example.com',now())`, [ADMIN, CLIENT_A, CLIENT_B]);
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін')", [ADMIN]);
    for (const [i, email] of ["a@example.com", "b@example.com"].entries()) {
      await pool.query(`select public.create_order_v2('webapp', 'Сайт', null, null, 'Клієнт', $1, null, '{}'::jsonb, '{}', $2, 'vitest', '2026-11-08', false)`, [email, `ip-del-${i}`]);
    }
    await asUserCommit(pool, a, (q) => q("select public.client_claim_orders()"));
    await asUserCommit(pool, b, (q) => q("select public.client_claim_orders()"));
    projectA = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_A])).rows[0].id;
    projectB = (await pool.query("select id from public.projects where client_id=$1", [CLIENT_B])).rows[0].id;
    await pool.query("update public.projects set activated_at = now() where id = any($1)", [[projectA]]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("передача проєкту", () => {
    it("секрети не зберігаються: паролі, токени, приватні ключі, JWT відхиляються; звичайні слова — ні", async () => {
      const bad = [
        { ...website, backup_note: "пароль: Sup3rSecret!" },
        { ...website, hosting: "password=hunter22" },
        { ...website, backend_note: "api_key: abcd1234efgh5678" },
        { ...website, rights_note: "-----BEGIN RSA PRIVATE KEY-----" },
        { ...website, backend_note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk" },
        { ...website, repository_url: "https://github.com/client/site", backend_note: "ghp_abcdefghijklmnopqrstuvwxyz0123" },
      ];
      for (const fields of bad) {
        await expect(asUser(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify(fields)]))).rejects.toThrow(/check constraint/);
      }
      await asUserCommit(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify({ ...website, rights_note: "Паролі передаються окремо захищеним каналом, у документі їх немає" })]));
      expect((await pool.query("select status from public.handover_records where project_id=$1", [projectA])).rows[0].status).toBe("draft");
    });

    it("посилання лише https; артефакти валідуються", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify({ ...website, production_url: "http://insecure.example" })]))).rejects.toThrow(/check constraint/);
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify({ ...website, artifacts: [{ kind: "exe", label: "x", url: "https://x.example/a" }] })]))).rejects.toThrow(/invalid_artifacts/);
    });

    it("чернетку клієнт не бачить; неповну передачу не можна відправити; клієнт/anon/адмін без MFA не мають доступу", async () => {
      expect((await asUser(pool, a, (q) => q("select id from public.handover_records"))).rows).toHaveLength(0);
      await asUserCommit(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify({ product_kind: "website", production_url: "https://example-client.ua" })]));
      await expect(asUser(pool, admin, (q) => q("select public.admin_submit_handover($1)", [projectA]))).rejects.toThrow(/handover_incomplete/);
      await expect(asUser(pool, a, (q) => q("select public.admin_save_handover($1,'{}'::jsonb)", [projectA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, adminNoMfa, (q) => q("select public.admin_submit_handover($1)", [projectA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, null, (q) => q("select * from public.handover_records"))).rejects.toThrow(/permission denied/);
    });

    it("відправлена передача бачиться клієнту й заморожена; клієнт Б її не бачить", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify(website)]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_submit_handover($1)", [projectA]));
      expect((await asUser(pool, a, (q) => q("select status, production_url from public.handover_records"))).rows[0]).toEqual({ status: "submitted", production_url: "https://example-client.ua" });
      expect((await asUser(pool, b, (q) => q("select id from public.handover_records"))).rows).toHaveLength(0);
      await expect(asUser(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify(website)]))).rejects.toThrow(/handover_locked/);
      await expect(asUser(pool, b, (q) => q("select public.client_decide_handover($1,'approved',null)", [projectA]))).rejects.toThrow(/forbidden/);
    });

    it("правки клієнта: потрібен коментар; після правок адміністратор може змінити й відправити повторно", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_decide_handover($1,'changes_requested',' ')", [projectA]))).rejects.toThrow(/comment_required/);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_handover($1,'changes_requested','Додайте інструкцію користувача')", [projectA]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_save_handover($1,$2::jsonb)", [projectA, JSON.stringify({ ...website, manual_url: "https://docs.example-client.ua/manual" })]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_submit_handover($1)", [projectA]));
    });

    it("завершити проєкт до приймання не можна; приймання фіксується в журналі зі знімком; запис потім незмінний", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_complete_project($1,'2027-05-01')", [projectA]))).rejects.toThrow(/handover_not_accepted/);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_handover($1,'approved',null)", [projectA]));
      const log = (await pool.query("select decision, snapshot->>'production_url' as url, snapshot ? 'created_by' as leaks from public.handover_decisions order by id")).rows;
      expect(log).toEqual([
        { decision: "changes_requested", url: "https://example-client.ua", leaks: false },
        { decision: "approved", url: "https://example-client.ua", leaks: false },
      ]);
      await expect(pool.query("update public.handover_records set hosting='підміна' where project_id=$1", [projectA])).rejects.toThrow(/handover_locked/);
      await expect(pool.query("delete from public.handover_decisions")).rejects.toThrow(/append_only/);
      await expect(asUser(pool, a, (q) => q("select public.client_decide_handover($1,'approved',null)", [projectA]))).rejects.toThrow(/not_pending/);
    });

    it("завершення: статус «завершено», етап «підтримка», гарантійний строк встановлює адміністратор; подія в журналі проєкту", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_complete_project($1,'2099-01-01')", [projectA]));
      const p = (await pool.query("select status, stage, warranty_until::text as w from public.projects where id=$1", [projectA])).rows[0];
      expect(p).toEqual({ status: "completed", stage: "support", w: "2099-01-01" });
      expect((await pool.query("select count(*)::int as n from public.project_events where project_id=$1 and type in ('handover_submitted','handover_approved','project_completed')", [projectA])).rows[0].n).toBe(4);
      await expect(asUser(pool, admin, (q) => q("select public.admin_complete_project($1,null)", [projectA]))).rejects.toThrow(/not_pending/);
    });
  });

  describe("підтримка", () => {
    let ticket = "";

    it("звернення можливе лише у власному активному проєкті (також після завершення); чужий і неактивний — ні", async () => {
      await expect(asUser(pool, b, (q) => q("select public.client_create_ticket($1,'bug','normal','Помилка','Опис помилки детально')", [projectA]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, b, (q) => q("select public.client_create_ticket($1,'bug','normal','Помилка','Опис помилки детально')", [projectB]))).rejects.toThrow(/project_not_active/);
      await expect(asUser(pool, a, (q) => q("select public.client_create_ticket($1,'magic','normal','Помилка','Опис помилки детально')", [projectA]))).rejects.toThrow(/check constraint/);
      ticket = (await asUserCommit(pool, a, (q) => q("select public.client_create_ticket($1,'warranty_fix','high','Не працює форма','Форма заявки не надсилається після оновлення') as id", [projectA]))).rows[0].id;
      const row = (await pool.query("select number, status, priority from public.support_tickets where id=$1", [ticket])).rows[0];
      expect(row.number).toMatch(/^SUP-\d{4}-\d{5}$/);
      expect(row).toMatchObject({ status: "new", priority: "high" });
    });

    it("клієнт Б не бачить звернення клієнта А; anon нічого не читає", async () => {
      expect((await asUser(pool, b, (q) => q("select id from public.support_tickets"))).rows).toHaveLength(0);
      expect((await asUser(pool, b, (q) => q("select id from public.support_messages"))).rows).toHaveLength(0);
      await expect(asUser(pool, b, (q) => q("select public.client_ticket_reply($1,'чужий коментар')", [ticket]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, null, (q) => q("select * from public.support_tickets"))).rejects.toThrow(/permission denied/);
    });

    it("гарантійний статус бачить лише студія (за датою звернення); внутрішні нотатки клієнту недоступні", async () => {
      expect((await asUser(pool, admin, (q) => q("select public.ticket_warranty_state($1) as s", [ticket]))).rows[0].s).toBe("in_warranty");
      expect((await asUser(pool, a, (q) => q("select public.ticket_warranty_state($1) as s", [ticket]))).rows[0].s).toBeNull();
      await asUserCommit(pool, admin, (q) => q("select public.admin_ticket_reply($1,'Перевіряємо, схоже на регресію після оновлення',true)", [ticket]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_ticket_reply($1,'Дякуємо, відтворили проблему, працюємо над виправленням',false)", [ticket]));
      const seen = (await asUser(pool, a, (q) => q("select body from public.support_messages where ticket_id=$1 order by id", [ticket]))).rows.map((r) => r.body);
      expect(seen).toEqual(["Дякуємо, відтворили проблему, працюємо над виправленням"]);
      expect((await asUser(pool, admin, (q) => q("select body from public.support_messages where ticket_id=$1", [ticket]))).rows).toHaveLength(2);
      expect((await pool.query("select status from public.support_tickets where id=$1", [ticket])).rows[0].status).toBe("in_progress");
      expect((await asUser(pool, a, (q) => q("select id from public.support_events"))).rows).toHaveLength(0);
    });

    it("вирішення вимагає результату; клієнт підтверджує закриття; нова відповідь клієнта повертає звернення в роботу", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_update_ticket($1,'resolved',$2,'high',null)", [ticket, ADMIN]))).rejects.toThrow(/result_required/);
      await asUserCommit(pool, admin, (q) => q("select public.admin_update_ticket($1,'resolved',$2,'high','Виправлено у версії 1.0.1')", [ticket, ADMIN]));
      expect((await pool.query("select status, result, resolved_at is not null as r from public.support_tickets where id=$1", [ticket])).rows[0]).toEqual({ status: "resolved", result: "Виправлено у версії 1.0.1", r: true });
      await asUserCommit(pool, a, (q) => q("select public.client_ticket_reply($1,'Ні, проблема лишилась')", [ticket]));
      expect((await pool.query("select status, result from public.support_tickets where id=$1", [ticket])).rows[0]).toMatchObject({ status: "in_progress" });
      await asUserCommit(pool, admin, (q) => q("select public.admin_update_ticket($1,'resolved',$2,'high','Виправлено остаточно у версії 1.0.2')", [ticket, ADMIN]));
      await asUserCommit(pool, a, (q) => q("select public.client_close_ticket($1)", [ticket]));
      expect((await pool.query("select status from public.support_tickets where id=$1", [ticket])).rows[0].status).toBe("closed");
      await expect(asUser(pool, a, (q) => q("select public.client_ticket_reply($1,'ще раз')", [ticket]))).rejects.toThrow(/ticket_closed/);
      await expect(asUser(pool, a, (q) => q("select public.client_close_ticket($1)", [ticket]))).rejects.toThrow(/not_pending/);
    });

    it("історія звернення повна й незмінна", async () => {
      const types = (await pool.query("select type from public.support_events where ticket_id=$1 order by id", [ticket])).rows.map((r) => r.type);
      expect(types[0]).toBe("created");
      expect(types).toEqual(expect.arrayContaining(["replied", "status_changed", "assigned", "closed_by_client"]));
      await expect(pool.query("update public.support_events set type='created'")).rejects.toThrow(/append_only/);
    });

    it("платне доопрацювання оформлюється як окремий запит на зміну; повторно не конвертується", async () => {
      const paid = (await asUserCommit(pool, a, (q) => q("select public.client_create_ticket($1,'paid_work','normal','Нова сторінка','Потрібна ще одна сторінка з кейсами') as id", [projectA]))).rows[0].id;
      await expect(asUser(pool, a, (q) => q("select public.admin_ticket_to_change($1)", [paid]))).rejects.toThrow(/forbidden/);
      const cr = (await asUserCommit(pool, admin, (q) => q("select public.admin_ticket_to_change($1) as id", [paid]))).rows[0].id;
      expect((await pool.query("select status, ticket_id from public.change_requests where id=$1", [cr])).rows[0]).toEqual({ status: "submitted", ticket_id: paid });
      await expect(asUser(pool, admin, (q) => q("select public.admin_ticket_to_change($1)", [paid]))).rejects.toThrow(/already_converted/);
      // Платна робота йде звичайним шляхом: оцінка → додаткова угода → погодження клієнтом.
      const doc = (await asUserCommit(pool, admin, (q) => q("select public.admin_quote_change_request($1,'Сторінка кейсів, 1 тиждень роботи',8000,'UAH',7) as d", [cr]))).rows[0].d;
      await asUserCommit(pool, a, (q) => q("select public.client_decide_document($1,'approved','Погоджую')", [doc]));
      expect((await pool.query("select status from public.change_requests where id=$1", [cr])).rows[0].status).toBe("approved");
    });

    it("вкладення до звернення: лише власні файли проєкту; чужий проєкт — ні", async () => {
      const ticket2 = (await asUserCommit(pool, a, (q) => q("select public.client_create_ticket($1,'bug','low','Скріншот','Прикладаю скріншот помилки у формі') as id", [projectA]))).rows[0].id;
      const file = (await asUserCommit(pool, a, (q) => q("select public.client_register_file($1,'attachment','err.png','image/png',1024,$2) as id", [projectA, `${projectA}/f1-${Date.now()}`]))).rows[0].id;
      await asUserCommit(pool, a, (q) => q("select public.attach_files_to_ticket($1,$2::uuid[])", [ticket2, [file]]));
      expect((await pool.query("select ticket_id from public.project_files where id=$1", [file])).rows[0].ticket_id).toBe(ticket2);
      await expect(asUser(pool, a, (q) => q("select public.attach_files_to_ticket($1,$2::uuid[])", [ticket2, [file]]))).rejects.toThrow(/invalid_files/);
      await expect(asUser(pool, b, (q) => q("select public.attach_files_to_ticket($1,$2::uuid[])", [ticket2, [file]]))).rejects.toThrow(/forbidden/);
    });
  });

  describe("шаблони листів", () => {
    it("черга приймає нові шаблони й відхиляє невідомі", async () => {
      for (const template of ["document_for_approval", "budget_change", "stage_completed", "handover_ready", "support_update", "order_rejected"]) {
        await asServiceCommit(pool, (q) => q("select public.email_enqueue($1,$2,'t@example.com',null,'uk','{}'::jsonb,null,null)", [`k-${template}-12345`, template]));
      }
      await expect(asService(pool, (q) => q("select public.email_enqueue('k-bad-1234567','nonsense','t@example.com',null,'uk','{}'::jsonb,null,null)"))).rejects.toThrow(/check constraint/);
    });
  });
});
