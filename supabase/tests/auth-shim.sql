-- TEST ONLY: minimal Supabase Auth contract for embedded PostgreSQL.
-- Never apply this file to Supabase. The platform supplies these objects there.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
    id uuid primary key,
    email text,
    is_anonymous boolean not null default false,
    raw_user_meta_data jsonb default '{}',
    raw_app_meta_data jsonb default '{}',
    aud text,
    role text
);
create function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
-- Model generous legacy Supabase defaults so the migration must remove them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
