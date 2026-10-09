\set ON_ERROR_STOP 1
-- users: A admin, C client, E1 gold expert, E2 bronze expert, E3 pending, X other client
insert into auth.users(id, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','{"name":"운영자","agreed":true}'),
 ('00000000-0000-0000-0000-00000000000c','{"name":"연구자","org":"KAIST","agreed":true}'),
 ('00000000-0000-0000-0000-0000000000e1','{"name":"골드"}'),
 ('00000000-0000-0000-0000-0000000000e2','{"name":"브론즈"}'),
 ('00000000-0000-0000-0000-0000000000e3','{"name":"대기"}'),
 ('00000000-0000-0000-0000-0000000000ff','{"name":"남"}');
update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';
select count(*) as profiles_created from profiles;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;

-- experts apply
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into experts(fields, dtypes) values ('scRNA', '{sc,bulk}');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
insert into experts(fields) values ('bulk');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
insert into experts(fields) values ('wgs');
-- try to self approve: column not granted
do $$ begin update experts set status='approved' where id = auth.uid(); raise exception 'FAIL self approve'; exception when insufficient_privilege then raise notice 'ok: self-approve blocked'; end $$;
reset role;

-- admin approves
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select review_expert('00000000-0000-0000-0000-0000000000e1','approved','gold');
select review_expert('00000000-0000-0000-0000-0000000000e2','approved',null);
select id, status, tier from experts order by id;
reset role;

-- client creates two requests
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into requests(title, dtype, scope, tier_min, est_band) values ('간암 scRNA', 'sc', '{basic,anno}', 'gold', 3);
insert into requests(title, dtype) values ('Bulk 발현', 'bulk');
do $$ begin update requests set status='open'; raise exception 'FAIL status'; exception when insufficient_privilege then raise notice 'ok: client cannot set status'; end $$;
update requests set purpose = '목적 수정' where title = 'Bulk 발현';
-- client uploads a file to scRNA request
insert into storage.objects(bucket_id, name) select 'request-files', id || '/data.h5ad' from requests where title = '간암 scRNA';
reset role;

-- other user cannot see requests or upload
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select 'other sees requests' as t, count(*) from requests;
do $$ begin insert into storage.objects(bucket_id, name) select 'request-files', id || '/x' from public.requests limit 1; raise notice 'no rows to insert (fine)'; exception when insufficient_privilege then raise notice 'blocked'; end $$;
reset role;

-- before publish: experts see nothing
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select 'e1 open before publish' as t, count(*) from open_requests();
reset role;

-- admin publishes both
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select publish_request(id) from requests;
reset role;

-- E1 (gold) sees both; E2 (bronze) sees only bulk; E3 (pending) none
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select 'e1 open' as t, count(*) from open_requests();
select 'e1 direct requests' as t, count(*) from requests;
select 'e1 sees files before selection' as t, count(*) from storage.objects;
insert into bids(request_id, amount, days, approach) select id, 3000000, 14, 'Seurat' from open_requests() where title='간암 scRNA';
insert into bids(request_id, amount, days) select id, 1000000, 7 from open_requests() where title='Bulk 발현';
do $$ begin update bids set status='selected'; raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'ok: expert cannot set bid status'; end $$;
update bids set amount = 2800000 where amount = 3000000;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select 'e2 open' as t, count(*) from open_requests();
insert into bids(request_id, amount, days) select id, 900000, 10 from open_requests();
do $$ begin insert into bids(request_id, amount, days) select id, 1, 1 from requests where false; end $$;
-- e2 tries to bid on the gold-only request by id (bypassing list)
do $$ declare rid uuid; begin
  reset role; select id into rid from requests where title='간암 scRNA'; set role authenticated;
  insert into bids(request_id, amount, days) values (rid, 500000, 5); raise exception 'FAIL tier bypass';
exception when insufficient_privilege then raise notice 'ok: bronze blocked from gold-only request'; end $$;
select 'e2 sees others bids' as t, count(*) from bids;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select 'e3 pending open' as t, count(*) from open_requests();
reset role;

-- client sees bids + bidder profiles, selects E1 on scRNA
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select r.title, b.amount, e.tier, p.name from bids b join requests r on r.id=b.request_id join experts e on e.id=b.expert_id join profiles p on p.id=b.expert_id order by 1,2;
select select_bid(b.id) from bids b join requests r on r.id=b.request_id where r.title='간암 scRNA';
select title, status from requests order by title;
do $$ begin perform confirm_payment(id) from requests; raise exception 'FAIL'; exception when raise_exception then raise notice 'ok: client cannot confirm payment: %', sqlerrm; end $$;
reset role;

-- E1 now sees full scRNA request and file, E2 does not
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select 'e1 direct requests after select' as t, count(*) from requests;
select 'e1 files after select' as t, count(*) from storage.objects;
select 'e1 sees client' as t, name, org from profiles where id = '00000000-0000-0000-0000-00000000000c';
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select confirm_payment(id) from requests where title='간암 scRNA';
select amount, fee_rate, payout_amount from payments;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into storage.objects(bucket_id, name) select 'deliverables', id || '/report.pdf' from requests where title='간암 scRNA';
select submit_delivery(id, '보고서 첨부') from requests where title='간암 scRNA';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
do $$ declare rid uuid; begin
  reset role; select id into rid from requests where title='간암 scRNA'; set role authenticated;
  insert into storage.objects(bucket_id, name) values ('deliverables', rid || '/evil.pdf'); raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'ok: other expert cannot upload deliverable'; end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'client sees deliverables' as t, count(*) from storage.objects where bucket_id='deliverables';
select request_revision(id, '그림 보완') from requests where title='간암 scRNA';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select submit_delivery(id, '수정본') from requests where title='간암 scRNA';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select approve_delivery(id, 5, '좋아요') from requests where title='간암 scRNA';
select cancel_request(id) from requests where title='Bulk 발현';
select kind from events order by id;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select mark_payout(id) from requests where title='간암 scRNA';
reset role;
select id, completed_count, rating from experts where status='approved' order by id;
select title, status from requests order by title;
select b.amount, b.status from bids b order by amount;
-- 31 days later the expert loses data access
update requests set completed_at = now() - interval '31 days' where title='간암 scRNA';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select 'e1 request-files after 31d' as t, count(*) from storage.objects where bucket_id='request-files';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select title, request_status, amount, status from my_bids();
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin update settings set value='{"text":"hack"}' where key='bank'; if found then raise exception 'FAIL client updated settings'; end if; raise notice 'ok: client cannot update settings'; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update settings set value='{"text":"국민 000-00 퍼스트옴"}' where key='bank';
select value from settings where key='bank';
reset role;
