import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbEnabled, dbUrl, resetDatabase } from "@/test/pg-harness";
import { EMAIL_TEMPLATES } from "./templates";

describe.skipIf(!dbEnabled)("шаблони листів збігаються з обмеженням БД", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
    await resetDatabase(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });
  it("email_outbox.template приймає рівно ті шаблони, які знає код", async () => {
    const def = (await pool.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname='email_outbox_template_check'")).rows[0].d as string;
    const inDb = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(new Set(inDb)).toEqual(new Set(EMAIL_TEMPLATES));
  });
  it("повторне додавання в чергу з тим самим ключем не створює другого листа", async () => {
    const enqueue = () => pool.query("select public.email_enqueue('dup-key-0001','order_received','a@example.com',null,'uk','{}'::jsonb,null,null) as n");
    await pool.query("select set_config('request.jwt.claims','',false)");
    // email_enqueue доступна лише service_role; тут виконуємо від власника схеми (перевіряється логіка ключа).
    await enqueue();
    await enqueue();
    expect((await pool.query("select count(*)::int as n from public.email_outbox where idempotency_key='dup-key-0001'")).rows[0].n).toBe(1);
  });
});
