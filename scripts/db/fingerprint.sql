-- Відбиток даних: кількість рядків і md5 вмісту кожної таблиці public (+ auth.users). Лише читання.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'
select format('select %L as table_name, count(*)::bigint as rows, coalesce(md5(string_agg(x::text, %L order by x::text)), %L) as md5 from %I.%I x', tablename, '|', '', schemaname, tablename)
  from pg_tables where schemaname = 'public' order by tablename \gexec
select 'auth.users', count(*)::bigint, coalesce(md5(string_agg(x.id::text, '|' order by x.id::text)), '') from auth.users x;
select 'schema:functions', count(*)::bigint, coalesce(md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '|' order by p.proname, pg_get_function_identity_arguments(p.oid))), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
select 'schema:policies', count(*)::bigint, coalesce(md5(string_agg(tablename || '.' || policyname, '|' order by tablename, policyname)), '') from pg_policies where schemaname = 'public';
select 'schema:indexes', count(*)::bigint, coalesce(md5(string_agg(indexname, '|' order by indexname)), '') from pg_indexes where schemaname = 'public';
select 'schema:rls_tables', count(*)::bigint, coalesce(md5(string_agg(c.relname, '|' order by c.relname)), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
