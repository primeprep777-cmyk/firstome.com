\set ON_ERROR_STOP 1
-- 샘플로 의뢰 흐름 · 권한 · 입력 검사 확인. stub → schema → billing → samplo 순서로 실행한 빈 DB에서 돌립니다.
-- users: A 운영자, C 의뢰인(정보 입력 완료), N 새 회원(정보 미입력), X 다른 의뢰인
insert into auth.users(id, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','{"name":"운영자","agreed":true}'),
 ('00000000-0000-0000-0000-00000000000c','{"name":"연구자","org":"KAIST","phone":"010-1234-5678","agreed":true}'),
 ('00000000-0000-0000-0000-0000000000a1','{"full_name":"카카오 사용자"}'),
 ('00000000-0000-0000-0000-0000000000ff','{"name":"남","org":"SNU","phone":"01099998888","agreed":true}');
update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';
select name, phone, agreed_at is not null as agreed from profiles order by id;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;

-- 검사용 의뢰 한 건 (오늘 기준으로 날짜를 만듦)
create or replace function pg_temp.order_json(pay text default 'credit') returns jsonb language sql as $$
  select jsonb_build_object('sample_type','blood','service','wgs','lab_name','KAIST 유전체연구실','pi_name','김교수',
    'contact_phone','010-1234-5678','pickup_date', (public.sp_today() + 1)::text,'pickup_slot','pm',
    'pickup_addr','대전 유성구 대학로 291','pickup_addr2','E16 5층 512호','leftover','biobank','pay_method',pay,
    'biz_name','KAIST 산학협력단','invoice_email','tax@kaist.ac.kr')
$$;
create or replace function pg_temp.samples_json() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('name','CASE-01','collected_on',public.sp_today()::text,'amount',3),
    jsonb_build_object('name','CASE-02','collected_on',public.sp_today()::text,'amount','4.5'))
$$;
-- 오류 문장이 기대한 말을 담고 있는지 확인
create or replace function pg_temp.expect_err(q text, frag text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'FAIL: no error for %', q;
exception when raise_exception or insufficient_privilege or check_violation then
  if sqlerrm not like 'FAIL:%' and position(frag in sqlerrm) > 0 then raise notice 'ok: %', sqlerrm;
  else raise exception 'FAIL: expected "%" got "%"', frag, sqlerrm; end if;
end $$;

-- 사업자등록번호 검증
select sp_biz_no_ok('124-81-00998') as samsung_ok, sp_biz_no_ok('124-81-00999') as wrong_check, sp_biz_no_ok('123') as short;

-- 정보 미입력 회원은 의뢰 불가 → 정보 입력 후 가능
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.samples_json())$q$, '회원 정보');
select pg_temp.expect_err($q$select sp_complete_profile('카카오', 'KAIST', '02-123-4567')$q$, '휴대폰');
select sp_complete_profile('카카오 사용자', 'KAIST', '010-5555-6666');
reset role;

-- 의뢰인: 입력 검사
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"service":"scrna"}', pg_temp.samples_json())$q$, '할 수 없습니다');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"sample_type":"x"}', pg_temp.samples_json())$q$, '시료 종류');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"contact_phone":"1234"}', pg_temp.samples_json())$q$, '현장 연락처');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_addr":"대학로"}', pg_temp.samples_json())$q$, '건물 번호');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', (sp_today()-1)::text), pg_temp.samples_json())$q$, '지난 날짜');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', (sp_today()+90)::text), pg_temp.samples_json())$q$, '일 안에서');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_slot":"night"}', pg_temp.samples_json())$q$, '시간대');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('invoice') || '{"invoice_email":"tax@kaist"}', pg_temp.samples_json())$q$, '메일 주소');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('invoice') || '{"biz_no":"124-81-00999"}', pg_temp.samples_json())$q$, '사업자등록번호');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), '[]')$q$, '1개 이상');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), '[{"name":"A 1","collected_on":"2026-01-01","amount":3}]')$q$, '영문');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',sp_today()::text,'amount',3), jsonb_build_object('name','A1','collected_on',sp_today()::text,'amount',3)))$q$, '중복');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',(sp_today()+1)::text,'amount',3)))$q$, '미래');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',(sp_today()-3)::text,'amount',3)))$q$, '48시간');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',sp_today()::text,'amount',30)))$q$, '접수 기준');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',sp_today()::text,'amount','three')))$q$, '숫자로');

-- 정상 의뢰 두 건 (충전금 · 건별 청구)
select sp_save_order(null, pg_temp.order_json('credit'), pg_temp.samples_json()) as oid \gset
select sp_save_order(null, pg_temp.order_json('invoice'), pg_temp.samples_json()) as oid2 \gset
select order_no ~ '^S-[0-9]{4}-[0-9]{4}$' as no_ok, status, pay_method from sp_orders order by created_at;
select label, name, amount from sp_samples where order_id = :'oid' order by seq;
-- 직접 쓰기는 막힘
do $$ begin update sp_orders set status = 'completed'; raise exception 'FAIL direct update'; exception when insufficient_privilege then raise notice 'ok: no direct update'; end $$;
do $$ begin insert into sp_ledger(user_id, amount, kind) values (auth.uid(), 99999999, 'topup'); raise exception 'FAIL ledger insert'; exception when insufficient_privilege then raise notice 'ok: no ledger insert'; end $$;
-- 접수 확인 전에는 고칠 수 있음 (시료 교체)
select sp_save_order(:'oid', pg_temp.order_json('credit'), jsonb_build_array(jsonb_build_object('name','NEW-1','collected_on',sp_today()::text,'amount',2))) = :'oid'::uuid as edited;
select count(*) as samples_after_edit from sp_samples where order_id = :'oid';
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 100000)$q$, '운영자만');
reset role;

-- 다른 회원은 남의 의뢰를 못 봄 · 못 고침
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select 'other sees orders' t, count(*) from sp_orders union all select 'other sees samples', count(*) from sp_samples union all select 'other sees events', count(*) from sp_events;
select pg_temp.expect_err($q$select sp_cancel_order('$q$ || :'oid' || $q$')$q$, '권한');
select pg_temp.expect_err($q$select sp_save_order('$q$ || :'oid' || $q$', pg_temp.order_json(), pg_temp.samples_json())$q$, '고칠 수 없습니다');
reset role;

-- 충전: 신청 → 운영자 입금 확인. 단위가 안 맞으면 거절.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_err($q$select sp_request_topup(1500000, 'none')$q$, '단위');
select sp_request_topup(1000000, 'tax_invoice', 'KAIST 산학협력단', '', 'tax@kaist.ac.kr') as tid \gset
select pg_temp.expect_err($q$select sp_request_topup(1000000, 'none')$q$, '기다리는');
select sp_balance() as balance_before;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- 잔액 0: 충전금 의뢰는 확정 불가
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 300000)$q$, '모자랍니다');
update settings set value = jsonb_set(value, '{bonus_rate}', '0.05') where key = 'sp_credit';
select sp_confirm_topup(:'tid');
select pg_temp.expect_err($q$select sp_confirm_topup('$q$ || :'tid' || $q$')$q$, '기다리는');
select sp_confirm_order(:'oid', 300000, sp_today() + 14, '키트 발송');
select sp_confirm_order(:'oid2', 500000, null, '');
select pg_temp.expect_err($q$select sp_set_status('$q$ || :'oid' || $q$', 'cancelled')$q$, '알 수 없는');
select sp_set_status(:'oid', 'in_transit', '수거 완료');
select sp_set_status(:'oid', 'received', '도착 · 온도 정상', sp_today() + 15);
select sp_record_qc(id, 'warn', 'DIN 5.2', '분해 의심') from sp_samples where order_id = :'oid';
select sp_mark_invoiced(:'oid2');
select pg_temp.expect_err($q$select sp_mark_invoiced('$q$ || :'oid' || $q$')$q$, '건별 청구');
select user_id, balance from sp_balances();
reset role;

-- 의뢰인: 잔액 · 추적 · QC 선택. 확정 뒤에는 직접 취소 불가.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_balance() as balance_after;  -- 1,000,000 + 50,000 보너스 - 300,000
select status, quote_amount, charged, eta = sp_today() + 15 as eta_updated from sp_orders where id = :'oid';
select kind, status, note from sp_events where order_id = :'oid' order by id;
select id as sid from sp_samples where order_id = :'oid' limit 1 \gset
select sp_decide(:'sid', 'proceed');
select qc_status, decision from sp_samples where order_id = :'oid';
select pg_temp.expect_err($q$select sp_cancel_order('$q$ || :'oid' || $q$')$q$, '카카오톡');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.expect_err($q$select sp_decide('$q$ || :'sid' || $q$', 'exclude')$q$, 'QC 확인이 필요한');
select 'other sees ledger' t, count(*) from sp_ledger union all select 'other sees topups', count(*) from sp_topups;
reset role;

-- 운영자 취소 → 차감액 환불
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select sp_cancel_order(:'oid', '고객 요청 취소');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_balance() as balance_after_refund;
select kind, amount from sp_ledger order by id;
reset role;
