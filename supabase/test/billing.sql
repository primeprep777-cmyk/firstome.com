\set ON_ERROR_STOP 1
insert into auth.users(id, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','{"name":"운영자"}'),
 ('00000000-0000-0000-0000-00000000000c','{"name":"연구자"}'),
 ('00000000-0000-0000-0000-0000000000e1','{"name":"골드"}'),
 ('00000000-0000-0000-0000-0000000000ff','{"name":"남"}');
update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1'); insert into experts(fields) values ('x'); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); select review_expert('00000000-0000-0000-0000-0000000000e1','approved','gold'); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into requests(title, dtype) values ('tt','bulk') returning id as rid \gset
select set_config('t.rid', :'rid', false);
-- before selection: cannot add billing
do $$ begin insert into billing(request_id, method) values (current_setting('t.rid')::uuid,'card'); raise exception 'FAIL early billing'; exception when insufficient_privilege then raise notice 'ok: no billing before selection'; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); select publish_request(:'rid'); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1'); insert into bids(request_id, amount, days) values (:'rid', 1100000, 10); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select select_bid(id) from bids;
insert into billing(request_id, method, doc_type, biz_no, biz_name, email) values (:'rid','research_card','tax_invoice','123-45-67890','KAIST 산학협력단','a@kaist.ac.kr');
update billing set project_no='RS-2026-1';
do $$ begin update billing set invoice_status='issued'; raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'ok: client cannot mark issued'; end $$;
do $$ begin perform mark_invoice_issued(current_setting('t.rid')::uuid); raise exception 'FAIL'; exception when raise_exception then raise notice 'ok: %', sqlerrm; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff'); select 'other sees billing' t, count(*) from billing; reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1'); select 'expert sees billing' t, count(*) from billing; reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select mark_card_link_sent(:'rid');
select mark_invoice_issued(:'rid');
select method, project_no, invoice_status, card_link_sent is not null as link from billing;
update settings set value = jsonb_set(value, '{biz_no}', '"000-00-00000"') where key='company';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin update billing set memo='late'; if found then raise exception 'FAIL edit after issued'; end if; raise notice 'ok: locked after issue'; end $$;
reset role;
