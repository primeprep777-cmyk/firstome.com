-- 오믹스메이트 결제 방법 · 세금계산서 신청 · 견적서용 회사 정보
-- schema.sql 다음에 Supabase SQL Editor 에서 한 번 실행합니다 (다시 실행해도 됨).
--
-- 금액 기준: 입찰 금액은 부가세 포함 총액입니다. 견적서는 공급가액 = 금액 ÷ 1.1, 부가세 = 나머지로 나눠 보여 줍니다.
-- 세금계산서 발행 주체(전체 금액 vs 수수료분)는 세무 검토 후 정하며, 이 표는 신청 정보만 모읍니다.

create table if not exists public.billing (
  request_id      uuid primary key references public.requests(id) on delete cascade,
  method          text not null default 'transfer' check (method in ('transfer','card','research_card')),
  doc_type        text not null default 'tax_invoice' check (doc_type in ('tax_invoice','cash_receipt','none')),
  biz_no          text not null default '',   -- 사업자등록번호 (세금계산서) 또는 휴대폰·사업자번호 (현금영수증)
  biz_name        text not null default '',   -- 상호 (기관명)
  ceo             text not null default '',   -- 대표자
  biz_address     text not null default '',
  email           text not null default '',   -- 세금계산서 받을 메일
  project_no      text not null default '',   -- 연구과제 번호 (선택)
  memo            text not null default '',
  invoice_status  text not null default 'requested' check (invoice_status in ('requested','issued')),
  issued_at       timestamptz,
  card_link_sent  timestamptz,                -- 카드 결제 링크를 운영자가 보낸 시각 (PG 연동 전)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists billing_touch on public.billing;
create trigger billing_touch before update on public.billing for each row execute function public.touch_updated_at();

alter table public.billing enable row level security;
revoke all on public.billing from anon, authenticated;
grant select on public.billing to authenticated;
grant insert (request_id, method, doc_type, biz_no, biz_name, ceo, biz_address, email, project_no, memo) on public.billing to authenticated;
grant update (method, doc_type, biz_no, biz_name, ceo, biz_address, email, project_no, memo) on public.billing to authenticated;

-- 의뢰인이 선정 이후(입금 전 · 진행 중 · 결과 제출 · 완료)에 쓰고, 발행된 뒤에는 고칠 수 없음
create or replace function public.billing_editable(req uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from requests r where r.id = req and r.client_id = auth.uid()
                   and r.status in ('selected','in_progress','delivered','completed'))
     and not exists (select 1 from billing b where b.request_id = req and b.invoice_status = 'issued')
$$;
grant execute on function public.billing_editable(uuid) to authenticated;

drop policy if exists billing_read on public.billing;
create policy billing_read on public.billing for select using (public.is_client(request_id) or public.is_admin());
drop policy if exists billing_insert on public.billing;
create policy billing_insert on public.billing for insert with check (public.billing_editable(request_id));
drop policy if exists billing_update on public.billing;
create policy billing_update on public.billing for update using (public.billing_editable(request_id)) with check (public.billing_editable(request_id));

-- 운영자: 세금계산서·현금영수증 발행 완료 표시 / 카드 결제 링크 발송 표시
create or replace function public.mark_invoice_issued(req uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update billing set invoice_status = 'issued', issued_at = now() where request_id = req and invoice_status = 'requested' and doc_type <> 'none';
  if not found then raise exception '발행 대기 중인 신청이 아닙니다'; end if;
  perform log_event(req, 'invoice_issued', '');
end $$;

create or replace function public.mark_card_link_sent(req uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있습니다'; end if;
  update billing set card_link_sent = now() where request_id = req and method in ('card','research_card');
  if not found then raise exception '카드 결제를 고른 의뢰가 아닙니다'; end if;
end $$;

revoke execute on function public.mark_invoice_issued(uuid), public.mark_card_link_sent(uuid) from anon, public;
grant execute on function public.mark_invoice_issued(uuid), public.mark_card_link_sent(uuid) to authenticated;

-- 견적서 공급자 정보 (운영 화면 > 설정에서 채움)
insert into public.settings(key, value) values
  ('company', '{"name":"퍼스트옴","biz_no":"","ceo":"","address":"","phone":"","email":""}')
on conflict (key) do nothing;
