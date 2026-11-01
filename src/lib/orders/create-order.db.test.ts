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

describe.skipIf(!enabled)("база даних BONSI (PostgreSQL)", () => {
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
    // Мінімальна імітація Supabase Auth: auth.users, auth.uid() і auth.jwt() читають claims із налаштування сесії.
    await pool.query(`
      drop schema if exists auth cascade;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
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

  // -------------------------------------------------------------------------
  // Admin Workspace: RLS, операції, історія, outbox
  // -------------------------------------------------------------------------
  const ADMIN_A = "11111111-1111-4111-8111-111111111111";
  const ADMIN_B = "22222222-2222-4222-8222-222222222222";
  const OUTSIDER = "33333333-3333-4333-8333-333333333333";
  const THIRD = "44444444-4444-4444-8444-444444444444";

  type Session = { sub: string; aal: "aal1" | "aal2" };

  /** Виконує SQL від імені authenticated із заданим JWT і завжди відкочує транзакцію. */
  async function asUser<T>(session: Session | null, fn: (q: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${session ? "authenticated" : "anon"}`);
      if (session) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: session.sub, role: "authenticated", aal: session.aal }),
        ]);
      }
      return await fn((sql, values) => client.query(sql, values));
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  const A2: Session = { sub: ADMIN_A, aal: "aal2" };

  async function newOrder(label: string, notify = false) {
    const { rows } = await pool.query(
      `select public.create_order('webapp', $1, 'discuss', 'flexible', $2, $3, null, $4, 'vitest', '2026-10-31', $5) as t`,
      [`Опис ідеї для перевірки: ${label}`, `Клієнт ${label}`, `${label}@example.com`, `ip-admin-${label}`, notify],
    );
    const ticket = rows[0].t as string;
    const order = await pool.query("select id from public.orders where ticket_number = $1", [ticket]);
    return { ticket, id: order.rows[0].id as string };
  }

  describe("Admin Workspace", () => {
    beforeAll(async () => {
      await pool.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [ADMIN_A, ADMIN_B, OUTSIDER, THIRD]);
      await pool.query(
        "insert into public.admin_users (user_id, email, display_name) values ($1, 'a@bonsi.test', 'Перший'), ($2, 'b@bonsi.test', 'Другий')",
        [ADMIN_A, ADMIN_B],
      );
    });

    it("не дозволяє мати більше двох адміністраторів", async () => {
      await expect(
        pool.query("insert into public.admin_users (user_id, email, display_name) values ($1, 'c@bonsi.test', 'Третій')", [THIRD]),
      ).rejects.toThrow(/admin_limit/);
    });

    it("anon не бачить нічого з адмін-даних і не викликає адмін-функції", async () => {
      for (const sql of [
        "select * from public.order_notes",
        "select * from public.order_events",
        "select * from public.notification_outbox",
        "select * from public.admin_users",
        "select public.admin_set_order_status(gen_random_uuid(), 'done')",
        "select * from public.admin_search_orders()",
      ]) {
        await expect(asUser(null, (q) => q(sql))).rejects.toThrow(/permission denied/);
      }
    });

    it("користувач поза allowlist (навіть з aal2) не читає заявок і не змінює їх", async () => {
      const { id } = await newOrder("outsider");
      await asUser({ sub: OUTSIDER, aal: "aal2" }, async (q) => {
        expect((await q("select id from public.orders")).rowCount).toBe(0);
        expect((await q("select * from public.admin_search_orders()")).rowCount).toBe(0);
        expect((await q("select * from public.order_notes")).rowCount).toBe(0);
        expect((await q("select * from public.order_events")).rowCount).toBe(0);
      });
      await expect(
        asUser({ sub: OUTSIDER, aal: "aal2" }, (q) => q("select public.admin_set_order_status($1, 'done')", [id])),
      ).rejects.toThrow(/forbidden/);
      await expect(
        asUser({ sub: OUTSIDER, aal: "aal2" }, (q) => q("select public.admin_add_note($1, 'hack')", [id])),
      ).rejects.toThrow(/forbidden/);
    });

    it("адміністратор без MFA (aal1) не має доступу до даних", async () => {
      const { id } = await newOrder("aal1");
      await asUser({ sub: ADMIN_A, aal: "aal1" }, async (q) => {
        expect((await q("select id from public.orders")).rowCount).toBe(0);
        expect((await q("select * from public.admin_search_orders()")).rowCount).toBe(0);
      });
      await expect(
        asUser({ sub: ADMIN_A, aal: "aal1" }, (q) => q("select public.admin_set_order_status($1, 'done')", [id])),
      ).rejects.toThrow(/forbidden/);
    });

    it("деактивований адміністратор втрачає доступ", async () => {
      await newOrder("inactive");
      await pool.query("update public.admin_users set active = false where user_id = $1", [ADMIN_B]);
      try {
        await asUser({ sub: ADMIN_B, aal: "aal2" }, async (q) => {
          expect((await q("select id from public.orders")).rowCount).toBe(0);
          expect((await q("select public.admin_is_allowlisted() as ok")).rows[0].ok).toBe(false);
        });
      } finally {
        await pool.query("update public.admin_users set active = true where user_id = $1", [ADMIN_B]);
      }
    });

    it("адміністратор з aal2 читає заявки, але не приховані службові поля", async () => {
      await newOrder("reader");
      await asUser(A2, async (q) => {
        expect(((await q("select id, name, email from public.orders")).rowCount ?? 0)).toBeGreaterThan(0);
        expect((await q("select public.is_admin() as ok")).rows[0].ok).toBe(true);
      });
      await expect(asUser(A2, (q) => q("select ip_hash from public.orders"))).rejects.toThrow(/permission denied/);
      await expect(asUser(A2, (q) => q("select user_agent from public.orders"))).rejects.toThrow(/permission denied/);
    });

    it("адміністратор не може писати в таблиці напряму (лише через функції з історією)", async () => {
      const { id } = await newOrder("direct");
      await expect(asUser(A2, (q) => q("update public.orders set status = 'done' where id = $1", [id]))).rejects.toThrow(/permission denied/);
      await expect(asUser(A2, (q) => q("delete from public.orders where id = $1", [id]))).rejects.toThrow(/permission denied/);
      await expect(
        asUser(A2, (q) => q("insert into public.order_notes (order_id, body) values ($1, 'x')", [id])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asUser(A2, (q) => q("insert into public.order_events (order_id, type) values ($1, 'created')", [id])),
      ).rejects.toThrow(/permission denied/);
      await expect(asUser(A2, (q) => q("delete from public.order_events"))).rejects.toThrow(/permission denied/);
    });

    it("зміна статусу пишеться в історію з відповідальним; повтор не дублює подію", async () => {
      const { id } = await newOrder("status");
      await asUser(A2, async (q) => {
        await q("select public.admin_set_order_status($1, 'in_review')", [id]);
        await q("select public.admin_set_order_status($1, 'in_review')", [id]);
        const status = (await q("select status from public.orders where id = $1", [id])).rows[0].status;
        expect(status).toBe("in_review");
        const rows = (await q("select type, actor_id, data from public.order_events where order_id = $1 order by id", [id])).rows;
        expect(rows.map((r) => r.type)).toEqual(["created", "status_changed"]);
        expect(rows[1].actor_id).toBe(ADMIN_A);
        expect(rows[1].data).toEqual({ from: "new", to: "in_review" });
      });
    });

    it("відхиляє невідомий статус і неіснуючу заявку", async () => {
      const { id } = await newOrder("badstatus");
      await expect(asUser(A2, (q) => q("select public.admin_set_order_status($1, 'hacked')", [id]))).rejects.toThrow(/invalid_status/);
      await expect(
        asUser(A2, (q) => q("select public.admin_set_order_status('99999999-9999-4999-8999-999999999999', 'done')")),
      ).rejects.toThrow(/not_found/);
    });

    it("призначення: лише активному адміністратору, зі зняттям і історією", async () => {
      const { id } = await newOrder("assign");
      await asUser(A2, async (q) => {
        await q("select public.admin_assign_order($1, $2)", [id, ADMIN_B]);
        expect((await q("select assigned_to from public.orders where id = $1", [id])).rows[0].assigned_to).toBe(ADMIN_B);
        await q("select public.admin_assign_order($1, null)", [id]);
        expect((await q("select assigned_to from public.orders where id = $1", [id])).rows[0].assigned_to).toBeNull();
        const types = (await q("select type from public.order_events where order_id = $1 order by id", [id])).rows.map((r) => r.type);
        expect(types).toEqual(["created", "assigned", "assigned"]);
      });
      await expect(
        asUser(A2, (q) => q("select public.admin_assign_order($1, $2)", [id, OUTSIDER])),
      ).rejects.toThrow(/invalid_assignee/);
    });

    it("нотатки: тримінг, межі довжини, історія, ізоляція між заявками", async () => {
      const first = await newOrder("note-a");
      const second = await newOrder("note-b");
      await asUser(A2, async (q) => {
        await q("select public.admin_add_note($1, $2)", [first.id, "  Передзвонити завтра  "]);
        const notes = (await q("select body, author_id from public.order_notes where order_id = $1", [first.id])).rows;
        expect(notes).toEqual([{ body: "Передзвонити завтра", author_id: ADMIN_A }]);
        expect((await q("select * from public.order_notes where order_id = $1", [second.id])).rowCount).toBe(0);
        const types = (await q("select type from public.order_events where order_id = $1 order by id", [first.id])).rows.map((r) => r.type);
        expect(types).toEqual(["created", "note_added"]);
      });
      await expect(asUser(A2, (q) => q("select public.admin_add_note($1, '   ')", [first.id]))).rejects.toThrow(/invalid_note/);
      await expect(asUser(A2, (q) => q("select public.admin_add_note($1, $2)", [first.id, "x".repeat(4001)]))).rejects.toThrow(/invalid_note/);
    });

    it("пошук: за номером, імʼям, email; фільтри; пагінація; захист від wildcard та SQL-ін'єкцій", async () => {
      const marker = await newOrder("searchme");
      await newOrder("other1");
      await newOrder("other2");

      await asUser(A2, async (q) => {
        const byTicket = await q("select * from public.admin_search_orders($1)", [marker.ticket.toLowerCase()]);
        expect(byTicket.rows.map((r) => r.ticket_number)).toEqual([marker.ticket]);
        expect((await q("select * from public.admin_search_orders('клієнт searchme')")).rowCount).toBe(1);
        expect((await q("select * from public.admin_search_orders('SEARCHME@EXAMPLE.COM')")).rowCount).toBe(1);

        // % і _ не повинні діяти як шаблон «усе»
        expect((await q("select * from public.admin_search_orders('%')")).rowCount).toBe(0);
        expect((await q("select * from public.admin_search_orders('_')")).rowCount).toBe(0);
        // Спроба ін'єкції — звичайний текст
        expect((await q("select * from public.admin_search_orders($1)", ["'; drop table public.orders; --"])).rowCount).toBe(0);
        expect((await q("select * from public.admin_search_orders($1)", ["' or '1'='1"])).rowCount).toBe(0);

        const filtered = await q("select * from public.admin_search_orders(null, 'new', 'webapp')");
        expect(filtered.rows.every((r) => r.status === "new")).toBe(true);
        expect((await q("select * from public.admin_search_orders(null, null, null, now() + interval '1 day')")).rowCount).toBe(0);

        const page1 = await q("select * from public.admin_search_orders(null, null, null, null, null, 2, 0)");
        const page2 = await q("select * from public.admin_search_orders(null, null, null, null, null, 2, 2)");
        expect(page1.rowCount).toBe(2);
        expect(Number(page1.rows[0].total_count)).toBeGreaterThan(2);
        expect(page1.rows.map((r) => r.id)).not.toEqual(page2.rows.map((r) => r.id));
        // limit обмежується зверху
        expect(((await q("select * from public.admin_search_orders(null, null, null, null, null, 100000, 0)")).rowCount ?? 0)).toBeLessThanOrEqual(100);
      });
      const exists = await pool.query("select to_regclass('public.orders') as t");
      expect(exists.rows[0].t).toBe("orders");
    });

    it("dashboard: підрахунок за статусами збігається з даними", async () => {
      await asUser(A2, async (q) => {
        const stats = (await q("select status, total from public.admin_dashboard_stats()")).rows;
        const sum = stats.reduce((n, r) => n + Number(r.total), 0);
        const all = Number((await q("select count(*) as n from public.orders")).rows[0].n);
        expect(sum).toBe(all);
      });
    });

    it("create_order записує подію created", async () => {
      const { id } = await newOrder("created-event");
      const rows = await pool.query("select type, actor_id from public.order_events where order_id = $1", [id]);
      expect(rows.rows).toEqual([{ type: "created", actor_id: null }]);
    });

    describe("outbox сповіщень", () => {
      it("не ставить у чергу, коли інтеграція вимкнена", async () => {
        const { id } = await newOrder("notify-off", false);
        const rows = await pool.query("select 1 from public.notification_outbox where order_id = $1", [id]);
        expect(rows.rowCount).toBe(0);
      });

      it("ставить у чергу в одній транзакції із заявкою, повторює з затримкою й завершує", async () => {
        const { id, ticket } = await newOrder("notify-on", true);
        const queued = await pool.query("select status, attempts from public.notification_outbox where order_id = $1", [id]);
        expect(queued.rows).toEqual([{ status: "pending", attempts: 0 }]);

        const client = await pool.connect();
        try {
          await client.query("set role service_role");
          const claimed = await client.query("select * from public.claim_notifications(50)");
          const mine = claimed.rows.find((r) => r.order_id === id);
          expect(mine).toMatchObject({ ticket_number: ticket, attempts: 1, name: "Клієнт notify-on" });
          // Повторно «захоплена» запис не віддається (замкнено)
          const again = await client.query("select * from public.claim_notifications(50)");
          expect(again.rows.find((r) => r.order_id === id)).toBeUndefined();

          await client.query("select public.complete_notification($1, 'telegram: HTTP 500')", [mine!.outbox_id]);
          const retry = await pool.query("select status, last_error, next_attempt_at > now() as later from public.notification_outbox where id = $1", [mine!.outbox_id]);
          expect(retry.rows[0]).toEqual({ status: "pending", last_error: "telegram: HTTP 500", later: true });
          expect((await client.query("select * from public.claim_notifications(50)")).rows.find((r) => r.order_id === id)).toBeUndefined();

          // Час повтору настав → знову видається, attempts зростає
          await pool.query("update public.notification_outbox set next_attempt_at = now() - interval '1 second' where id = $1", [mine!.outbox_id]);
          const second = (await client.query("select * from public.claim_notifications(50)")).rows.find((r) => r.order_id === id);
          expect(second!.attempts).toBe(2);

          await client.query("select public.complete_notification($1)", [mine!.outbox_id]);
          const done = await pool.query("select status, sent_at is not null as sent from public.notification_outbox where id = $1", [mine!.outbox_id]);
          expect(done.rows[0]).toEqual({ status: "sent", sent: true });
        } finally {
          await client.query("reset role").catch(() => undefined);
          client.release();
        }
      });

      it("після ліміту спроб запис стає dead і більше не видається", async () => {
        const { id } = await newOrder("notify-dead", true);
        await pool.query("update public.notification_outbox set attempts = 7 where order_id = $1", [id]);
        const client = await pool.connect();
        try {
          await client.query("set role service_role");
          const claimed = (await client.query("select * from public.claim_notifications(50)")).rows.find((r) => r.order_id === id);
          expect(claimed!.attempts).toBe(8);
          await client.query("select public.complete_notification($1, 'fail', 8)", [claimed!.outbox_id]);
        } finally {
          await client.query("reset role").catch(() => undefined);
          client.release();
        }
        const row = await pool.query("select status from public.notification_outbox where order_id = $1", [id]);
        expect(row.rows[0].status).toBe("dead");
      });

      it("застряглий 'sending' після закінчення замка видається знову", async () => {
        const { id } = await newOrder("notify-stuck", true);
        await pool.query("update public.notification_outbox set status = 'sending', locked_until = now() - interval '1 second' where order_id = $1", [id]);
        const client = await pool.connect();
        try {
          await client.query("set role service_role");
          const rows = (await client.query("select * from public.claim_notifications(50)")).rows;
          expect(rows.find((r) => r.order_id === id)).toBeDefined();
        } finally {
          await client.query("reset role").catch(() => undefined);
          client.release();
        }
      });

      it("authenticated не може доставляти сповіщення й не пише в чергу; адмін лише читає статуси", async () => {
        await expect(asUser(A2, (q) => q("select * from public.claim_notifications(1)"))).rejects.toThrow(/permission denied/);
        await expect(asUser(A2, (q) => q("select public.complete_notification(1)"))).rejects.toThrow(/permission denied/);
        await expect(asUser(A2, (q) => q("delete from public.notification_outbox"))).rejects.toThrow(/permission denied/);
        await asUser(A2, async (q) => {
          expect((await q("select status from public.notification_outbox")).rows.length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe("закрита реєстрація адміністраторів", () => {
    const U1 = "00000000-0000-4000-8000-0000000000a1";
    const U2 = "00000000-0000-4000-8000-0000000000a2";
    const U3 = "00000000-0000-4000-8000-0000000000a3";
    const adminIds = async () =>
      (await pool.query("select email from public.admin_users order by email")).rows.map((r) => r.email as string);

    beforeAll(async () => {
      await pool.query("delete from public.orders");
      await pool.query("delete from public.admin_users");
      await pool.query("delete from auth.users");
      await pool.query(
        "insert into public.admin_invites (email, display_name) values ('one@bonsi.test', 'Перший'), ('two@bonsi.test', 'Другий')",
      );
    });

    it("не дозволяє мати більше двох запрошень", async () => {
      await expect(
        pool.query("insert into public.admin_invites (email, display_name) values ('three@bonsi.test', 'Третій')"),
      ).rejects.toThrow(/invite_limit/);
    });

    it("незапрошена або непідтверджена пошта не стає адміном", async () => {
      await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'stranger@bonsi.test', now())", [U3]);
      await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'one@bonsi.test', null)", [U1]);
      expect(await adminIds()).toEqual([]);
    });

    it("запрошена адреса стає адміном одразу після підтвердження пошти", async () => {
      await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [U1]);
      expect(await adminIds()).toEqual(["one@bonsi.test"]);
      const row = (await pool.query("select display_name, active from public.admin_users where user_id = $1", [U1])).rows[0];
      expect(row).toEqual({ display_name: "Перший", active: true });
    });

    it("регістр пошти не має значення", async () => {
      await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'TWO@Bonsi.Test', now())", [U2]);
      expect(await adminIds()).toEqual(["one@bonsi.test", "two@bonsi.test"]);
    });

    it("запрошення, додане після підтвердження пошти, підхоплюється одразу", async () => {
      await pool.query("delete from public.admin_users where user_id = $1", [U2]);
      await pool.query("delete from public.admin_invites where email = 'two@bonsi.test'");
      await pool.query("insert into public.admin_invites (email, display_name) values ('two@bonsi.test', 'Другий')");
      expect(await adminIds()).toEqual(["one@bonsi.test", "two@bonsi.test"]);
    });

    it("anon і authenticated не бачать запрошень і не викликають перевірку", async () => {
      for (const role of ["anon", "authenticated"]) {
        const client = await pool.connect();
        try {
          await client.query(`set role ${role}`);
          await expect(client.query("select * from public.admin_invites")).rejects.toThrow(/permission denied/);
          await client.query("rollback").catch(() => undefined);
          await expect(client.query("select public.admin_invite_exists('one@bonsi.test')")).rejects.toThrow(/permission denied/);
        } finally {
          await client.query("reset role").catch(() => undefined);
          client.release();
        }
      }
    });

    it("service_role може перевірити, чи запрошена адреса", async () => {
      const client = await pool.connect();
      try {
        await client.query("set role service_role");
        const yes = await client.query("select public.admin_invite_exists(' ONE@bonsi.test ') as ok");
        const no = await client.query("select public.admin_invite_exists('nobody@bonsi.test') as ok");
        expect([yes.rows[0].ok, no.rows[0].ok]).toEqual([true, false]);
      } finally {
        await client.query("reset role").catch(() => undefined);
        client.release();
      }
    });
  });
});
