import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, dbEnabled, dbUrl, resetDatabase, type Session } from "@/test/pg-harness";

/** V0.5 фаза 4: портфоліо — публікація лише зі згодою власника й ручним підтвердженням; без прямого доступу клієнтів. */
describe.skipIf(!dbEnabled)("портфоліо V0.5 (PostgreSQL)", () => {
  let pool: pg.Pool;
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CLIENT = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
  const admin: Session = { sub: ADMIN, aal: "aal2" };
  const noMfa: Session = { sub: ADMIN, aal: "aal1" };
  const client: Session = { sub: CLIENT, aal: "aal1" };
  const fields = { slug: "demo-site", title: "Демо-сайт", summary: "Короткий опис проєкту для картки.", task: "Потрібно було зробити сайт-візитку.", result: "Сайт запущено й передано замовнику.", stack: ["Next.js", " ", "Supabase"], product_type: "website", cover_url: "", cover_alt: "", live_url: "https://example.com" };
  let id = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    await resetDatabase(pool);
    await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1,'admin@bonsi.test',now()),($2,'a@example.com',now())", [ADMIN, CLIENT]);
    await pool.query("insert into public.admin_users (user_id, email, display_name) values ($1,'admin@bonsi.test','Адмін')", [ADMIN]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("створення — лише адміністратор з MFA; стек очищується від порожніх значень", async () => {
    await expect(asUser(pool, client, (q) => q("select public.admin_save_portfolio_item(null, 0, $1::jsonb)", [JSON.stringify(fields)]))).rejects.toThrow(/forbidden/);
    await expect(asUser(pool, noMfa, (q) => q("select public.admin_save_portfolio_item(null, 0, $1::jsonb)", [JSON.stringify(fields)]))).rejects.toThrow(/forbidden/);
    id = (await asUserCommit(pool, admin, (q) => q("select public.admin_save_portfolio_item(null, 0, $1::jsonb) as id", [JSON.stringify(fields)]))).rows[0].id;
    const row = (await pool.query("select status, stack, cover_url from public.portfolio_items where id=$1", [id])).rows[0];
    expect(row).toEqual({ status: "draft", stack: ["Next.js", "Supabase"], cover_url: null });
  });

  it("клієнт, anon і адмін без MFA записів не бачать", async () => {
    expect((await asUser(pool, client, (q) => q("select count(*)::int as n from public.portfolio_items"))).rows[0].n).toBe(0);
    expect((await asUser(pool, noMfa, (q) => q("select count(*)::int as n from public.portfolio_items"))).rows[0].n).toBe(0);
    await expect(asUser(pool, null, (q) => q("select * from public.portfolio_items"))).rejects.toThrow(/permission denied/);
    expect((await asUser(pool, admin, (q) => q("select count(*)::int as n from public.portfolio_items"))).rows[0].n).toBe(1);
  });

  it("публікація без підтвердженої згоди власника неможлива (функція й обмеження таблиці)", async () => {
    await expect(asUser(pool, admin, (q) => q("select public.admin_set_portfolio_status($1, 1, 'published')", [id]))).rejects.toThrow(/consent_required/);
    await expect(pool.query("update public.portfolio_items set status='published' where id=$1", [id])).rejects.toThrow(/check constraint/);
    await expect(asUser(pool, admin, (q) => q("select public.admin_confirm_portfolio_consent($1, 'ok')", [id]))).rejects.toThrow(/consent_note_required/);
  });

  it("згода → публікація; змістова правка опублікованого запису знімає згоду й повертає в чернетку; stale відхиляється", async () => {
    await asUserCommit(pool, admin, (q) => q("select public.admin_confirm_portfolio_consent($1, 'Лист від власника проєкту від 2026-11-09')", [id]));
    const v = (await pool.query("select version from public.portfolio_items where id=$1", [id])).rows[0].version;
    await expect(asUser(pool, admin, (q) => q("select public.admin_set_portfolio_status($1, $2, 'published')", [id, v - 1]))).rejects.toThrow(/stale/);
    await asUserCommit(pool, admin, (q) => q("select public.admin_set_portfolio_status($1, $2, 'published')", [id, v]));
    let row = (await pool.query("select status, published_at is not null as pub from public.portfolio_items where id=$1", [id])).rows[0];
    expect(row).toEqual({ status: "published", pub: true });

    const v2 = (await pool.query("select version from public.portfolio_items where id=$1", [id])).rows[0].version;
    await asUserCommit(pool, admin, (q) => q("select public.admin_save_portfolio_item($1, $2, $3::jsonb)", [id, v2, JSON.stringify({ ...fields, result: "Оновлений результат після повторного запуску." })]));
    row = (await pool.query("select status, consent_confirmed_at is null as no_consent, published_at is null as no_pub from public.portfolio_items where id=$1", [id])).rows[0];
    expect(row).toEqual({ status: "draft", no_consent: true, no_pub: true });
  });

  it("некоректні дані відхиляються: slug, не-https посилання, дубль slug", async () => {
    const bad = (extra: object) => asUser(pool, admin, (q) => q("select public.admin_save_portfolio_item(null, 0, $1::jsonb)", [JSON.stringify({ ...fields, slug: "other", ...extra })]));
    await expect(bad({ slug: "Bad Slug" })).rejects.toThrow(/check constraint/);
    await expect(bad({ live_url: "http://example.com" })).rejects.toThrow(/check constraint/);
    await expect(bad({ cover_url: "javascript:alert(1)" })).rejects.toThrow(/check constraint/);
    await expect(bad({ slug: "demo-site" })).rejects.toThrow(/duplicate key|unique/);
  });
});
