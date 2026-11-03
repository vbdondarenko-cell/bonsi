import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/**
 * V0.4 Client Workspace на справжньому PostgreSQL: ізоляція клієнтів (RLS), розділення ролей,
 * чат без витоку внутрішніх нотаток, версіоване погодження пропозицій, незмінний журнал рішень.
 *   DATABASE_URL=postgres://... ALLOW_DESTRUCTIVE_DB_TEST=1 npm test
 */
describe.skipIf(!dbEnabled)("client workspace (PostgreSQL)", () => {
  let pool: pg.Pool;

  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CLIENT_A = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const CLIENT_B = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2";
  const UNCONFIRMED = "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const adminNoMfa: Session = { sub: ADMIN, aal: "aal1" };
  const a: Session = { sub: CLIENT_A, aal: "aal1" };
  const b: Session = { sub: CLIENT_B, aal: "aal1" };

  let projectA = "";
  let projectB = "";

  async function order(email: string, extra: { budget?: string | null; idea?: string | null } = {}) {
    const { rows } = await pool.query(
      `select public.create_order_v2('webapp', $1, $2, null, 'Клієнт', $3, null, '{"platform":"web"}'::jsonb, '{}', $4, 'vitest', '2026-11-02', false) as t`,
      [extra.idea ?? null, extra.budget ?? null, email, `ip-${email}`],
    );
    return rows[0].t as string;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    await resetDatabase(pool);
    await pool.query(
      `insert into auth.users (id, email, email_confirmed_at) values
        ($1, 'admin@bonsi.test', now()), ($2, 'a@example.com', now()), ($3, 'b@example.com', now()), ($4, 'u@example.com', null)`,
      [ADMIN, CLIENT_A, CLIENT_B, UNCONFIRMED],
    );
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1, 'admin@bonsi.test', 'Адмін')", [ADMIN]);

    await order("a@example.com");
    await order("b@example.com", { budget: "discuss", idea: "Потрібен веб-застосунок для обліку" });
    await order("u@example.com");
    await asUserCommit(pool, a, (q) => q("select public.client_claim_orders()"));
    await asUserCommit(pool, b, (q) => q("select public.client_claim_orders()"));
    projectA = (await pool.query("select id from public.projects where client_id = $1", [CLIENT_A])).rows[0].id;
    projectB = (await pool.query("select id from public.projects where client_id = $1", [CLIENT_B])).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("заявки без зайвих полів", () => {
    it("приймає заявку без бюджету, термінів і опису та зберігає уточнення й посилання", async () => {
      const { rows } = await pool.query(
        `select public.create_order_v2('landing', null, null, null, 'Ім''я', 'new@example.com', null,
           '{"pages":"3-5"}'::jsonb, array['https://example.com/ref'], 'ip-new', 'vitest', '2026-11-02', false) as t`,
      );
      const stored = await pool.query(
        "select idea, budget, deadline, details, links, status from public.orders where ticket_number = $1",
        [rows[0].t],
      );
      expect(stored.rows[0]).toMatchObject({ idea: null, budget: null, deadline: null, details: { pages: "3-5" }, links: ["https://example.com/ref"], status: "new" });
    });

    it("старі заявки (повні, з бюджетом) і стара функція create_order працюють без змін", async () => {
      const { rows } = await pool.query(
        `select public.create_order('webapp', 'Старий формат: потрібен веб-застосунок', 'lt-50k', 'asap', 'Старий', 'old@example.com', null, 'ip-old', 'vitest', '2026-10-31', false) as t`,
      );
      const stored = await pool.query("select budget, deadline, details, links from public.orders where ticket_number = $1", [rows[0].t]);
      expect(stored.rows[0]).toMatchObject({ budget: "lt-50k", deadline: "asap", details: {}, links: [] });
    });

    it("відхиляє понад 5 посилань і недійсний бюджет у самій таблиці", async () => {
      await expect(
        pool.query(
          `select public.create_order_v2('landing', null, null, null, 'X1', 'many@example.com', null, '{}'::jsonb,
             array['a','b','c','d','e','f'], 'ip-many', 'vitest', '2026-11-02', false)`,
        ),
      ).rejects.toThrow(/orders_links_check/);
      await expect(
        pool.query(
          `select public.create_order_v2('landing', null, 'free', null, 'X2', 'bad@example.com', null, '{}'::jsonb,
             '{}', 'ip-bad', 'vitest', '2026-11-02', false)`,
        ),
      ).rejects.toThrow(/orders_budget_check/);
    });

    it("зберігає ліміти приймання (3 заявки/год з одного email) і для нової функції", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          pool.query(
            `select public.create_order_v2('landing', null, null, null, 'Ліміт', 'limit@example.com', null, '{}'::jsonb, '{}', $1, 'vitest', '2026-11-02', false)`,
            [`ip-limit-${i}`],
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    });

    it("v2 недоступна для anon і authenticated", async () => {
      for (const session of [null, a]) {
        await expect(
          asUser(pool, session, (q) =>
            q(`select public.create_order_v2('landing', null, null, null, 'Хакер', 'h@example.com', null, '{}'::jsonb, '{}', 'x', 'x', 'x', false)`),
          ),
        ).rejects.toThrow(/permission denied/);
      }
    });
  });

  describe("ліміт спроб входу", () => {
    it("дозволяє рівно N спроб у вікні навіть під паралельними запитами", async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => pool.query("select public.auth_throttle_hit('k-concurrent', 5, interval '1 hour') as ok")),
      );
      expect(results.filter((r) => r.rows[0].ok === true)).toHaveLength(5);
    });

    it("окремі ключі не впливають один на одного, а вікно скидається", async () => {
      expect((await pool.query("select public.auth_throttle_hit('k-other', 1, interval '1 hour') as ok")).rows[0].ok).toBe(true);
      expect((await pool.query("select public.auth_throttle_hit('k-other', 1, interval '1 hour') as ok")).rows[0].ok).toBe(false);
      await pool.query("update public.auth_throttle set window_start = now() - interval '2 hours' where key = 'k-other'");
      expect((await pool.query("select public.auth_throttle_hit('k-other', 1, interval '1 hour') as ok")).rows[0].ok).toBe(true);
    });

    it("недоступний браузерним ролям", async () => {
      for (const session of [null, a]) {
        await expect(asUser(pool, session, (q) => q("select public.auth_throttle_hit('x', 1, interval '1 hour')"))).rejects.toThrow(/permission denied/);
        await expect(asUser(pool, session, (q) => q("select * from public.auth_throttle"))).rejects.toThrow(/permission denied/);
      }
    });
  });

  describe("прив'язка заявки до підтвердженої особи", () => {
    it("створює проєкт для підтвердженого email і не чіпає чужі заявки", async () => {
      const mine = await asUser(pool, a, (q) => q("select title, stage, status, next_action_owner from public.projects"));
      expect(mine.rows).toHaveLength(1);
      expect(mine.rows[0]).toMatchObject({ stage: "brief", status: "active", next_action_owner: "studio" });
      const orders = await pool.query("select email, client_id from public.orders where email in ('a@example.com','b@example.com')");
      expect(Object.fromEntries(orders.rows.map((r) => [r.email, r.client_id]))).toEqual({
        "a@example.com": CLIENT_A,
        "b@example.com": CLIENT_B,
      });
    });

    it("не прив'язує заявки до непідтвердженого email", async () => {
      const claimed = await asUserCommit(pool, { sub: UNCONFIRMED, aal: "aal1" }, (q) => q("select public.client_claim_orders() as n"));
      expect(claimed.rows[0].n).toBe(0);
      const row = await pool.query("select client_id from public.orders where email = 'u@example.com'");
      expect(row.rows[0].client_id).toBeNull();
    });

    it("ідемпотентна: повторний виклик не дублює проєкти", async () => {
      const again = await asUserCommit(pool, a, (q) => q("select public.client_claim_orders() as n"));
      expect(again.rows[0].n).toBe(0);
      expect((await pool.query("select count(*)::int as n from public.projects where client_id = $1", [CLIENT_A])).rows[0].n).toBe(1);
    });

    it("адміністратор не стає клієнтом", async () => {
      await order("admin@bonsi.test");
      const claimed = await asUserCommit(pool, admin, (q) => q("select public.client_claim_orders() as n"));
      expect(claimed.rows[0].n).toBe(0);
    });

    it("прив'язує кілька заявок одного клієнта до окремих проєктів", async () => {
      await pool.query("update public.orders set created_at = created_at where false"); // no-op, лишає план стабільним
      await pool.query(
        `insert into auth.users (id, email, email_confirmed_at) values ('c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4', 'multi@example.com', now())`,
      );
      await order("multi@example.com");
      await pool.query(
        `select public.create_order_v2('shop', null, null, null, 'Клієнт', 'multi@example.com', null, '{}'::jsonb, '{}', 'ip-multi-2', 'vitest', '2026-11-02', false)`,
      );
      const session: Session = { sub: "c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4", aal: "aal1" };
      const claimed = await asUserCommit(pool, session, (q) => q("select public.client_claim_orders() as n"));
      expect(claimed.rows[0].n).toBe(2);
      const projects = await asUser(pool, session, (q) => q("select service from public.projects order by service"));
      expect(projects.rows.map((r) => r.service)).toEqual(["shop", "webapp"]);
    });
  });

  describe("клієнт A ніколи не бачить дані клієнта B", () => {
    beforeAll(async () => {
      await asUserCommit(pool, b, (q) => q("select public.client_send_message($1, 'Повідомлення клієнта B')", [projectB]));
      await asUserCommit(pool, admin, async (q) => {
        await q("select public.admin_send_message($1, 'Відповідь студії для B')", [projectB]);
        await q("select public.admin_add_internal_note($1, 'Внутрішнє: B — складний клієнт')", [projectB]);
        const p = await q("select public.admin_create_proposal($1) as id", [projectB]);
        await q(
          `select public.admin_update_proposal($1, 'Пропозиція для B', 'Опис', '["Каталог","Оплата"]'::jsonb, 90000, 'UAH', 30,
             '[{"label":"Аванс","percent":50},{"label":"Фінал","percent":50}]'::jsonb, 2, 'Приймання за чек-листом')`,
          [p.rows[0].id],
        );
        await q("select public.admin_send_proposal($1)", [p.rows[0].id]);
      });
    });

    it("не бачить чужі проєкти, етапи, події, повідомлення, пропозиції, рішення й профіль", async () => {
      for (const table of ["projects", "project_stages", "project_events", "project_messages", "project_message_reads", "proposals", "proposal_decisions"]) {
        const own = await asUser(pool, a, (q) => q(`select * from public.${table}`));
        const foreign = own.rows.filter((row) => row.project_id === projectB || row.id === projectB);
        expect(foreign, table).toHaveLength(0);
      }
      const profiles = await asUser(pool, a, (q) => q("select user_id from public.client_profiles"));
      expect(profiles.rows.map((r) => r.user_id)).toEqual([CLIENT_A]);
      const orders = await asUser(pool, a, (q) => q("select * from public.orders").catch((e: Error) => e));
      expect(orders).toBeInstanceOf(Error); // немає доступу до таблиці заявок
    });

    it("не може читати за прямим id чужого проєкту", async () => {
      const direct = await asUser(pool, a, (q) => q("select id from public.projects where id = $1", [projectB]));
      expect(direct.rows).toHaveLength(0);
      const msgs = await asUser(pool, a, (q) => q("select id from public.project_messages where project_id = $1", [projectB]));
      expect(msgs.rows).toHaveLength(0);
    });

    it("не може писати в чужий проєкт: повідомлення, прочитання, рішення щодо пропозиції", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_send_message($1, 'вторгнення')", [projectB]))).rejects.toThrow(/forbidden/);
      await expect(asUser(pool, a, (q) => q("select public.client_mark_read($1)", [projectB]))).rejects.toThrow(/forbidden/);
      const proposalB = (await pool.query("select id from public.proposals where project_id = $1", [projectB])).rows[0].id;
      await expect(
        asUser(pool, a, (q) => q("select public.client_decide_proposal($1, 'approved', null)", [proposalB])),
      ).rejects.toThrow(/forbidden/);
      const status = await pool.query("select status from public.proposals where id = $1", [proposalB]);
      expect(status.rows[0].status).toBe("sent");
    });

    it("не може змінювати дані напряму (INSERT/UPDATE/DELETE заборонені)", async () => {
      for (const sql of [
        `insert into public.project_messages (project_id, author_id, author_role, body) values ('${projectA}', '${CLIENT_A}', 'admin', 'підробка')`,
        `update public.projects set stage = 'delivery', status = 'completed' where id = '${projectA}'`,
        `delete from public.project_messages`,
        `update public.proposals set status = 'approved'`,
        `insert into public.proposal_decisions (proposal_id, project_id, proposal_version, decision, content_hash) select id, project_id, version, 'approved', 'x' from public.proposals limit 1`,
        `update public.client_profiles set user_id = '${CLIENT_B}'`,
      ]) {
        await expect(asUser(pool, a, (q) => q(sql)), sql).rejects.toThrow(/permission denied/);
      }
    });

    it("не може викликати адміністративні функції", async () => {
      for (const sql of [
        `select public.admin_send_message('${projectA}', 'я адмін')`,
        `select public.admin_set_project_stage('${projectA}', 'delivery')`,
        `select public.admin_update_project('${projectA}', 'completed', null, null, null)`,
        `select public.admin_add_internal_note('${projectA}', 'нотатка')`,
        `select public.admin_create_proposal('${projectA}')`,
      ]) {
        await expect(asUser(pool, a, (q) => q(sql)), sql).rejects.toThrow(/forbidden/);
      }
    });

    it("anon не має доступу ні до чого", async () => {
      for (const table of ["projects", "project_messages", "proposals", "project_internal_notes", "client_profiles"]) {
        await expect(asUser(pool, null, (q) => q(`select * from public.${table}`)), table).rejects.toThrow(/permission denied/);
      }
      await expect(asUser(pool, null, (q) => q("select public.client_claim_orders()"))).rejects.toThrow(/permission denied/);
    });

    it("власник бачить свої дані; клієнт B бачить пропозицію й повідомлення студії", async () => {
      const msgs = await asUser(pool, b, (q) => q("select author_role, body from public.project_messages order by id"));
      expect(msgs.rows.map((r) => r.author_role)).toEqual(["client", "admin"]);
      const proposals = await asUser(pool, b, (q) => q("select status, version from public.proposals"));
      expect(proposals.rows).toEqual([{ status: "sent", version: 1 }]);
    });
  });

  describe("виконавець проєкту", () => {
    it("клієнт бачить ім'я виконавця лише свого проєкту", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_update_project($1, 'active', $2, 'studio', 'Працюємо')", [projectA, ADMIN]));
      const own = await asUser(pool, a, (q) => q("select public.project_assignee_name($1) as n", [projectA]));
      expect(own.rows[0].n).toBe("Адмін");
      const foreign = await asUser(pool, a, (q) => q("select public.project_assignee_name($1) as n", [projectB]));
      expect(foreign.rows[0].n).toBeNull();
      await expect(asUser(pool, a, (q) => q("select * from public.admin_users"))).resolves.toMatchObject({ rows: [] });
    });
  });

  describe("розділення ролей client/admin", () => {
    it("внутрішні нотатки та службові події ніколи не видимі клієнту", async () => {
      const notes = await asUser(pool, b, (q) => q("select * from public.project_internal_notes"));
      expect(notes.rows).toHaveLength(0);
      const events = await asUser(pool, b, (q) => q("select type from public.project_events where project_id = $1", [projectB]));
      expect(events.rows.map((r) => r.type)).not.toContain("internal_note_added");
    });

    it("адміністратор без MFA (aal1) нічого не бачить і не може діяти", async () => {
      const projects = await asUser(pool, adminNoMfa, (q) => q("select id from public.projects"));
      expect(projects.rows).toHaveLength(0);
      await expect(asUser(pool, adminNoMfa, (q) => q("select public.admin_send_message($1, 'x')", [projectB]))).rejects.toThrow(/forbidden/);
    });

    it("адміністратор з MFA (aal2) бачить усі проєкти, чати, нотатки й чернетки", async () => {
      const projects = await asUser(pool, admin, (q) => q("select id from public.projects"));
      expect(projects.rows.length).toBeGreaterThanOrEqual(2);
      const notes = await asUser(pool, admin, (q) => q("select body from public.project_internal_notes"));
      expect(notes.rows).toHaveLength(1);
    });

    it("клієнт не бачить чернеток пропозицій, адміністратор бачить", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_create_proposal($1)", [projectA]));
      const asClient = await asUser(pool, a, (q) => q("select status from public.proposals"));
      expect(asClient.rows).toHaveLength(0);
      const asAdmin = await asUser(pool, admin, (q) => q("select status from public.proposals where project_id = $1", [projectA]));
      expect(asAdmin.rows).toEqual([{ status: "draft" }]);
      await pool.query("delete from public.proposals where project_id = $1", [projectA]);
    });
  });

  describe("чат проєкту", () => {
    it("клієнт і адміністратор обмінюються повідомленнями; історія зберігається в порядку", async () => {
      await asUserCommit(pool, a, (q) => q("select public.client_send_message($1, '  Привіт, студіє  ')", [projectA]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_send_message($1, 'Привіт! Працюємо над брифом')", [projectA]));
      const history = await asUser(pool, a, (q) => q("select author_role, body from public.project_messages order by id"));
      expect(history.rows).toEqual([
        { author_role: "client", body: "Привіт, студіє" },
        { author_role: "admin", body: "Привіт! Працюємо над брифом" },
      ]);
    });

    it("відхиляє порожні й завеликі повідомлення", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_send_message($1, '   ')", [projectA]))).rejects.toThrow(/invalid_message/);
      await expect(asUser(pool, a, (q) => q("select public.client_send_message($1, $2)", [projectA, "x".repeat(4001)]))).rejects.toThrow(/invalid_message/);
    });

    it("статуси прочитання ведуться окремо для клієнта й адміністратора й не відкочуються назад", async () => {
      await asUserCommit(pool, a, (q) => q("select public.client_mark_read($1)", [projectA]));
      await asUserCommit(pool, admin, (q) => q("select public.admin_mark_read($1)", [projectA]));
      const reads = await asUser(pool, admin, (q) =>
        q("select reader_role, last_read_id from public.project_message_reads where project_id = $1 order by reader_role", [projectA]),
      );
      expect(reads.rows.map((r) => r.reader_role)).toEqual(["admin", "client"]);
      const max = (await pool.query("select max(id)::int as m from public.project_messages where project_id = $1", [projectA])).rows[0].m;
      expect(reads.rows.every((r) => Number(r.last_read_id) === max)).toBe(true);
      await pool.query("update public.project_message_reads set last_read_id = $1 where project_id = $2", [max + 5, projectA]);
      await asUserCommit(pool, a, (q) => q("select public.client_mark_read($1)", [projectA]));
      const after = await pool.query("select last_read_id from public.project_message_reads where project_id = $1 and reader_role = 'client'", [projectA]);
      expect(Number(after.rows[0].last_read_id)).toBe(max + 5);
    });

    it("повідомлення незмінні: UPDATE заборонений навіть власнику бази", async () => {
      await expect(pool.query("update public.project_messages set body = 'змінено'")).rejects.toThrow(/append_only/);
    });
  });

  describe("комерційні пропозиції та погодження", () => {
    let proposalId = "";
    const schedule = '[{"label":"Аванс","percent":30},{"label":"Дизайн","percent":40},{"label":"Здача","percent":30}]';

    async function draft(q: (sql: string, v?: unknown[]) => Promise<pg.QueryResult>, project: string) {
      const created = await q("select public.admin_create_proposal($1) as id", [project]);
      return created.rows[0].id as string;
    }

    it("не відправляє неповну пропозицію й графік, що не дорівнює 100%", async () => {
      await asUserCommit(pool, admin, async (q) => {
        proposalId = await draft(q, projectA);
      });
      await expect(asUser(pool, admin, (q) => q("select public.admin_send_proposal($1)", [proposalId]))).rejects.toThrow(/incomplete/);
      await asUserCommit(pool, admin, (q) =>
        q(
          `select public.admin_update_proposal($1, 'Корпоративний сайт', 'Опис робіт', '["Дизайн","Розробка"]'::jsonb, 120000, 'UAH', 45,
             '[{"label":"Аванс","percent":30},{"label":"Фінал","percent":60}]'::jsonb, 3, 'Приймання за чек-листом')`,
          [proposalId],
        ),
      );
      await expect(asUser(pool, admin, (q) => q("select public.admin_send_proposal($1)", [proposalId]))).rejects.toThrow(/schedule_must_total_100/);
    });

    it("надсилає повну пропозицію: клієнт бачить її, проєкт чекає на дію клієнта", async () => {
      await asUserCommit(pool, admin, async (q) => {
        await q(
          `select public.admin_update_proposal($1, 'Корпоративний сайт', 'Опис робіт', '["Дизайн","Розробка"]'::jsonb, 120000, 'UAH', 45, $2::jsonb, 3, 'Приймання за чек-листом')`,
          [proposalId, schedule],
        );
        await q("select public.admin_send_proposal($1)", [proposalId]);
      });
      const seen = await asUser(pool, a, (q) => q("select status, version, price_amount, included_revisions from public.proposals"));
      expect(seen.rows).toEqual([{ status: "sent", version: 1, price_amount: "120000.00", included_revisions: 3 }]);
      const project = await asUser(pool, a, (q) => q("select stage, next_action_owner from public.projects"));
      expect(project.rows[0]).toMatchObject({ stage: "proposal", next_action_owner: "client" });
    });

    it("надіслану пропозицію не можна змінити (правки — лише новою версією)", async () => {
      await expect(pool.query("update public.proposals set price_amount = 1 where id = $1", [proposalId])).rejects.toThrow(/proposal_frozen/);
      await expect(
        asUser(pool, admin, (q) =>
          q("select public.admin_update_proposal($1, 'x', '', '[]'::jsonb, 1, 'UAH', 1, '[]'::jsonb, 0, '')", [proposalId]),
        ),
      ).rejects.toThrow(/not_editable/);
    });

    it("зміни вимагають коментаря; рішення пишеться в журнал із хешем змісту", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_decide_proposal($1, 'changes_requested', '  ')", [proposalId]))).rejects.toThrow(/comment_required/);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_proposal($1, 'changes_requested', 'Потрібна оплата частинами')", [proposalId]));
      const log = await asUser(pool, a, (q) =>
        q("select decision, proposal_version, comment, content_hash, actor_id from public.proposal_decisions"),
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ decision: "changes_requested", proposal_version: 1, comment: "Потрібна оплата частинами", actor_id: CLIENT_A });
      expect(log.rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
      const status = await asUser(pool, a, (q) => q("select status from public.proposals"));
      expect(status.rows[0].status).toBe("changes_requested");
    });

    it("повторне рішення щодо вже вирішеної версії відхиляється", async () => {
      await expect(asUser(pool, a, (q) => q("select public.client_decide_proposal($1, 'approved', null)", [proposalId]))).rejects.toThrow(/not_pending/);
    });

    it("нова версія створюється з копії, відправка замінює попередню (superseded), погодження фіксується", async () => {
      let v2 = "";
      await asUserCommit(pool, admin, async (q) => {
        const created = await q("select public.admin_create_proposal($1, $2) as id", [projectA, proposalId]);
        v2 = created.rows[0].id;
        await q(
          `select public.admin_update_proposal($1, 'Корпоративний сайт v2', 'Оплата частинами', '["Дизайн","Розробка"]'::jsonb, 120000, 'UAH', 45, $2::jsonb, 3, 'Приймання за чек-листом')`,
          [v2, schedule],
        );
        await q("select public.admin_send_proposal($1)", [v2]);
      });
      const versions = await asUser(pool, a, (q) => q("select version, status from public.proposals order by version"));
      expect(versions.rows).toEqual([
        { version: 1, status: "superseded" },
        { version: 2, status: "sent" },
      ]);
      await asUserCommit(pool, a, (q) => q("select public.client_decide_proposal($1, 'approved', 'Погоджую')", [v2]));
      const journal = await asUser(pool, a, (q) => q("select proposal_version, decision from public.proposal_decisions order by id"));
      expect(journal.rows).toEqual([
        { proposal_version: 1, decision: "changes_requested" },
        { proposal_version: 2, decision: "approved" },
      ]);
      const events = await asUser(pool, a, (q) => q("select type from public.project_events where project_id = $1 order by id", [projectA]));
      expect(events.rows.map((r) => r.type)).toEqual(
        expect.arrayContaining(["project_created", "proposal_sent", "proposal_changes_requested", "proposal_approved"]),
      );
    });

    it("журнал рішень незмінний: ні UPDATE, ні DELETE (навіть для власника бази)", async () => {
      await expect(pool.query("update public.proposal_decisions set comment = 'підміна'")).rejects.toThrow(/append_only/);
      await expect(pool.query("delete from public.proposal_decisions")).rejects.toThrow(/append_only/);
    });

    it("не дозволяє двох чернеток одного проєкту одночасно", async () => {
      await asUserCommit(pool, admin, (q) => q("select public.admin_create_proposal($1, null)", [projectA]));
      await expect(asUser(pool, admin, (q) => q("select public.admin_create_proposal($1)", [projectA]))).rejects.toThrow(/draft_exists/);
    });
  });

  describe("етапи й прогрес", () => {
    it("прогрес рахується за реально завершеними етапами", async () => {
      // Етапи роботи доступні лише активному проєкту (V0.5); сам процес активації перевіряє business.db.test.ts.
      await pool.query("update public.projects set activated_at = now() where id = $1 and activated_at is null", [projectA]);
      await asUserCommit(pool, admin, (q) => q("select public.admin_set_project_stage($1, 'design')", [projectA]));
      const stages = await asUser(pool, a, (q) =>
        q("select stage, state from public.project_stages where project_id = $1 order by position", [projectA]),
      );
      expect(stages.rows.map((r) => r.state)).toEqual(["done", "done", "done", "in_progress", "pending", "pending", "pending", "pending"]);
      const proj = await asUser(pool, a, (q) => q("select stage from public.projects where id = $1", [projectA]));
      expect(proj.rows[0].stage).toBe("design");
    });

    it("відхиляє невідомий етап", async () => {
      await expect(asUser(pool, admin, (q) => q("select public.admin_set_project_stage($1, 'party')", [projectA]))).rejects.toThrow(/invalid_stage/);
    });
  });
});
