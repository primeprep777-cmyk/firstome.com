/* /samplo/admin/ : 샘플로 운영 화면 (profiles.is_admin = true 인 계정만)
   ?tab=new       접수 대기: 고객이 낸 의뢰를 확인하고 금액 · 예상 완료일로 접수 확정, 또는 사유를 적어 반려
   ?tab=progress  진행 중: 단계 · 예상 완료일, 시료별 QC 결과, 고객 안내, 세금계산서 발행 표시, 취소
   ?tab=credit    충전금: 충전 신청 입금 확인, 회원별 잔액 · 장부, 직접 조정
   ?tab=all       전체 의뢰: 최근 200건 (상태로 거르기, 검색)
   ?tab=settings  설정: 시료 종류 · 서비스 · 수거 · 충전 · 입금 안내 (settings 표의 sp_criteria · sp_pickup · sp_credit · sp_bank)
   상태 · 금액 · 충전금은 화면에서 직접 쓰지 않고 supabase/samplo.sql 의 함수(rpc)로만 바꿉니다.
   주소 끝에 #o-<의뢰 id> 를 붙이면 그 의뢰를 펼친 채로 엽니다. */
(async function () {
  var OM = window.OM, SP = window.SP, sb = OM.sb, L = SP.L, esc = OM.esc, main = OM.$("#om-main");
  var me = await SP.requireLogin(); if (!me) return;
  if (!me.isAdmin) {
    main.innerHTML = '<div class="om-card om-empty"><h2>운영자만 볼 수 있는 화면입니다</h2><p>의뢰와 진행 상황은 내 의뢰 화면에서 볼 수 있습니다.</p><a class="btn primary" href="/samplo/app/">내 의뢰로 가기</a></div>';
    return;
  }

  var TABS = { new: "접수 대기", progress: "진행 중", credit: "충전금", all: "전체 의뢰", settings: "설정" };
  var VIEW = { new: viewNew, progress: viewProgress, credit: viewCredit, all: viewAll, settings: viewSettings };
  var tab = TABS[OM.qs("tab")] ? OM.qs("tab") : "new";
  var STEPS = SP.TRACK.concat("completed");   // 운영자가 고를 수 있는 진행 단계 (confirmed … stored, completed)
  var CTL = "font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--line2);border-radius:6px;background:var(--surface);color:var(--ink);max-width:100%";
  var S = null;        // 설정. SP.loadSettings 가 캐시하는 객체라, 저장 뒤 이 객체를 고치면 SP 쪽도 같이 바뀝니다
  var byId = {};       // 지금 화면에 있는 의뢰 (id → 행)
  var opened = {};     // 펼쳐 둔 의뢰. 처리한 뒤 다시 그려도 펼친 채로 둠
  var pf = "";         // 진행 중 탭의 보기 거르기
  var dirty = false;   // 설정 탭: 저장하지 않은 변경
  var first = true;    // 첫 화면에서만 #o-… 로 이동

  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  await show();

  // ───────── 화면 그리기 ─────────
  async function show() {
    var n = {};
    try {
      if (!S) S = await SP.loadSettings();
      var r = await Promise.all([counts(), VIEW[tab]()]);
      n = r[0];
      main.innerHTML = head(n) + r[1].html;
      bindTabs();
      if (r[1].bind) r[1].bind();
      if (first) { first = false; toHash(); }
    } catch (e) {
      console.error(e);
      main.innerHTML = head(n) + '<div class="om-card om-empty"><h2>화면을 불러오지 못했습니다</h2><p>' + esc(OM.errMsg(e)) + '</p><button type="button" class="btn primary" id="sp-retry">다시 불러오기</button></div>';
      bindTabs();
      OM.$("#sp-retry").onclick = function () { show(); };
    }
  }
  // 탭에 붙는 숫자 (확인을 기다리는 의뢰 · 충전 신청)
  async function counts() {
    var r = await Promise.all([
      sb.from("sp_orders").select("id", { head: true, count: "exact" }).eq("status", "submitted"),
      sb.from("sp_topups").select("id", { head: true, count: "exact" }).eq("status", "requested")
    ]);
    return { new: r[0].count || 0, credit: r[1].count || 0 };
  }
  function head(n) {
    return '<div class="om-head"><div><h1>샘플로 운영</h1><p>의뢰 접수 확정, 진행 단계와 QC, 충전금, 접수 기준을 관리합니다.</p></div></div><div class="om-tabs">' +
      Object.keys(TABS).map(function (k) {
        return '<button type="button" data-tab="' + k + '"' + (k === tab ? ' class="on" aria-current="page"' : "") + ">" + TABS[k] + (n[k] ? " <b>" + n[k] + "</b>" : "") + "</button>";
      }).join("") + "</div>";
  }
  function bindTabs() { OM.$$("[data-tab]").forEach(function (b) { b.onclick = function () { location.href = "?tab=" + b.dataset.tab; }; }); }
  function toHash() {
    var m = /^#o-([0-9a-f-]{36})$/.exec(location.hash), el = m && document.getElementById("o-" + m[1]);
    if (!el) return;
    if (el.tagName === "DETAILS" && !el.open) el.open = true;   // toggle 이벤트가 기록을 불러옴
    el.scrollIntoView({ block: "start" });
  }

  // 함수(rpc) 실행 → 알림 → 화면 다시 그림. ask 가 있으면 먼저 묻습니다
  function act(btn, name, args, ask, done) {
    if (ask && !confirm(ask)) return;
    if (args.p_id) opened[args.p_id] = true;
    return OM.run(btn, async function () {
      OM.unwrap(await sb.rpc(name, args));
      OM.toast(done || "처리했습니다.");
      await show();
    });
  }

  // ───────── 입력 칸 안내 · 오류 ─────────
  // 칸 아래 문장. kind: err | warn | ok | "" (지움). 칸을 감싼 .sp-f 에 빨간 테두리
  function msg(input, text, kind) {
    var box = input.closest(".sp-f") || input.parentNode, m = box.querySelector(".sp-msg");
    box.classList.toggle("sp-invalid", kind === "err");
    if (kind === "err") input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    if (m) { m.textContent = text || ""; m.className = "sp-msg" + (kind ? " " + kind : ""); }
  }
  // 표 안의 칸
  function cellErr(input, text) {
    input.classList.add("sp-invalid"); input.setAttribute("aria-invalid", "true");
    var m = document.createElement("span"); m.className = "sp-cellmsg"; m.textContent = text;
    input.parentNode.appendChild(m);
  }
  function clearCell(input) {
    if (!input || !input.parentNode) return;
    input.classList.remove("sp-invalid"); input.removeAttribute("aria-invalid");
    OM.$$(".sp-cellmsg", input.parentNode).forEach(function (m) { m.remove(); });
  }
  // "1,200,000" · "1200000원" · "120만" · "120만 5000" → { n }. 틀리면 { err }
  function parseWon(v) {
    var s = String(v || "").replace(/[\s,원]/g, ""), m;
    if (!s) return { err: "금액을 입력해 주세요." };
    if ((m = s.match(/^(\d+)만(\d{0,4})$/))) return okWon(+m[1] * 10000 + (m[2] ? +m[2] : 0));
    if (!/^\d+$/.test(s)) return { err: "숫자로 입력해 주세요 (예: 1,200,000 또는 120만)." };
    return okWon(+s);
  }
  function okWon(n) { return n > 2000000000 ? { err: "금액이 너무 큽니다. 자릿수를 확인해 주세요." } : { n: n }; }

  // ───────── 표시 도우미 ─────────
  // 2026-10-14T04:20:00Z → "10.14 13:20" (한국 시간)
  function when(iso) {
    if (!iso) return "-";
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return +p.month + "." + +p.day + " " + p.hour + ":" + p.minute;
  }
  function tel(v) { return v ? '<a href="tel:' + esc(String(v).replace(/[^\d+]/g, "")) + '">' + esc(v) + "</a>" : "-"; }
  function who(o) { var p = o.profiles || {}; return esc(p.name || "(이름 없음)") + (p.org ? " · " + esc(p.org) : ""); }
  function crit() { return S.criteria || { types: {}, services: {} }; }
  function typeOf(o) { return (crit().types || {})[o.sample_type] || null; }
  function samplesOf(o) { return (o.sp_samples || []).filter(function (s) { return s.id; }).sort(function (a, b) { return a.seq - b.seq; }); }
  // sp_samples(*) 는 행 목록, sp_samples(count) 는 [{count: n}]
  function nSamples(o) { var x = o.sp_samples || []; return x.length === 1 && x[0].count != null ? x[0].count : x.length; }
  function kind(o) { return esc(SP.typeName(crit(), o.sample_type)) + " × " + nSamples(o) + "개 · " + esc(SP.serviceName(crit(), o.service)); }
  function manwon(n) { return n % 10000 === 0 ? (n / 10000).toLocaleString("ko-KR") + "만원" : OM.won(n); }
  function payText(o) {
    if (o.pay_method === "credit") return "충전금 차감" + (o.charged ? " · " + OM.won(o.charged) + " 차감함" : "");
    return "건별 청구 (세금계산서)" + (o.invoiced_at ? " · " + OM.date(o.invoiced_at) + " 발행" : o.status !== "submitted" && o.status !== "cancelled" ? " · 발행 대기" : "");
  }
  // sp_events 의 QC · 선택 기록은 영문 코드로 남으므로 이름표로 바꿔 보여 줌
  function evNote(ev) {
    var n = ev.note || "";
    if (ev.kind === "qc") n = n.replace(/ (pending|pass|warn|fail)( · |$)/, function (m, q, tail) { return " " + L.qc[q] + tail; });
    if (ev.kind === "decision") n = n.replace(/ (proceed|reextract|exclude|resend)$/, function (m, d) { return " " + L.decision[d]; });
    return n;
  }

  // 고객이 낸 의뢰 내용 전체
  function orderDl(o, payExtra) {
    var p = o.profiles || {}, t = typeOf(o);
    return '<dl class="om-dl">' +
      "<dt>고객</dt><dd>" + who(o) + " · " + tel(p.phone) + "</dd>" +
      "<dt>시료 · 서비스</dt><dd>" + kind(o) + (t ? ' <small class="om-dim">(' + esc(t.ship) + ")</small>" : "") + "</dd>" +
      "<dt>연구실</dt><dd>" + esc(o.lab_name) + " · 책임자 " + esc(o.pi_name) + "</dd>" +
      "<dt>현장 연락처</dt><dd>" + tel(o.contact_phone) + "</dd>" +
      "<dt>수거</dt><dd>" + esc(SP.dateLabel(o.pickup_date)) + " · " + esc(SP.slotLabel(S.pickup, o.pickup_slot)) + "</dd>" +
      "<dt>주소</dt><dd>" + esc(o.pickup_addr) + " · " + esc(o.pickup_addr2) + "</dd>" +
      "<dt>IRB 번호</dt><dd>" + (o.irb_no ? esc(o.irb_no) : '<span class="om-dim">없음</span>') + "</dd>" +
      "<dt>남은 시료</dt><dd>" + esc(L.leftover[o.leftover] || o.leftover) + "</dd>" +
      (o.quote_amount != null ? '<dt>금액</dt><dd><b class="sp-num">' + OM.won(o.quote_amount) + '</b> <small class="om-dim">부가세 포함</small></dd>' : "") +
      "<dt>결제</dt><dd>" + esc(payText(o)) + (payExtra || "") + "</dd>" +
      (o.pay_method === "invoice" ? "<dt>세금계산서</dt><dd>" + esc(o.biz_name) + (o.biz_no ? " · " + esc(o.biz_no) : "") + " · " + esc(o.invoice_email) + "</dd>" : "") +
      (o.eta ? "<dt>예상 완료</dt><dd>" + esc(SP.dateLabel(o.eta)) + "</dd>" : "") +
      (o.memo ? '<dt>요청 사항</dt><dd class="om-pre" style="margin:0">' + esc(o.memo) + "</dd>" : "") +
      (o.admin_note ? '<dt>확정 · 취소 메모</dt><dd class="om-pre" style="margin:0">' + esc(o.admin_note) + "</dd>" : "") +
      "</dl>";
  }
  // 지금 접수 기준으로 다시 본 시료 문제 (기준을 바꾼 뒤 들어온 의뢰 대비. 규칙은 sp_save_order 와 같음)
  function sampleIssues(o, s) {
    var t = typeOf(o), out = [], a = Number(s.amount);
    if (!t) return out;
    if (a < Number(t.min) || a > Number(t.max)) out.push("양이 기준 " + t.min + "–" + t.max + " " + t.unit + " 밖");
    // 채취 시각을 받지 않으므로 채취일을 하루로 셈: (수거일 − 채취일 + 1) × 24 ≤ 기한 (DB · 의뢰서와 같은 규칙)
    if (t.hours && s.collected_on && o.pickup_date && (SP.daysBetween(s.collected_on, o.pickup_date) + 1) * 24 > Number(t.hours)) out.push("채취 후 " + t.hours + "시간 넘어 수거");
    return out;
  }
  function sampleTable(o, list) {
    var t = typeOf(o) || {}, qc = o.status !== "submitted";
    if (!list.length) return '<p class="om-dim">시료 목록이 없습니다.</p>';
    return '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>라벨</th><th>시료명</th><th>채취일</th><th>양' + (t.unit ? " (" + esc(t.unit) + ")" : "") + "</th>" +
      (qc ? "<th>QC</th><th>고객 선택</th>" : "") + "<th>점검</th></tr></thead><tbody>" +
      list.map(function (s) {
        var bad = sampleIssues(o, s);
        return '<tr><td class="mono">' + esc(s.label) + '</td><td style="white-space:nowrap">' + esc(s.name) + '</td><td class="mono">' + esc(s.collected_on) + '</td><td class="mono">' + esc(s.amount) + "</td>" +
          (qc ? "<td>" + SP.qcChip(s.qc_status) + (s.qc_value ? " " + esc(s.qc_value) : "") + "</td><td>" + (s.decision ? esc(L.decision[s.decision] || s.decision) : "-") + "</td>" : "") +
          "<td>" + (bad.length ? '<span class="sp-msg warn">' + esc(bad.join(" · ")) + "</span>" : '<span class="om-dim">-</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  // 펼칠 때 불러오는 것들: 진행 기록, (전체 의뢰 탭) 시료 목록
  function lazy(root) { OM.$$("[data-log]", root).forEach(loadLog); OM.$$("[data-samples]", root).forEach(loadSamples); }
  function bindDetails() {
    OM.$$("details[data-o]").forEach(function (d) {
      d.addEventListener("toggle", function () { opened[d.dataset.o] = d.open; if (d.open) lazy(d); });
      if (d.open) lazy(d);
    });
  }
  async function loadLog(box) {
    if (box.dataset.done) return;
    box.dataset.done = "1";
    var o = byId[box.dataset.log] || {};
    var r = await sb.from("sp_events").select("*").eq("order_id", box.dataset.log).order("created_at", { ascending: false }).limit(100);
    if (r.error) { box.dataset.done = ""; box.innerHTML = '<p class="om-dim">기록을 불러오지 못했습니다. ' + esc(OM.errMsg(r.error)) + "</p>"; return; }
    box.innerHTML = r.data.length ? '<ul class="sp-log">' + r.data.map(function (ev) {
      var by = !ev.actor ? "" : ev.actor === o.client_id ? "고객" : "운영";
      return "<li><time>" + when(ev.created_at) + "</time><div><b>" + esc(L.event[ev.kind] || ev.kind) + "</b>" + (ev.status ? " · " + esc(L.status[ev.status] || ev.status) : "") +
        (by ? ' <small class="om-dim">' + by + "</small>" : "") + (ev.note ? '<br><span style="white-space:pre-wrap">' + esc(evNote(ev)) + "</span>" : "") + "</div></li>";
    }).join("") + "</ul>" : '<p class="om-dim">기록이 없습니다.</p>';
  }
  async function loadSamples(box) {
    if (box.dataset.done) return;
    box.dataset.done = "1";
    var o = byId[box.dataset.samples] || {};
    var r = await sb.from("sp_samples").select("*").eq("order_id", box.dataset.samples).order("seq");
    if (r.error) { box.dataset.done = ""; box.innerHTML = '<p class="om-dim">시료 목록을 불러오지 못했습니다. ' + esc(OM.errMsg(r.error)) + "</p>"; return; }
    box.innerHTML = sampleTable(o, r.data);
  }

  // ───────── 접수 대기 ─────────
  async function viewNew() {
    var r = await Promise.all([
      sb.from("sp_orders").select("*, profiles(name, org, phone), sp_samples(*)").eq("status", "submitted").order("created_at"),
      sb.rpc("sp_balances"),
      sb.from("sp_topups").select("user_id, amount").eq("status", "requested")
    ]);
    var rows = OM.unwrap(r[0]), bal = {}, tops = {};
    (OM.unwrap(r[1]) || []).forEach(function (b) { bal[b.user_id] = b.balance; });
    OM.unwrap(r[2]).forEach(function (t) { tops[t.user_id] = t.amount; });
    byId = {};
    rows.forEach(function (o) { byId[o.id] = o; o._bal = bal[o.client_id] || 0; o._top = tops[o.client_id] || 0; });
    if (!rows.length) return { html: '<div class="om-card om-empty"><h2>확인할 새 의뢰가 없습니다</h2><p>고객이 의뢰를 내면 여기에 먼저 보입니다.</p></div>' };
    return {
      html: '<p class="om-dim" style="margin:0 0 12px">새 의뢰 ' + rows.length + "건 · 먼저 들어온 순서입니다. 금액을 정해 확정하면 고객 화면에 금액과 진행 단계가 보입니다.</p>" + rows.map(newCard).join(""),
      bind: function () {
        OM.$$("form.sp-confirm").forEach(bindConfirm);
        OM.$$("[data-pay]").forEach(function (b) {
          b.onclick = function () {
            var o = byId[b.dataset.id], to = b.dataset.pay;
            act(b, "sp_set_pay_method", { p_id: o.id, method: to },
              o.order_no + " 결제 방법을 '" + L.pay[to] + "'(으)로 바꿀까요?\n고객이 요청했을 때만 바꿔 주세요. 고객 진행 기록에 남습니다.", "결제 방법을 바꿨습니다.");
          };
        });
      }
    };
  }
  function newCard(o) {
    var credit = o.pay_method === "credit", td = SP.todayKST(), list = samplesOf(o);
    var minEta = o.pickup_date > td ? o.pickup_date : td;
    var issues = list.filter(function (s) { return sampleIssues(o, s).length; }).length, flags = [];
    if (o.pickup_date < td) flags.push('<p class="sp-callout err">수거 희망일(' + esc(SP.dateLabel(o.pickup_date)) + ")이 지났습니다. 고객에게 연락해 의뢰에서 날짜를 고쳐 달라고 하거나, 사유를 적어 반려해 주세요.</p>");
    else if (o.pickup_date === td) flags.push('<p class="sp-callout warn">오늘 수거 · ' + esc(SP.slotLabel(S.pickup, o.pickup_slot)) + ". 먼저 확인해 주세요.</p>");
    else if (o.pickup_date === SP.addDays(td, 1)) flags.push('<p class="sp-callout info">내일 수거 · ' + esc(SP.slotLabel(S.pickup, o.pickup_slot)) + "</p>");
    if (!typeOf(o)) flags.push('<p class="sp-callout warn">설정에 없는 시료 종류(' + esc(o.sample_type) + ")입니다. 설정에서 지운 종류일 수 있습니다.</p>");
    if (issues) flags.push('<p class="sp-callout warn">지금 접수 기준과 맞지 않는 시료가 ' + issues + "개 있습니다. 아래 표의 점검 칸을 확인해 주세요.</p>");
    // 결제 칸: 충전금 잔액 · 대기 중인 충전 신청 · 결제 방법 바꾸기 (고객 요청 시)
    var payExtra = credit ? ' · 잔액 <b class="sp-num">' + OM.won(o._bal) + "</b>" + (o._top ? ' <small class="om-dim">(충전 신청 ' + OM.won(o._top) + " 입금 확인 대기 · 충전금 탭)</small>" : "") : "";
    var canInvoice = String(o.biz_name || "").trim().length >= 2 && SP.V.email(o.invoice_email);
    if (!credit || canInvoice) payExtra += ' <button type="button" class="btn ghost sm" data-pay="' + (credit ? "invoice" : "credit") + '" data-id="' + esc(o.id) + '">' + (credit ? "건별 청구로 바꾸기" : "충전금 차감으로 바꾸기") + "</button>";
    var edited = o.updated_at && new Date(o.updated_at) - new Date(o.created_at) > 60000 ? " · " + when(o.updated_at) + " 마지막 수정" : "";
    return '<div class="om-card" id="o-' + esc(o.id) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px 16px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0">' + esc(o.order_no) + " " + SP.chip(o.status) + "</h2>" +
      '<span class="om-dim">' + when(o.created_at) + " 접수" + edited + "</span></div>" +
      (flags.length ? '<div style="display:grid;gap:8px;margin-bottom:16px">' + flags.join("") + "</div>" : "") +
      orderDl(o, payExtra) +
      '<h3 style="margin:22px 0 8px">시료 ' + list.length + "개</h3>" + sampleTable(o, list) +
      confirmForm(o, minEta) + "</div>";
  }
  function confirmForm(o, minEta) {
    var id = esc(o.id), fromPickup = minEta === o.pickup_date;
    return '<form class="om-form sp-confirm" data-id="' + id + '" novalidate style="margin-top:22px;padding-top:20px;border-top:1px solid var(--line)">' +
      '<h3 style="margin:0">접수 확정</h3><div class="om-grid2" style="align-items:start">' +
      '<label class="sp-f">금액 (원, 부가세 포함) <small>이 고객 화면에만 보입니다. 120만처럼 써도 됩니다.</small><input type="text" name="amount" inputmode="numeric" autocomplete="off" placeholder="예: 1,200,000"><span class="sp-msg"></span></label>' +
      '<div class="om-field sp-f"><label>예상 완료일 <small>선택. ' + (fromPickup ? "수거일" : "오늘") + ' 이후 날짜로 고릅니다. 진행 중 탭에서 바꿀 수 있습니다.</small>' +
      '<input type="date" name="eta" min="' + esc(minEta) + '"></label>' +
      '<small>' + (fromPickup ? "수거일" : "오늘") + "부터 " + [7, 14, 21, 28].map(function (d) { return '<button type="button" class="om-link" data-eta="' + d + '">+' + d + "일</button>"; }).join(" · ") + "</small>" +
      '<span class="sp-msg"></span></div></div>' +
      '<label class="sp-f">고객 안내 메모 <small>선택. 확정 · 반려와 함께 고객 진행 기록에 보입니다. 반려할 때는 사유를 꼭 적어 주세요.</small><textarea name="note" rows="2" maxlength="500" style="min-height:64px"></textarea><span class="sp-msg"></span></label>' +
      '<div class="om-actions"><button class="btn primary" type="submit">접수 확정</button><button class="btn danger" type="button" data-reject>반려</button></div></form>';
  }
  function bindConfirm(f) {
    var o = byId[f.dataset.id], credit = o.pay_method === "credit", amt = f.elements.amount, eta = f.elements.eta, nt = f.elements.note, base = eta.min;
    // 금액: 입력하는 동안 공급가액 · 부가세 · 차감 후 잔액을 보여 줌
    function checkAmount(final) {
      var v = parseWon(amt.value);
      if (v.err) { msg(amt, final || amt.value.trim() ? v.err : "", final || amt.value.trim() ? "err" : ""); return null; }
      if (credit && v.n > o._bal) { msg(amt, "충전금 잔액(" + OM.won(o._bal) + ")이 " + OM.won(v.n - o._bal) + " 모자랍니다. 충전 입금을 먼저 확인하거나, 고객과 이야기해 건별 청구로 바꿔 주세요.", "err"); return null; }
      if (v.n === 0) { msg(amt, "0원이면 무상으로 진행합니다. 맞는지 확인해 주세요.", "warn"); return 0; }
      var s = OM.vatSplit(v.n);
      msg(amt, OM.won(v.n) + " · 공급가액 " + OM.won(s.supply) + " + 부가세 " + OM.won(s.vat) + (credit ? " · 차감 후 잔액 " + OM.won(o._bal - v.n) : ""), "ok");
      return v.n;
    }
    function checkEta() {
      if (!eta.value) { msg(eta, "", ""); return true; }
      if (eta.value < base) { msg(eta, "예상 완료일은 " + SP.dateLabel(base) + " 이후로 골라 주세요.", "err"); return false; }
      msg(eta, SP.dateLabel(eta.value), "ok"); return true;
    }
    amt.addEventListener("input", function () { checkAmount(false); });
    amt.addEventListener("blur", function () { var v = parseWon(amt.value); if (!v.err) amt.value = v.n.toLocaleString("ko-KR"); });
    eta.addEventListener("change", checkEta);
    OM.$$("[data-eta]", f).forEach(function (b) { b.onclick = function () { eta.value = SP.addDays(base, +b.dataset.eta); checkEta(); }; });
    nt.addEventListener("input", function () { if (nt.value.trim()) msg(nt, "", ""); });
    f.onsubmit = function (e) {
      e.preventDefault();
      var n = checkAmount(true), okEta = checkEta();
      if (n == null) { amt.focus(); return; }
      if (!okEta) { eta.focus(); return; }
      var ask = o.order_no + " 접수를 확정할까요?\n\n금액 " + OM.won(n) + " (부가세 포함)" + (eta.value ? "\n예상 완료 " + SP.dateLabel(eta.value) : "") +
        (credit ? "\n충전금에서 바로 " + OM.won(n) + "을 차감합니다." : "\n건별 청구: 세금계산서는 발행 뒤 진행 중 탭에서 발행 완료로 표시합니다.") +
        "\n\n확정하면 고객 화면에 금액과 진행 단계가 보입니다.";
      // p_seen: 이 화면이 불러온 의뢰의 수정 시각. 그 사이 고객이 의뢰를 고쳤으면 DB 가 확정하지 않고 새로고침하라고 알려 줌
      act(f.querySelector("[type=submit]"), "sp_confirm_order", { p_id: o.id, amount: n, p_eta: eta.value || null, note: nt.value.trim(), p_seen: o.updated_at }, ask, o.order_no + " 접수를 확정했습니다.");
    };
    f.querySelector("[data-reject]").onclick = function () {
      if (nt.value.trim().length < 2) { msg(nt, "반려 사유를 적어 주세요. 고객 화면에 그대로 보입니다.", "err"); nt.focus(); return; }
      act(this, "sp_cancel_order", { p_id: o.id, note: nt.value.trim() }, o.order_no + " 의뢰를 반려할까요?\n의뢰가 취소되고, 적은 사유가 고객 화면에 보입니다.", o.order_no + " 의뢰를 반려했습니다.");
    };
  }

  // ───────── 진행 중 ─────────
  async function viewProgress() {
    var r = await Promise.all([
      sb.from("sp_orders").select("*, profiles(name, org, phone), sp_samples(*)").in("status", SP.TRACK).order("eta", { ascending: true, nullsFirst: false }).order("created_at"),
      // 완료됐지만 세금계산서 발행 표시가 아직인 건별 청구 (진행 중 목록에서 빠지므로 따로 보여 줌)
      sb.from("sp_orders").select("*, profiles(name, org, phone)").eq("status", "completed").eq("pay_method", "invoice").is("invoiced_at", null).order("completed_at")
    ]);
    var rows = OM.unwrap(r[0]), late = OM.unwrap(r[1]), td = SP.todayKST(), stepN = {}, todoN = 0, ex = STEPS.indexOf("extraction");
    byId = {};
    late.forEach(function (o) { byId[o.id] = o; });
    rows.forEach(function (o) {
      var list = samplesOf(o), upd = new Date(o.updated_at);
      byId[o.id] = o; o._list = list;
      o._wait = list.filter(function (s) { return (s.qc_status === "warn" || s.qc_status === "fail") && !s.decision; }).length;
      // 운영자가 의뢰를 마지막으로 바꾼 뒤에 고객이 고른 것 = 새 고객 선택
      o._dec = list.filter(function (s) { return s.decision && s.decided_at && new Date(s.decided_at) > upd; }).length;
      o._noqc = STEPS.indexOf(o.status) >= ex ? list.filter(function (s) { return s.qc_status === "pending"; }).length : 0;
      o._inv = o.pay_method === "invoice" && !o.invoiced_at;
      o._late = !!o.eta && o.eta < td;
      o._todo = !!(o._dec || o._noqc || o._inv || o._late);
      stepN[o.status] = (stepN[o.status] || 0) + 1;
      if (o._todo) todoN++;
    });
    var lateCard = late.length ? '<div class="om-card"><h2>완료 · 세금계산서 발행 대기 ' + late.length + "건</h2>" +
      '<p class="om-dim" style="margin:0 0 10px">홈택스에서 발행한 뒤 "발행 완료"를 눌러 주세요. 금액은 부가세 포함 총액입니다.</p><ul class="om-list">' + late.map(function (o) {
        var v = OM.vatSplit(o.quote_amount || 0);
        return '<li><div class="row"><b>' + esc(o.order_no) + " " + SP.chip(o.status) + "</b><small>" + who(o) + " · " + esc(o.biz_name) + (o.biz_no ? " · " + esc(o.biz_no) : "") + " · " + esc(o.invoice_email) +
          " · 공급가액 " + OM.won(v.supply) + " + 부가세 " + OM.won(v.vat) + '</small><div class="r"><span class="sp-num">' + OM.won(o.quote_amount) + '</span><button type="button" class="btn primary sm" data-invoiced="' + esc(o.id) + '">발행 완료</button></div></div></li>';
      }).join("") + "</ul></div>" : "";
    if (!rows.length) return { html: lateCard + '<div class="om-card om-empty"><h2>진행 중인 의뢰가 없습니다</h2><p>접수 대기 탭에서 의뢰를 확정하면 여기로 옮겨집니다.</p></div>', bind: bindInvoiced };
    function li(o) {
      var chips = [];
      if (o._late) chips.push('<span class="om-chip sp-qc-fail">예상일 지남</span>');
      if (o._inv) chips.push('<span class="om-chip sp-qc-warn">세금계산서 발행</span>');
      if (o._noqc) chips.push('<span class="om-chip sp-qc-warn">QC 미입력 ' + o._noqc + "</span>");
      if (o._dec) chips.push('<span class="om-chip sp-qc-warn">새 고객 선택 ' + o._dec + "</span>");
      if (o._wait) chips.push('<span class="om-chip">고객 선택 대기 ' + o._wait + "</span>");
      return '<li data-st="' + esc(o.status) + '"' + (o._todo ? ' data-todo="1"' : "") + '><details id="o-' + esc(o.id) + '" data-o="' + esc(o.id) + '"' + (opened[o.id] ? " open" : "") + ">" +
        '<summary class="row" style="cursor:pointer"><b>' + esc(o.order_no) + " " + SP.chip(o.status) + "</b><small>" + who(o) + " · " + kind(o) + "</small>" +
        (chips.length ? '<span style="grid-column:1;display:flex;gap:4px;flex-wrap:wrap">' + chips.join("") + "</span>" : "") +
        '<span class="r"><span>' + (o.eta ? "예상 완료<br>" + esc(SP.dateLabel(o.eta)) : "예상 완료일<br>미정") + "</span></span></summary>" +
        '<div style="padding:4px 4px 26px;display:grid;grid-template-columns:minmax(0,1fr);gap:22px">' + progBody(o) + "</div></details></li>";
    }
    var opts = '<option value="">전체 ' + rows.length + "건</option><option value=\"todo\">처리할 일 있음 " + todoN + "건</option>" +
      SP.TRACK.map(function (s) { return stepN[s] ? '<option value="' + s + '">' + esc(L.status[s]) + " " + stepN[s] + "건</option>" : ""; }).join("");
    return {
      html: lateCard + '<div class="om-card"><div style="display:flex;gap:10px 16px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><h2 style="margin:0">진행 중 ' + rows.length + "건</h2>" +
        '<label class="om-dim" style="display:flex;gap:8px;align-items:center">보기 <select id="pf" style="' + CTL + '">' + opts + "</select></label></div>" +
        '<p class="om-dim" style="margin:0 0 12px">예상 완료일이 가까운 순서입니다. 처리할 일: 예상 완료일 지남 · 세금계산서 발행 · QC 미입력 · 새 고객 선택.</p>' +
        '<ul class="om-list">' + rows.map(li).join("") + "</ul></div>",
      bind: function () {
        var sel = OM.$("#pf");
        if (!OM.$$("option", sel).some(function (x) { return x.value === pf; })) pf = "";
        sel.value = pf;
        sel.onchange = function () { pf = sel.value; filterProg(); };
        filterProg();
        bindDetails();
        OM.$$("form.sp-status").forEach(bindStatus);
        OM.$$("table[data-qc]").forEach(bindQc);
        OM.$$("form.sp-note").forEach(bindNote);
        OM.$$("form.sp-cancel").forEach(bindCancel);
        bindInvoiced();
      }
    };
  }
  function filterProg() {
    OM.$$("li[data-st]").forEach(function (li) { li.hidden = !!pf && (pf === "todo" ? !li.dataset.todo : li.dataset.st !== pf); });
  }
  function bindInvoiced() {
    OM.$$("[data-invoiced]").forEach(function (b) {
      b.onclick = function () {
        var o = byId[b.dataset.invoiced];
        act(b, "sp_mark_invoiced", { p_id: o.id }, o.order_no + " 세금계산서를 홈택스에서 발행했나요?\n고객 화면에 발행 완료로 표시됩니다.", "발행 완료로 표시했습니다.");
      };
    });
  }
  function progBody(o) {
    var id = esc(o.id), ci = STEPS.indexOf(o.status);
    var opts = STEPS.map(function (s, k) {
      return '<option value="' + s + '"' + (k === Math.min(ci + 1, STEPS.length - 1) ? " selected" : "") + ">" + esc(L.status[s]) + (k === ci ? " (지금)" : k < ci ? " (되돌리기)" : "") + "</option>";
    }).join("");
    var stat = '<form class="om-form sp-status" data-id="' + id + '" novalidate><h3 style="margin:0">단계 · 예상 완료일</h3><div class="om-grid2" style="align-items:start">' +
      '<label class="sp-f">단계 <small>고객 화면의 진행 막대가 바로 바뀝니다.</small><select name="status">' + opts + '</select><span class="sp-msg"></span></label>' +
      '<label class="sp-f">예상 완료일 <small>바뀔 때만 고칩니다.</small><input type="date" name="eta" value="' + esc(o.eta || "") + '"><span class="sp-msg"></span></label></div>' +
      '<label class="sp-f">고객 안내 <small>선택. 진행 기록에 단계와 함께 보입니다. 예: 오늘 오후 수거 완료, 도착 온도 정상</small><input type="text" name="note" maxlength="300"><span class="sp-msg"></span></label>' +
      '<div class="om-actions"><button class="btn primary" type="submit">저장</button></div></form>';
    var qc = "<div><h3 style=\"margin:0 0 8px\">QC 결과</h3>" +
      (o._dec ? '<p class="sp-callout warn" style="margin-bottom:8px">고객이 새로 진행 방법을 고른 시료가 ' + o._dec + "개 있습니다. 표의 고객 선택 칸을 확인해 주세요.</p>" : "") +
      (o._wait ? '<p class="sp-callout info" style="margin-bottom:8px">고객이 진행 방법을 고르기를 기다리는 시료가 ' + o._wait + "개 있습니다.</p>" : "") +
      qcTable(o) +
      (o._list.length ? '<div class="om-actions" style="margin-top:10px"><button type="button" class="btn primary sm" data-qcsave="' + id + '" disabled>QC 저장</button>' +
        '<button type="button" class="btn ghost sm" data-qcpass="' + id + '">측정 전 시료를 모두 통과로</button>' +
        '<small class="om-dim">확인 필요 · 기준 미달이면 고객이 진행 방법을 고릅니다. QC 결과를 바꿔 저장하면 고객이 고른 것이 지워집니다. 측정값 · 메모만 고치면 그대로입니다.</small></div>' : "") + "</div>";
    var inv = "";
    if (o.pay_method === "invoice") {
      var v = OM.vatSplit(o.quote_amount || 0);
      inv = '<div><h3 style="margin:0 0 8px">세금계산서</h3>' + (o.invoiced_at ? '<p class="om-dim" style="margin:0">' + OM.date(o.invoiced_at) + " 발행 완료로 표시했습니다.</p>" :
        '<p class="sp-callout warn">발행 대기 · 홈택스에서 발행한 뒤 "발행 완료"를 눌러 주세요. 고객 화면에 발행 완료로 보입니다.</p>' +
        '<dl class="om-dl" style="margin-top:10px"><dt>상호</dt><dd>' + esc(o.biz_name) + "</dd><dt>사업자번호</dt><dd>" + (o.biz_no ? esc(o.biz_no) : '<span class="om-dim">없음</span>') + "</dd>" +
        "<dt>받는 메일</dt><dd>" + esc(o.invoice_email) + "</dd><dt>금액</dt><dd>공급가액 " + OM.won(v.supply) + " · 부가세 " + OM.won(v.vat) + " · 합계 " + OM.won(v.total) + "</dd></dl>" +
        '<div class="om-actions" style="margin-top:10px"><button type="button" class="btn primary sm" data-invoiced="' + id + '">발행 완료</button></div>') + "</div>";
    }
    var noteF = '<form class="om-form sp-note" data-id="' + id + '" novalidate><label class="sp-f">고객에게 안내 남기기 <small>단계는 그대로 두고 진행 기록에만 남깁니다. 예: 시퀀싱 일정이 하루 늦어집니다.</small>' +
      '<textarea name="note" rows="2" maxlength="500" style="min-height:64px"></textarea><span class="sp-msg"></span></label><div class="om-actions"><button class="btn ghost sm" type="submit">안내 남기기</button></div></form>';
    var cancel = '<details><summary class="om-dim" style="cursor:pointer">의뢰 취소</summary><form class="om-form sp-cancel" data-id="' + id + '" novalidate style="margin-top:12px">' +
      '<label class="sp-f">취소 사유 <small>고객 화면에 보입니다.</small><input type="text" name="note" maxlength="300"><span class="sp-msg"></span></label>' +
      '<div class="om-actions"><button class="btn danger sm" type="submit">이 의뢰 취소</button>' + (o.charged > 0 ? '<small class="om-dim">충전금에서 차감한 ' + OM.won(o.charged) + "은 자동으로 돌려줍니다.</small>" : "") + "</div></form></details>";
    return SP.track(o.status) + stat + qc + inv +
      '<div><h3 style="margin:0 0 8px">의뢰 정보</h3>' + orderDl(o) + "</div>" + noteF +
      '<div><h3 style="margin:0 0 8px">진행 기록</h3><div data-log="' + id + '"><p class="om-dim">불러오는 중…</p></div></div>' + cancel;
  }
  function qcTable(o) {
    var t = typeOf(o) || {};
    if (!o._list.length) return '<p class="om-dim">시료 목록이 없습니다.</p>';
    return '<div class="sp-table-wrap"><table class="sp-table" data-qc="' + esc(o.id) + '"><thead><tr><th>라벨</th><th>시료명</th><th>양' + (t.unit ? " (" + esc(t.unit) + ")" : "") +
      "</th><th>QC</th><th>측정값</th><th>메모 (고객에게 보임)</th><th>고객 선택</th></tr></thead><tbody>" +
      o._list.map(function (s) {
        return '<tr data-s="' + esc(s.id) + '" data-q="' + esc(s.qc_status) + '" data-v="' + esc(s.qc_value || "") + '" data-n="' + esc(s.qc_note || "") + '">' +
          '<td class="mono">' + esc(s.label) + '</td><td style="white-space:nowrap">' + esc(s.name) + '</td><td class="mono">' + esc(s.amount) + "</td>" +
          '<td><select name="q" aria-label="' + esc(s.label) + ' QC" style="' + CTL + '">' + Object.keys(L.qc).map(function (q) { return '<option value="' + q + '"' + (q === s.qc_status ? " selected" : "") + ">" + esc(L.qc[q]) + "</option>"; }).join("") + "</select></td>" +
          '<td><input type="text" name="v" maxlength="60" placeholder="예: RIN 7.2" aria-label="' + esc(s.label) + ' 측정값" value="' + esc(s.qc_value || "") + '"></td>' +
          '<td><input type="text" name="n" maxlength="200" aria-label="' + esc(s.label) + ' 메모" value="' + esc(s.qc_note || "") + '" style="min-width:160px"></td>' +
          "<td>" + (s.decision ? "<b>" + esc(L.decision[s.decision] || s.decision) + '</b><br><small class="om-dim">' + when(s.decided_at) + "</small>"
            : s.qc_status === "warn" || s.qc_status === "fail" ? '<span class="om-dim" style="white-space:nowrap">기다리는 중</span>' : '<span class="om-dim">-</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function bindStatus(f) {
    var o = byId[f.dataset.id], sel = f.elements.status, eta = f.elements.eta, nt = f.elements.note;
    eta.addEventListener("change", function () { msg(eta, "", ""); });
    sel.addEventListener("change", function () { msg(sel, "", ""); });
    f.onsubmit = function (e) {
      e.preventDefault();
      var st = sel.value, ci = STEPS.indexOf(o.status), ni = STEPS.indexOf(st), td = SP.todayKST(), etaNew = eta.value !== (o.eta || ""), note = nt.value.trim(), btn = f.querySelector("[type=submit]");
      if (etaNew && !eta.value) { msg(eta, "예상 완료일은 지울 수 없습니다. 새 날짜를 골라 주세요.", "err"); eta.focus(); return; }
      if (etaNew && eta.value < td) { msg(eta, "예상 완료일은 오늘(" + SP.dateLabel(td) + ") 이후로 골라 주세요.", "err"); eta.focus(); return; }
      if (st === o.status && !etaNew) {
        if (!note) { msg(sel, "바뀐 내용이 없습니다. 다음 단계를 고르거나 예상 완료일을 바꿔 주세요.", "err"); sel.focus(); return; }
        return act(btn, "sp_add_note", { p_id: o.id, note: note }, null, "안내를 남겼습니다.");
      }
      var ask = null;
      if (ni < ci) ask = "'" + L.status[o.status] + "'에서 '" + L.status[st] + "'(으)로 되돌릴까요?\n고객 화면의 진행 막대도 함께 바뀝니다.";
      if (st === "completed") ask = o.order_no + " 의뢰를 완료로 바꿀까요?\n진행 중 목록에서 빠지고 고객 화면에 완료로 보입니다." +
        (o._wait ? "\n\n고객 선택을 기다리는 시료가 " + o._wait + "개 있습니다." : "") + (o._inv ? "\n세금계산서는 발행 완료 표시가 아직입니다. 완료 뒤에도 이 탭 위쪽에서 표시할 수 있습니다." : "");
      act(btn, "sp_set_status", { p_id: o.id, new_status: st, note: note, p_eta: etaNew ? eta.value : null }, ask,
        st === o.status ? "예상 완료일을 바꿨습니다." : "'" + L.status[st] + "' 단계로 바꿨습니다.");
    };
  }
  // QC 표: 바뀐 행만 모아서 저장 (sp_record_qc 를 행마다 부름)
  function bindQc(tb) {
    var id = tb.dataset.qc, save = OM.$('[data-qcsave="' + id + '"]'), pass = OM.$('[data-qcpass="' + id + '"]');
    function rows() { return OM.$$("tr[data-s]", tb); }
    function val(tr) { return { q: tr.querySelector("[name=q]").value, v: tr.querySelector("[name=v]").value.trim(), n: tr.querySelector("[name=n]").value.trim() }; }
    function changed(tr) { var x = val(tr); return x.q !== tr.dataset.q || x.v !== tr.dataset.v || x.n !== tr.dataset.n; }
    function refresh() {
      var n = 0;
      rows().forEach(function (tr) { var c = changed(tr); tr.style.background = c ? "color-mix(in oklab,var(--teal) 7%,transparent)" : ""; if (c) n++; });
      save.disabled = !n; save.textContent = n ? "바뀐 " + n + "개 저장" : "QC 저장";
    }
    tb.addEventListener("input", function (e) { clearCell(e.target); refresh(); });
    tb.addEventListener("change", function (e) { clearCell(e.target.closest("tr").querySelector("[name=v]")); refresh(); });
    pass.onclick = function () { rows().forEach(function (tr) { var s = tr.querySelector("[name=q]"); if (s.value === "pending") s.value = "pass"; }); refresh(); };
    save.onclick = async function () {
      var list = rows().filter(changed), bad = null;
      list.forEach(function (tr) {
        var x = val(tr), inp = tr.querySelector("[name=v]");
        clearCell(inp);
        if ((x.q === "warn" || x.q === "fail") && !x.v && !x.n) { cellErr(inp, "고객이 판단할 수 있게 측정값이나 메모를 적어 주세요."); bad = bad || inp; }
      });
      if (!list.length) return;
      if (bad) { bad.focus(); OM.toast("빨간 칸을 채워 주세요.", true); return; }
      opened[id] = true;
      await OM.run(save, async function () {
        // 고객 선택은 QC 결과(상태)가 바뀌는 시료에서만 지워짐 (값 · 메모만 고치면 그대로).
        // 화면을 연 뒤에 고객이 고른 것도 세도록, 저장 직전에 그 시료들의 지금 선택을 다시 읽음
        var ids = list.filter(function (tr) { return val(tr).q !== tr.dataset.q; }).map(function (tr) { return tr.dataset.s; });
        if (ids.length) {
          var reset = OM.unwrap(await sb.from("sp_samples").select("id,decision").in("id", ids)).filter(function (s) { return s.decision; }).length;
          if (reset > 0 && !confirm("고객이 고른 진행 방법 " + reset + "개가 지워지고, 확인 필요 · 기준 미달이면 고객이 다시 고르게 됩니다. 저장할까요?")) return;
        }
        var n = 0;
        try {
          for (var i = 0; i < list.length; i++) {
            var tr = list[i], x = val(tr), res = await sb.rpc("sp_record_qc", { p_sample: tr.dataset.s, p_status: x.q, p_value: x.v, p_note: x.n });
            if (res.error) throw new Error(tr.querySelector("td").textContent + ": " + OM.errMsg(res.error));
            n++;
          }
        } finally {
          if (n) { OM.toast("QC 결과 " + n + "개를 저장했습니다."); await show(); }
        }
      });
    };
    refresh();
  }
  function bindNote(f) {
    var o = byId[f.dataset.id], nt = f.elements.note;
    nt.addEventListener("input", function () { msg(nt, "", ""); });
    f.onsubmit = function (e) {
      e.preventDefault();
      if (nt.value.trim().length < 2) { msg(nt, "고객에게 남길 안내를 적어 주세요.", "err"); nt.focus(); return; }
      act(f.querySelector("[type=submit]"), "sp_add_note", { p_id: o.id, note: nt.value.trim() }, null, "안내를 남겼습니다. 고객 진행 기록에 보입니다.");
    };
  }
  function bindCancel(f) {
    var o = byId[f.dataset.id], nt = f.elements.note;
    nt.addEventListener("input", function () { msg(nt, "", ""); });
    f.onsubmit = function (e) {
      e.preventDefault();
      if (nt.value.trim().length < 2) { msg(nt, "취소 사유를 적어 주세요. 고객 화면에 보입니다.", "err"); nt.focus(); return; }
      act(f.querySelector("[type=submit]"), "sp_cancel_order", { p_id: o.id, note: nt.value.trim() },
        o.order_no + " 의뢰를 취소할까요? 되돌릴 수 없습니다." + (o.charged > 0 ? "\n충전금에서 차감한 " + OM.won(o.charged) + "은 고객에게 돌려줍니다." : ""), o.order_no + " 의뢰를 취소했습니다.");
    };
  }

  // ───────── 충전금 ─────────
  async function viewCredit() {
    var r = await Promise.all([
      sb.from("sp_topups").select("*, profiles(name, org, phone)").eq("status", "requested").order("created_at"),
      sb.from("sp_topups").select("*, profiles(name, org)").neq("status", "requested").order("created_at", { ascending: false }).limit(20),
      sb.rpc("sp_balances"),
      sb.from("profiles").select("id, name, org, phone").order("name").limit(2000)
    ]);
    var pend = OM.unwrap(r[0]), past = OM.unwrap(r[1]), bals = OM.unwrap(r[2]) || [], people = OM.unwrap(r[3]);
    var balOf = {}, tops = {}, total = 0, rate = Number((S.credit || {}).bonus_rate) || 0;
    bals.forEach(function (b) { balOf[b.user_id] = b.balance; total += b.balance || 0; });
    pend.forEach(function (t) { tops[t.id] = t; });
    function nm(p) { p = p || {}; return esc(p.name || "(이름 없음)") + (p.org ? " · " + esc(p.org) : ""); }
    function doc(t) { return t.doc_type === "tax_invoice" ? "세금계산서: " + esc(t.biz_name) + (t.biz_no ? " · " + esc(t.biz_no) : "") + " · " + esc(t.invoice_email) : "증빙 필요 없음"; }
    var pendHtml = pend.length ? '<ul class="om-list">' + pend.map(function (t) {
      return '<li><div class="row"><b>' + nm(t.profiles) + ' · <span class="sp-num">' + OM.won(t.amount) + "</span></b>" +
        "<small>" + when(t.created_at) + " 신청 · " + doc(t) + (t.memo ? " · 메모: " + esc(t.memo) : "") + " · 지금 잔액 " + OM.won(balOf[t.user_id] || 0) +
        (rate > 0 ? " · 보너스 " + OM.won(Math.round(t.amount * rate)) + " 함께 적립" : "") + (t.profiles && t.profiles.phone ? " · " + tel(t.profiles.phone) : "") + "</small>" +
        '<div class="r"><button type="button" class="btn primary sm" data-paid="' + esc(t.id) + '">입금 확인</button><button type="button" class="btn ghost sm" data-tcancel="' + esc(t.id) + '">신청 취소</button></div></div></li>';
    }).join("") + "</ul>" : '<p class="om-dim">입금 확인을 기다리는 충전 신청이 없습니다.</p>';
    var pastHtml = past.length ? '<ul class="om-list">' + past.map(function (t) {
      return '<li><div class="row"><b>' + nm(t.profiles) + ' · <span class="sp-num">' + OM.won(t.amount) + '</span> <span class="om-chip ' + (t.status === "paid" ? "sp-qc-pass" : "sp-s-cancelled") + '">' + esc(L.topup[t.status] || t.status) + "</span></b>" +
        "<small>" + when(t.created_at) + " 신청" + (t.paid_at ? " · " + when(t.paid_at) + " 입금 확인" : "") + " · " + doc(t) + "</small></div></li>";
    }).join("") + "</ul>" : '<p class="om-dim">없음</p>';
    var balHtml = bals.length ? '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>회원</th><th>소속</th><th style="text-align:right">잔액</th><th>마지막 변동</th><th></th></tr></thead><tbody>' +
      bals.map(function (b) {
        var u = esc(b.user_id);
        return "<tr><td>" + esc(b.name || "(이름 없음)") + "</td><td>" + esc(b.org || "") + '</td><td class="sp-num" style="text-align:right;white-space:nowrap">' + OM.won(b.balance) + '</td><td class="mono">' + OM.date(b.last_at) + "</td>" +
          '<td style="white-space:nowrap;text-align:right"><button type="button" class="btn ghost sm" data-ledger="' + u + '" aria-expanded="false">장부</button> <button type="button" class="btn ghost sm" data-adj="' + u + '">조정</button></td></tr>' +
          '<tr data-lrow="' + u + '" hidden><td colspan="5"><div data-lbox="' + u + '"></div></td></tr>';
      }).join("") + "</tbody></table></div>" : '<p class="om-dim">아직 충전금이 있는 회원이 없습니다.</p>';
    var opt = function (q) {
      q = (q || "").trim().toLowerCase();
      var list = people.filter(function (p) { return !q || [p.name, p.org, p.phone].join(" ").toLowerCase().indexOf(q) >= 0; });
      return '<option value="">' + (list.length ? "회원을 고르세요 (" + list.length + "명)" : "찾는 회원이 없습니다") + "</option>" + list.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name || "(이름 없음)") + (p.org ? " · " + esc(p.org) : "") + (p.phone ? " · " + esc(String(p.phone).slice(-4)) : "") + " · 잔액 " + OM.won(balOf[p.id] || 0) + "</option>";
      }).join("");
    };
    return {
      html: '<div class="om-card"><h2>충전 신청 · 입금 확인 대기 ' + pend.length + "건</h2>" +
        '<p class="om-dim" style="margin:0 0 10px">통장에 입금된 것을 확인한 뒤 "입금 확인"을 누르면 충전금이 바로 적립됩니다' + (rate > 0 ? " (보너스 " + Math.round(rate * 1000) / 10 + "% 함께)" : "") + ". 세금계산서는 홈택스에서 따로 발행합니다.</p>" + pendHtml + "</div>" +
        '<div class="om-card"><h2>회원별 잔액</h2><p class="om-dim" style="margin:0 0 10px">고객 충전금 합계 <b class="sp-num">' + OM.won(total) + "</b> · 장부에 기록이 있는 회원만 보입니다.</p>" + balHtml + "</div>" +
        '<div class="om-card" id="adj"><h2>충전금 직접 조정</h2><p class="om-dim" style="margin:0 0 14px">오입금 정정이나 보상 적립처럼 충전 신청 없이 잔액을 바꿀 때 씁니다. 사유는 고객 장부에 그대로 보입니다.</p>' +
        '<form class="om-form" id="f-adj" novalidate><div class="om-grid2" style="align-items:start">' +
        '<div class="om-field sp-f"><label for="adj-user">회원 <small>이름 · 소속 · 휴대폰 끝 4자리로 찾을 수 있습니다.</small></label>' +
        '<input type="text" id="adj-q" placeholder="찾기: 이름 또는 소속" autocomplete="off" aria-label="회원 찾기"><select name="user" id="adj-user">' + opt("") + '</select><span class="sp-msg"></span></div>' +
        '<div class="om-field">방향<div class="om-checks"><label><input type="radio" name="dir" value="1" checked> 적립 (+)</label><label><input type="radio" name="dir" value="-1"> 차감 (−)</label></div></div></div>' +
        '<div class="om-grid2" style="align-items:start"><label class="sp-f">금액 (원)<input type="text" name="amount" inputmode="numeric" autocomplete="off" placeholder="예: 100,000"><span class="sp-msg"></span></label>' +
        '<label class="sp-f">사유 <small>고객 장부에 보입니다. 예: 10월 14일 오입금 정정</small><input type="text" name="note" maxlength="200"><span class="sp-msg"></span></label></div>' +
        '<div class="om-actions"><button class="btn primary" type="submit">조정하기</button></div></form></div>' +
        '<div class="om-card"><h2>최근 처리한 충전 신청</h2>' + pastHtml + "</div>",
      bind: function () {
        OM.$$("[data-paid]").forEach(function (b) {
          b.onclick = function () {
            var t = tops[b.dataset.paid], p = t.profiles || {};
            act(b, "sp_confirm_topup", { p_id: t.id }, (p.name || "") + (p.org ? " · " + p.org : "") + " 님의 충전 신청 " + OM.won(t.amount) + "이 통장에 들어온 것을 확인했나요?\n확인하면 충전금이 바로 적립되고 고객 화면에 보입니다." +
              (rate > 0 ? "\n보너스 " + OM.won(Math.round(t.amount * rate)) + "도 함께 적립됩니다." : ""),
              "충전했습니다." + (t.doc_type === "tax_invoice" ? " 세금계산서는 홈택스에서 발행해 주세요." : ""));
          };
        });
        OM.$$("[data-tcancel]").forEach(function (b) {
          b.onclick = function () { var t = tops[b.dataset.tcancel]; act(b, "sp_cancel_topup", { p_id: t.id }, OM.won(t.amount) + " 충전 신청을 취소할까요? 고객 화면에 취소로 보입니다.", "충전 신청을 취소했습니다."); };
        });
        OM.$$("[data-ledger]").forEach(function (b) {
          b.onclick = function () {
            var u = b.dataset.ledger, row = OM.$('[data-lrow="' + u + '"]'), box = OM.$('[data-lbox="' + u + '"]');
            row.hidden = !row.hidden; b.setAttribute("aria-expanded", String(!row.hidden));
            if (!row.hidden && !box.dataset.done) loadLedger(box, u);
          };
        });
        var f = OM.$("#f-adj"), sel = f.elements.user, q = OM.$("#adj-q"), amt = f.elements.amount, nt = f.elements.note;
        function pick(u) { if (!OM.$$("option", sel).some(function (x) { return x.value === u; })) { q.value = ""; sel.innerHTML = opt(""); } sel.value = u; check(false); }
        OM.$$("[data-adj]").forEach(function (b) {
          b.onclick = function () { pick(b.dataset.adj); OM.$("#adj").scrollIntoView({ behavior: "smooth", block: "start" }); amt.focus({ preventScroll: true }); };
        });
        q.addEventListener("input", function () {
          var cur = sel.value; sel.innerHTML = opt(q.value);
          var only = OM.$$("option", sel).filter(function (x) { return x.value; });
          sel.value = only.some(function (x) { return x.value === cur; }) ? cur : only.length === 1 ? only[0].value : "";
          check(false);
        });
        // 조정 검사: 회원 · 금액(차감이면 잔액 이하) · 사유. final 이면 빈 칸도 오류로 표시
        function check(final) {
          var u = sel.value, dir = +f.querySelector("[name=dir]:checked").value, v = parseWon(amt.value), b = balOf[u] || 0, ok = true;
          if (!u) { msg(sel, final ? "조정할 회원을 골라 주세요." : "", final ? "err" : ""); if (final) ok = false; }
          else msg(sel, "지금 잔액 " + OM.won(b), "ok");
          if (v.err) { if (final || amt.value.trim()) { msg(amt, v.err, "err"); ok = false; } else msg(amt, "", ""); }
          else if (v.n === 0) { msg(amt, "0원은 조정할 수 없습니다.", "err"); ok = false; }
          else if (u && dir < 0 && v.n > b) { msg(amt, "잔액(" + OM.won(b) + ")보다 많이 뺄 수 없습니다.", "err"); ok = false; }
          else msg(amt, u ? (dir > 0 ? "+" : "−") + OM.won(v.n) + " → 조정 후 잔액 " + OM.won(b + dir * v.n) : "", u ? "ok" : "");
          if (final && nt.value.trim().length < 2) { msg(nt, "조정 사유를 적어 주세요. 고객 장부에 보입니다.", "err"); ok = false; }
          return ok ? { u: u, n: dir * v.n } : null;
        }
        sel.addEventListener("change", function () { check(false); });
        amt.addEventListener("input", function () { check(false); });
        amt.addEventListener("blur", function () { var v = parseWon(amt.value); if (!v.err) amt.value = v.n.toLocaleString("ko-KR"); });
        OM.$$("[name=dir]", f).forEach(function (x) { x.addEventListener("change", function () { check(false); }); });
        nt.addEventListener("input", function () { msg(nt, "", ""); });
        f.onsubmit = function (e) {
          e.preventDefault();
          var c = check(true);
          if (!c) { var bad = f.querySelector(".sp-invalid select, .sp-invalid input"); if (bad) bad.focus(); return; }
          var label = sel.options[sel.selectedIndex].textContent.replace(/ · 잔액 .*$/, ""), b = balOf[c.u] || 0;
          act(f.querySelector("[type=submit]"), "sp_adjust_credit", { p_user: c.u, p_amount: c.n, note: nt.value.trim() },
            label + " 님의 충전금을 " + (c.n > 0 ? OM.won(c.n) + " 적립" : OM.won(-c.n) + " 차감") + "할까요?\n\n조정 후 잔액 " + OM.won(b + c.n) + "\n사유: " + nt.value.trim(), "충전금을 조정했습니다.");
        };
      }
    };
  }
  async function loadLedger(box, u) {
    box.dataset.done = "1";
    box.innerHTML = '<p class="om-dim">불러오는 중…</p>';
    var r = await sb.from("sp_ledger").select("*, sp_orders(order_no)").eq("user_id", u).order("created_at", { ascending: false }).limit(50);
    if (r.error) { box.dataset.done = ""; box.innerHTML = '<p class="om-dim">장부를 불러오지 못했습니다. ' + esc(OM.errMsg(r.error)) + "</p>"; return; }
    box.innerHTML = r.data.length ? '<ul class="sp-log" style="padding:6px 0">' + r.data.map(function (l) {
      return "<li><time>" + when(l.created_at) + "</time><div><b>" + esc(L.ledger[l.kind] || l.kind) + '</b> <span class="sp-num">' + (l.amount > 0 ? "+" : "") + OM.won(l.amount) + "</span>" +
        (l.sp_orders && l.sp_orders.order_no ? " · " + esc(l.sp_orders.order_no) : "") + (l.note ? ' <small class="om-dim">' + esc(l.note) + "</small>" : "") + "</div></li>";
    }).join("") + "</ul>" + (r.data.length === 50 ? '<p class="om-dim">최근 50줄까지 보입니다.</p>' : "") : '<p class="om-dim">기록이 없습니다.</p>';
  }

  // ───────── 전체 의뢰 ─────────
  async function viewAll() {
    var f = L.status[OM.qs("status")] ? OM.qs("status") : "";
    var q = sb.from("sp_orders").select("*, profiles(name, org, phone), sp_samples(count)").order("created_at", { ascending: false }).limit(200);
    if (f) q = q.eq("status", f);
    var rows = OM.unwrap(await q);
    byId = {};
    rows.forEach(function (o) { byId[o.id] = o; });
    var opts = '<option value="">모든 상태</option>' + Object.keys(L.status).map(function (s) { return '<option value="' + s + '"' + (s === f ? " selected" : "") + ">" + esc(L.status[s]) + "</option>"; }).join("");
    function li(o) {
      var p = o.profiles || {}, id = esc(o.id), hay = [o.order_no, p.name, p.org, p.phone, o.lab_name, o.pi_name].join(" ").toLowerCase();
      var go = o.status === "submitted" ? '<a class="btn ghost sm" href="?tab=new#o-' + id + '">접수 대기에서 처리</a>'
        : SP.TRACK.indexOf(o.status) >= 0 ? '<a class="btn ghost sm" href="?tab=progress#o-' + id + '">진행 중에서 처리</a>' : "";
      return '<li data-q="' + esc(hay) + '"><details id="o-' + id + '" data-o="' + id + '"' + (opened[o.id] ? " open" : "") + '><summary class="row" style="cursor:pointer">' +
        "<b>" + esc(o.order_no) + " " + SP.chip(o.status) + "</b><small>" + who(o) + " · " + kind(o) + " · " + OM.date(o.created_at) + " 접수</small>" +
        '<span class="r"><span class="sp-num">' + (o.quote_amount != null ? OM.won(o.quote_amount) : "금액 미정") + "</span><span>" + esc(L.pay[o.pay_method] || "") + "</span></span></summary>" +
        '<div style="padding:4px 4px 24px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px">' + (o.status !== "submitted" && o.status !== "cancelled" ? SP.track(o.status) : "") + orderDl(o) +
        '<div><h3 style="margin:0 0 8px">시료</h3><div data-samples="' + id + '"><p class="om-dim">불러오는 중…</p></div></div>' +
        '<div><h3 style="margin:0 0 8px">진행 기록</h3><div data-log="' + id + '"><p class="om-dim">불러오는 중…</p></div></div>' +
        (go ? '<div class="om-actions">' + go + "</div>" : "") + "</div></details></li>";
    }
    return {
      html: '<div class="om-card"><div style="display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><h2 style="margin:0">' + (f ? esc(L.status[f]) + " · " : "") + "최근 " + rows.length + "건</h2>" +
        '<select id="af" aria-label="상태로 거르기" style="' + CTL + '">' + opts + "</select>" +
        '<input type="text" id="aq" placeholder="찾기: 의뢰 번호 · 이름 · 소속 · 연구실" aria-label="의뢰 찾기" style="' + CTL + ';flex:1;min-width:200px"></div>' +
        '<p class="om-dim" id="aq-n" style="margin:0 0 10px">최근 200건까지 보입니다. 더 오래된 의뢰는 상태로 걸러 보세요.</p>' +
        (rows.length ? '<ul class="om-list">' + rows.map(li).join("") + "</ul>" : '<p class="om-dim">의뢰가 없습니다.</p>') + "</div>",
      bind: function () {
        OM.$("#af").onchange = function () { location.href = "?tab=all" + (this.value ? "&status=" + this.value : ""); };
        OM.$("#aq").oninput = function () {
          var s = this.value.trim().toLowerCase(), n = 0;
          OM.$$("li[data-q]").forEach(function (x) { x.hidden = !!s && x.dataset.q.indexOf(s) < 0; if (!x.hidden) n++; });
          OM.$("#aq-n").textContent = s ? "찾은 의뢰 " + n + "건" : "최근 200건까지 보입니다. 더 오래된 의뢰는 상태로 걸러 보세요.";
        };
        bindDetails();
      }
    };
  }

  // ───────── 설정 ─────────
  // 화면에서 고치는 사본(M)을 두고, 행을 더하거나 지울 때만 다시 그립니다. 저장할 때 전부 검사한 뒤 settings 네 줄을 한 번에 씁니다.
  // 코드(key)는 의뢰에 그대로 저장되므로, 한 번 저장한 코드는 바꿀 수 없게 잠급니다.
  async function viewSettings() {
    var c = S.criteria || {}, p = S.pickup || {}, cr = S.credit || {}, seq = 0, form = null, tried = false;
    var KEY = /^[a-z][a-z0-9_]{0,29}$/;
    function U() { return "u" + (++seq); }
    function str(v) { return v == null ? "" : String(v); }
    // 고객 화면 순서(ord)대로. ord 가 없는 항목은 뒤로, 같으면 코드 순 (sp-client.js 의 ordKeys 와 같은 규칙).
    // jsonb 는 키를 길이 · 글자 순으로 바꿔 저장하므로 Object.keys 순서를 그대로 쓰지 않음
    function ordOf(x) { var v = x && x.ord; v = v == null || v === "" ? NaN : Number(v); return isFinite(v) ? v : Infinity; }
    function byOrd(obj) {
      return function (a, b) { var x = ordOf(obj[a.key]), y = ordOf(obj[b.key]); return x !== y ? (x < y ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0; };
    }
    var M = {
      max: str(c.max_samples == null ? 200 : c.max_samples),
      types: Object.keys(c.types || {}).map(function (k) {
        var t = c.types[k] || {};
        return { u: U(), key: k, locked: true, name: str(t.name), unit: str(t.unit), min: str(t.min), max: str(t.max), ship: str(t.ship), hours: str(t.hours) };
      }).sort(byOrd(c.types || {})),
      services: [], slots: [],
      weekend: p.weekend !== false, lead: str(p.lead_hours == null ? 2 : p.lead_hours), ahead: str(p.max_days_ahead == null ? 60 : p.max_days_ahead),
      unit: str(cr.unit || 1000000), maxUnits: str(cr.max_units == null ? 50 : cr.max_units), bonus: str(Math.round((Number(cr.bonus_rate) || 0) * 1000) / 10),
      bank: S.bank || ""
    };
    var uOf = {};
    M.types.forEach(function (t) { uOf[t.key] = t.u; });
    M.services = Object.keys(c.services || {}).map(function (k) {
      var s = c.services[k] || {}, on = {};
      (s.types || []).forEach(function (tk) { if (uOf[tk]) on[uOf[tk]] = true; });
      return { u: U(), key: k, locked: true, name: str(s.name), on: on };
    }).sort(byOrd(c.services || {}));
    M.slots = Object.keys(p.slots || {}).map(function (k) {
      var s = p.slots[k] || {};
      return { u: U(), key: k, locked: true, label: str(s.label), start: str(s.start), end: str(s.end) };
    }).sort(function (a, b) { return Number(a.start) - Number(b.start); });

    function keyCell(it, ph) {
      return it.locked ? '<span class="mono" title="저장한 코드는 바꿀 수 없습니다">' + esc(it.key) + "</span>"
        : '<input type="text" data-f="key" maxlength="30" value="' + esc(it.key) + '" placeholder="' + esc(ph) + '" autocapitalize="off" spellcheck="false" style="min-width:110px">';
    }
    // 순서 바꾸기 ↑ ↓ (시료 종류 · 서비스). 의뢰서에 이 순서대로 보입니다. 맨 위 · 맨 아래에서는 누를 수 없음
    function mvBtns(list, i, nm, cls, style) {
      return [[-1, "↑", "위로"], [1, "↓", "아래로"]].map(function (d) {
        var off = i + d[0] < 0 || i + d[0] >= list.length;
        return '<button type="button"' + (cls ? ' class="' + cls + '"' : "") + ' data-mv="' + list[i].u + '" data-dir="' + d[0] + '" title="' + d[2] + '" aria-label="' + esc(nm) + " " + d[2] + '"' +
          (off ? " disabled" : "") + ' style="' + (style || "") + (off ? "opacity:.3;cursor:not-allowed" : "") + '">' + d[1] + "</button>";
      }).join("");
    }
    function cardTypes() {
      return '<div class="om-card" style="margin:0"><h2>시료 종류 · 접수 기준</h2>' +
        '<p class="om-dim" style="margin:0 0 14px">의뢰서에서 고르는 시료 종류와 시료 한 개의 양 범위입니다. 의뢰서 입력 검사와 DB 검사가 모두 이 숫자를 씁니다. ↑ ↓ 로 의뢰서에 보이는 순서를 바꿉니다.</p>' +
        '<label class="sp-f" style="max-width:360px;margin-bottom:16px">한 의뢰의 최대 시료 수 <small>이보다 많으면 나눠서 의뢰하도록 안내합니다.</small><input type="number" name="max" min="1" max="1000" step="1" value="' + esc(M.max) + '"><span class="sp-msg"></span></label>' +
        '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>코드</th><th>이름</th><th>단위</th><th>최소</th><th>최대</th><th>보관 · 운송</th><th>수거 기한 (시간)</th><th></th></tr></thead><tbody>' +
        M.types.map(function (t, i) {
          return '<tr data-u="' + t.u + '"><td>' + keyCell(t, "예: saliva") + "</td>" +
            '<td><input type="text" data-f="name" maxlength="40" value="' + esc(t.name) + '" placeholder="예: 타액" style="min-width:150px"></td>' +
            '<td><input type="text" data-f="unit" maxlength="12" value="' + esc(t.unit) + '" placeholder="예: mL" style="min-width:72px"></td>' +
            '<td><input type="number" data-f="min" step="any" min="0" value="' + esc(t.min) + '" style="min-width:84px"></td>' +
            '<td><input type="number" data-f="max" step="any" min="0" value="' + esc(t.max) + '" style="min-width:84px"></td>' +
            '<td><input type="text" data-f="ship" maxlength="30" value="' + esc(t.ship) + '" placeholder="예: 드라이아이스" style="min-width:120px"></td>' +
            '<td><input type="number" data-f="hours" step="1" min="24" max="720" value="' + esc(t.hours) + '" placeholder="없음" style="min-width:84px"></td>' +
            '<td style="white-space:nowrap">' + mvBtns(M.types, i, t.name || t.key || "새 종류", "", "background:none;border:0;color:var(--dim);cursor:pointer;font-size:16px;line-height:1;padding:6px 5px;") +
            '<button type="button" class="sp-rm" data-rm="' + t.u + '" title="지우기" aria-label="' + esc(t.name || "새 종류") + ' 지우기">×</button></td></tr>';
        }).join("") + "</tbody></table></div>" +
        '<div class="om-actions" style="margin-top:10px"><button type="button" class="btn ghost sm" data-add="types">+ 시료 종류 추가</button>' +
        '<small class="om-dim">코드는 영문 소문자 · 숫자 · _ 로 짓고, 저장한 뒤에는 바꿀 수 없습니다. 수거 기한은 채취 후 몇 시간 안에 수거해야 하는지입니다. 채취 시각을 받지 않아 하루(24시간) 단위로 셉니다: 48이면 채취일 다음 날까지. 없으면 비워 둡니다.</small></div></div>';
    }
    function cardServices() {
      return '<div class="om-card" style="margin:0"><h2>서비스</h2><p class="om-dim" style="margin:0 0 14px">서비스마다 받을 수 있는 시료 종류를 고릅니다. 고르지 않은 종류는 의뢰서에서 "이 시료로는 불가"로 보입니다. ↑ ↓ 로 의뢰서에 보이는 순서를 바꿉니다.</p><div style="display:grid;gap:12px">' +
        M.services.map(function (s, i) {
          return '<div data-u="' + s.u + '" style="border:1px solid var(--line);border-radius:10px;padding:14px;display:grid;gap:12px">' +
            '<div style="display:flex;gap:10px 14px;flex-wrap:wrap;align-items:flex-end">' +
            (s.locked ? '<div class="om-field" style="flex:0 1 180px">코드<span class="mono" style="padding:11px 0" title="저장한 코드는 바꿀 수 없습니다">' + esc(s.key) + "</span></div>"
              : '<label class="sp-f" style="flex:0 1 180px">코드<input type="text" data-f="key" maxlength="30" value="' + esc(s.key) + '" placeholder="예: methyl" autocapitalize="off" spellcheck="false"><span class="sp-msg"></span></label>') +
            '<label class="sp-f" style="flex:1 1 240px">이름<input type="text" data-f="name" maxlength="40" value="' + esc(s.name) + '" placeholder="예: 메틸화 분석"><span class="sp-msg"></span></label>' +
            '<div style="display:flex;gap:6px">' + mvBtns(M.services, i, s.name || s.key || "새 서비스", "btn ghost sm", "") +
            '<button type="button" class="btn ghost sm" data-rm="' + s.u + '">서비스 지우기</button></div></div>' +
            '<div class="om-field sp-f">받는 시료 종류<div class="om-checks">' + (M.types.length ? M.types.map(function (t) {
              return '<label><input type="checkbox" data-f="on" value="' + t.u + '"' + (s.on[t.u] ? " checked" : "") + "> " + esc(t.name || t.key || "새 종류") + "</label>";
            }).join("") : '<span class="om-dim">먼저 시료 종류를 추가해 주세요.</span>') + '</div><span class="sp-msg"></span></div></div>';
        }).join("") + '</div><div class="om-actions" style="margin-top:10px"><button type="button" class="btn ghost sm" data-add="services">+ 서비스 추가</button></div></div>';
    }
    function cardPickup() {
      return '<div class="om-card" style="margin:0"><h2>수거</h2><p class="om-dim" style="margin:0 0 14px">고객이 고를 수 있는 수거 날짜와 시간대입니다.</p><div style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px">' +
        '<label class="om-agree"><input type="checkbox" name="weekend"' + (M.weekend ? " checked" : "") + "> 주말(토 · 일)에도 수거합니다</label>" +
        '<div class="om-grid2" style="align-items:start"><label class="sp-f">당일 수거 준비 시간 (시간) <small>오늘 수거는 시간대가 시작하기 이만큼 전까지 받습니다. 예: 2 → 오후 1시 시간대는 오전 11시까지</small><input type="number" name="lead" min="0" max="48" step="1" value="' + esc(M.lead) + '"><span class="sp-msg"></span></label>' +
        '<label class="sp-f">신청 가능 기간 (일) <small>오늘부터 이 날수 안의 날짜만 고를 수 있습니다.</small><input type="number" name="ahead" min="1" max="365" step="1" value="' + esc(M.ahead) + '"><span class="sp-msg"></span></label></div>' +
        '<div><h3 style="margin:0 0 8px">수거 시간대</h3><div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>코드</th><th>고객에게 보이는 이름</th><th>시작 (시)</th><th>끝 (시)</th><th></th></tr></thead><tbody>' +
        M.slots.map(function (s) {
          return '<tr data-u="' + s.u + '"><td>' + keyCell(s, "예: night") + "</td>" +
            '<td><input type="text" data-f="label" maxlength="20" value="' + esc(s.label) + '" placeholder="예: 저녁 6–9시" style="min-width:140px"></td>' +
            '<td><input type="number" data-f="start" min="0" max="23" step="1" value="' + esc(s.start) + '" style="min-width:72px"></td>' +
            '<td><input type="number" data-f="end" min="1" max="24" step="1" value="' + esc(s.end) + '" style="min-width:72px"></td>' +
            '<td><button type="button" class="sp-rm" data-rm="' + s.u + '" title="지우기" aria-label="' + esc(s.label || "새 시간대") + ' 지우기">×</button></td></tr>';
        }).join("") + "</tbody></table></div>" +
        '<div class="om-actions" style="margin-top:10px"><button type="button" class="btn ghost sm" data-add="slots">+ 시간대 추가</button><small class="om-dim">시각은 0–24 사이 정수입니다. 예: 저녁 6–9시 → 시작 18, 끝 21</small></div></div></div></div>';
    }
    function cardCredit() {
      return '<div class="om-card" style="margin:0"><h2>충전금</h2><p class="om-dim" style="margin:0 0 14px">고객은 충전 단위의 배수로 충전을 신청하고, 입금을 확인하면 적립됩니다.</p><div class="om-grid2" style="align-items:start">' +
        '<label class="sp-f">충전 단위 (원) <small>1만 원 단위. 예: 1000000 = 100만 원</small><input type="number" name="unit" min="10000" step="10000" value="' + esc(M.unit) + '"><span class="sp-msg"></span></label>' +
        '<label class="sp-f">한 번에 최대 (단위 수) <small>예: 50 → 한 번에 충전 단위 × 50까지</small><input type="number" name="maxUnits" min="1" max="1000" step="1" value="' + esc(M.maxUnits) + '"><span class="sp-msg"></span></label>' +
        '<label class="sp-f">충전 보너스 (%) <small>입금 확인 때 충전액의 이 비율만큼 더 적립합니다. 0이면 없음.</small><input type="number" name="bonus" min="0" max="50" step="0.1" value="' + esc(M.bonus) + '"><span class="sp-msg"></span></label></div>' +
        '<p class="sp-callout info" id="credit-preview" style="margin-top:14px"></p></div>';
    }
    function cardBank() {
      return '<div class="om-card" style="margin:0"><h2>입금 안내</h2><label class="sp-f">입금 계좌 안내 <small>충전 신청 화면에 그대로 보입니다. 비워 두면 "입금 계좌는 운영자가 메일 · 카카오톡으로 안내합니다"가 보입니다.</small>' +
        '<textarea name="bank" rows="3" maxlength="300" style="min-height:80px" placeholder="예: 국민은행 000000-00-000000 (주)퍼스트옴">' + esc(M.bank) + '</textarea><span class="sp-msg"></span></label></div>';
    }
    function draw() {
      form.innerHTML = cardTypes() + cardServices() + cardPickup() + cardCredit() + cardBank() +
        '<p class="sp-callout err" id="set-err" role="alert" hidden></p>' +
        '<div class="om-actions"><button class="btn primary" type="submit">설정 저장</button><span class="om-dim" id="set-dirty">' + (dirty ? "저장하지 않은 변경이 있습니다." : "") + "</span></div>" +
        '<p class="om-note">바뀐 기준은 새로 내는 의뢰와 고객이 고치는 의뢰부터 적용됩니다. 이미 받은 의뢰는 그대로입니다. 운영자 계정을 추가하려면 Supabase 대시보드 Table Editor 에서 그 사람의 profiles 행의 is_admin 을 true 로 바꿉니다.</p>';
      preview();
      if (tried) check(false);
    }
    // 화면 값 → M
    function read() {
      var e = form.elements;
      if (!e.max) return;
      M.max = e.max.value; M.weekend = e.weekend.checked; M.lead = e.lead.value; M.ahead = e.ahead.value;
      M.unit = e.unit.value; M.maxUnits = e.maxUnits.value; M.bonus = e.bonus.value; M.bank = e.bank.value;
      OM.$$("[data-u]", form).forEach(function (row) {
        var it = item(row.dataset.u);
        if (!it) return;
        if (it.on) it.on = {};
        OM.$$("[data-f]", row).forEach(function (x) {
          if (x.dataset.f === "on") { if (x.checked) it.on[x.value] = true; }
          else it[x.dataset.f] = x.value;
        });
      });
    }
    function item(u) { return M.types.concat(M.services, M.slots).filter(function (x) { return x.u === u; })[0]; }
    function preview() {
      var box = OM.$("#credit-preview"), u = Number(M.unit), mu = Number(M.maxUnits), bo = Number(M.bonus);
      if (!box) return;
      if (!(u >= 10000 && u % 10000 === 0 && mu >= 1 && mu <= 1000 && Math.floor(mu) === mu)) { box.textContent = "충전 단위와 최대 단위 수를 바르게 넣으면 고객에게 보일 금액이 여기 나옵니다."; return; }
      box.textContent = "고객 화면: " + manwon(u) + (mu > 1 ? ", " + manwon(u * 2) : "") + (mu > 2 ? " … " + manwon(u * mu) : "") + " 중에서 골라 충전을 신청합니다." +
        (bo > 0 && bo <= 50 ? " 보너스 " + bo + "% → " + manwon(u) + "을 충전하면 " + manwon(Math.round(u * bo / 100)) + "을 더 적립합니다." : "");
    }
    function add(kind) {
      var it = kind === "types" ? { u: U(), key: "", locked: false, name: "", unit: "", min: "", max: "", ship: "", hours: "" }
        : kind === "services" ? { u: U(), key: "", locked: false, name: "", on: {} }
        : { u: U(), key: "", locked: false, label: "", start: "", end: "" };
      M[kind].push(it);
      return it;
    }
    function remove(u) {
      var it = item(u), nm = it.name || it.label || it.key || "이 항목";
      if (it.locked && !confirm("'" + nm + "'을(를) 지울까요?\n이미 받은 의뢰는 그대로지만, 새 의뢰에서는 고를 수 없습니다. 설정 저장을 눌러야 반영됩니다.")) return false;
      function keep(x) { return x.u !== u; }
      M.types = M.types.filter(keep); M.services = M.services.filter(keep); M.slots = M.slots.filter(keep);
      M.services.forEach(function (s) { delete s.on[u]; });
      return true;
    }
    // 이웃 항목과 자리 바꾸기 (d: -1 위로, 1 아래로). 바꿀 수 없으면 false
    function move(u, d) {
      var list = M.types.some(function (x) { return x.u === u; }) ? M.types : M.services, i = -1, j, t;
      list.forEach(function (x, k) { if (x.u === u) i = k; });
      j = i + d;
      if (i < 0 || j < 0 || j >= list.length) return false;
      t = list[i]; list[i] = list[j]; list[j] = t;
      return true;
    }
    function clearAll() {
      OM.$$(".sp-cellmsg", form).forEach(function (m) { m.remove(); });
      OM.$$(".sp-invalid", form).forEach(function (x) { x.classList.remove("sp-invalid"); });
      OM.$$("[aria-invalid]", form).forEach(function (x) { x.removeAttribute("aria-invalid"); });
      OM.$$(".sp-msg", form).forEach(function (m) { m.textContent = ""; m.className = "sp-msg"; });
    }
    function mark(el, text) {
      if (el.closest("td")) cellErr(el, text);
      else if (el.closest(".sp-f")) msg(el, text, "err");
    }
    // 전체 검사 (sp_save_order 가 이 숫자를 정수로 읽는 칸은 정수만 받음). 틀린 칸마다 이유를 적고 개수를 위에 보여 줌
    function check(focus) {
      read(); clearAll();
      var errs = [], e = form.elements;
      function bad(el, text) { if (el) errs.push({ el: el, text: text }); }
      function fld(u, k) { return form.querySelector('[data-u="' + u + '"] [data-f="' + k + '"]'); }
      function n(v) { v = String(v == null ? "" : v).trim(); return v === "" ? NaN : Number(v); }
      function int(v, lo, hi) { var x = n(v); return isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }
      function keys(list, eg) {
        var seen = {};
        list.forEach(function (it) { if (it.locked) seen[it.key] = true; });
        list.forEach(function (it) {
          if (it.locked) return;
          var k = String(it.key).trim(), el = fld(it.u, "key");
          if (!k) bad(el, "코드를 입력해 주세요 (예: " + eg + ").");
          else if (!KEY.test(k)) bad(el, "영문 소문자로 시작하고 소문자 · 숫자 · _ 만 써 주세요 (예: " + eg + ").");
          else if (seen[k]) bad(el, "같은 코드가 이미 있습니다. 다른 코드를 써 주세요.");
          seen[k] = true;
        });
      }
      if (!int(M.max, 1, 1000)) bad(e.max, "1부터 1000 사이의 정수로 입력해 주세요.");
      if (!M.types.length) bad(form.querySelector('[data-add="types"]'), "시료 종류가 하나 이상 있어야 합니다.");
      keys(M.types, "saliva");
      M.types.forEach(function (t) {
        var lo = n(t.min), hi = n(t.max);
        if (!t.name.trim()) bad(fld(t.u, "name"), "이름을 입력해 주세요.");
        if (!t.unit.trim()) bad(fld(t.u, "unit"), "단위를 입력해 주세요 (예: mL).");
        if (!(lo >= 0)) bad(fld(t.u, "min"), "0 이상의 숫자로 입력해 주세요.");
        if (!(hi > 0)) bad(fld(t.u, "max"), "0보다 큰 숫자로 입력해 주세요.");
        else if (lo >= 0 && hi < lo) bad(fld(t.u, "max"), "최대는 최소(" + lo + ")보다 작을 수 없습니다.");
        if (!t.ship.trim()) bad(fld(t.u, "ship"), "보관 · 운송 온도를 입력해 주세요 (예: 드라이아이스).");
        // 하루(24시간) 단위로 세므로 24 미만이면 어떤 시료도 받을 수 없음
        if (String(t.hours).trim() !== "" && !int(t.hours, 24, 720)) bad(fld(t.u, "hours"), "24–720 사이 정수로 입력하거나, 기한이 없으면 비워 두세요.");
      });
      if (!M.services.length) bad(form.querySelector('[data-add="services"]'), "서비스가 하나 이상 있어야 합니다.");
      keys(M.services, "methyl");
      M.services.forEach(function (s) {
        if (!s.name.trim()) bad(fld(s.u, "name"), "이름을 입력해 주세요.");
        if (!M.types.some(function (t) { return s.on[t.u]; })) bad(form.querySelector('[data-u="' + s.u + '"] [data-f="on"]') || form.querySelector('[data-u="' + s.u + '"] .om-checks'), "받는 시료 종류를 하나 이상 골라 주세요.");
      });
      if (!int(M.lead, 0, 48)) bad(e.lead, "0–48 사이 정수로 입력해 주세요.");
      if (!int(M.ahead, 1, 365)) bad(e.ahead, "1–365 사이 정수로 입력해 주세요.");
      if (!M.slots.length) bad(form.querySelector('[data-add="slots"]'), "수거 시간대가 하나 이상 있어야 합니다.");
      keys(M.slots, "night");
      M.slots.forEach(function (s) {
        var a = int(s.start, 0, 23);
        if (!s.label.trim()) bad(fld(s.u, "label"), "고객에게 보일 이름을 입력해 주세요 (예: 저녁 6–9시).");
        if (!a) bad(fld(s.u, "start"), "0–23 사이 정수로 입력해 주세요.");
        if (!int(s.end, 1, 24)) bad(fld(s.u, "end"), "1–24 사이 정수로 입력해 주세요.");
        else if (a && n(s.end) <= n(s.start)) bad(fld(s.u, "end"), "끝 시각은 시작(" + n(s.start) + "시)보다 늦어야 합니다.");
      });
      var u = n(M.unit), bo = n(M.bonus);
      if (!int(M.unit, 10000, 100000000) || u % 10000) bad(e.unit, "1만 원 단위로, 1만 원부터 1억 원 사이로 입력해 주세요.");
      if (!int(M.maxUnits, 1, 1000)) bad(e.maxUnits, "1–1000 사이 정수로 입력해 주세요.");
      else if (u * n(M.maxUnits) > 2000000000) bad(e.maxUnits, "한 번 충전 한도(단위 × 최대)가 20억 원을 넘지 않게 줄여 주세요.");
      if (!(bo >= 0 && bo <= 50) || Math.abs(bo * 10 - Math.round(bo * 10)) > 1e-9) bad(e.bonus, "0–50 사이 숫자로, 소수 첫째 자리까지 입력해 주세요.");
      if (M.bank.length > 300) bad(e.bank, "300자 이내로 줄여 주세요.");

      errs.forEach(function (x) { mark(x.el, x.text); });
      var box = OM.$("#set-err");
      box.hidden = !errs.length;
      if (errs.length) {
        box.textContent = errs.length + "곳을 고쳐 주세요. 첫 번째: " + errs[0].text;
        if (focus) { errs[0].el.focus(); errs[0].el.scrollIntoView({ block: "center" }); }
      }
      return !errs.length;
    }
    function ext(base, over) { var o = {}, k; for (k in base || {}) o[k] = base[k]; for (k in over) o[k] = over[k]; return o; }
    function save(btn) {
      tried = true;
      if (!check(true)) { OM.toast("고칠 곳이 있습니다. 빨간 칸을 확인해 주세요.", true); return; }
      // 화면에 없는 값(다른 화면이 쓰는 칸)은 그대로 두고 고친 칸만 덮어씀
      var c0 = S.criteria || {}, p0 = S.pickup || {}, types = {}, services = {}, slots = {};
      function num(v) { return Number(String(v).trim()); }
      // ord: 화면에 놓인 순서 (의뢰서도 이 순서로 보여 줌)
      M.types.forEach(function (t, i) {
        var k = t.key.trim();
        types[k] = ext((c0.types || {})[k], { ord: i, name: t.name.trim(), unit: t.unit.trim(), min: num(t.min), max: num(t.max), ship: t.ship.trim(), hours: String(t.hours).trim() === "" ? null : num(t.hours) });
      });
      M.services.forEach(function (s, i) {
        var k = s.key.trim();
        services[k] = ext((c0.services || {})[k], { ord: i, name: s.name.trim(), types: M.types.filter(function (t) { return s.on[t.u]; }).map(function (t) { return t.key.trim(); }) });
      });
      M.slots.forEach(function (s) { var k = s.key.trim(); slots[k] = ext((p0.slots || {})[k], { label: s.label.trim(), start: num(s.start), end: num(s.end) }); });
      var critV = ext(c0, { max_samples: num(M.max), types: types, services: services });
      var pickV = ext(p0, { weekend: M.weekend, lead_hours: num(M.lead), max_days_ahead: num(M.ahead), slots: slots });
      var creditV = ext(S.credit, { unit: num(M.unit), max_units: num(M.maxUnits), bonus_rate: Math.round(num(M.bonus) * 10) / 1000 });
      var bank = M.bank.trim();
      OM.run(btn, async function () {
        OM.unwrap(await sb.from("settings").upsert([
          { key: "sp_criteria", value: critV }, { key: "sp_pickup", value: pickV }, { key: "sp_credit", value: creditV }, { key: "sp_bank", value: { text: bank } }
        ]));
        S.criteria = critV; S.pickup = pickV; S.credit = creditV; S.bank = bank;
        dirty = false;
        OM.toast("설정을 저장했습니다. 새 의뢰부터 적용됩니다.");
        await show();
      });
    }
    function touched() { dirty = true; var d = OM.$("#set-dirty"); if (d) d.textContent = "저장하지 않은 변경이 있습니다."; }

    return {
      html: '<form class="om-form" id="f-set" novalidate style="grid-template-columns:minmax(0,1fr)"></form>',
      bind: function () {
        form = OM.$("#f-set");
        draw();
        form.addEventListener("input", function (e) {
          touched();
          if (e.target.closest("td")) clearCell(e.target);
          else if (e.target.closest(".sp-f") && e.target.type !== "checkbox") msg(e.target, "", "");
          if (/^(unit|maxUnits|bonus)$/.test(e.target.name || "")) { read(); preview(); }
        });
        form.addEventListener("change", function (e) {
          touched(); read();
          // 시료 종류 이름 · 코드가 바뀌면 서비스의 '받는 시료 종류' 이름표도 바꿈 (다시 그리지 않아 커서가 그대로)
          var row = e.target.closest("tr[data-u]"), t = row && M.types.filter(function (x) { return x.u === row.dataset.u; })[0];
          if (t) OM.$$('input[data-f="on"][value="' + t.u + '"]', form).forEach(function (cb) { cb.parentNode.lastChild.textContent = " " + (t.name || t.key || "새 종류"); });
          if (tried) check(false);
        });
        form.addEventListener("click", function (e) {
          var b = e.target.closest("[data-add],[data-rm],[data-mv]"), it = null;
          if (!b) return;
          read();
          if (b.dataset.add) it = add(b.dataset.add);
          else if (b.dataset.mv) { if (!move(b.dataset.mv, +b.dataset.dir)) return; }
          else if (!remove(b.dataset.rm)) return;
          touched(); draw();
          if (it) { var f = form.querySelector('[data-u="' + it.u + '"] input'); if (f) f.focus(); }
          // 옮긴 항목의 같은 버튼에 초점을 두어 키보드로 계속 옮길 수 있게 함 (맨 끝에 닿으면 반대쪽 버튼)
          if (b.dataset.mv) {
            var mv = OM.$$('[data-mv="' + b.dataset.mv + '"]', form), go = mv.filter(function (x) { return x.dataset.dir === b.dataset.dir && !x.disabled; })[0] || mv.filter(function (x) { return !x.disabled; })[0];
            if (go) go.focus();
          }
        });
        form.onsubmit = function (e) { e.preventDefault(); save(form.querySelector("[type=submit]")); };
      }
    };
  }
})();
