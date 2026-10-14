\set ON_ERROR_STOP 1
-- Run after test/samplo.sql, in a disposable DB only. Never production.
reset role;
create temp table review_results(name text, passed boolean);
grant all on review_results to authenticated;
create or replace function pg_temp.review_check(n text, c boolean) returns void language sql as $$
 insert into review_results values(n, coalesce(c,false))
$$;
create or replace function pg_temp.review_reject(n text, q text, fragment text) returns void language plpgsql as $$
begin
 begin execute q;
 exception when others then
   perform pg_temp.review_check(n, position(fragment in sqlerrm)>0); return;
 end;
 perform pg_temp.review_check(n,false);
end $$;

-- false / string true / null / absent must not be recorded as consent.
insert into auth.users(id,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','{"sp_agreed":false}'),
 ('10000000-0000-0000-0000-000000000002','{"sp_agreed":"true"}'),
 ('10000000-0000-0000-0000-000000000003','{"sp_agreed":null}'),
 ('10000000-0000-0000-0000-000000000004','{}'),
 ('10000000-0000-0000-0000-000000000005','{"sp_agreed":true}');
select pg_temp.review_check('only boolean true records Samplo consent',
 (select count(*)=1 from profiles where id::text like '10000000-%' and sp_agreed_at is not null));

insert into settings(key,value) values('sp_access','{"enabled":false}')
 on conflict(key) do update set value=excluded.value;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.review_reject('closed DB rejects direct order RPC',
 'select sp_save_order(null,pg_temp.order_json(),pg_temp.samples_json())','오픈 준비 중');
select pg_temp.review_reject('closed DB rejects direct topup RPC',
 'select sp_request_topup(1000000,''none'')','오픈 준비 중');
reset role;
delete from settings where key='sp_access';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.review_reject('missing DB switch fails closed',
 'select sp_save_order(null,pg_temp.order_json(),pg_temp.samples_json())','오픈 준비 중');
reset role;
insert into settings values('sp_access','{"enabled":true}');
select setval('sp_order_seq',10000,false);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_save_order(null,pg_temp.order_json(),pg_temp.samples_json()) as boundary_id \gset
select pg_temp.review_check('sequence 10000 preserved in order number',
 (select order_no like '%-10000' from sp_orders where id=:'boundary_id'));
reset role;

-- Reopening a completed paid order permits subsequent cancellation/refund in original code.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as terminal_id from sp_orders where status='confirmed' limit 1 \gset
select sp_set_status(:'terminal_id','completed');
select pg_temp.review_reject('completed order cannot reopen',
 format('select sp_set_status(%L,''confirmed'')', :'terminal_id'),'완료된 의뢰');
reset role;

-- Explicit row assertions, including ledger/topups; printed row counts are insufficient.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.review_check('other customer sees zero orders',(select count(*)=0 from sp_orders));
select pg_temp.review_check('other customer sees zero samples',(select count(*)=0 from sp_samples));
select pg_temp.review_check('other customer sees zero events',(select count(*)=0 from sp_events));
select pg_temp.review_check('other customer sees zero ledger rows',(select count(*)=0 from sp_ledger));
select pg_temp.review_check('other customer sees zero topups',(select count(*)=0 from sp_topups));
select pg_temp.review_reject('other customer cannot decide QC',
 format('select sp_decide(%L,''proceed'')', :'sid'),'QC 확인이 필요한');
select pg_temp.review_reject('other customer cannot adjust credit',
 'select sp_adjust_credit(''00000000-0000-0000-0000-00000000000c'',1000000,''attack'')','운영자만');
reset role;
select pg_temp.review_check('private gate helper not executable',
 not coalesce(has_function_privilege('authenticated',to_regprocedure('public.sp_require_open()'),'execute'),true));
select * from review_results;
do $$ begin
 if exists(select 1 from review_results where not passed) then raise exception 'Review regressions failed'; end if;
end $$;
