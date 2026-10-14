-- 샘플로 온라인 의뢰 · 추적 · 충전금 DB
-- schema.sql(오믹스메이트, 계정·운영자·설정 표를 만듦) 다음에 Supabase SQL Editor 에서 한 번 실행합니다.
-- 다시 실행해도 됩니다. 계정(auth.users · profiles)과 운영자(is_admin)는 오믹스메이트와 같이 씁니다.
--
-- 상태 흐름 (sp_orders.status) — 샘플로 소개 페이지의 8단계 추적과 같습니다.
--   submitted(의뢰 접수, 운영자 확인 전) → confirmed(접수 확정 · 키트 발송) → in_transit(이동)
--   → received(도착 · QC) → extraction(추출) → library(라이브러리) → sequencing(시퀀싱)
--   → data_ready(데이터 도착) → stored(보관 중) → completed(완료)
--   곁가지: cancelled(취소)
-- 상태와 금액은 화면에서 직접 바꾸지 못하고, 아래 함수(rpc)로만 바뀝니다.
-- 입력값 검사(시료 기준, 수거일, 연락처 등)는 화면과 이 파일 양쪽에서 합니다. 기준 숫자는 settings 의 sp_criteria 한 곳에만 있습니다.

create extension if not exists pgcrypto;

-- ───────────────────────── 회원 (오믹스메이트와 같은 profiles) ─────────────────────────
-- 샘플로 약관 동의 시각. 오믹스메이트 가입(agreed_at)과 따로 기록합니다.
alter table public.profiles add column if not exists sp_agreed_at timestamptz;

-- ───────────────────────── 설정 (운영 화면 > 설정에서 바꿈) ─────────────────────────
-- 아래 숫자는 예시 기준입니다. 오픈 전에 실제 접수 기준으로 바꾸세요.
-- 이미 설정이 있으면 덮어쓰지 않습니다 (on conflict do nothing). ord 는 고객 화면에 보이는 순서입니다 (jsonb 는 키 순서를 지키지 않음).
-- 바이오뱅크 보관은 아직 사전 신청만 받으므로 서비스에 넣지 않았습니다. 열 때 운영 화면 > 설정에서 더합니다.
insert into public.settings(key, value) values
  ('sp_criteria', $j${
    "max_samples": 200,
    "types": {
      "tissue_ff": {"ord": 0, "name": "신선 동결 조직", "unit": "mg",    "min": 10,  "max": 500,  "ship": "드라이아이스", "hours": null},
      "ffpe":      {"ord": 1, "name": "FFPE 블록 · 슬라이드", "unit": "장", "min": 1, "max": 30,   "ship": "상온",        "hours": null},
      "blood":     {"ord": 2, "name": "전혈 (EDTA)",    "unit": "mL",    "min": 1,   "max": 10,   "ship": "냉장 2–8℃",   "hours": 48},
      "plasma":    {"ord": 3, "name": "혈장 · 혈청",    "unit": "mL",    "min": 0.5, "max": 5,    "ship": "드라이아이스", "hours": null},
      "cells":     {"ord": 4, "name": "세포 (펠렛)",    "unit": "만 개", "min": 10,  "max": 1000, "ship": "드라이아이스", "hours": null},
      "dna":       {"ord": 5, "name": "추출 DNA",       "unit": "ng/µL", "min": 10,  "max": 2000, "ship": "아이스팩",     "hours": null},
      "rna":       {"ord": 6, "name": "추출 RNA",       "unit": "ng/µL", "min": 20,  "max": 3000, "ship": "드라이아이스", "hours": null}
    },
    "services": {
      "extract_qc": {"ord": 0, "name": "핵산 추출 · QC",        "types": ["tissue_ff","ffpe","blood","plasma","cells"]},
      "library":    {"ord": 1, "name": "라이브러리 제작까지",    "types": ["tissue_ff","ffpe","blood","plasma","cells","dna","rna"]},
      "wgs":        {"ord": 2, "name": "WGS (시퀀싱 연결)",      "types": ["tissue_ff","ffpe","blood","cells","dna"]},
      "wes":        {"ord": 3, "name": "WES (시퀀싱 연결)",      "types": ["tissue_ff","ffpe","blood","cells","dna"]},
      "rnaseq":     {"ord": 4, "name": "RNA-seq (시퀀싱 연결)",  "types": ["tissue_ff","ffpe","blood","cells","rna"]},
      "scrna":      {"ord": 5, "name": "단일세포 RNA-seq",       "types": ["tissue_ff","cells"]},
      "cfdna":      {"ord": 6, "name": "cfDNA",                  "types": ["plasma","blood"]}
    }
  }$j$::jsonb),
  ('sp_pickup', $j${
    "weekend": true,
    "lead_hours": 2,
    "max_days_ahead": 60,
    "slots": {
      "am":  {"label": "오전 9–12시", "start": 9,  "end": 12},
      "pm":  {"label": "오후 1–6시",  "start": 13, "end": 18},
      "eve": {"label": "저녁 6–9시",  "start": 18, "end": 21}
    }
  }$j$::jsonb),
  ('sp_credit', '{"unit": 1000000, "max_units": 50, "bonus_rate": 0}'),
  ('sp_bank', '{"text": ""}')
on conflict (key) do nothing;

-- ───────────────────────── 표 ─────────────────────────

create sequence if not exists public.sp_order_seq;

create table if not exists public.sp_orders (
  id            uuid primary key default gen_random_uuid(),
  order_no      text not null unique,                       -- S-2610-0001 (라벨·문의에 쓰는 번호)
  client_id     uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'submitted'
                check (status in ('submitted','confirmed','in_transit','received','extraction','library',
                                  'sequencing','data_ready','stored','completed','cancelled')),
  sample_type   text not null,
  service       text not null,
  lab_name      text not null,
  pi_name       text not null,
  contact_phone text not null,
  pickup_date   date not null,
  pickup_slot   text not null,
  pickup_addr   text not null,
  pickup_addr2  text not null,
  irb_no        text not null default '',
  leftover      text not null default 'undecided' check (leftover in ('biobank','return','discard','undecided')),
  memo          text not null default '',
  pay_method    text not null default 'invoice' check (pay_method in ('credit','invoice')),
  biz_name      text not null default '',                   -- 건별 청구: 세금계산서 상호
  biz_no        text not null default '',                   -- 건별 청구: 사업자등록번호 (선택)
  invoice_email text not null default '',                   -- 건별 청구: 세금계산서 받을 메일
  quote_amount  int check (quote_amount >= 0),              -- 운영자가 접수 확정 때 정하는 금액 (원, 부가세 포함)
  charged       int not null default 0,                     -- 충전금에서 실제로 차감한 금액 (취소 때 돌려줌)
  invoiced_at   timestamptz,
  eta           date,                                       -- 예상 완료일 (운영자가 갱신)
  admin_note    text not null default '',
  confirmed_at  timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sp_orders_client_idx on public.sp_orders(client_id);
create index if not exists sp_orders_status_idx on public.sp_orders(status);

create table if not exists public.sp_samples (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.sp_orders(id) on delete cascade,
  seq           int  not null,
  label         text not null,                              -- S-2610-0001-01 (튜브 라벨)
  name          text not null,                              -- 고객이 쓰는 시료명
  collected_on  date not null,
  amount        numeric not null,
  qc_status     text not null default 'pending' check (qc_status in ('pending','pass','warn','fail')),
  qc_value      text not null default '',                   -- 예: RIN 6.1, 52 ng/µL
  qc_note       text not null default '',
  decision      text check (decision in ('proceed','reextract','exclude','resend')),
  decided_at    timestamptz,
  unique (order_id, seq)
);
create unique index if not exists sp_samples_name_uq on public.sp_samples(order_id, lower(name));

create table if not exists public.sp_events (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.sp_orders(id) on delete cascade,
  actor         uuid default auth.uid(),
  kind          text not null,                              -- submitted · updated · confirmed · status · qc · decision · cancelled · invoiced · note
  status        text,                                       -- 이 일이 있었을 때의 주문 상태
  note          text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists sp_events_order_idx on public.sp_events(order_id);

-- 충전금 장부: 잔액 = 합계. 행은 함수로만 생깁니다.
create table if not exists public.sp_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  amount        int  not null,                              -- + 충전 · 환불, - 차감
  kind          text not null check (kind in ('topup','bonus','charge','refund','adjust')),
  order_id      uuid references public.sp_orders(id) on delete set null,
  topup_id      uuid,
  note          text not null default '',
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists sp_ledger_user_idx on public.sp_ledger(user_id);

create table if not exists public.sp_topups (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  amount        int  not null check (amount > 0),
  status        text not null default 'requested' check (status in ('requested','paid','cancelled')),
  doc_type      text not null default 'tax_invoice' check (doc_type in ('tax_invoice','none')),
  biz_name      text not null default '',
  biz_no        text not null default '',
  invoice_email text not null default '',
  memo          text not null default '',
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create index if not exists sp_topups_user_idx on public.sp_topups(user_id);
-- 확인을 기다리는 충전 신청은 회원마다 하나만 (동시에 두 번 눌러도)
create unique index if not exists sp_topups_one_pending on public.sp_topups(user_id) where status = 'requested';

drop trigger if exists sp_orders_touch on public.sp_orders;
create trigger sp_orders_touch before update on public.sp_orders for each row execute function public.touch_updated_at();

-- ───────────────────────── 도우미 함수 ─────────────────────────

-- 한국 시간 기준 지금 시각, 오늘 날짜, 지금 시각(시). 날짜 · 시각 규칙은 모두 sp_now() 하나에서 나옵니다.
create or replace function public.sp_now() returns timestamp
language sql stable as $$ select (now() at time zone 'Asia/Seoul')::timestamp $$;
create or replace function public.sp_today() returns date
language sql stable as $$ select public.sp_now()::date $$;
create or replace function public.sp_hour() returns int
language sql stable as $$ select extract(hour from public.sp_now())::int $$;

create or replace function public.sp_setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from settings where key = k
$$;

-- 사업자등록번호 검증 (10자리 + 검증 숫자)
create or replace function public.sp_biz_no_ok(v text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(v, ''), '\D', '', 'g'); w int[] := array[1,3,7,1,3,7,1,3,5]; s int := 0; i int;
begin
  if length(d) <> 10 then return false; end if;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * w[i]; end loop;
  s := s + (substr(d, 9, 1)::int * 5) / 10;
  return (10 - s % 10) % 10 = substr(d, 10, 1)::int;
end $$;

create or replace function public.sp_phone_ok(v text) returns boolean
language sql immutable as $$ select regexp_replace(coalesce(v, ''), '\D', '', 'g') ~ '^01[016789][0-9]{7,8}$' $$;

create or replace function public.sp_email_ok(v text) returns boolean
language sql immutable as $$ select coalesce(v, '') ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' $$;

create or replace function public.sp_is_client(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sp_orders where id = o and client_id = auth.uid())
$$;

create or replace function public.sp_log(o uuid, k text, n text default '') returns void
language sql security definer set search_path = public as $$
  insert into sp_events(order_id, kind, status, note) select o, k, status, coalesce(n, '') from sp_orders where id = o
$$;

create or replace function public.sp_balance_of(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from sp_ledger where user_id = u
$$;

-- 지금 로그인한 사람의 충전금 잔액
create or replace function public.sp_balance() returns int
language sql stable security definer set search_path = public as $$ select sp_balance_of(auth.uid()) $$;

-- 샘플로 가입 화면에서 약관에 동의하고 가입하면(가입 정보에 sp_agreed) 샘플로 약관 동의 시각을 남깁니다.
-- 오믹스메이트의 on_auth_user_created 가 profiles 행을 먼저 만듭니다 (같은 때 도는 트리거는 이름 순서라 이 트리거가 뒤).
create or replace function public.sp_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data ? 'sp_agreed' then
    update profiles set sp_agreed_at = now() where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists sp_on_auth_user_created on auth.users;
create trigger sp_on_auth_user_created after insert on auth.users
  for each row execute function public.sp_handle_new_user();

-- ───────────────────────── 권한 (RLS) ─────────────────────────
-- 표는 읽기만 열고, 쓰기는 모두 아래 함수로만 합니다.

alter table public.sp_orders  enable row level security;
alter table public.sp_samples enable row level security;
alter table public.sp_events  enable row level security;
alter table public.sp_ledger  enable row level security;
alter table public.sp_topups  enable row level security;

revoke all on public.sp_orders, public.sp_samples, public.sp_events, public.sp_ledger, public.sp_topups from anon, authenticated;
grant select on public.sp_orders, public.sp_samples, public.sp_events, public.sp_ledger, public.sp_topups to authenticated;
revoke all on sequence public.sp_order_seq from anon, authenticated;

drop policy if exists sp_orders_read on public.sp_orders;
create policy sp_orders_read on public.sp_orders for select using (client_id = auth.uid() or public.is_admin());
drop policy if exists sp_samples_read on public.sp_samples;
create policy sp_samples_read on public.sp_samples for select using (public.sp_is_client(order_id) or public.is_admin());
drop policy if exists sp_events_read on public.sp_events;
create policy sp_events_read on public.sp_events for select using (public.sp_is_client(order_id) or public.is_admin());
drop policy if exists sp_ledger_read on public.sp_ledger;
create policy sp_ledger_read on public.sp_ledger for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists sp_topups_read on public.sp_topups;
create policy sp_topups_read on public.sp_topups for select using (user_id = auth.uid() or public.is_admin());

-- ───────────────────────── 화면에서 부르는 함수 ─────────────────────────

-- 가입 뒤 한 번: 이름 · 소속 · 휴대폰 · 샘플로 약관 동의 (카카오 로그인, 오믹스메이트 가입처럼 샘플로 가입 화면을 거치지 않은 경우 포함)
create or replace function public.sp_complete_profile(p_name text, p_org text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception '이름을 2자 이상 입력해 주세요'; end if;
  if btrim(p_name) ~ '[ㄱ-ㅎㅏ-ㅣ0-9]' then raise exception '이름에는 숫자나 덜 완성된 글자(ㄱ, ㅏ)를 넣을 수 없습니다'; end if;
  if length(btrim(p_name)) > 40 then raise exception '이름은 40자 이내로 적어 주세요'; end if;
  if length(btrim(coalesce(p_org, ''))) < 2 then raise exception '소속을 입력해 주세요'; end if;
  if length(btrim(p_org)) > 80 then raise exception '소속은 80자 이내로 적어 주세요'; end if;
  if not sp_phone_ok(p_phone) or length(btrim(p_phone)) > 20 then raise exception '휴대폰 번호를 확인해 주세요 (010으로 시작하는 10–11자리)'; end if;
  insert into profiles(id) values (auth.uid()) on conflict (id) do nothing;
  update profiles set name = btrim(p_name), org = btrim(p_org), phone = btrim(p_phone), agreed_at = coalesce(agreed_at, now()),
         sp_agreed_at = now()
   where id = auth.uid();
end $$;

-- 의뢰 검사 + 저장. p_id 가 null 이면 새 의뢰, 아니면 접수 확인 전(submitted)인 내 의뢰를 고칩니다.
-- o: {sample_type, service, lab_name, pi_name, contact_phone, pickup_date, pickup_slot, pickup_addr, pickup_addr2,
--     irb_no, leftover, memo, pay_method, biz_name, biz_no, invoice_email}
-- samples: [{name, collected_on, amount}, ...]
-- 틀린 값이 있으면 무엇을 고쳐야 하는지 한국어 문장으로 오류를 냅니다.
create or replace function public.sp_save_order(p_id uuid, o jsonb, samples jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  crit jsonb := sp_setting('sp_criteria');
  pick jsonb := sp_setting('sp_pickup');
  t jsonb; slot jsonb; s jsonb;
  v_type text := o->>'sample_type';
  v_service text := o->>'service';
  v_date date; v_slot text := o->>'pickup_slot';
  v_pay text := coalesce(nullif(o->>'pay_method', ''), 'invoice');
  v_left text := coalesce(nullif(o->>'leftover', ''), 'undecided');
  n int; i int := 0; nm text; cd date; cdt text; amt numeric; names text[] := '{}';
  oid uuid; ono text; v_st text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  -- 이름 · 소속 · 휴대폰이 제대로 들어 있고 샘플로 약관에 동의한 회원만 ('회원 정보' 문구로 화면이 정보 입력 카드를 띄움)
  if not exists (select 1 from profiles where id = auth.uid() and sp_agreed_at is not null and sp_phone_ok(phone)
                   and length(btrim(name)) >= 2 and length(btrim(org)) >= 2) then
    raise exception '회원 정보(이름 · 소속 · 휴대폰)와 샘플로 약관 동의를 먼저 마쳐 주세요';
  end if;

  -- 고치기: 내 의뢰이고 접수 확인 전일 때만. 안 되는 까닭을 그대로 알려 줍니다.
  if p_id is not null then
    select status into v_st from sp_orders where id = p_id and client_id = auth.uid();
    if v_st is null then raise exception '의뢰를 찾을 수 없습니다'; end if;
    if v_st = 'cancelled' then raise exception '취소된 의뢰는 고칠 수 없습니다. 새 의뢰로 다시 접수해 주세요'; end if;
    if v_st <> 'submitted' then raise exception '접수가 확정된 뒤에는 고칠 수 없습니다. 카카오톡 채널로 문의해 주세요'; end if;
  end if;

  -- 시료 종류와 서비스 조합
  t := crit->'types'->v_type;
  if t is null then raise exception '시료 종류를 골라 주세요'; end if;
  if crit->'services'->v_service is null then raise exception '서비스를 골라 주세요'; end if;
  if not (crit->'services'->v_service->'types') ? v_type then
    raise exception '%(으)로는 %을(를) 할 수 없습니다. 다른 서비스를 골라 주세요', t->>'name', crit->'services'->v_service->>'name';
  end if;

  -- 연구실 · 연락처 · 주소
  if length(btrim(coalesce(o->>'lab_name', ''))) < 2 then raise exception '기관 · 연구실 이름을 입력해 주세요'; end if;
  if length(btrim(o->>'lab_name')) > 100 then raise exception '기관 · 연구실 이름은 100자 이내로 적어 주세요'; end if;
  if length(btrim(coalesce(o->>'pi_name', ''))) < 2 then raise exception '연구책임자 이름을 입력해 주세요'; end if;
  if length(btrim(o->>'pi_name')) > 50 then raise exception '연구책임자 이름은 50자 이내로 적어 주세요'; end if;
  if not sp_phone_ok(o->>'contact_phone') or length(btrim(o->>'contact_phone')) > 20 then
    raise exception '현장 연락처를 확인해 주세요 (010으로 시작하는 10–11자리)';
  end if;
  if length(btrim(coalesce(o->>'pickup_addr', ''))) < 6 or coalesce(o->>'pickup_addr', '') !~ '[0-9]' then
    raise exception '수거 주소를 건물 번호까지 입력해 주세요 (예: 대학로 103)';
  end if;
  if length(btrim(o->>'pickup_addr')) > 200 then raise exception '수거 주소는 200자 이내로 적어 주세요'; end if;
  if length(btrim(coalesce(o->>'pickup_addr2', ''))) < 2 then raise exception '상세 주소(건물 · 층 · 호실)를 입력해 주세요'; end if;
  if length(btrim(o->>'pickup_addr2')) > 100 then raise exception '상세 주소는 100자 이내로 적어 주세요'; end if;

  -- 수거일 · 시간대. 날짜는 화면과 같은 YYYY-MM-DD 만 받습니다 ('tomorrow', '-infinity' 같은 값은 거절).
  v_date := null;
  if coalesce(o->>'pickup_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin v_date := (o->>'pickup_date')::date; exception when others then v_date := null; end;
  end if;
  if v_date is null then raise exception '수거 희망일을 골라 주세요'; end if;
  slot := pick->'slots'->v_slot;
  if slot is null then raise exception '수거 시간대를 골라 주세요'; end if;
  if v_date < sp_today() then raise exception '지난 날짜에는 수거할 수 없습니다'; end if;
  if v_date > sp_today() + coalesce((pick->>'max_days_ahead')::int, 60) then
    raise exception '수거일은 오늘부터 %일 안에서 골라 주세요', coalesce((pick->>'max_days_ahead')::int, 60);
  end if;
  if not coalesce((pick->>'weekend')::boolean, true) and extract(isodow from v_date) in (6, 7) then
    raise exception '주말에는 수거하지 않습니다. 평일을 골라 주세요';
  end if;
  -- 당일 수거: 시간대 시작까지 남은 시간(분 단위)이 lead_hours 이상이어야 함 (11:59 에 13시 시간대는 2시간 여유가 아님)
  if v_date = sp_today()
     and (v_date + make_interval(hours => (slot->>'start')::int)) - sp_now() < make_interval(hours => coalesce((pick->>'lead_hours')::int, 2)) then
    raise exception '오늘 % 수거는 마감됐습니다. 더 늦은 시간대나 다른 날을 골라 주세요', slot->>'label';
  end if;

  -- 남은 시료 · 결제
  if v_left not in ('biobank','return','discard','undecided') then raise exception '남은 시료 처리 방법을 골라 주세요'; end if;
  if v_pay not in ('credit','invoice') then raise exception '결제 방법을 골라 주세요'; end if;
  if v_pay = 'invoice' then
    if length(btrim(coalesce(o->>'biz_name', ''))) < 2 then raise exception '세금계산서 받을 기관명(상호)을 입력해 주세요'; end if;
    if not sp_email_ok(o->>'invoice_email') then raise exception '세금계산서 받을 메일 주소를 확인해 주세요'; end if;
    if coalesce(o->>'biz_no', '') <> '' and not sp_biz_no_ok(o->>'biz_no') then
      raise exception '사업자등록번호가 맞지 않습니다. 숫자 10자리를 다시 확인해 주세요';
    end if;
  end if;
  -- 세금계산서 정보는 충전금 결제여도 저장되므로(나중에 건별 청구로 바꿀 때 씀) 길이는 늘 봅니다
  if length(btrim(coalesce(o->>'biz_name', ''))) > 100 then raise exception '세금계산서 받을 기관명은 100자 이내로 적어 주세요'; end if;
  if length(btrim(coalesce(o->>'invoice_email', ''))) > 200 then raise exception '세금계산서 받을 메일 주소가 너무 깁니다'; end if;
  if length(btrim(coalesce(o->>'biz_no', ''))) > 20 then raise exception '사업자등록번호가 맞지 않습니다. 숫자 10자리를 다시 확인해 주세요'; end if;
  if length(coalesce(o->>'memo', '')) > 1000 then raise exception '요청 사항은 1000자 이내로 적어 주세요'; end if;
  if length(coalesce(o->>'irb_no', '')) > 60 then raise exception 'IRB 번호는 60자 이내로 적어 주세요'; end if;

  -- 시료 목록
  if jsonb_typeof(samples) is distinct from 'array' then raise exception '시료 목록이 비어 있습니다'; end if;
  n := jsonb_array_length(samples);
  if n < 1 then raise exception '시료를 1개 이상 입력해 주세요'; end if;
  if n > coalesce((crit->>'max_samples')::int, 200) then
    raise exception '한 번에 %개까지 의뢰할 수 있습니다. 나눠서 의뢰해 주세요', coalesce((crit->>'max_samples')::int, 200);
  end if;
  for s in select * from jsonb_array_elements(samples) loop
    i := i + 1;
    nm := btrim(coalesce(s->>'name', ''));
    if nm !~ '^[A-Za-z0-9_-]{1,20}$' then raise exception '%번 시료명 "%": 영문 · 숫자 · - · _ 로 20자 이내로 써 주세요', i, left(nm, 40); end if;
    if lower(nm) = any(names) then raise exception '%번 시료명 "%"이(가) 중복됩니다 (대소문자 구분 없음)', i, nm; end if;
    names := names || lower(nm);
    -- 채취일: YYYY-MM-DD, 1900년 이후, 오늘까지
    cdt := btrim(coalesce(s->>'collected_on', ''));
    if cdt = '' then raise exception '%번 시료(%) 채취일을 입력해 주세요', i, nm; end if;
    cd := null;
    if cdt ~ '^\d{4}-\d{2}-\d{2}$' then
      begin cd := cdt::date; exception when others then cd := null; end;
    end if;
    if cd is null then raise exception '%번 시료(%) 채취일을 YYYY-MM-DD 형식으로 입력해 주세요', i, nm; end if;
    if cd < date '1900-01-01' then raise exception '%번 시료(%) 채취일을 확인해 주세요', i, nm; end if;
    if cd > sp_today() then raise exception '%번 시료(%) 채취일이 미래입니다', i, nm; end if;
    -- 수거 기한: 채취 시각을 받지 않으므로 가장 늦은 경우(채취일 0시에 채취, 수거일 끝에 수거)로 셈
    if (t->>'hours') is not null and (v_date - cd + 1) * 24 > (t->>'hours')::int then
      raise exception '%번 시료(%)는 채취 후 %시간 안에 수거해야 합니다 (채취 시각을 받지 않아 채취일 포함 %일째까지만 됩니다). 수거일을 앞당기거나 시료를 다시 채취해 주세요',
        i, nm, t->>'hours', floor((t->>'hours')::numeric / 24)::int;
    end if;
    begin amt := (s->>'amount')::numeric; exception when others then amt := null; end;
    if amt is null then raise exception '%번 시료(%) 양을 숫자로 입력해 주세요', i, nm; end if;
    if amt < (t->>'min')::numeric or amt > (t->>'max')::numeric then
      raise exception '%번 시료(%) 양 % %: 접수 기준은 %–% %입니다', i, nm, amt, t->>'unit', t->>'min', t->>'max', t->>'unit';
    end if;
  end loop;

  if p_id is null then
    ono := 'S-' || to_char(now() at time zone 'Asia/Seoul', 'YYMM') || '-' || lpad(nextval('sp_order_seq')::text, 4, '0');
    insert into sp_orders(order_no, client_id, sample_type, service, lab_name, pi_name, contact_phone, pickup_date, pickup_slot,
                          pickup_addr, pickup_addr2, irb_no, leftover, memo, pay_method, biz_name, biz_no, invoice_email)
    values (ono, auth.uid(), v_type, v_service, btrim(o->>'lab_name'), btrim(o->>'pi_name'), btrim(o->>'contact_phone'), v_date, v_slot,
            btrim(o->>'pickup_addr'), btrim(o->>'pickup_addr2'), btrim(coalesce(o->>'irb_no', '')), v_left, coalesce(o->>'memo', ''),
            v_pay, btrim(coalesce(o->>'biz_name', '')), btrim(coalesce(o->>'biz_no', '')), btrim(coalesce(o->>'invoice_email', '')))
    returning id into oid;
  else
    update sp_orders set sample_type = v_type, service = v_service, lab_name = btrim(o->>'lab_name'), pi_name = btrim(o->>'pi_name'),
           contact_phone = btrim(o->>'contact_phone'), pickup_date = v_date, pickup_slot = v_slot,
           pickup_addr = btrim(o->>'pickup_addr'), pickup_addr2 = btrim(o->>'pickup_addr2'), irb_no = btrim(coalesce(o->>'irb_no', '')),
           leftover = v_left, memo = coalesce(o->>'memo', ''), pay_method = v_pay, biz_name = btrim(coalesce(o->>'biz_name', '')),
           biz_no = btrim(coalesce(o->>'biz_no', '')), invoice_email = btrim(coalesce(o->>'invoice_email', ''))
     where id = p_id and client_id = auth.uid() and status = 'submitted'
    returning id, order_no into oid, ono;
    -- 위에서 확인한 사이에 운영자가 확정했을 때
    if oid is null then raise exception '접수가 확정된 뒤에는 고칠 수 없습니다. 카카오톡 채널로 문의해 주세요'; end if;
    delete from sp_samples where order_id = oid;
  end if;

  insert into sp_samples(order_id, seq, label, name, collected_on, amount)
  select oid, x.ord, ono || '-' || lpad(x.ord::text, case when n > 99 then 3 else 2 end, '0'),
         btrim(x.v->>'name'), btrim(x.v->>'collected_on')::date, (x.v->>'amount')::numeric
    from jsonb_array_elements(samples) with ordinality as x(v, ord);

  perform sp_log(oid, case when p_id is null then 'submitted' else 'updated' end, '');
  return oid;
end $$;

-- 의뢰인: 접수 확정 전 취소 / 운영자: 완료 전 언제든 취소. 충전금에서 차감한 금액은 돌려줍니다.
create or replace function public.sp_cancel_order(p_id uuid, note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r sp_orders;
begin
  select * into r from sp_orders where id = p_id for update;
  if r.id is null or not (is_admin() or r.client_id = auth.uid()) then raise exception '권한이 없습니다'; end if;
  if r.status in ('completed','cancelled') then raise exception '이미 완료되었거나 취소된 의뢰입니다'; end if;
  if not is_admin() and r.status <> 'submitted' then raise exception '접수가 확정된 뒤에는 카카오톡 채널로 취소를 요청해 주세요'; end if;
  if length(coalesce(note, '')) > 500 then raise exception '취소 사유는 500자 이내로 적어 주세요'; end if;
  if r.charged > 0 then
    insert into sp_ledger(user_id, amount, kind, order_id, note) values (r.client_id, r.charged, 'refund', r.id, r.order_no || ' 취소 환불');
  end if;
  update sp_orders set status = 'cancelled', charged = 0,
         admin_note = case when is_admin() then coalesce(note, '') else admin_note end
   where id = p_id;
  perform sp_log(p_id, 'cancelled', note);
end $$;

-- 운영자: 접수 확정 (금액 · 예상 완료일). 충전금 결제면 이때 차감하고, 잔액이 모자라면 확정하지 않습니다.
-- p_seen: 운영자 화면이 불러온 의뢰의 updated_at. 그 사이 고객이 시료 · 서비스 · 결제 방법을 바꿨으면 확정하지 않습니다
-- (본 적 없는 내용에 금액을 매기거나 차감하지 않도록).
drop function if exists public.sp_confirm_order(uuid, int, date, text);
create or replace function public.sp_confirm_order(p_id uuid, amount int, p_eta date default null, note text default '',
                                                   p_seen timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare r sp_orders; bal int;
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  if amount is null or amount < 0 then raise exception '금액을 입력해 주세요'; end if;
  select * into r from sp_orders where id = p_id for update;
  if r.id is null or r.status <> 'submitted' then raise exception '접수 확인 전 의뢰가 아닙니다'; end if;
  if p_seen is null then raise exception '운영 화면을 새로고침한 뒤 다시 확정해 주세요'; end if;
  if r.updated_at is distinct from p_seen then
    raise exception '고객이 방금 의뢰를 고쳤습니다. 새로고침해 바뀐 내용을 확인한 뒤 다시 확정해 주세요';
  end if;
  if r.pay_method = 'credit' and amount > 0 then
    perform pg_advisory_xact_lock(hashtext('sp_ledger:' || r.client_id::text));
    bal := sp_balance_of(r.client_id);
    if bal < amount then
      raise exception '충전금이 %원 모자랍니다 (잔액 %원). 충전을 기다리거나 건별 청구로 바꿔 주세요',
        to_char(amount - bal, 'FM999,999,999,990'), to_char(bal, 'FM999,999,999,990');
    end if;
    insert into sp_ledger(user_id, amount, kind, order_id, note) values (r.client_id, -amount, 'charge', r.id, r.order_no || ' 차감');
  end if;
  update sp_orders set status = 'confirmed', quote_amount = amount, charged = case when r.pay_method = 'credit' then amount else 0 end,
         eta = coalesce(p_eta, eta), confirmed_at = now(), admin_note = coalesce(note, '')
   where id = p_id;
  perform sp_log(p_id, 'confirmed', note);
end $$;

-- 운영자: 결제 방법 바꾸기 (접수 확인 전, 고객 요청 시)
create or replace function public.sp_set_pay_method(p_id uuid, method text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or sp_is_client(p_id)) then raise exception '권한이 없습니다'; end if;
  if method not in ('credit','invoice') then raise exception '결제 방법을 골라 주세요'; end if;
  if method = 'invoice' and exists (select 1 from sp_orders where id = p_id and (biz_name = '' or not sp_email_ok(invoice_email))) then
    raise exception '건별 청구로 바꾸려면 의뢰를 수정해 세금계산서 정보를 넣어 주세요';
  end if;
  update sp_orders set pay_method = method where id = p_id and status = 'submitted';
  if not found then raise exception '접수 확인 전에만 바꿀 수 있습니다'; end if;
  perform sp_log(p_id, 'note', case method when 'credit' then '결제 방법: 충전금 차감' else '결제 방법: 건별 청구' end);
end $$;

-- 운영자: 진행 단계 · 예상 완료일 갱신 (고객 화면 추적에 그대로 보임)
create or replace function public.sp_set_status(p_id uuid, new_status text, note text default '', p_eta date default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  if new_status not in ('confirmed','in_transit','received','extraction','library','sequencing','data_ready','stored','completed') then
    raise exception '알 수 없는 단계입니다';
  end if;
  select status into cur from sp_orders where id = p_id for update;
  if cur is null then raise exception '의뢰를 찾을 수 없습니다'; end if;
  if cur in ('submitted','cancelled') then raise exception '접수 확정 전이거나 취소된 의뢰입니다'; end if;
  update sp_orders set status = new_status, eta = coalesce(p_eta, eta),
         completed_at = case when new_status = 'completed' then now() else null end
   where id = p_id;
  perform sp_log(p_id, 'status', note);
end $$;

-- 운영자: 고객에게 보이는 메모만 남기기 (일정 변경 사유 등)
create or replace function public.sp_add_note(p_id uuid, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  if length(btrim(coalesce(note, ''))) = 0 then raise exception '내용을 적어 주세요'; end if;
  perform sp_log(p_id, 'note', note);
end $$;

-- 운영자: 시료별 QC 결과. warn · fail 이면 고객의 선택을 기다립니다.
-- QC 결과(상태)가 바뀔 때만 고객의 선택을 지웁니다. 값 · 메모만 고쳐 다시 저장하면 고객이 고른 내용은 그대로 둡니다.
create or replace function public.sp_record_qc(p_sample uuid, p_status text, p_value text default '', p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare oid uuid; lbl text;
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  if p_status not in ('pending','pass','warn','fail') then raise exception 'QC 결과를 골라 주세요'; end if;
  update sp_samples set qc_status = p_status, qc_value = coalesce(p_value, ''), qc_note = coalesce(p_note, ''),
         decision = case when qc_status is distinct from p_status then null else decision end,
         decided_at = case when qc_status is distinct from p_status then null else decided_at end
   where id = p_sample
  returning order_id, label into oid, lbl;
  if oid is null then raise exception '시료를 찾을 수 없습니다'; end if;
  -- 고객 화면 진행 기록에 그대로 보이므로 한국어로 남김
  perform sp_log(oid, 'qc', lbl || ' ' ||
    case p_status when 'pass' then '통과' when 'warn' then '확인 필요' when 'fail' then '기준 미달' else '측정 전' end ||
    case when coalesce(p_value, '') <> '' then ' · ' || p_value else '' end);
end $$;

-- 의뢰인: QC 확인이 필요한 시료의 진행 방법 선택 (진행 · 재추출 · 제외 · 추가 시료)
create or replace function public.sp_decide(p_sample uuid, p_decision text) returns void
language plpgsql security definer set search_path = public as $$
declare oid uuid; lbl text;
begin
  if p_decision not in ('proceed','reextract','exclude','resend') then raise exception '진행 방법을 골라 주세요'; end if;
  update sp_samples s set decision = p_decision, decided_at = now()
    from sp_orders o
   where s.id = p_sample and o.id = s.order_id and o.client_id = auth.uid()
     and s.qc_status in ('warn','fail') and o.status not in ('submitted','completed','cancelled')
  returning s.order_id, s.label into oid, lbl;
  if oid is null then raise exception 'QC 확인이 필요한 시료가 아닙니다'; end if;
  perform sp_log(oid, 'decision', lbl || ' → ' ||
    case p_decision when 'proceed' then '그대로 진행' when 'reextract' then '재추출' when 'exclude' then '이 시료 제외' else '시료 다시 보내기' end);
end $$;

-- 운영자: 건별 청구 세금계산서 발행 완료 표시
create or replace function public.sp_mark_invoiced(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update sp_orders set invoiced_at = now()
   where id = p_id and pay_method = 'invoice' and invoiced_at is null and status not in ('submitted','cancelled');
  if not found then raise exception '발행 대기 중인 건별 청구가 아닙니다'; end if;
  perform sp_log(p_id, 'invoiced', '');
end $$;

-- 의뢰인: 충전 신청 (단위 금액의 배수). 입금이 확인되면 운영자가 충전합니다.
create or replace function public.sp_request_topup(p_amount int, p_doc_type text, p_biz_name text default '', p_biz_no text default '',
                                                   p_email text default '', p_memo text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare c jsonb := sp_setting('sp_credit'); u int; tid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  u := coalesce((c->>'unit')::int, 1000000);
  if p_amount is null or p_amount <= 0 or p_amount % u <> 0 then
    raise exception '충전은 %원 단위로 할 수 있습니다', to_char(u, 'FM999,999,999,990');
  end if;
  if p_amount > u * coalesce((c->>'max_units')::int, 50) then
    raise exception '한 번에 %원까지 충전할 수 있습니다', to_char(u::bigint * coalesce((c->>'max_units')::int, 50), 'FM999,999,999,990');
  end if;
  if p_doc_type not in ('tax_invoice','none') then raise exception '증빙 종류를 골라 주세요'; end if;
  if p_doc_type = 'tax_invoice' then
    if length(btrim(coalesce(p_biz_name, ''))) < 2 then raise exception '세금계산서 받을 기관명(상호)을 입력해 주세요'; end if;
    if not sp_email_ok(p_email) then raise exception '세금계산서 받을 메일 주소를 확인해 주세요'; end if;
    if coalesce(p_biz_no, '') <> '' and not sp_biz_no_ok(p_biz_no) then raise exception '사업자등록번호가 맞지 않습니다. 숫자 10자리를 다시 확인해 주세요'; end if;
  end if;
  -- 증빙이 필요 없어도 받은 값은 저장되므로 길이는 늘 봅니다
  if length(btrim(coalesce(p_biz_name, ''))) > 100 then raise exception '세금계산서 받을 기관명은 100자 이내로 적어 주세요'; end if;
  if length(btrim(coalesce(p_email, ''))) > 200 then raise exception '세금계산서 받을 메일 주소가 너무 깁니다'; end if;
  if length(btrim(coalesce(p_biz_no, ''))) > 20 then raise exception '사업자등록번호가 맞지 않습니다. 숫자 10자리를 다시 확인해 주세요'; end if;
  if length(coalesce(p_memo, '')) > 500 then raise exception '메모는 500자 이내로 적어 주세요'; end if;
  if exists (select 1 from sp_topups where user_id = auth.uid() and status = 'requested') then
    raise exception '확인을 기다리는 충전 신청이 있습니다. 입금 확인 뒤에 다시 신청하거나 기존 신청을 취소해 주세요';
  end if;
  -- 동시에 두 번 신청하면 위 검사를 둘 다 지나칠 수 있어, 표의 고유 색인(sp_topups_one_pending)이 한 번 더 막습니다
  begin
    insert into sp_topups(user_id, amount, doc_type, biz_name, biz_no, invoice_email, memo)
    values (auth.uid(), p_amount, p_doc_type, btrim(coalesce(p_biz_name, '')), btrim(coalesce(p_biz_no, '')), btrim(coalesce(p_email, '')), coalesce(p_memo, ''))
    returning id into tid;
  exception when unique_violation then
    raise exception '확인을 기다리는 충전 신청이 있습니다. 입금 확인 뒤에 다시 신청하거나 기존 신청을 취소해 주세요';
  end;
  return tid;
end $$;

create or replace function public.sp_cancel_topup(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update sp_topups set status = 'cancelled'
   where id = p_id and status = 'requested' and (user_id = auth.uid() or is_admin());
  if not found then raise exception '취소할 수 있는 충전 신청이 아닙니다'; end if;
end $$;

-- 운영자: 입금 확인 → 충전 (설정의 보너스 비율만큼 추가 적립)
create or replace function public.sp_confirm_topup(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tp sp_topups; rate numeric := coalesce((sp_setting('sp_credit')->>'bonus_rate')::numeric, 0);
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update sp_topups set status = 'paid', paid_at = now() where id = p_id and status = 'requested' returning * into tp;
  if tp.id is null then raise exception '확인을 기다리는 충전 신청이 아닙니다'; end if;
  insert into sp_ledger(user_id, amount, kind, topup_id, note) values (tp.user_id, tp.amount, 'topup', tp.id, '충전 입금 확인');
  if rate > 0 then
    insert into sp_ledger(user_id, amount, kind, topup_id, note) values (tp.user_id, round(tp.amount * rate)::int, 'bonus', tp.id, '충전 보너스');
  end if;
end $$;

-- 운영자: 충전금 직접 조정 (오입금 정정 등). 사유가 장부에 남습니다.
create or replace function public.sp_adjust_credit(p_user uuid, p_amount int, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  if p_amount is null or p_amount = 0 then raise exception '금액을 입력해 주세요'; end if;
  if length(btrim(coalesce(note, ''))) < 2 then raise exception '조정 사유를 적어 주세요'; end if;
  perform pg_advisory_xact_lock(hashtext('sp_ledger:' || p_user::text));
  if sp_balance_of(p_user) + p_amount < 0 then raise exception '잔액보다 많이 뺄 수 없습니다'; end if;
  insert into sp_ledger(user_id, amount, kind, note) values (p_user, p_amount, 'adjust', note);
end $$;

-- 운영자: 회원별 충전금 잔액 (운영 화면 > 충전금)
create or replace function public.sp_balances()
returns table (user_id uuid, name text, org text, balance int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.org, sum(l.amount)::int, max(l.created_at)
    from sp_ledger l join profiles p on p.id = l.user_id
   where is_admin()
   group by p.id, p.name, p.org
   order by max(l.created_at) desc
$$;

-- 권한: Supabase 는 public 에 새로 만드는 함수마다 anon · authenticated 에 실행 권한을 자동으로 줍니다.
-- 그래서 모두 거둔 뒤 화면에서 쓰는 함수만 로그인한 사람에게 다시 엽니다. sp_setting · sp_log · sp_balance_of 는 위 함수 안에서만 씁니다
-- (열어 두면 남의 의뢰에 가짜 기록을 남기거나 남의 잔액을 볼 수 있음). 함수를 더하거나 인자를 바꾸면 두 목록에 같이 넣으세요.
revoke execute on function public.sp_now(), public.sp_today(), public.sp_hour(), public.sp_setting(text), public.sp_biz_no_ok(text),
  public.sp_phone_ok(text), public.sp_email_ok(text), public.sp_is_client(uuid), public.sp_log(uuid, text, text), public.sp_balance_of(uuid),
  public.sp_balance(), public.sp_handle_new_user(),
  public.sp_complete_profile(text, text, text), public.sp_save_order(uuid, jsonb, jsonb), public.sp_cancel_order(uuid, text),
  public.sp_confirm_order(uuid, int, date, text, timestamptz), public.sp_set_pay_method(uuid, text), public.sp_set_status(uuid, text, text, date),
  public.sp_add_note(uuid, text), public.sp_record_qc(uuid, text, text, text), public.sp_decide(uuid, text), public.sp_mark_invoiced(uuid),
  public.sp_request_topup(int, text, text, text, text, text), public.sp_cancel_topup(uuid), public.sp_confirm_topup(uuid),
  public.sp_adjust_credit(uuid, int, text), public.sp_balances() from anon, authenticated, public;
grant execute on function public.sp_now(), public.sp_today(), public.sp_hour(), public.sp_biz_no_ok(text), public.sp_phone_ok(text),
  public.sp_email_ok(text), public.sp_is_client(uuid), public.sp_balance(),
  public.sp_complete_profile(text, text, text), public.sp_save_order(uuid, jsonb, jsonb), public.sp_cancel_order(uuid, text),
  public.sp_confirm_order(uuid, int, date, text, timestamptz), public.sp_set_pay_method(uuid, text), public.sp_set_status(uuid, text, text, date),
  public.sp_add_note(uuid, text), public.sp_record_qc(uuid, text, text, text), public.sp_decide(uuid, text), public.sp_mark_invoiced(uuid),
  public.sp_request_topup(int, text, text, text, text, text), public.sp_cancel_topup(uuid), public.sp_confirm_topup(uuid),
  public.sp_adjust_credit(uuid, int, text), public.sp_balances() to authenticated;
