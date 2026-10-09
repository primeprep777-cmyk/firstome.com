-- 오믹스메이트 DB 구조 · 권한 규칙
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 한 번 실행합니다.
-- 다시 실행해도 되도록 대부분 "if not exists / or replace" 로 작성했습니다.
--
-- 상태 흐름 (requests.status)
--   review(검수대기) → open(입찰중) → selected(선정됨) → in_progress(진행중)
--   → delivered(결과제출) → completed(완료)
--   곁가지: closed(입찰 마감, 선정 없음) · cancelled(취소) · disputed(분쟁)
-- 상태는 화면에서 직접 바꾸지 못하고, 아래 함수(rpc)로만 바뀝니다.

create extension if not exists pgcrypto;

-- ───────────────────────── 표 ─────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  org         text not null default '',
  phone       text not null default '',
  is_admin    boolean not null default false,
  agreed_at   timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.experts (
  id              uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  tier            text check (tier in ('bronze','silver','gold','platinum')),
  fields          text not null default '',          -- 전문 분야 (자유 서술)
  dtypes          text[] not null default '{}',      -- 가능한 데이터 종류 (bulk, sc, wgs, prot, spatial, multi)
  education       text not null default '',
  papers          text not null default '',          -- 논문 링크·목록
  bio             text not null default '',
  admin_note      text not null default '',
  completed_count int not null default 0,
  rating          numeric(3,2),
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title         text not null check (length(title) between 2 and 120),
  purpose       text not null default '',
  dtype         text not null check (dtype in ('bulk','sc','wgs','prot','spatial','multi')),
  n_samples     text not null default '',
  scope         text[] not null default '{}',
  speed         text not null default 'std' check (speed in ('std','fast','slow')),
  tier_min      text not null default 'any' check (tier_min in ('any','gold','plat')),
  est_band      int check (est_band between 1 and 5),
  data_status   text not null default '',             -- 데이터 상태 (보유 · 시퀀싱 중 · 샘플로 의뢰 예정 등)
  due_date      date,
  status        text not null default 'review'
                check (status in ('review','open','closed','selected','in_progress','delivered','completed','cancelled','disputed')),
  admin_note    text not null default '',
  bid_deadline  timestamptz,
  selected_bid  uuid,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.requests add column if not exists completed_at timestamptz;
create index if not exists requests_status_idx on public.requests(status);
create index if not exists requests_client_idx on public.requests(client_id);

create table if not exists public.bids (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.requests(id) on delete cascade,
  expert_id     uuid not null default auth.uid() references public.experts(id) on delete cascade,
  amount        int  not null check (amount > 0),     -- 원, 수수료 포함
  days          int  not null check (days between 1 and 365),
  approach      text not null default '',
  deliverables  text not null default '',
  question      text not null default '',
  status        text not null default 'submitted' check (status in ('submitted','withdrawn','selected','rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (request_id, expert_id)
);
create index if not exists bids_request_idx on public.bids(request_id);

do $$ begin
  alter table public.requests add constraint requests_selected_bid_fk
    foreign key (selected_bid) references public.bids(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.deliveries (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.requests(id) on delete cascade,
  expert_id     uuid not null references public.experts(id),
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists public.payments (
  request_id    uuid primary key references public.requests(id) on delete cascade,
  amount        int not null,
  fee_rate      numeric(5,4) not null,                 -- 0.1500 = 15%
  paid_at       timestamptz not null default now(),    -- 의뢰인 입금 확인
  payout_amount int,
  payout_at     timestamptz                            -- 전문가 지급
);

create table if not exists public.reviews (
  request_id    uuid primary key references public.requests(id) on delete cascade,
  expert_id     uuid not null references public.experts(id),
  rating        int not null check (rating between 1 and 5),
  comment       text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists public.events (
  id            bigint generated always as identity primary key,
  request_id    uuid references public.requests(id) on delete cascade,
  actor         uuid default auth.uid(),
  kind          text not null,
  note          text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists events_request_idx on public.events(request_id);

-- 등급별 수수료율. 런칭 전에 숫자만 바꾸면 됩니다.
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);
insert into public.settings(key, value) values
  ('fee_rate', '{"bronze":0.20,"silver":0.17,"gold":0.15,"platinum":0.12}'),
  ('bid_days', '7'),
  ('bank', '{"text":""}')
on conflict (key) do nothing;

-- ───────────────────────── 도우미 함수 ─────────────────────────

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.tier_rank(t text) returns int
language sql immutable as $$
  select case t when 'bronze' then 1 when 'silver' then 2 when 'gold' then 3 when 'platinum' then 4
                when 'any' then 1 when 'plat' then 4 else 0 end
$$;

-- 지금 로그인한 사람이 승인된 전문가이고, 그 의뢰의 희망 등급을 만족하는지
create or replace function public.expert_qualifies(req uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from experts e join requests r on r.id = req
    where e.id = auth.uid() and e.status = 'approved'
      and tier_rank(e.tier) >= tier_rank(r.tier_min)
      and r.client_id <> auth.uid()
  )
$$;

-- 지금 로그인한 사람이 그 의뢰에 선정된 전문가인지
create or replace function public.is_selected_expert(req uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r join bids b on b.id = r.selected_bid
    where r.id = req and b.expert_id = auth.uid()
  )
$$;

-- 그 의뢰가 지금 입찰을 받는 중인지 (전문가는 requests 표를 직접 못 읽으므로 함수로 확인)
create or replace function public.request_biddable(req uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from requests where id = req and status = 'open' and bid_deadline > now())
$$;

create or replace function public.is_client(req uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from requests where id = req and client_id = auth.uid())
$$;

-- 가입하면 profiles 행을 자동으로 만듭니다 (가입 화면의 이름·소속을 옮겨 둠)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, name, org, agreed_at)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', ''),
          coalesce(new.raw_user_meta_data->>'org', ''),
          case when new.raw_user_meta_data ? 'agreed' then now() end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists requests_touch on public.requests;
create trigger requests_touch before update on public.requests for each row execute function public.touch_updated_at();
drop trigger if exists bids_touch on public.bids;
create trigger bids_touch before update on public.bids for each row execute function public.touch_updated_at();

create or replace function public.log_event(req uuid, k text, n text default '') returns void
language sql security definer set search_path = public as $$
  insert into events(request_id, kind, note) values (req, k, coalesce(n, ''))
$$;

-- ───────────────────────── 권한 (RLS) ─────────────────────────
-- 표 전체 권한을 먼저 거두고, 화면에서 써야 하는 열만 다시 열어 줍니다.

alter table public.profiles   enable row level security;
alter table public.experts    enable row level security;
alter table public.requests   enable row level security;
alter table public.bids       enable row level security;
alter table public.deliveries enable row level security;
alter table public.payments   enable row level security;
alter table public.reviews    enable row level security;
alter table public.events     enable row level security;
alter table public.settings   enable row level security;

revoke all on public.profiles, public.experts, public.requests, public.bids, public.deliveries,
              public.payments, public.reviews, public.events, public.settings from anon, authenticated;

grant select on public.profiles, public.experts, public.requests, public.bids, public.deliveries,
                public.payments, public.reviews, public.events, public.settings to authenticated;
grant update (name, org, phone) on public.profiles to authenticated;
grant insert (fields, dtypes, education, papers, bio) on public.experts to authenticated;
grant update (fields, dtypes, education, papers, bio) on public.experts to authenticated;
grant insert (title, purpose, dtype, n_samples, scope, speed, tier_min, est_band, data_status, due_date) on public.requests to authenticated;
grant update (title, purpose, dtype, n_samples, scope, speed, tier_min, est_band, data_status, due_date) on public.requests to authenticated;
grant insert (request_id, amount, days, approach, deliverables, question) on public.bids to authenticated;
grant update (amount, days, approach, deliverables, question) on public.bids to authenticated;

-- profiles: 본인, 운영자. 의뢰인은 선정된 전문가의 이름을, 선정된 전문가는 의뢰인의 이름·소속을 봅니다.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (
  id = auth.uid() or public.is_admin()
  or exists (select 1 from requests r join bids b on b.id = r.selected_bid
             where (r.client_id = auth.uid() and b.expert_id = profiles.id)
                or (b.expert_id = auth.uid() and r.client_id = profiles.id))
  or exists (select 1 from bids b join requests r on r.id = b.request_id
             where b.expert_id = profiles.id and r.client_id = auth.uid())
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- experts: 본인 신청서, 운영자. 의뢰인은 자기 의뢰에 입찰한 전문가의 프로필을 봅니다.
drop policy if exists experts_read on public.experts;
create policy experts_read on public.experts for select using (
  id = auth.uid() or public.is_admin()
  or exists (select 1 from bids b join requests r on r.id = b.request_id
             where b.expert_id = experts.id and r.client_id = auth.uid() and b.status <> 'withdrawn')
);
drop policy if exists experts_insert on public.experts;
create policy experts_insert on public.experts for insert with check (id = auth.uid());
drop policy if exists experts_update on public.experts;
create policy experts_update on public.experts for update using (id = auth.uid() and status in ('pending','rejected')) with check (id = auth.uid());

-- requests: 의뢰인은 전체를, 선정된 전문가는 전체를, 운영자는 전체를 봅니다.
-- 입찰 단계의 전문가는 표를 직접 읽지 못하고 open_requests() 로 요약만 봅니다.
drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select using (
  client_id = auth.uid() or public.is_admin() or public.is_selected_expert(id)
);
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert with check (client_id = auth.uid());
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update
  using (client_id = auth.uid() and status = 'review') with check (client_id = auth.uid());

-- bids: 본인 입찰, 그 의뢰의 의뢰인, 운영자. 전문가끼리는 서로의 입찰을 못 봅니다.
drop policy if exists bids_read on public.bids;
create policy bids_read on public.bids for select using (
  expert_id = auth.uid() or public.is_admin()
  or (public.is_client(request_id) and status <> 'withdrawn')
);
drop policy if exists bids_insert on public.bids;
create policy bids_insert on public.bids for insert with check (
  expert_id = auth.uid() and public.expert_qualifies(request_id)
  and public.request_biddable(request_id)
);
drop policy if exists bids_update on public.bids;
create policy bids_update on public.bids for update using (
  expert_id = auth.uid() and status = 'submitted'
  and public.request_biddable(request_id)
) with check (expert_id = auth.uid());

drop policy if exists deliveries_read on public.deliveries;
create policy deliveries_read on public.deliveries for select using (
  public.is_client(request_id) or expert_id = auth.uid() or public.is_admin());

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select using (
  public.is_client(request_id) or public.is_selected_expert(request_id) or public.is_admin());

drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select using (
  public.is_client(request_id) or expert_id = auth.uid() or public.is_admin());

drop policy if exists events_read on public.events;
create policy events_read on public.events for select using (
  public.is_client(request_id) or public.is_selected_expert(request_id) or public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
grant insert, update on public.settings to authenticated;
drop policy if exists settings_admin_insert on public.settings;
create policy settings_admin_insert on public.settings for insert with check (public.is_admin());
drop policy if exists settings_admin_update on public.settings;
create policy settings_admin_update on public.settings for update using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── 화면에서 부르는 함수 ─────────────────────────

-- 전문가용 공개 의뢰 목록: 의뢰인 이름·소속·데이터 파일은 빼고 요약만
create or replace function public.open_requests()
returns table (id uuid, title text, purpose text, dtype text, n_samples text, scope text[], speed text,
               tier_min text, est_band int, data_status text, due_date date, bid_deadline timestamptz,
               bid_count bigint, my_bid uuid, my_bid_status text)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.purpose, r.dtype, r.n_samples, r.scope, r.speed, r.tier_min, r.est_band,
         r.data_status, r.due_date, r.bid_deadline,
         (select count(*) from bids b where b.request_id = r.id and b.status <> 'withdrawn'),
         mb.id, mb.status
  from requests r
  left join bids mb on mb.request_id = r.id and mb.expert_id = auth.uid()
  where r.status = 'open' and r.bid_deadline > now() and public.expert_qualifies(r.id)
  order by r.bid_deadline
$$;

-- 전문가용 내 입찰 목록: 선정 전에는 requests 를 못 읽으므로 제목·상태만 함께 돌려줌
create or replace function public.my_bids()
returns table (bid_id uuid, request_id uuid, title text, dtype text, request_status text, bid_deadline timestamptz,
               amount int, days int, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, r.id, r.title, r.dtype, r.status, r.bid_deadline, b.amount, b.days, b.status, b.created_at
  from bids b join requests r on r.id = b.request_id
  where b.expert_id = auth.uid()
  order by b.created_at desc
$$;

-- 운영자: 의뢰 공개 (검수 통과)
create or replace function public.publish_request(req uuid, note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  select coalesce((value #>> '{}')::int, 7) into d from settings where key = 'bid_days';
  update requests set status = 'open', bid_deadline = now() + make_interval(days => coalesce(d, 7)), admin_note = coalesce(note, '')
   where id = req and status = 'review';
  if not found then raise exception '검수 대기 중인 의뢰가 아닙니다'; end if;
  perform log_event(req, 'published', note);
end $$;

-- 운영자: 의뢰 반려 → 취소 처리
-- 의뢰인: 선정 전이면 취소
create or replace function public.cancel_request(req uuid, note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_client(req)) then raise exception '권한이 없습니다'; end if;
  update requests set status = 'cancelled', admin_note = case when is_admin() then coalesce(note,'') else admin_note end
   where id = req and status in ('review','open','closed');
  if not found then raise exception '선정 이후에는 취소할 수 없습니다. 운영자에게 문의해 주세요'; end if;
  update bids set status = 'rejected' where request_id = req and status = 'submitted';
  perform log_event(req, 'cancelled', note);
end $$;

-- 전문가: 입찰 철회
create or replace function public.withdraw_bid(bid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update bids set status = 'withdrawn' where id = bid and expert_id = auth.uid() and status = 'submitted';
  if not found then raise exception '철회할 수 있는 입찰이 아닙니다'; end if;
end $$;

-- 의뢰인: 입찰 하나를 선정
create or replace function public.select_bid(bid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r_id uuid;
begin
  select b.request_id into r_id from bids b join requests r on r.id = b.request_id
   where b.id = bid and b.status = 'submitted' and r.client_id = auth.uid() and r.status in ('open','closed');
  if r_id is null then raise exception '선정할 수 있는 입찰이 아닙니다'; end if;
  update bids set status = case when id = bid then 'selected' else 'rejected' end
   where request_id = r_id and status = 'submitted';
  update requests set status = 'selected', selected_bid = bid where id = r_id;
  perform log_event(r_id, 'selected', '');
end $$;

-- 운영자: 입금 확인 → 진행중 (에스크로 보관 시작)
create or replace function public.confirm_payment(req uuid) returns void
language plpgsql security definer set search_path = public as $$
declare amt int; t text; rate numeric;
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  select b.amount, e.tier into amt, t from requests r join bids b on b.id = r.selected_bid join experts e on e.id = b.expert_id
   where r.id = req and r.status = 'selected';
  if amt is null then raise exception '선정 상태의 의뢰가 아닙니다'; end if;
  select coalesce((value ->> coalesce(t,'bronze'))::numeric, 0.2) into rate from settings where key = 'fee_rate';
  insert into payments(request_id, amount, fee_rate, payout_amount) values (req, amt, rate, round(amt * (1 - rate)));
  update requests set status = 'in_progress' where id = req;
  perform log_event(req, 'paid', '');
end $$;

-- 선정된 전문가: 결과 제출 (파일은 storage 의 deliverables/{의뢰 id}/ 에 먼저 올림)
create or replace function public.submit_delivery(req uuid, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_selected_expert(req) then raise exception '선정된 전문가만 제출할 수 있습니다'; end if;
  update requests set status = 'delivered' where id = req and status = 'in_progress';
  if not found then raise exception '진행 중인 의뢰가 아닙니다'; end if;
  insert into deliveries(request_id, expert_id, note) values (req, auth.uid(), coalesce(note, ''));
  perform log_event(req, 'delivered', note);
end $$;

-- 의뢰인: 결과 승인 + 평가 → 완료 (정산 대상)
create or replace function public.approve_delivery(req uuid, rating int, comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare ex uuid;
begin
  if not is_client(req) then raise exception '의뢰인만 승인할 수 있습니다'; end if;
  select b.expert_id into ex from requests r join bids b on b.id = r.selected_bid where r.id = req and r.status = 'delivered';
  if ex is null then raise exception '결과 제출 상태가 아닙니다'; end if;
  update requests set status = 'completed', completed_at = now() where id = req;
  insert into reviews(request_id, expert_id, rating, comment) values (req, ex, rating, coalesce(comment, ''));
  update experts e set completed_count = completed_count + 1,
         rating = (select round(avg(v.rating)::numeric, 2) from reviews v where v.expert_id = e.id)
   where e.id = ex;
  perform log_event(req, 'approved', comment);
end $$;

-- 의뢰인: 수정 요청 → 진행중으로 되돌림
create or replace function public.request_revision(req uuid, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_client(req) then raise exception '의뢰인만 요청할 수 있습니다'; end if;
  update requests set status = 'in_progress' where id = req and status = 'delivered';
  if not found then raise exception '결과 제출 상태가 아닙니다'; end if;
  perform log_event(req, 'revision', note);
end $$;

-- 운영자: 전문가 승인·반려·정지와 등급 지정
create or replace function public.review_expert(ex uuid, new_status text, new_tier text default null, note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update experts set status = new_status,
         tier = case when new_status = 'approved' then coalesce(new_tier, tier, 'bronze') else tier end,
         admin_note = coalesce(note, ''), reviewed_at = now()
   where id = ex;
end $$;

-- 운영자: 입찰 마감 처리 · 전문가 지급 완료 기록 · 분쟁 표시
create or replace function public.close_request(req uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update requests set status = 'closed' where id = req and status = 'open';
end $$;

create or replace function public.mark_payout(req uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update payments set payout_at = now() where request_id = req and payout_at is null
    and exists (select 1 from requests where id = req and status = 'completed');
  if not found then raise exception '완료된 의뢰의 미지급 건이 아닙니다'; end if;
  perform log_event(req, 'payout', '');
end $$;

create or replace function public.mark_dispute(req uuid, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_client(req) or is_selected_expert(req)) then raise exception '권한이 없습니다'; end if;
  update requests set status = 'disputed' where id = req and status in ('in_progress','delivered');
  if not found then raise exception '진행 중이거나 결과 제출 상태에서만 할 수 있습니다'; end if;
  perform log_event(req, 'disputed', note);
end $$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.open_requests(), public.my_bids(), public.publish_request(uuid, text), public.cancel_request(uuid, text),
  public.withdraw_bid(uuid), public.select_bid(uuid), public.confirm_payment(uuid), public.submit_delivery(uuid, text),
  public.approve_delivery(uuid, int, text), public.request_revision(uuid, text),
  public.review_expert(uuid, text, text, text), public.close_request(uuid), public.mark_payout(uuid),
  public.mark_dispute(uuid, text),
  public.is_admin(), public.tier_rank(text), public.expert_qualifies(uuid), public.is_selected_expert(uuid), public.is_client(uuid),
  public.request_biddable(uuid)
  to authenticated;

-- ───────────────────────── 파일 저장소 ─────────────────────────
-- request-files/{의뢰 id}/파일 : 의뢰인이 올리고, 의뢰인·선정된 전문가·운영자만 읽음
-- deliverables/{의뢰 id}/파일  : 선정된 전문가가 올리고, 의뢰인·그 전문가·운영자만 읽음
-- 과제 완료 30일 뒤 전문가의 데이터 접근을 막습니다 (페이지의 '과제 종료 후 접근 차단' 약속).

insert into storage.buckets (id, name, public) values ('request-files', 'request-files', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('deliverables', 'deliverables', false) on conflict (id) do nothing;

create or replace function public.storage_req(name text) returns uuid
language sql immutable as $$
  select case when split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid end
$$;
grant execute on function public.storage_req(text) to authenticated;

create or replace function public.expert_data_open(req uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_selected_expert(req) and exists (
    select 1 from requests r where r.id = req
      and (r.status in ('selected','in_progress','delivered','disputed')
           or (r.status = 'completed' and r.completed_at > now() - interval '30 days')))
$$;
grant execute on function public.expert_data_open(uuid) to authenticated;

drop policy if exists "om request files read" on storage.objects;
create policy "om request files read" on storage.objects for select to authenticated using (
  bucket_id = 'request-files' and (public.is_client(public.storage_req(name)) or public.is_admin()
                                   or public.expert_data_open(public.storage_req(name))));
drop policy if exists "om request files write" on storage.objects;
create policy "om request files write" on storage.objects for insert to authenticated with check (
  bucket_id = 'request-files' and public.is_client(public.storage_req(name)));
drop policy if exists "om request files delete" on storage.objects;
create policy "om request files delete" on storage.objects for delete to authenticated using (
  bucket_id = 'request-files' and public.is_client(public.storage_req(name)));

drop policy if exists "om deliverables read" on storage.objects;
create policy "om deliverables read" on storage.objects for select to authenticated using (
  bucket_id = 'deliverables' and (public.is_client(public.storage_req(name)) or public.is_admin()
                                  or public.is_selected_expert(public.storage_req(name))));
drop policy if exists "om deliverables write" on storage.objects;
create policy "om deliverables write" on storage.objects for insert to authenticated with check (
  bucket_id = 'deliverables' and public.expert_data_open(public.storage_req(name)));
