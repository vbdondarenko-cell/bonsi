import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/** Захист адмінських операцій від повторного виконання: «захоплення» ідентифікатора спроби. */
describe.skipIf(!dbEnabled)("admin_operations (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ADMIN2 = "abababab-abab-4bab-8bab-abababababab";
  const CLIENT = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const admin2: Session = { sub: ADMIN2, aal: "aal2" };
  const noMfa: Session = { sub: ADMIN, aal: "aal1" };
  const client: Session = { sub: CLIENT, aal: "aal1" };
  const OP1 = "11111111-1111-4111-8111-111111111111";
  const OP2 = "22222222-2222-4222-8222-222222222222";
  const OP3 = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    await resetDatabase(pool);
    await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1,'a1@bonsi.test',now()),($2,'a2@bonsi.test',now()),($3,'c@example.com',now())", [ADMIN, ADMIN2, CLIENT]);
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'a1@bonsi.test','A1'),($2,'a2@bonsi.test','A2')", [ADMIN, ADMIN2]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const claim = (s: Session, op: string, action = "create_task") => asUserCommit(pool, s, (q) => q("select public.admin_claim_operation($1,$2) as ok", [op, action])).then((r) => r.rows[0].ok as boolean);

  it("перший запит захоплює ідентифікатор, повторний із тим самим — ні", async () => {
    expect(await claim(admin, OP1)).toBe(true);
    expect(await claim(admin, OP1)).toBe(false);
    expect(await claim(admin2, OP1)).toBe(false); // ідентифікатор унікальний глобально
    expect(await claim(admin, OP2)).toBe(true);
  });

  it("одночасні повтори: виконується рівно один", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(admin, OP3, "create_estimate")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await pool.query("select count(*)::int as n from public.admin_operations where op_id=$1", [OP3])).rows[0].n).toBe(1);
  });

  it("невдала операція звільняє ідентифікатор лише для власника", async () => {
    await asUserCommit(pool, admin2, (q) => q("select public.admin_release_operation($1)", [OP2])); // чужий — без ефекту
    expect(await claim(admin, OP2)).toBe(false);
    await asUserCommit(pool, admin, (q) => q("select public.admin_release_operation($1)", [OP2]));
    expect(await claim(admin, OP2)).toBe(true);
  });

  it("клієнт, адмін без MFA й anon не можуть ні захоплювати, ні читати таблицю", async () => {
    await expect(asUser(pool, client, (q) => q("select public.admin_claim_operation($1,'x')", [OP1]))).rejects.toThrow(/forbidden/);
    await expect(asUser(pool, noMfa, (q) => q("select public.admin_claim_operation($1,'x')", [OP1]))).rejects.toThrow(/forbidden/);
    await expect(asUser(pool, null, (q) => q("select public.admin_claim_operation($1,'x')", [OP1]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, admin, (q) => q("select * from public.admin_operations"))).rejects.toThrow(/permission denied/);
  });

  it("старі записи прибираються під час наступного захоплення", async () => {
    await pool.query("insert into public.admin_operations (op_id, admin_id, action, created_at) values ('44444444-4444-4444-8444-444444444444', $1, 'old', now() - interval '3 days')", [ADMIN]);
    await claim(admin, "55555555-5555-4555-8555-555555555555");
    expect((await pool.query("select count(*)::int as n from public.admin_operations where action='old'")).rows[0].n).toBe(0);
  });
});
