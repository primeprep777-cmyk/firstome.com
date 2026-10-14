do $$ begin create role anon nologin; create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth; create schema storage;
grant usage on schema auth, storage, public to anon, authenticated;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
-- 실제 Supabase 의 기본 권한 흉내: SQL Editor(postgres)가 public 에 새로 만드는 표 · 함수 · 시퀀스는 anon, authenticated 에 자동으로 열림.
-- 각 .sql 파일이 이 기본값을 직접 거둬야 하므로, 테스트도 같은 조건에서 돌립니다.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
