import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/**
 * Спільний каркас інтеграційних тестів на справжньому PostgreSQL: мінімальна імітація Supabase Auth,
 * усі міграції по порядку, виконання SQL від імені authenticated із заданим JWT.
 * Скидає схему public — лише для тестової бази (ALLOW_DESTRUCTIVE_DB_TEST=1).
 */
export const dbUrl = process.env.DATABASE_URL;
export const dbEnabled = Boolean(dbUrl) && process.env.ALLOW_DESTRUCTIVE_DB_TEST === "1";

/** `before` — застосувати лише міграції з іменем меншим за вказане (для перевірки переходу зі старої схеми). */
export async function resetDatabase(pool: pg.Pool, options: { before?: string } = {}) {
  await pool.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;
  `);
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
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql") && (!options.before || name < options.before)).sort()) {
    await pool.query(readFileSync(join(dir, file), "utf8"));
  }
}

export type Session = { sub: string; aal: "aal1" | "aal2" };
export type Query = (sql: string, values?: unknown[]) => Promise<pg.QueryResult>;

/** Виконує SQL від імені authenticated (або anon) із заданим JWT; транзакція завжди відкочується. */
export async function asUser<T>(pool: pg.Pool, session: Session | null, fn: (q: Query) => Promise<T>) {
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

/** Те саме, але зміни зберігаються (потрібно, коли наступний крок читає результат попереднього). */
export async function asUserCommit<T>(pool: pg.Pool, session: Session, fn: (q: Query) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: session.sub, role: "authenticated", aal: session.aal }),
    ]);
    const result = await fn((sql, values) => client.query(sql, values));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Виконує SQL від імені service_role (як сервер із service-ключем); транзакція відкочується. */
export async function asService<T>(pool: pg.Pool, fn: (q: Query) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    return await fn((sql, values) => client.query(sql, values));
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Те саме, але зміни зберігаються. */
export async function asServiceCommit<T>(pool: pg.Pool, fn: (q: Query) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await fn((sql, values) => client.query(sql, values));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
