-- 승인된 연결에서 권한 상태만 읽기. 스키마/데이터를 변경하지 않습니다.
begin transaction read only;
select current_database(), current_user, version();
select c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','settings','sp_orders','sp_samples','sp_events','sp_ledger','sp_topups');
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and (tablename like 'sp_%' or tablename in ('profiles','settings'));
select p.oid::regprocedure as function,p.prosecdef as security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like 'sp\_%' or p.proname in ('log_event','is_admin'))
order by 1;
select grantee,table_name,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name like 'sp_%' and grantee in ('anon','authenticated','PUBLIC');
select defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl from pg_default_acl;
-- log_event, sp_log, sp_balance_of, sp_setting, sp_require_open 은 anon/authenticated 모두 false가 기대값입니다.
rollback;
