\set ON_ERROR_STOP 1
-- 샘플로 의뢰 흐름 · 권한 · 입력 검사 확인. stub → schema → billing → samplo 순서로 실행한 빈 DB에서 돌립니다.
-- users: A 운영자, C 의뢰인(샘플로 가입, 정보 입력 완료), N 카카오 가입(정보 미입력), O 오믹스메이트 가입(샘플로 약관 미동의), X 다른 의뢰인
insert into auth.users(id, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','{"name":"운영자","agreed":true}'),
 ('00000000-0000-0000-0000-00000000000c','{"name":"연구자","org":"KAIST","phone":"010-1234-5678","agreed":true,"sp_agreed":true}'),
 ('00000000-0000-0000-0000-0000000000a1','{"full_name":"카카오 사용자"}'),
 ('00000000-0000-0000-0000-0000000000b1','{"name":"오믹스 회원","org":"KAIST","agreed":true}'),
 ('00000000-0000-0000-0000-0000000000ff','{"name":"남궁","org":"SNU","phone":"01099998888","agreed":true,"sp_agreed":true}');
update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';
select name, phone, agreed_at is not null as agreed, sp_agreed_at is not null as sp_agreed from profiles order by id;

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
-- 시료 한 개 (채취일만 바꿔 가며 검사)
create or replace function pg_temp.one_sample(cd text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('name','a1','collected_on',cd,'amount',3))
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
-- 조건이 참인지 확인
create or replace function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', what; end if; raise notice 'ok: %', what; end $$;

-- ───────── 권한: 내부 함수는 로그인한 회원도 직접 못 부름 (Supabase 기본 권한을 stub 이 흉내 냄) ─────────
select pg_temp.ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), 'closed: ' || f)
  from unnest(array['public.sp_log(uuid,text,text)', 'public.sp_balance_of(uuid)', 'public.sp_setting(text)',
                    'public.log_event(uuid,text,text)', 'public.sp_handle_new_user()']) f;
select pg_temp.ok(not has_function_privilege('anon', p.oid, 'execute'), 'anon closed: ' || p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'sp\_%';
select pg_temp.ok(has_function_privilege('authenticated', f, 'execute'), 'open: ' || f)
  from unnest(array['public.sp_now()', 'public.sp_today()', 'public.sp_hour()', 'public.sp_save_order(uuid,jsonb,jsonb)',
                    'public.sp_confirm_order(uuid,integer,date,text,timestamptz)', 'public.sp_balance()']) f;
select pg_temp.ok(not exists (select 1 from pg_proc where proname = 'sp_confirm_order' and pronargs = 4), 'old 4-argument sp_confirm_order dropped');

-- ───────── 예시 접수 기준: 보이는 순서(ord), 바이오뱅크 보관은 서비스에서 뺌 ─────────
select pg_temp.ok((value->'types'->'tissue_ff'->>'ord')::int = 0 and (value->'types'->'rna'->>'ord')::int = 6
                  and (value->'services'->'cfdna'->>'ord')::int = 6 and not (value->'services' ? 'biobank'), 'seeded criteria order, no biobank service')
  from settings where key = 'sp_criteria';

-- ───────── 샘플로 약관 동의는 샘플로 가입(sp_agreed) 또는 정보 입력 카드에서만 ─────────
select pg_temp.ok((select sp_agreed_at is not null from profiles where id = '00000000-0000-0000-0000-00000000000c'), 'Samplo sign-up records sp_agreed_at');
select pg_temp.ok((select agreed_at is not null and sp_agreed_at is null from profiles where id = '00000000-0000-0000-0000-0000000000b1'),
                  'OmicsMate consent is not Samplo consent');

-- 사업자등록번호 검증
select sp_biz_no_ok('124-81-00998') as samsung_ok, sp_biz_no_ok('124-81-00999') as wrong_check, sp_biz_no_ok('123') as short;

-- 정보 미입력 회원은 의뢰 불가 → 정보 입력 후 가능
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.samples_json())$q$, '회원 정보');
select pg_temp.expect_err($q$select sp_complete_profile('카카오', 'KAIST', '02-123-4567')$q$, '휴대폰');
select pg_temp.expect_err($q$select sp_complete_profile('ㅎㅎ', 'KAIST', '010-5555-6666')$q$, '덜 완성된');
select pg_temp.expect_err($q$select sp_complete_profile('김1수', 'KAIST', '010-5555-6666')$q$, '숫자나');
select pg_temp.expect_err($q$select sp_complete_profile(repeat('가', 41), 'KAIST', '010-5555-6666')$q$, '40자 이내');
select pg_temp.expect_err($q$select sp_complete_profile('카카오 사용자', repeat('가', 81), '010-5555-6666')$q$, '80자 이내');
select pg_temp.expect_err($q$select sp_complete_profile('카카오 사용자', 'KAIST', '010-5555-6666' || repeat('x', 30))$q$, '휴대폰');
select sp_complete_profile('카카오 사용자', 'KAIST', '010-5555-6666');
select pg_temp.ok((select sp_agreed_at is not null from profiles where id = auth.uid()), 'profile card records Samplo consent');
reset role;

-- 오믹스메이트 회원: 휴대폰을 직접 넣어도 샘플로 약관 동의 전에는 의뢰 불가 → 정보 입력 카드에서 동의하면 가능
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
update profiles set phone = '010-7777-8888' where id = auth.uid();
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.samples_json())$q$, '회원 정보');
select sp_complete_profile('오믹스 회원', 'KAIST', '010-7777-8888');
select pg_temp.ok((select sp_agreed_at is not null from profiles where id = auth.uid()), 'OmicsMate member consents on the profile card');
reset role;

-- 의뢰인: 입력 검사
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
-- 회원 정보를 직접 망가뜨리면 의뢰 불가 (열 권한으로 profiles 를 바로 고친 경우)
update profiles set phone = '없음' where id = auth.uid();
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.samples_json())$q$, '회원 정보');
update profiles set phone = '010-1234-5678', name = ' ' where id = auth.uid();
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.samples_json())$q$, '회원 정보');
update profiles set name = '연구자', org = 'K' where id = auth.uid();
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.samples_json())$q$, '회원 정보');
update profiles set org = 'KAIST' where id = auth.uid();

select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"service":"scrna"}', pg_temp.samples_json())$q$, '할 수 없습니다');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"service":"biobank"}', pg_temp.samples_json())$q$, '서비스를 골라');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"sample_type":"x"}', pg_temp.samples_json())$q$, '시료 종류');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"contact_phone":"1234"}', pg_temp.samples_json())$q$, '현장 연락처');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_addr":"대학로"}', pg_temp.samples_json())$q$, '건물 번호');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', (sp_today()-1)::text), pg_temp.samples_json())$q$, '지난 날짜');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', (sp_today()+90)::text), pg_temp.samples_json())$q$, '오늘부터 60일 안에서');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_slot":"night"}', pg_temp.samples_json())$q$, '시간대');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('invoice') || '{"invoice_email":"tax@kaist"}', pg_temp.samples_json())$q$, '메일 주소');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('invoice') || '{"biz_no":"124-81-00999"}', pg_temp.samples_json())$q$, '사업자등록번호');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), '[]')$q$, '1개 이상');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), null)$q$, '시료 목록');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), (select jsonb_agg(jsonb_build_object('name', 'S' || g, 'collected_on', sp_today()::text, 'amount', 3)) from generate_series(1, 201) g))$q$, '한 번에 200개까지');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), '[{"name":"A 1","collected_on":"2026-01-01","amount":3}]')$q$, '영문');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',sp_today()::text,'amount',3), jsonb_build_object('name','A1','collected_on',sp_today()::text,'amount',3)))$q$, '중복');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample((sp_today()+1)::text))$q$, '미래');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample((sp_today()-3)::text))$q$, '48시간');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',sp_today()::text,'amount',30)))$q$, '접수 기준은 1–10 mL입니다');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), jsonb_build_array(jsonb_build_object('name','a1','collected_on',sp_today()::text,'amount','three')))$q$, '숫자로');

-- 날짜: YYYY-MM-DD 만, 1900년 이후 ('-infinity', 'epoch', 'tomorrow', 기원전 날짜 같은 Postgres 특수 값은 거절)
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample(''))$q$, '채취일을 입력해');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample('-infinity'))$q$, 'YYYY-MM-DD 형식');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample('epoch'))$q$, 'YYYY-MM-DD 형식');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample('0044-03-15 BC'))$q$, 'YYYY-MM-DD 형식');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample('2026-02-30'))$q$, 'YYYY-MM-DD 형식');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample('1899-12-31'))$q$, '채취일을 확인해');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_date":"-infinity"}', pg_temp.samples_json())$q$, '수거 희망일을 골라');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_date":"tomorrow"}', pg_temp.samples_json())$q$, '수거 희망일을 골라');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || '{"pickup_date":"epoch"}', pg_temp.samples_json())$q$, '수거 희망일을 골라');

-- 수거 기한(전혈 48시간): 채취 시각을 받지 않으므로 채취일 포함 2일째까지만. 오늘 채취 · 내일 수거는 됨(아래 정상 의뢰), 어제 채취 · 내일 수거는 안 됨
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json(), pg_temp.one_sample((sp_today()-1)::text))$q$, '채취일 포함 2일째까지만');

-- 길이 제한 (공개 키로 함수를 바로 불러 아주 긴 글을 넣는 것을 막음)
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('lab_name', repeat('가', 101)), pg_temp.samples_json())$q$, '100자 이내');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pi_name', repeat('가', 51)), pg_temp.samples_json())$q$, '연구책임자 이름은 50자');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_addr', '대학로 291 ' || repeat('가', 200)), pg_temp.samples_json())$q$, '수거 주소는 200자');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_addr2', repeat('가', 101)), pg_temp.samples_json())$q$, '상세 주소는 100자');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('contact_phone', '010-1234-5678' || repeat('x', 30)), pg_temp.samples_json())$q$, '현장 연락처');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('invoice') || jsonb_build_object('biz_name', repeat('가', 101)), pg_temp.samples_json())$q$, '기관명은 100자');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('invoice') || jsonb_build_object('invoice_email', repeat('a', 195) || '@kaist.ac.kr'), pg_temp.samples_json())$q$, '메일 주소가 너무 깁니다');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json('credit') || jsonb_build_object('biz_name', repeat('가', 101)), pg_temp.samples_json())$q$, '기관명은 100자');

-- 정상 의뢰 두 건 (충전금 · 건별 청구). 둘 다 오늘 채취 · 내일 수거(48시간 경계)
select sp_save_order(null, pg_temp.order_json('credit'), pg_temp.samples_json()) as oid \gset
select sp_save_order(null, pg_temp.order_json('invoice'), pg_temp.samples_json()) as oid2 \gset
select order_no ~ '^S-[0-9]{4}-[0-9]{4}$' as no_ok, status, pay_method from sp_orders order by created_at;
select label, name, amount from sp_samples where order_id = :'oid' order by seq;
-- 직접 쓰기 · 내부 함수 직접 호출은 막힘
do $$ begin update sp_orders set status = 'completed'; raise exception 'FAIL direct update'; exception when insufficient_privilege then raise notice 'ok: no direct update'; end $$;
do $$ begin insert into sp_ledger(user_id, amount, kind) values (auth.uid(), 99999999, 'topup'); raise exception 'FAIL ledger insert'; exception when insufficient_privilege then raise notice 'ok: no ledger insert'; end $$;
do $$ begin update profiles set sp_agreed_at = now() where id = auth.uid(); raise exception 'FAIL sp_agreed_at update'; exception when insufficient_privilege then raise notice 'ok: consent time is not writable'; end $$;
select pg_temp.expect_err($q$select sp_log('$q$ || :'oid' || $q$', 'note', '가짜 안내')$q$, 'permission denied');
select pg_temp.expect_err($q$select sp_balance_of('00000000-0000-0000-0000-0000000000ff')$q$, 'permission denied');
select pg_temp.expect_err($q$select sp_setting('sp_bank')$q$, 'permission denied');
select pg_temp.expect_err($q$select log_event(gen_random_uuid(), 'note', '가짜')$q$, 'permission denied');
-- 접수 확인 전에는 고칠 수 있음 (시료 교체)
select sp_save_order(:'oid', pg_temp.order_json('credit'), jsonb_build_array(jsonb_build_object('name','NEW-1','collected_on',sp_today()::text,'amount',2))) = :'oid'::uuid as edited;
select count(*) as samples_after_edit from sp_samples where order_id = :'oid';
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 100000)$q$, '운영자만');
reset role;

-- 다른 회원은 남의 의뢰를 못 봄 · 못 고침 · 가짜 기록을 못 남김
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select 'other sees orders' t, count(*) from sp_orders union all select 'other sees samples', count(*) from sp_samples union all select 'other sees events', count(*) from sp_events;
select pg_temp.expect_err($q$select sp_cancel_order('$q$ || :'oid' || $q$')$q$, '권한');
select pg_temp.expect_err($q$select sp_save_order('$q$ || :'oid' || $q$', pg_temp.order_json(), pg_temp.samples_json())$q$, '의뢰를 찾을 수 없습니다');
select pg_temp.expect_err($q$select sp_log('$q$ || :'oid' || $q$', 'confirmed', '접수 확정 · 아래 계좌로 입금해 주세요')$q$, 'permission denied');
reset role;
select pg_temp.ok((select count(*) = 0 from sp_events where note like '%계좌로%'), 'no forged event rows');

-- 충전: 신청 → 운영자 입금 확인. 단위가 안 맞으면 거절.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_err($q$select sp_request_topup(1500000, 'none')$q$, '1,000,000원 단위');
select pg_temp.expect_err($q$select sp_request_topup(60000000, 'none')$q$, '50,000,000원까지');
select pg_temp.expect_err($q$select sp_request_topup(1000000, 'none', '', '', '', repeat('가', 501))$q$, '메모는 500자');
select pg_temp.expect_err($q$select sp_request_topup(1000000, 'tax_invoice', repeat('가', 101), '', 'tax@kaist.ac.kr')$q$, '기관명은 100자');
select pg_temp.expect_err($q$select sp_request_topup(1000000, 'tax_invoice', 'KAIST 산학협력단', '', repeat('a', 195) || '@kaist.ac.kr')$q$, '메일 주소가 너무 깁니다');
select sp_request_topup(1000000, 'tax_invoice', 'KAIST 산학협력단', '', 'tax@kaist.ac.kr') as tid \gset
select pg_temp.expect_err($q$select sp_request_topup(1000000, 'none')$q$, '기다리는');
select sp_balance() as balance_before;
reset role;
-- 확인을 기다리는 신청은 회원마다 하나 (동시에 신청해 위 검사를 둘 다 지나쳐도 표가 막음)
do $$ begin
  insert into sp_topups(user_id, amount) values ('00000000-0000-0000-0000-00000000000c', 1000000);
  raise exception 'FAIL second pending top-up';
exception when unique_violation then raise notice 'ok: one pending top-up per member (index)'; end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- 운영자가 본 내용 그대로일 때만 확정 (p_seen = 화면이 불러온 updated_at)
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 300000)$q$, '새로고침한 뒤');
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 300000, p_seen := '2000-01-01')$q$, '고객이 방금');
-- 잔액 0: 충전금 의뢰는 확정 불가
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 300000, p_seen := (select updated_at from sp_orders where id = '$q$ || :'oid' || $q$'))$q$, '충전금이 300,000원 모자랍니다 (잔액 0원)');
update settings set value = jsonb_set(value, '{bonus_rate}', '0.05') where key = 'sp_credit';
select sp_confirm_topup(:'tid');
select pg_temp.expect_err($q$select sp_confirm_topup('$q$ || :'tid' || $q$')$q$, '기다리는');
select updated_at as seen1 from sp_orders where id = :'oid' \gset
reset role;
-- 운영자가 화면을 연 뒤 고객이 의뢰를 고치면(시료 200개 · 결제 방법 변경) 예전 화면으로는 확정 불가
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_save_order(:'oid', pg_temp.order_json('credit'), (select jsonb_agg(jsonb_build_object('name', 'S' || g, 'collected_on', sp_today()::text, 'amount', 3)) from generate_series(1, 200) g)) is not null as edited_200;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 300000, p_seen := '$q$ || :'seen1' || $q$')$q$, '새로고침해');
select updated_at as seen2 from sp_orders where id = :'oid' \gset
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_set_pay_method(:'oid', 'invoice');
select sp_set_pay_method(:'oid', 'credit');
select sp_save_order(:'oid', pg_temp.order_json('credit'), jsonb_build_array(jsonb_build_object('name','NEW-1','collected_on',sp_today()::text,'amount',2))) is not null as edited_back;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_err($q$select sp_confirm_order('$q$ || :'oid' || $q$', 300000, p_seen := '$q$ || :'seen2' || $q$')$q$, '고객이 방금');
select pg_temp.ok((select status = 'submitted' and charged = 0 from sp_orders where id = :'oid'), 'stale confirm changed nothing');
select sp_confirm_order(:'oid', 300000, sp_today() + 14, '키트 발송', (select updated_at from sp_orders where id = :'oid'));
select sp_confirm_order(:'oid2', 500000, null, '', (select updated_at from sp_orders where id = :'oid2'));
select pg_temp.expect_err($q$select sp_set_status('$q$ || :'oid' || $q$', 'cancelled')$q$, '알 수 없는');
select sp_set_status(:'oid', 'in_transit', '수거 완료');
select sp_set_status(:'oid', 'received', '도착 · 온도 정상', sp_today() + 15);
select sp_record_qc(id, 'warn', 'DIN 5.2', '분해 의심') from sp_samples where order_id = :'oid';
select sp_mark_invoiced(:'oid2');
select pg_temp.expect_err($q$select sp_mark_invoiced('$q$ || :'oid' || $q$')$q$, '건별 청구');
select user_id, balance from sp_balances();
reset role;

-- 의뢰인: 잔액 · 추적 · QC 선택. 확정 뒤에는 직접 취소 · 수정 불가.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_balance() as balance_after;  -- 1,000,000 + 50,000 보너스 - 300,000
select status, quote_amount, charged, eta = sp_today() + 15 as eta_updated from sp_orders where id = :'oid';
select id as sid from sp_samples where order_id = :'oid' limit 1 \gset
select sp_decide(:'sid', 'proceed');
select qc_status, decision from sp_samples where order_id = :'oid';
select pg_temp.expect_err($q$select sp_cancel_order('$q$ || :'oid' || $q$')$q$, '카카오톡');
select pg_temp.expect_err($q$select sp_save_order('$q$ || :'oid2' || $q$', pg_temp.order_json('invoice'), pg_temp.samples_json())$q$, '접수가 확정된 뒤에는 고칠 수 없습니다');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.expect_err($q$select sp_decide('$q$ || :'sid' || $q$', 'exclude')$q$, 'QC 확인이 필요한');
select 'other sees ledger' t, count(*) from sp_ledger union all select 'other sees topups', count(*) from sp_topups;
reset role;

-- 운영자가 QC 값 · 메모만 고쳐 다시 저장해도 고객의 선택은 그대로. QC 결과가 바뀌면 선택을 다시 받음.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select sp_record_qc(:'sid', 'warn', 'DIN 5.0', '재측정');
select pg_temp.ok((select decision = 'proceed' and decided_at is not null from sp_samples where id = :'sid'), 'same QC status keeps the decision');
select sp_record_qc(:'sid', 'fail', 'DIN 3.1', '');
select pg_temp.ok((select decision is null and decided_at is null from sp_samples where id = :'sid'), 'changed QC status clears the decision');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_decide(:'sid', 'reextract');
-- 고객 화면 진행 기록은 한국어
select kind, status, note from sp_events where order_id = :'oid' order by id;
select pg_temp.ok(not exists (select 1 from sp_events where order_id = :'oid' and kind in ('qc', 'decision')
                                and note ~ '(pending|pass|warn|fail|proceed|reextract|exclude|resend)'), 'QC and decision notes are Korean');
select pg_temp.ok(exists (select 1 from sp_events where order_id = :'oid' and kind = 'qc' and note like '% 확인 필요 · DIN 5.2'), 'QC note: 확인 필요');
select pg_temp.ok(exists (select 1 from sp_events where order_id = :'oid' and kind = 'decision' and note like '% → 재추출'), 'decision note: → 재추출');
reset role;

-- 운영자 취소 → 차감액 환불. 취소 사유는 500자까지.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_err($q$select sp_cancel_order('$q$ || :'oid' || $q$', repeat('가', 501))$q$, '취소 사유는 500자');
select sp_cancel_order(:'oid', '고객 요청 취소');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sp_balance() as balance_after_refund;
select kind, amount from sp_ledger order by id;
select pg_temp.expect_err($q$select sp_save_order('$q$ || :'oid' || $q$', pg_temp.order_json('credit'), pg_temp.samples_json())$q$, '취소된 의뢰는 고칠 수 없습니다');
reset role;

-- ───────── 당일 수거 여유 시간(분 단위) · 수거 기한 (sp_now 를 테스트 시각으로 바꿔 확인) ─────────
create or replace function public.sp_now() returns timestamp language sql stable as $$
  select coalesce(nullif(current_setting('t.now', true), '')::timestamp, (now() at time zone 'Asia/Seoul')::timestamp) $$;
select set_config('t.day', ((now() at time zone 'Asia/Seoul')::date)::text, false);
create or replace function pg_temp.at(hm text) returns void language sql as $$ select set_config('t.now', current_setting('t.day') || ' ' || hm, false) $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
-- 오후 시간대(13시 시작), 여유 2시간: 11:00 까지 되고 11:01 · 11:59 는 안 됨 (예전에는 시 단위라 11:59 도 통과)
select pg_temp.at('11:59');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', sp_today()::text), pg_temp.samples_json())$q$, '마감');
select pg_temp.at('11:01');
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', sp_today()::text), pg_temp.samples_json())$q$, '마감');
select pg_temp.at('11:00');
select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', sp_today()::text), pg_temp.samples_json()) is not null as same_day_2h_ok;
-- 08:00, 오늘 저녁 수거: 어제 채취는 채취일 포함 2일째라 됨, 그제 채취는 안 됨
select pg_temp.at('08:00');
select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', sp_today()::text, 'pickup_slot', 'eve'), pg_temp.one_sample((sp_today()-1)::text)) is not null as day2_ok;
select pg_temp.expect_err($q$select sp_save_order(null, pg_temp.order_json() || jsonb_build_object('pickup_date', sp_today()::text, 'pickup_slot', 'eve'), pg_temp.one_sample((sp_today()-2)::text))$q$, '시간 안에 수거');
reset role;
select set_config('t.now', '', false);
