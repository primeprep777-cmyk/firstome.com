/* /samplo/app/ : 샘플로 고객(의뢰인) 화면
   (없음)      내 의뢰 목록 + 충전금
   ?new=1      새 의뢰: 시료 종류 → 서비스 → 시료 목록 → 수거 · 연락 → 결제 · 확인
   ?edit=…     접수 확인 전(submitted) 의뢰 고치기 (같은 5단계)
   ?id=…       의뢰 상세: 8단계 추적 · QC 진행 방법 선택 · 진행 기록 · 튜브 라벨 인쇄
   ?topup=1    충전 신청 · 충전금 내역
   회원 정보(이름 · 소속 · 휴대폰 · 약관 동의)가 비어 있으면 어느 화면이든 그것부터 받습니다 (카카오 가입 포함).
   입력 검사는 supabase/samplo.sql 의 sp_complete_profile · sp_save_order · sp_request_topup 과 같은 규칙입니다.
   한쪽 규칙을 바꾸면 다른 쪽도 같이 바꿔 주세요. 기준 숫자는 운영 화면 > 설정(sp_criteria · sp_pickup · sp_credit)에서 옵니다. */
(async function () {
  var OM = window.OM, SP = window.SP, sb = OM.sb, L = SP.L, esc = OM.esc, main = OM.$("#om-main");
  var me = await SP.requireLogin(); if (!me) return;
  var uid = me.user.id, S = null;
  var DOC = { tax_invoice: "세금계산서", none: "필요 없음" };
  var DRAFT = "sp-draft-" + uid;                  // 작성 중인 새 의뢰 (이 기기에만 저장)

  async function route() {
    if (SP.needsProfile(me)) return profileGate();
    if (OM.qs("new")) return wizard(null);
    if (OM.qs("edit")) return isUuid(OM.qs("edit")) ? wizard(OM.qs("edit")) : notFound();
    if (OM.qs("id")) return isUuid(OM.qs("id")) ? detail(OM.qs("id")) : notFound();
    if (OM.qs("topup")) return topup();
    return list();
  }

  // ───────── 공통 도우미 ─────────
  function trim(v) { return String(v == null ? "" : v).trim(); }
  // DB 의 length() 와 같은 방식으로 글자 수를 셉니다 (이모지도 1자)
  function clen(v) { return Array.from(String(v == null ? "" : v)).length; }
  function num(v) { var n = Number(v); return isFinite(n) ? n.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : String(v); }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + OM.won(Math.abs(n)); }
  // 1000000 → "100만원", 150000000 → "1억 5,000만원"
  function krMoney(n) {
    n = Number(n) || 0;
    if (n % 10000) return OM.won(n);
    var eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4);
    return (eok ? eok.toLocaleString("ko-KR") + "억" + (man ? " " : "") : "") + (man ? man.toLocaleString("ko-KR") + "만" : "") + "원";
  }
  // 한국 시간으로 날짜 · 시각
  function when(ts) {
    if (!ts) return { d: "-", t: "" };
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; });
    return { d: p.year + "." + p.month + "." + p.day, t: p.hour + ":" + p.minute };
  }
  // 지금 한국 시각을 분으로 (13:05 → 785). 당일 수거 마감을 분 단위로 봅니다 (sp_save_order 와 같음)
  function nowMinKST() {
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return parseInt(p.hour, 10) % 24 * 60 + parseInt(p.minute, 10);
  }
  // 설정의 ord(운영 화면에서 정한 순서)대로 키를 늘어놓음. ord 가 없으면 뒤로, 같으면 키 이름 순.
  // (DB 의 jsonb 는 키를 길이 · 글자 순으로 바꿔 저장하므로 Object.keys 순서를 믿을 수 없음)
  function ordKeys(obj) {
    obj = obj || {};
    function ord(k) { var v = obj[k] && obj[k].ord; v = v == null || v === "" ? NaN : Number(v); return isFinite(v) ? v : Infinity; }
    return Object.keys(obj).sort(function (a, b) { var x = ord(a), y = ord(b); return x !== y ? (x < y ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0; });
  }
  // 붙여 넣은 값 정리: 전각 글자(ＣＡＳＥ－０１) → 반각, 보이지 않는 글자(폭 없는 공백 · BOM) 제거
  function clean(v) { return String(v == null ? "" : v).normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, ""); }
  // "2026-10-08" 이 실제 있는 날짜인지
  function isoOk(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "") || s < "1900-01-01") return false;
    var d = new Date(s + "T00:00:00Z");
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  function box(kind, html, attrs) { return '<div class="sp-callout ' + kind + '" style="margin-bottom:16px"' + (attrs || "") + ">" + html + "</div>"; }
  function kakaoBtn(label) { return '<a class="btn ghost" href="' + OM.KAKAO + '" target="_blank" rel="noopener">' + esc(label || "카카오톡 문의") + "</a>"; }
  function emptyCard(title, text, actions) {
    return '<div class="om-card om-empty"><h2>' + esc(title) + "</h2><p>" + text + '</p><div class="om-actions" style="justify-content:center">' + (actions || "") + "</div></div>";
  }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || ""); }
  function notFound() { main.innerHTML = emptyCard("의뢰를 찾을 수 없습니다", "주소가 맞는지 확인해 주세요.", '<a class="btn primary" href="./">내 의뢰로</a>'); }
  function fail(e) {
    console.error(e);
    main.innerHTML = emptyCard("화면을 불러오지 못했습니다", esc(OM.errMsg(e)) + "<br>잠시 뒤 다시 시도하거나 카카오톡 채널로 알려 주세요.",
      '<button class="btn primary" type="button" id="b-retry">다시 시도</button>' + kakaoBtn());
    OM.$("#b-retry").onclick = function () { location.reload(); };
  }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가(사생활 보호 모드 등)면 그냥 넘어감 */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function draftUsable(dr) { return dr && dr.d && dr.at && Date.now() - dr.at < 30 * 864e5; }

  // 마우스를 누르는 사이에 생긴 오류 표시는 손을 뗀 뒤에 그립니다.
  // (칸을 떠나며 오류 줄이 생기면 버튼이 밀려 "다음" · "접수" 클릭이 빗나가는 것을 막음)
  var pressing = false, queued = [];
  function release() { pressing = false; setTimeout(function () { var q = queued; queued = []; q.forEach(function (f) { f(); }); }, 0); }
  document.addEventListener("pointerdown", function () { pressing = true; }, true);
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  function later(f) { if (pressing) queued.push(f); else f(); }

  // 입력하는 동안 휴대폰 · 사업자등록번호에 하이픈을 넣고, 커서는 같은 숫자 뒤에 둡니다
  function autoFormat(el, fmt) {
    if (!el) return;
    el.addEventListener("input", function () {
      var pos = el.selectionStart == null ? el.value.length : el.selectionStart;
      var before = el.value.slice(0, pos).replace(/\D/g, "").length, v = fmt(el.value);
      if (v === el.value) return;
      el.value = v;
      var i = 0, d = 0; while (i < v.length && d < before) { if (/\d/.test(v[i])) d++; i++; }
      try { el.setSelectionRange(i, i); } catch (e) { /* type=email 등은 커서 이동 불가 */ }
    });
  }

  // 입력 칸 검사 연결. rules[name]() 는 "" (통과) · "오류 문장" · { warn, fix } (오타 의심) · { ok } (안내) 를 돌려줍니다.
  // { warn, fix, block } 은 오류처럼 막고, "이 주소로 바꾸기" · "이대로 쓰기" 중 하나를 고르게 합니다.
  // 오류는 칸을 떠날 때와 다음 · 제출을 누를 때 보여 주고, 고치는 동안에는 바로 지웁니다.
  function fields(root, rules, order, onInput, deps) {
    var touched = {};
    function el(n) { return root.querySelector('[name="' + n + '"]'); }
    // 안내 줄을 입력 칸에 연결 (화면 읽기 프로그램이 오류 문장을 함께 읽도록)
    order.forEach(function (n) {
      var m = root.querySelector('.sp-msg[data-for="' + n + '"]'); if (!m) return;
      if (!m.id) m.id = "m-" + n;
      root.querySelectorAll('[name="' + n + '"]').forEach(function (x) { x.setAttribute("aria-describedby", m.id); });
    });
    function paint(n) {
      var e = el(n); if (!e) return "";
      var r = rules[n]() || "", block = !!r.block, err = typeof r === "string" ? r : block ? "주소를 확인해 주세요. 혹시 " + r.fix + " 인가요?" : "";
      var wrap = e.closest("[data-f]"), msg = wrap && wrap.querySelector(".sp-msg[data-for]");
      var show = !!err && !!touched[n];
      if (wrap) wrap.classList.toggle("sp-invalid", show);
      root.querySelectorAll('[name="' + n + '"]').forEach(function (x) { x.setAttribute("aria-invalid", show ? "true" : "false"); });
      if (msg) {
        if (show && block) {
          msg.className = "sp-msg err";
          msg.innerHTML = esc(err) + ' <button type="button" class="om-link" data-typo="fix">이 주소로 바꾸기</button> · <button type="button" class="om-link" data-typo="keep">이대로 쓰기</button>';
          msg.querySelector('[data-typo="fix"]').onclick = function () { e.value = r.fix; e.dispatchEvent(new Event("input", { bubbles: true })); touched[n] = true; paint(n); e.focus(); };
          msg.querySelector('[data-typo="keep"]').onclick = function () { okTypo[r.key] = trim(e.value).toLowerCase(); paint(n); e.focus(); };
        }
        else if (show) { msg.className = "sp-msg err"; msg.textContent = err; }
        else if (r.warn && touched[n]) {
          msg.className = "sp-msg warn";
          msg.innerHTML = esc(r.warn) + (r.fix ? ' <button type="button" class="om-link">' + "이 주소로 바꾸기</button>" : "");
          if (r.fix) msg.querySelector("button").onclick = function () { e.value = r.fix; e.dispatchEvent(new Event("input", { bubbles: true })); touched[n] = true; paint(n); e.focus(); };
        } else { msg.className = "sp-msg ok"; msg.textContent = (!err && r.ok) || ""; }
      }
      return err;
    }
    function after(n) { paint(n); ((deps || {})[n] || []).forEach(function (d) { paint(d); }); }
    order.forEach(function (n) {
      root.querySelectorAll('[name="' + n + '"]').forEach(function (e) {
        var ev = e.type === "radio" || e.type === "checkbox" || e.tagName === "SELECT" || e.type === "date" ? "change" : "input";
        e.addEventListener(ev, function () { if (onInput) onInput(n, e); if (ev === "change") touched[n] = true; after(n); });
        if (ev === "change" && e.type === "date") e.addEventListener("input", function () { if (onInput) onInput(n, e); after(n); });
        e.addEventListener("blur", function () { touched[n] = true; later(function () { after(n); }); });
      });
      paint(n);
    });
    return {
      paint: paint,
      // 이미 값이 들어 있는 칸(지난 의뢰에서 불러온 값 등)은 처음부터 검사 결과를 보여 줌
      touch: function (n) { var e = el(n); if (e && trim(e.value)) { touched[n] = true; paint(n); } },
      // 모든 칸을 검사하고, 첫 번째로 틀린 칸으로 커서를 옮김
      check: function () {
        var first = null;
        order.forEach(function (n) { touched[n] = true; if (paint(n) && !first) first = n; });
        if (first) { var e = el(first); e.focus(); if (e.scrollIntoView) e.scrollIntoView({ block: "center" }); }
        return !first;
      }
    };
  }
  // 칸 하나: 이름표 + 입력 + 안내 줄
  function fld(name, label, hint, input) {
    return '<label data-f="' + name + '">' + label + (hint ? " <small>" + hint + "</small>" : "") + input + '<span class="sp-msg" id="m-' + name + '" data-for="' + name + '"></span></label>';
  }
  function txt(name, val, attrs) { return '<input type="text" name="' + name + '" value="' + esc(val == null ? "" : val) + '" ' + (attrs || "") + ">"; }
  function radios(name, map, val) {
    return '<div class="om-checks">' + Object.keys(map).map(function (k) {
      return '<label><input type="radio" name="' + name + '" value="' + esc(k) + '"' + (k === val ? " checked" : "") + "> " + esc(map[k]) + "</label>";
    }).join("") + "</div>";
  }

  // 검사 규칙 (서버와 같은 기준)
  function minLen(v, n, msg) { return clen(trim(v)) >= n ? "" : msg; }
  function phoneRule(v, emptyMsg) {
    if (!trim(v)) return emptyMsg;
    return SP.V.phone(v) ? "" : "010으로 시작하는 휴대폰 번호 10–11자리를 입력해 주세요.";
  }
  // 오타가 의심되지만 "이대로 쓰기"를 누른 주소 (칸 이름 → 소문자 주소). 칸 이름이 화면마다 달라 화면별로 따로 기억됩니다.
  var okTypo = {};
  // 오타 의심(gmial.com 등)은 고르기 전까지 다음 · 접수를 막음: { warn, fix, block, key }
  function emailRule(v, emptyMsg, key) {
    v = trim(v);
    if (!v) return emptyMsg;
    if (!SP.V.email(v)) return "메일 주소 형식이 맞지 않습니다 (예: tax@univ.ac.kr).";
    var fix = SP.V.emailTypo(v);
    return fix && okTypo[key] !== v.toLowerCase() ? { warn: "혹시 " + fix + " 인가요?", fix: fix, block: true, key: key } : "";
  }
  function bizNoRule(v) {
    v = trim(v); if (!v) return "";
    var d = v.replace(/\D/g, "");
    if (d.length !== 10) return "사업자등록번호는 숫자 10자리입니다 (지금 " + d.length + "자리). 모르면 비워 두세요.";
    return SP.V.bizNo(v) ? "" : "사업자등록번호가 맞지 않습니다. 숫자를 다시 확인하거나, 모르면 비워 두세요.";
  }

  // ───────── 처음 한 번: 회원 정보 ─────────
  function profileGate() {
    // 동의 칸은 샘플로 약관 동의(sp_agreed_at)로만 미리 체크합니다. agreed_at 은 오믹스메이트 가입 때도 채워지므로 쓰지 않음.
    var p = me.profile || {}, st = { name: p.name || "", org: p.org || "", phone: SP.fmtPhone(p.phone || ""), agree: !!p.sp_agreed_at };
    main.innerHTML =
      '<div class="om-card" style="max-width:560px;margin:8px auto">' +
      '<h1 style="font-size:26px;margin:0 0 8px">의뢰 전에 한 번만</h1>' +
      '<p class="om-dim" style="margin:0 0 20px">시료 수거와 진행 안내에 쓰는 정보입니다. 한 번 입력하면 다음부터는 묻지 않습니다.</p>' +
      '<form class="om-form" id="f-prof" novalidate>' +
      fld("name", "이름", "", txt("name", st.name, 'autocomplete="name" maxlength="40"')) +
      fld("org", "소속", "학교 · 병원 · 연구소 · 회사", txt("org", st.org, 'autocomplete="organization" maxlength="80"')) +
      fld("phone", "휴대폰", "수거 일정과 진행 안내를 받을 번호", '<input type="tel" name="phone" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" value="' + esc(st.phone) + '">') +
      '<div data-f="agree"><label class="om-agree"><input type="checkbox" name="agree"' + (st.agree ? " checked" : "") + '> <span>샘플로 <a href="/samplo/terms/" target="_blank">이용약관</a>과 <a href="/privacy/" target="_blank">개인정보 처리방침</a>에 동의합니다. (필수)</span></label><span class="sp-msg" id="m-agree" data-for="agree"></span></div>' +
      '<button class="btn primary" type="submit">저장하고 계속하기</button></form></div>';
    var f = OM.$("#f-prof");
    autoFormat(f.elements.phone, SP.fmtPhone);
    var chk = fields(f, {
      // 가입 화면(sp-login.js)과 같은 규칙 (SP.V.nameErr · orgErr). 예전 sp-app.js 가 캐시에 남아 있으면 글자 수만 봄
      name: function () { return (SP.V.nameErr ? SP.V.nameErr(st.name) : minLen(st.name, 2, "이름을 2자 이상 입력해 주세요.")) || ""; },
      org: function () { return (SP.V.orgErr ? SP.V.orgErr(st.org) : minLen(st.org, 2, "소속을 2자 이상 입력해 주세요 (예: KAIST).")) || ""; },
      phone: function () { return phoneRule(st.phone, "휴대폰 번호를 입력해 주세요."); },
      agree: function () { return st.agree ? "" : "이용약관과 개인정보 처리방침에 동의해 주세요."; }
    }, ["name", "org", "phone", "agree"], function (n, e) { st[n] = e.type === "checkbox" ? e.checked : e.value; });
    f.onsubmit = function (ev) {
      ev.preventDefault();
      if (!chk.check()) return;
      var btn = f.querySelector("button[type=submit]");
      OM.run(btn, async function () {
        OM.unwrap(await sb.rpc("sp_complete_profile", { p_name: trim(st.name), p_org: trim(st.org), p_phone: SP.fmtPhone(trim(st.phone)) }));
        me = await SP.session(); SP.header(me);
        OM.toast("저장했습니다.");
        await route();
      });
    };
  }

  // ───────── 내 의뢰 목록 + 충전금 ─────────
  async function list() {
    var res = await Promise.all([
      sb.from("sp_orders").select("id,order_no,status,sample_type,service,lab_name,pickup_date,pickup_slot,eta,created_at,sp_samples(count)").eq("client_id", uid).order("created_at", { ascending: false }),
      sb.rpc("sp_balance"),
      sb.from("sp_topups").select("id,amount,created_at").eq("user_id", uid).eq("status", "requested").order("created_at", { ascending: false }).limit(1),
      sb.from("sp_ledger").select("amount,kind,note,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(5)
    ]);
    var rows = OM.unwrap(res[0]) || [], bal = OM.unwrap(res[1]) || 0, pend = (OM.unwrap(res[2]) || [])[0], led = OM.unwrap(res[3]) || [];
    var active = rows.filter(function (r) { return ["completed", "cancelled"].indexOf(r.status) < 0; });
    var done = rows.filter(function (r) { return ["completed", "cancelled"].indexOf(r.status) >= 0; });

    // QC 결과를 보고 진행 방법을 골라야 하는 시료 수
    var waiting = {}, ids = active.filter(function (r) { return r.status !== "submitted"; }).map(function (r) { return r.id; });
    if (ids.length) {
      OM.unwrap(await sb.from("sp_samples").select("order_id").in("order_id", ids).in("qc_status", ["warn", "fail"]).is("decision", null))
        .forEach(function (s) { waiting[s.order_id] = (waiting[s.order_id] || 0) + 1; });
    }
    function li(r) {
      var cnt = r.sp_samples && r.sp_samples[0] ? r.sp_samples[0].count : 0;
      var info = r.status === "completed" || r.status === "cancelled" ? when(r.created_at).d + " 접수"
        : r.eta ? "완료 예정 " + SP.dateLabel(r.eta)
        : "수거 " + SP.dateLabel(r.pickup_date) + " " + SP.slotLabel(S.pickup, r.pickup_slot);
      return '<li><a class="row" href="?id=' + encodeURIComponent(r.id) + '"><b><span class="sp-num" style="white-space:nowrap">' + esc(r.order_no) + "</span> · " + esc(SP.typeName(S.criteria, r.sample_type)) + " " + esc(cnt) + "개</b>" +
        "<small>" + esc(SP.serviceName(S.criteria, r.service)) + " · " + esc(r.lab_name) + "</small>" +
        '<span class="r">' + SP.chip(r.status) + (waiting[r.id] ? '<span class="om-chip sp-qc-warn">QC 선택 기다림 ' + esc(waiting[r.id]) + "개</span>" : "") + "<span>" + esc(info) + "</span></span></a></li>";
    }
    var dr = load(DRAFT), draftNote = "";
    if (draftUsable(dr) && (dr.d.sample_type || (dr.d.samples || []).some(function (s) { return trim(s.name); }))) {
      var dn = (dr.d.samples || []).filter(function (s) { return trim(s.name); }).length;
      draftNote = box("info", "작성 중인 의뢰가 있습니다" + (dr.d.sample_type ? " (" + esc(SP.typeName(S.criteria, dr.d.sample_type)) + (dn ? " " + dn + "개" : "") + ")" : "") +
        '. <a href="?new=1">이어서 쓰기 →</a>');
    }

    var credit =
      '<div class="om-card"><h2 style="font-size:17px">충전금</h2><div class="sp-balance">' + esc(OM.won(bal)) + "</div>" +
      '<p class="om-dim" style="margin:6px 0 12px">충전금으로 결제한 의뢰는 접수가 확정될 때 이 잔액에서 차감됩니다.</p>' +
      (pend ? box("warn", "입금 확인 중: <b>" + esc(OM.won(pend.amount)) + "</b> (" + esc(when(pend.created_at).d) + ' 신청). <a href="?topup=1">입금 안내 보기</a>') : "") +
      (led.length ? '<ul class="sp-log" style="font-size:13.5px;margin-bottom:14px">' + led.map(function (x) {
        return "<li><time>" + esc(when(x.created_at).d.slice(5)) + "</time><div>" + esc(L.ledger[x.kind] || x.kind) + ' <b class="sp-num">' + esc(signed(x.amount)) + "</b>" + (x.note ? '<br><small class="om-dim">' + esc(x.note) + "</small>" : "") + "</div></li>";
      }).join("") + "</ul>" : "") +
      '<div class="om-actions"><a class="btn primary sm" href="?topup=1">충전 신청</a>' + (led.length ? '<a class="om-link" href="?topup=1#history">전체 내역</a>' : "") + "</div></div>";

    var orders = rows.length ? "" : emptyCard("아직 의뢰가 없습니다",
      "시료 종류와 서비스를 고르고 시료 목록을 붙여 넣으면 바로 의뢰할 수 있습니다.<br>주말 · 저녁 수거도 됩니다.",
      '<a class="btn primary" href="?new=1">새 의뢰 시작하기</a>' + kakaoBtn("먼저 상담하기"));
    if (active.length) orders += '<div class="om-card"><h2>진행 중</h2><ul class="om-list">' + active.map(li).join("") + "</ul></div>";
    if (done.length) orders += '<div class="om-card"><h2>완료 · 취소</h2><ul class="om-list">' + done.map(li).join("") + "</ul></div>";

    main.innerHTML =
      '<div class="om-head"><div><h1>내 의뢰</h1><p>' + esc(me.profile.name || "") + "님의 시료 의뢰와 충전금입니다.</p></div>" +
      '<a class="btn primary" href="?new=1">새 의뢰</a></div>' + draftNote +
      '<div class="sp-layout"><div>' + orders + '</div><aside class="sp-aside">' + credit + "</aside></div>";
  }

  // ───────── 시료 목록: 붙여 넣기 · 값 정리 · 검사 ─────────
  var COLS = ["name", "collected_on", "amount"];
  var COLNAME = { name: "시료명", collected_on: "채취일", amount: "양" };
  function amountWord(t) { return t && /\//.test(t.unit || "") ? "농도" : "양"; }
  function unitKey(u) { return String(u || "").toLowerCase().replace(/\s+/g, "").replace(/[μµ]/g, "u"); }
  // "3 mL" → "3", "1,000" → "1000". 단위가 다르거나("300 uL") 알아볼 수 없으면 그대로 두고 오류로 알립니다.
  function normAmount(v, unit) {
    v = trim(v).replace(/^약\s*/, "");
    var m = v.match(/^([0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)\s*(\D.*)?$/);
    if (!m) return v;
    var n = m[1], suf = trim(m[2]);
    if (suf && unitKey(suf) !== unitKey(unit)) return v;
    if (n.indexOf(",") >= 0) { if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) return v; n = n.replace(/,/g, ""); }
    return n;
  }
  function amountErr(a, t) {
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(a)) {
      if (/^\d+,\d+$/.test(a)) return "소수점은 점(.)으로 써 주세요 (예: 4.5).";
      if (/^[\d.,]+\s*\D/.test(a)) return "단위 없이 " + t.unit + " 기준 숫자만 적어 주세요.";
      return "숫자만 적어 주세요 (예: " + num(t.min) + ").";
    }
    var n = Number(a);
    if (n < +t.min) return "최소 " + num(t.min) + " " + t.unit + " 이상이어야 합니다.";
    if (n > +t.max) return "최대 " + num(t.max) + " " + t.unit + "입니다. 단위를 확인해 주세요.";
    return "";
  }
  function nameErr(nm) {
    if (SP.V.sampleName(nm)) return "";
    if (clen(nm) > 20) return "20자 이내로 줄여 주세요 (지금 " + clen(nm) + "자).";
    if (/\s/.test(nm)) return "띄어쓰기 대신 - 또는 _ 를 써 주세요.";
    // 처음 걸리는 글자를 알려 줌 (보이지 않는 글자는 U+ 번호로)
    var bad = Array.from(nm).filter(function (ch) { return !/[A-Za-z0-9_-]/.test(ch); })[0];
    if (!bad) return "영문 · 숫자 · - · _ 만 쓸 수 있습니다.";
    var shown = /[\u0000-\u001f\u007f-\u00a0\u00ad\u2000-\u200f\u2028-\u202f\u205f-\u206f]/.test(bad)
      ? "보이지 않는 글자(U+" + ("000" + bad.charCodeAt(0).toString(16).toUpperCase()).slice(-4) + ")" : '"' + bad + '"';
    return "쓸 수 없는 글자가 있습니다: " + shown + ". 영문 · 숫자 · - · _ 만 쓸 수 있습니다.";
  }
  function hoursOf(t) { return t && t.hours != null && t.hours !== "" ? +t.hours : null; }
  // 채취 시각은 받지 않으므로 채취일을 하루 통째로 셉니다: (수거일 − 채취일 + 1) × 24 ≤ hours (sp_save_order 와 같은 규칙)
  // 48시간 → 채취일 다음 날까지, 24시간 → 채취 당일, 72시간 → 채취일 포함 3일째까지
  function lastPick(cd, h) { return SP.addDays(cd, Math.floor(h / 24) - 1); }
  function dueText(h) { var n = Math.floor(h / 24); return n <= 1 ? "채취 당일" : n === 2 ? "채취일 다음 날" : "채취일 포함 " + n + "일째"; }
  function hoursText(h) { return "채취 후 " + h + "시간 안 (채취 시각을 받지 않아 " + dueText(h) + "까지 수거)"; }
  function blankRow(s) { return !trim(s.name) && !trim(s.collected_on) && !trim(s.amount); }
  // 시료마다 { name, collected_on, amount: 오류 문장, warn: { 칸: 경고 } } (빈 줄은 null)
  // 채취 후 수거 기한은 가장 빠른 수거일(firstDay: 오늘 마감 · 주말 규칙 반영) 기준으로 막고,
  // 고른 수거일과의 차이는 4단계(수거일 칸)에서 막습니다.
  function sampleChecks(list, t, pickDate, firstDay) {
    var today = SP.todayKST(), h = hoursOf(t), seen = {};
    list.forEach(function (s, i) { if (blankRow(s)) return; var k = trim(s.name).toLowerCase(); if (k) (seen[k] = seen[k] || []).push(i); });
    return list.map(function (s, i) {
      if (blankRow(s)) return null;
      var e = { warn: {} }, nm = trim(s.name), cd = trim(s.collected_on), a = trim(s.amount);
      if (!nm) e.name = "시료명을 입력해 주세요.";
      else if (nameErr(nm)) e.name = nameErr(nm);
      else if (seen[nm.toLowerCase()].length > 1) {
        var other = seen[nm.toLowerCase()].filter(function (j) { return j !== i; })[0];
        e.name = (other + 1) + "번째 줄과 이름이 같습니다 (대소문자 구분 없음).";
      }
      if (!cd) e.collected_on = "채취일을 입력해 주세요.";
      else if (!isoOk(cd)) e.collected_on = "날짜를 " + today + "처럼 써 주세요.";
      else if (cd > today) e.collected_on = "채취일이 오늘보다 뒤입니다. 날짜를 확인해 주세요.";
      else {
        if (h != null) {
          var last = lastPick(cd, h);
          if (firstDay && last < firstDay) e.collected_on = "채취 후 " + h + "시간 안에 수거할 수 있는 날이 남지 않았습니다 (가장 빠른 수거일 " + SP.dateLabel(firstDay) + "). 시료를 다시 채취해 주세요.";
          else if (!firstDay && last < today) e.collected_on = "채취 후 " + h + "시간이 지나 접수할 수 없습니다. 시료를 다시 채취해 주세요.";
          else if (isoOk(pickDate) && pickDate > last) e.warn.collected_on = "고른 수거일로는 늦습니다. 다음 단계에서 수거일을 " + SP.dateLabel(last) + "까지로 당겨 주세요.";
        }
        if (!e.collected_on && cd < SP.addDays(today, -365)) e.warn.collected_on = "1년 넘게 지난 날짜입니다. 맞는지 확인해 주세요.";
      }
      if (!a) e.amount = "양을 입력해 주세요.";
      else if (t) { var ae = amountErr(a, t); if (ae) e.amount = ae; }
      return e;
    });
  }
  function hasErr(e) { return !!(e && (e.name || e.collected_on || e.amount)); }

  // 엑셀(탭) · CSV 를 줄과 칸으로 나눔. sep 한 글자로만 나누고, 칸 맨 앞에서 열린 따옴표 안의 sep 은 그대로 둡니다 ("4,5").
  function splitCsv(line, sep) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && !trim(cur)) q = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  }
  // 구분 문자는 붙여 넣은 내용 전체에서 하나만 고릅니다: 탭이 있으면 탭, 없으면 ; 가 있으면 ;, 그 밖에는 쉼표.
  // (쉼표와 ; 로 함께 나누면 "CASE-01;2026-10-14;4,5" 의 4,5 가 두 칸으로 갈라짐)
  // 돌려주는 배열의 .sep 에 고른 구분 문자를 적어 둡니다.
  function splitRows(text) {
    text = String(text || "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n").filter(function (l) { return trim(l) !== ""; });
    var sep = /\t/.test(text) ? "\t" : /;/.test(text) ? ";" : /,/.test(text) ? "," : "";
    function cellsOf(cells) { return cells.map(function (c) { return trim(trim(clean(c)).replace(/^"([\s\S]*)"$/, "$1")); }); }
    // 한 줄에 쉼표로 늘어놓은 시료명 ("CASE-01, CASE-02, CASE-03") 은 시료명만 있는 여러 줄로
    if (lines.length === 1 && sep !== "\t") {
      var parts = cellsOf(splitCsv(lines[0], ","));
      var letters = parts.filter(function (x) { return /[A-Za-z]/.test(x); }).length;
      if (parts.length >= 2 && parts.every(function (x) { return SP.V.sampleName(x) && !dateLike(x); }) && (letters === 0 || letters === parts.length)) {
        var one = parts.map(function (x) { return [x]; }); one.sep = ","; one.list = true; return one;
      }
    }
    var rows = lines.map(function (l) {
      var ws = trim(l).split(/\s+/);
      return cellsOf(sep ? splitCsv(l, sep) : ws.length === 3 ? ws : [l]);
    });
    rows.sep = sep;
    return rows;
  }
  var HEAD = { amount: /양|량|농도|부피|무게|용량|^(amount|volume|vol|conc(entration)?|mass|weight|qty)\b/i, collected_on: /채취|날짜|일자|일시|^(date|collected)/i, name: /시료|이름|명|^(sample|name|id)\b/i };
  function dateLike(c) { return isoOk(SP.normDate(c)); }
  // 머리글 줄인지: 날짜나 숫자처럼 보이는 칸이 있으면 머리글이 아님 ("CASE-01 ⇥ ⇥ 50 ⇥ 재채취 필요" 는 시료 줄)
  function isHeader(row) {
    return !row.some(dateLike) && !row.some(function (c) { return /^[\d.,]+$/.test(c); }) && row.some(function (c) {
      return /[가-힣]/.test(c) ? (HEAD.amount.test(c) || HEAD.collected_on.test(c) || HEAD.name.test(c))
        : /^(sample[ _]?(name|id)?|name|id|date|collected[ _]?(on|date)?|amount|volume|vol|conc(entration)?|mass|weight)(\s*\(.*\))?$/i.test(c);
    });
  }
  function frac(rows, j, test) {
    var n = 0, k = 0;
    rows.forEach(function (r) { var c = r[j]; if (c) { k++; if (test(c)) n++; } });
    return k ? n / k : 0;
  }
  // 어느 열이 시료명 · 채취일 · 양인지: 머리글이 있으면 머리글로, 없으면 값의 모양으로 짐작.
  // 머리글에 양 열 후보가 여럿이면(부피 · 농도) 시료 단위(t.unit)로 고르고, 그래도 여럿이면 양은 비워 둡니다 (c.note 에 이유).
  function guessCols(head, rows, t) {
    var w = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([1]));
    var c = { name: -1, collected_on: -1, amount: -1, note: "" }, used = {}, fixed = false;
    if (head) {
      var cand = [], wrong = "";
      for (var j = 0; j < head.length; j++) {
        if (!HEAD.amount.test(head[j])) continue;
        var u = head[j].match(/[(\[]\s*([^)\]]+?)\s*[)\]]/);
        // 머리글에 적힌 단위가 접수 기준 단위와 다르면 그 열은 쓰지 않음 (예: DNA 의 "부피(uL)")
        if (u && t && unitKey(u[1]) !== unitKey(t.unit)) { used[j] = 1; wrong = wrong || u[1]; continue; }
        cand.push(j);
      }
      if (cand.length > 1) {
        var conc = !!(t && /\//.test(t.unit || ""));
        var pref = cand.filter(function (k) { return /농도|conc/i.test(head[k]) === conc; });
        if (pref.length) cand = pref;
      }
      if (cand.length === 1) { c.amount = cand[0]; used[cand[0]] = 1; }
      else if (cand.length > 1) { cand.forEach(function (k) { used[k] = 1; }); fixed = true; c.note = "양 열을 고를 수 없어 비워 두었습니다. 직접 입력해 주세요."; }
      else if (wrong) { fixed = true; c.note = amountWord(t) + " 열의 단위(" + wrong + ")가 접수 기준 단위(" + t.unit + ")와 달라 비워 두었습니다. " + t.unit + " 기준으로 직접 입력해 주세요."; }
      ["collected_on", "name"].forEach(function (k) {
        for (var j = 0; j < head.length; j++) if (!used[j] && HEAD[k].test(head[j])) { c[k] = j; used[j] = 1; break; }
      });
    }
    // 값이 하나도 없는 열은 고르지 않음
    function free(j) { return !used[j] && j < w && rows.some(function (r) { return !!r[j]; }); }
    if (c.collected_on < 0) {
      var best = -1, bf = 0.5;
      for (var j = 0; j < w; j++) if (free(j)) { var f = frac(rows, j, dateLike); if (f >= bf) { bf = f; best = j; } }
      if (best >= 0) { c.collected_on = best; used[best] = 1; }
    }
    if (c.amount < 0 && !fixed) {
      for (var a = w - 1; a >= 0; a--) if (free(a) && frac(rows, a, function (x) { return /^(\d[\d,]*(\.\d+)?|\.\d+)\s*\D{0,8}$/.test(x); }) >= 0.5) { c.amount = a; used[a] = 1; break; }
    }
    if (c.name < 0) {
      for (var n = 0; n < w; n++) if (free(n) && frac(rows, n, function (x) { return /[A-Za-z]/.test(x); }) >= 0.5) { c.name = n; used[n] = 1; break; }
      for (n = 0; c.name < 0 && n < w; n++) if (free(n)) { c.name = n; used[n] = 1; }
    }
    return c;
  }

  // ───────── 새 의뢰 · 의뢰 고치기 (5단계) ─────────
  async function wizard(editId) {
    var STEPS = ["시료 종류", "서비스", "시료 목록", "수거 · 연락", "결제 · 확인"];
    var key = editId ? DRAFT + "-" + editId : DRAFT;
    var crit = S.criteria || {}, TYPES = crit.types || {}, SERV = crit.services || {};
    var step = 0, dirty = false, srvErr = null, checks = {}, undo = null, origin = "", order = null;
    var D = { sample_type: "", service: "", samples: [], lab_name: "", pi_name: "", contact_phone: "", pickup_date: "", pickup_slot: "",
              pickup_addr: "", pickup_addr2: "", irb_no: "", leftover: "undecided", memo: "", pay_method: "", biz_name: "", biz_no: "", invoice_email: "" };

    var res = await Promise.all([
      sb.rpc("sp_balance"),
      sb.from("sp_topups").select("amount").eq("user_id", uid).eq("status", "requested").limit(1),
      editId ? sb.from("sp_orders").select("*").eq("id", editId).eq("client_id", uid).maybeSingle()
             : sb.from("sp_orders").select("lab_name,pi_name,contact_phone,pickup_addr,pickup_addr2,leftover,pay_method,biz_name,biz_no,invoice_email").eq("client_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    var bal = OM.unwrap(res[0]) || 0, pend = (OM.unwrap(res[1]) || [])[0], prev = OM.unwrap(res[2]);
    var PREFILL = ["lab_name", "pi_name", "contact_phone", "pickup_addr", "pickup_addr2", "leftover", "pay_method", "biz_name", "biz_no", "invoice_email"];

    if (editId) {
      order = prev;
      if (!order) return notFound();
      if (order.status !== "submitted") {
        var backBtn = '<a class="btn ' + (order.status === "cancelled" ? "ghost" : "primary") + '" href="?id=' + encodeURIComponent(editId) + '">의뢰로 돌아가기</a>';
        // 상태마다 고칠 수 없는 이유가 다름 (취소 · 반려 = cancelled, 완료, 그 밖 = 확정 뒤 진행 중)
        if (order.status === "cancelled") main.innerHTML = emptyCard("취소된 의뢰는 고칠 수 없습니다", "다시 맡기려면 새 의뢰로 접수해 주세요.",
          '<a class="btn primary" href="?new=1">새 의뢰 시작하기</a>' + backBtn);
        else if (order.status === "completed") main.innerHTML = emptyCard("완료된 의뢰입니다", "바꿀 내용이 있으면 카카오톡 채널로 알려 주세요.", backBtn + kakaoBtn());
        else main.innerHTML = emptyCard("접수가 확정되어 고칠 수 없습니다", "바꿀 내용이 있으면 카카오톡 채널로 알려 주세요. 의뢰번호 " + esc(order.order_no) + "를 함께 적어 주시면 빨리 찾습니다.",
          backBtn + kakaoBtn());
        return;
      }
      ["sample_type", "service", "pickup_date", "pickup_slot", "irb_no", "memo"].concat(PREFILL).forEach(function (k) { D[k] = order[k] == null ? "" : String(order[k]); });
      D.contact_phone = SP.fmtPhone(D.contact_phone);
      var ss = OM.unwrap(await sb.from("sp_samples").select("seq,name,collected_on,amount").eq("order_id", editId).order("seq"));
      D.samples = ss.map(function (s) { return { name: s.name, collected_on: s.collected_on, amount: String(s.amount) }; });
    } else if (prev) {
      PREFILL.forEach(function (k) { if (prev[k]) D[k] = String(prev[k]); });
      D.contact_phone = SP.fmtPhone(D.contact_phone);
      origin = "prev";
    } else {
      D.contact_phone = SP.fmtPhone(me.profile.phone || "");
      D.lab_name = me.profile.org || "";
    }
    var dr = load(key);
    if (draftUsable(dr) && (!editId || dr.at > Date.parse(order.updated_at))) {
      Object.keys(D).forEach(function (k) { if (dr.d[k] != null) D[k] = dr.d[k]; });
      if (!Array.isArray(D.samples)) D.samples = [];
      step = +dr.step || 0; origin = "draft"; dirty = true;
    }
    D.samples.forEach(function (s) { if (!blankRow(s)) s.seen = { name: 1, collected_on: 1, amount: 1 }; });
    while (D.samples.length < 3) D.samples.push({ name: "", collected_on: "", amount: "" });

    // ── 현재 값으로 계산하는 것들 ──
    function curType() { return TYPES[D.sample_type] || null; }
    function serviceErr() {
      var s = SERV[D.service];
      if (!s) return "서비스를 골라 주세요.";
      if ((s.types || []).indexOf(D.sample_type) < 0) return "이 시료로는 할 수 없는 서비스입니다. 다시 골라 주세요.";
      return "";
    }
    function filled() { return D.samples.filter(function (s) { return !blankRow(s); }); }
    function maxSamples() { return crit.max_samples == null ? 200 : +crit.max_samples; }
    // 검사는 정리한 값으로 합니다: 칸을 떠날 때 정리될 값("50 mg" → 50, "2026.10.14" → 2026-10-14)은 입력 중에도 통과로 봄
    function sampleState() {
      var t = curType(), unit = t ? t.unit : "";
      var norm = D.samples.map(function (s) { return { name: s.name, collected_on: SP.normDate(s.collected_on || ""), amount: normAmount(s.amount || "", unit), seen: s.seen }; });
      var errs = sampleChecks(norm, t, D.pickup_date, firstPickDay()), n = 0, bad = 0, shownBad = 0;
      errs.forEach(function (e, i) {
        if (!e) return; n++;
        if (hasErr(e)) { bad++; if (COLS.some(function (c) { return e[c] && (D.samples[i].seen || {})[c]; })) shownBad++; }
      });
      return { errs: errs, n: n, bad: bad, shownBad: shownBad, ok: n >= 1 && n <= maxSamples() && bad === 0 };
    }

    // 수거 규칙 (sp_pickup)
    function pk() {
      var p = S.pickup || {};
      return { weekend: !(p.weekend === false || p.weekend === "false"), lead: p.lead_hours == null ? 2 : +p.lead_hours,
               ahead: p.max_days_ahead == null ? 60 : +p.max_days_ahead, slots: p.slots || {} };
    }
    function slotKeys() { var s = pk().slots; return Object.keys(s).sort(function (a, b) { return (+s[a].start) - (+s[b].start); }); }
    // 그 날짜에 이 시간대를 고를 수 있는지: 오늘이면 시작 시각까지 lead_hours 시간 이상 남아야 함 (분 단위로 셈: 11:59 에 13시 시간대는 61분 전이라 2시간 기준이면 마감)
    function slotOpen(date, k) {
      var p = pk(), s = p.slots[k]; if (!s) return false;
      return date !== SP.todayKST() || (+s.start) * 60 - nowMinKST() >= p.lead * 60;
    }
    function todayOpen() { var t = SP.todayKST(); return slotKeys().some(function (k) { return slotOpen(t, k); }); }
    function weekend(iso) { var d = SP.dow(iso); return d === 0 || d === 6; }
    function lastDay() { return SP.addDays(SP.todayKST(), pk().ahead); }
    // 지금 고를 수 있는 가장 빠른 수거일 (오늘 마감 · 주말 규칙 반영). 없으면 null
    function firstPickDay() {
      var today = SP.todayKST(), end = lastDay(), p = pk();
      for (var d = today; d <= end; d = SP.addDays(d, 1)) {
        if ((d !== today || todayOpen()) && (p.weekend || !weekend(d))) return d;
      }
      return null;
    }
    // 채취 후 수거 기한(type.hours)을 넘기는 시료: [{ s, last }]
    function lateSamples(date) {
      var h = hoursOf(curType()); if (h == null || !isoOk(date)) return [];
      return filled().map(function (s) { var c = SP.normDate(trim(s.collected_on)); return { s: s, last: isoOk(c) ? lastPick(c, h) : null }; })
        .filter(function (x) { return x.last && date > x.last; });
    }
    function deadline() { // 시료 기준 가장 늦은 수거일
      var h = hoursOf(curType()), d = null; if (h == null) return null;
      filled().forEach(function (s) { var c = SP.normDate(trim(s.collected_on)); if (isoOk(c)) { var l = lastPick(c, h); if (!d || l < d) d = l; } });
      return d;
    }
    function dateErr(d) {
      var p = pk(), today = SP.todayKST();
      if (!isoOk(d)) return "수거 희망일을 골라 주세요.";
      if (d < today) return "지난 날짜입니다. 오늘이나 그 뒤 날짜를 골라 주세요.";
      if (d > lastDay()) return "수거일은 " + SP.dateLabel(lastDay()) + "까지 고를 수 있습니다.";
      if (!p.weekend && weekend(d)) return "주말에는 수거하지 않습니다. 평일을 골라 주세요.";
      if (d === today && !todayOpen()) return "오늘 수거는 모두 마감됐습니다. 내일 이후로 골라 주세요.";
      var late = lateSamples(d), h = hoursOf(curType());
      if (late.length) {
        return "채취 후 " + h + "시간 안(채취 시각을 받지 않아 " + dueText(h) + "까지) 수거해야 하는 시료가 있습니다: " + late.slice(0, 3).map(function (x) {
          return trim(x.s.name) + " (" + SP.dateLabel(x.last) + "까지)";
        }).join(", ") + (late.length > 3 ? " 외 " + (late.length - 3) + "개" : "") + ". 수거일을 당기거나 시료 목록을 고쳐 주세요.";
      }
      return { ok: SP.dateLabel(d) + (d === today ? " · 오늘" : d === SP.addDays(today, 1) ? " · 내일" : "") };
    }
    function slotErr(d, k) {
      var s = pk().slots[k];
      if (!k || !s) return "수거 시간대를 골라 주세요.";
      if (isoOk(d) && !slotOpen(d, k)) return "오늘 " + s.label + " 수거는 마감됐습니다. 더 늦은 시간대나 다른 날을 골라 주세요.";
      return "";
    }
    var R3 = {
      pickup_date: function () { return dateErr(D.pickup_date); },
      pickup_slot: function () { return slotErr(D.pickup_date, D.pickup_slot); },
      pickup_addr: function () {
        if (clen(trim(D.pickup_addr)) >= 6 && /[0-9]/.test(D.pickup_addr)) return "";
        return clen(trim(D.pickup_addr)) < 6 ? "도로명 주소를 건물 번호까지 입력해 주세요 (예: 대전 유성구 대학로 291)." : "건물 번호(숫자)까지 입력해 주세요 (예: 대학로 291).";
      },
      pickup_addr2: function () { return minLen(D.pickup_addr2, 2, "건물 · 층 · 호실을 입력해 주세요 (예: E16 5층 512호)."); },
      lab_name: function () { return minLen(D.lab_name, 2, "기관 · 연구실 이름을 2자 이상 입력해 주세요."); },
      pi_name: function () { return minLen(D.pi_name, 2, "연구책임자 이름을 2자 이상 입력해 주세요."); },
      contact_phone: function () { return phoneRule(D.contact_phone, "현장에서 연락받을 휴대폰 번호를 입력해 주세요."); },
      leftover: function () { return L.leftover[D.leftover] ? "" : "남은 시료 처리 방법을 골라 주세요."; },
      irb_no: function () { return clen(trim(D.irb_no)) <= 60 ? "" : "IRB 번호는 60자 이내로 적어 주세요 (지금 " + clen(trim(D.irb_no)) + "자)."; },
      memo: function () { var n = clen(trim(D.memo)); return n <= 1000 ? (n ? { ok: n + " / 1000자" } : "") : "요청 사항은 1000자 이내로 적어 주세요 (지금 " + n + "자)."; }
    };
    var R3_ORDER = ["pickup_date", "pickup_slot", "pickup_addr", "pickup_addr2", "lab_name", "pi_name", "contact_phone", "leftover", "irb_no", "memo"];
    var R4 = {
      biz_name: function () { return D.pay_method !== "invoice" ? "" : minLen(D.biz_name, 2, "세금계산서 받을 기관명(상호)을 입력해 주세요 (예: OO대학교 산학협력단)."); },
      invoice_email: function () { return D.pay_method !== "invoice" ? "" : emailRule(D.invoice_email, "세금계산서 받을 메일 주소를 입력해 주세요.", "invoice_email"); },
      biz_no: function () { return D.pay_method !== "invoice" ? "" : bizNoRule(D.biz_no); }
    };
    var R4_ORDER = ["biz_name", "invoice_email", "biz_no"];
    // 오타 의심 주소({ block })도 고르기 전까지는 오류로 셈
    function errOf(r) { return typeof r === "string" ? r : r && r.block ? r.warn || "메일 주소를 확인해 주세요." : ""; }
    function valid(k) {
      if (k === 0) return !!curType();
      if (k === 1) return !serviceErr();
      if (k === 2) return sampleState().ok;
      if (k === 3) return R3_ORDER.every(function (n) { return !errOf(R3[n]()); });
      return !!L.pay[D.pay_method] && R4_ORDER.every(function (n) { return !errOf(R4[n]()); });
    }
    function reachable(k) { for (var j = 0; j < k; j++) if (!valid(j)) return false; return true; }
    function furthest() { var k = 0; while (k < 4 && valid(k)) k++; return k; }

    // ── 임시 저장 ──
    var saveT;
    function changed() {
      dirty = true; clearTimeout(saveT);
      saveT = setTimeout(function () { store(key, { v: 1, at: Date.now(), step: step, d: D }); }, 250);
      paintAside(); paintStepper();
    }

    // ── 뼈대 ──
    var backHref = editId ? "?id=" + encodeURIComponent(editId) : "./";
    main.innerHTML =
      '<p class="om-dim"><a href="' + backHref + '">← ' + (editId ? "의뢰로 돌아가기" : "내 의뢰") + "</a></p>" +
      '<div class="om-head"><div><h1>' + (editId ? '<span class="sp-num">' + esc(order.order_no) + "</span> 고치기" : "새 의뢰") + '</h1><p id="wz-sub"></p></div></div>' +
      '<div id="wz-stepper"></div>' +
      '<div class="sp-layout"><div id="wz-pane"></div><aside class="sp-aside" id="wz-aside"></aside></div>';
    paintSub();

    function paintSub() {
      var el = OM.$("#wz-sub");
      if (origin === "draft") {
        el.innerHTML = "작성하던 내용을 불러왔습니다. " + '<button type="button" class="om-link" id="wz-reset">' + (editId ? "저장된 내용으로 되돌리기" : "처음부터 새로 쓰기") + "</button>";
        var b = OM.$("#wz-reset"), armed = false;
        b.onclick = function () {
          if (!armed) { armed = true; b.textContent = "작성하던 내용이 지워집니다. 한 번 더 누르면 지웁니다"; setTimeout(function () { armed = false; if (b.isConnected) b.textContent = editId ? "저장된 내용으로 되돌리기" : "처음부터 새로 쓰기"; }, 4000); return; }
          store(key, null); location.replace(location.pathname + location.search);
        };
      } else el.textContent = editId ? "접수 확정 전까지 고칠 수 있습니다. 고친 뒤 마지막 단계에서 저장해 주세요." : "다섯 단계로 끝납니다. 접수 기준에 맞지 않는 값은 입력하는 자리에서 바로 알려 드립니다.";
    }
    function paintStepper() {
      OM.$("#wz-stepper").innerHTML = '<ol class="sp-stepper" aria-label="의뢰 단계">' + STEPS.map(function (s, k) {
        // 좁은 화면(560px 미만)에서는 지금 단계가 아닌 단계의 이름(.sp-st-l)을 CSS 가 숨기고 번호만 보임
        var cls = k < step ? "done" : k === step ? "now" : "", t = (k + 1) + ". " + s;
        var inner = '<span class="sp-st-n">' + (k + 1) + '.</span> <span class="sp-st-l">' + esc(s) + "</span>";
        var link = k !== step && reachable(k);
        return '<li class="' + cls + '" aria-label="' + esc(t) + '"' + (k === step ? ' aria-current="step"' : "") + ">" +
          (link ? '<a href="#s' + k + '" aria-label="' + esc(t) + '" style="color:inherit;text-decoration:none">' + inner + "</a>" : inner) + "</li>";
      }).join("") + "</ol>";
    }
    function dl(rows) {
      return '<dl class="om-dl" style="grid-template-columns:76px minmax(0,1fr);gap:6px 10px;font-size:14px">' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>";
    }
    function paintAside() {
      var t = curType(), sv = SERV[D.service], st = sampleState(), h = hoursOf(t), slot = pk().slots[D.pickup_slot];
      OM.$("#wz-aside").innerHTML =
        '<div class="om-card"><h3>의뢰 요약</h3>' + dl([
          ["시료", t ? esc(t.name) : "-"],
          ["서비스", sv ? esc(sv.name) : "-"],
          ["시료 수", st.n ? esc(st.n) + "개 " + (st.bad ? '<span class="om-chip sp-qc-fail">' + esc(st.bad) + "개 확인 필요</span>" : st.n > maxSamples() ? '<span class="om-chip sp-qc-fail">너무 많음</span>' : '<span class="om-chip sp-qc-pass">기준 통과</span>') : "-"],
          ["수거", isoOk(D.pickup_date) ? esc(SP.dateLabel(D.pickup_date)) + (slot ? "<br>" + esc(slot.label) : "") : "-"],
          ["결제", L.pay[D.pay_method] ? esc(L.pay[D.pay_method]) : "-"]
        ]) + "</div>" +
        (t ? '<div class="om-card"><h3>' + esc(t.name) + " 접수 기준</h3>" + dl([
          [esc(amountWord(t)), esc(num(t.min)) + "–" + esc(num(t.max)) + " " + esc(t.unit)],
          ["운송", esc(t.ship || "-")],
          ["수거 기한", h != null ? esc(hoursText(h)) : "제한 없음"]
        ]) + "</div>" : "") +
        '<div class="om-card"><p class="om-dim" style="margin:0">작성 중인 내용은 이 기기에 자동으로 저장됩니다. 궁금한 점은 <a href="' + OM.KAKAO + '" target="_blank" rel="noopener">카카오톡 채널</a>로 물어보세요.</p></div>';
    }

    // ── 단계 이동 (브라우저 뒤로 가기 = 이전 단계) ──
    function want() { var m = /^#s(\d)$/.exec(location.hash); return m ? +m[1] : null; }
    function go(k) { if (want() === k) show(k); else location.hash = "s" + k; }
    window.addEventListener("hashchange", function () { var k = want(); show(k == null ? 0 : k); });
    var first = want() != null ? want() : step;
    show(first, true);

    function show(k, initial) {
      k = Math.max(0, Math.min(k, 4));
      if (!reachable(k)) k = Math.min(k, furthest());
      if (want() !== k) history.replaceState(null, "", location.pathname + location.search + "#s" + k);
      if (k < 4) checks = {};
      if (srvErr && srvErr.step !== k) srvErr = null;
      step = k;
      paintStepper(); paintAside();
      [step0, step1, step2, step3, step4][k]();
      if (dirty) store(key, { v: 1, at: Date.now(), step: step, d: D });
      // 단계가 바뀌면 키보드 · 화면 읽기 프로그램 위치를 새 단계 제목으로 (오류 칸으로 이미 옮겼으면 그대로)
      if (!initial) {
        var pn = OM.$("#wz-pane"), h2 = pn.querySelector("h2");
        if (h2 && !pn.contains(document.activeElement)) { h2.setAttribute("tabindex", "-1"); h2.focus({ preventScroll: true }); }
      }
      // 단계가 바뀌면 단계 표시가 보이도록 (위에 붙어 있는 머리글 높이만큼 띄움)
      if (!initial) {
        var top = OM.$("#wz-stepper"), hdr = document.querySelector("header.top");
        var off = Math.max(0, hdr ? hdr.getBoundingClientRect().bottom : 0) + 12, y = top.getBoundingClientRect().top;
        if (y < off) window.scrollTo(0, y + window.scrollY - off);
      }
    }
    function pane(html, nextLabel, nextDisabled) {
      OM.$("#wz-pane").innerHTML = '<div class="om-card" style="display:grid;gap:18px">' +
        (srvErr && srvErr.step === step ? '<div class="sp-callout err" role="alert">' + esc(srvErr.msg) + (srvErr.locked ? ' <a href="?id=' + encodeURIComponent(editId) + '">의뢰 보기</a>' : "") + "</div>" : "") +
        html +
        '<div class="om-actions" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:16px">' +
        (step ? '<button type="button" class="btn ghost" id="wz-prev">← 이전</button>' : '<a class="btn ghost" href="' + backHref + '">나중에 하기</a>') +
        '<span style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:flex-end;flex:1">' +
        '<span class="sp-msg err" id="wz-why" role="alert"></span>' +
        '<button type="button" class="btn primary" id="wz-next"' + (nextDisabled ? ' disabled style="cursor:not-allowed"' : "") + ">" + esc(nextLabel) + "</button></span></div></div>";
      var pv = OM.$("#wz-prev"); if (pv) pv.onclick = function () { go(step - 1); };
    }
    function why(msg) { var w = OM.$("#wz-why"); if (w) w.textContent = msg || ""; }
    function nextLabel() { return "다음: " + STEPS[step + 1]; }
    function picks(keys, html) { return '<div class="sp-picks" role="group">' + keys.map(html).join("") + "</div>"; }

    // ── 1단계: 시료 종류 ──
    function step0() {
      var keys = ordKeys(TYPES);
      if (!keys.length) {
        OM.$("#wz-pane").innerHTML = emptyCard("접수 기준을 준비하고 있습니다", "지금은 카카오톡 채널로 의뢰해 주세요.", kakaoBtn("카카오톡으로 의뢰하기"));
        return;
      }
      pane('<div><h2 style="margin-bottom:6px">어떤 시료를 보내시나요?</h2><p class="om-dim" style="margin:0">고른 시료에 맞춰 할 수 있는 서비스와 접수 기준(양 · 운송 온도 · 수거 기한)을 보여 드립니다.</p></div>' +
        picks(keys, function (k) {
          var t = TYPES[k], h = hoursOf(t);
          return '<button type="button" class="sp-pick" data-k="' + esc(k) + '" aria-pressed="' + (D.sample_type === k) + '"><b>' + esc(t.name) + "</b>" +
            "<small>" + esc(num(t.min)) + "–" + esc(num(t.max)) + " " + esc(t.unit) + " · " + esc(t.ship || "") + "</small>" +
            (h != null ? "<small>" + esc(hoursText(h)) + "</small>" : "") + "</button>";
        }) + '<p class="sp-msg warn" id="wz-note"></p>', nextLabel());
      OM.$$("#wz-pane .sp-pick").forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.k, before = curType(), notes = [];
          if (k === D.sample_type) return;
          D.sample_type = k;
          if (D.service && serviceErr()) { notes.push("고른 서비스(" + SP.serviceName(crit, D.service) + ")는 이 시료로 할 수 없어 다시 골라야 합니다."); D.service = ""; }
          // 단위가 다르면 적어 둔 양을 새 단위로 읽지 않도록 비움 (50 mg 이 50만 개로 통과하는 것을 막음)
          if (before && filled().length && unitKey(before.unit) !== unitKey(TYPES[k].unit)) {
            filled().forEach(function (s) { s.amount = ""; s.seen = s.seen || {}; s.seen.amount = 1; });
            notes.push("단위가 바뀌어(" + before.unit + " → " + TYPES[k].unit + ") 시료 목록의 양을 비웠습니다. 3단계에서 다시 입력해 주세요.");
          }
          OM.$$("#wz-pane .sp-pick").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.k === k)); });
          OM.$("#wz-note").textContent = notes.join(" ");
          why(""); changed();
        };
      });
      OM.$("#wz-next").onclick = function () { if (!curType()) return why("시료 종류를 골라 주세요."); go(1); };
    }

    // ── 2단계: 서비스 ──
    function step1() {
      var t = curType(), keys = ordKeys(SERV);
      var ok = keys.filter(function (k) { return (SERV[k].types || []).indexOf(D.sample_type) >= 0; });
      var no = keys.filter(function (k) { return ok.indexOf(k) < 0; });
      pane('<div><h2 style="margin-bottom:6px">어떤 서비스가 필요하신가요?</h2><p class="om-dim" style="margin:0">' + "고른 시료(" + esc(t.name) + ")로 할 수 있는 서비스만 고를 수 있습니다.</p></div>" +
        (ok.length ? "" : box("warn", "이 시료로 할 수 있는 서비스가 없습니다. 시료 종류를 바꾸거나 카카오톡으로 문의해 주세요.")) +
        picks(ok.concat(no), function (k) {
          var allowed = ok.indexOf(k) >= 0;
          return '<button type="button" class="sp-pick" data-k="' + esc(k) + '" aria-pressed="' + (D.service === k) + '"' + (allowed ? "" : " disabled") + "><b>" + esc(SERV[k].name) + "</b><small>" + (allowed ? "이 시료로 가능" : "이 시료로는 불가") + "</small></button>";
        }), nextLabel());
      OM.$$("#wz-pane .sp-pick:not(:disabled)").forEach(function (b) {
        b.onclick = function () {
          D.service = b.dataset.k;
          OM.$$("#wz-pane .sp-pick").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.k === D.service)); });
          why(""); changed();
        };
      });
      OM.$("#wz-next").onclick = function () { var e = serviceErr(); if (e) return why(e); go(2); };
    }

    // ── 3단계: 시료 목록 ──
    function step2() {
      var t = curType(), aw = amountWord(t);
      pane('<div><h2 style="margin-bottom:6px">시료 목록</h2><p class="om-dim" style="margin:0">엑셀에서 <b>시료명 · 채취일 · ' + esc(aw) + "</b> 세 열을 복사해 아래 칸에 붙여 넣으면 한 번에 채워집니다. 표의 칸에 바로 붙여 넣어도 됩니다.</p></div>" +
        '<div class="om-form"><label>엑셀 · CSV 붙여 넣기 <small>예: CASE-01 ⇥ ' + esc(SP.todayKST()) + " ⇥ " + esc(num(t.min)) + " · 머리글 줄은 건너뜁니다</small>" +
        '<textarea class="sp-paste" id="sm-paste" rows="3" placeholder="여기에 붙여 넣기 (Ctrl+V · ⌘V)"></textarea></label></div>' +
        '<p class="sp-msg" id="sm-msg" role="status"></p>' +
        '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>' + (editId ? "라벨" : "번호") + "</th><th>시료명 <small>(영문 · 숫자 · - · _)</small></th><th>채취일</th><th>" + esc(aw) + " (" + esc(t.unit) + ")</th><th></th></tr></thead><tbody id=\"sm-rows\"></tbody></table></div>" +
        '<div class="om-actions"><button type="button" class="btn ghost sm" id="sm-add">한 줄 추가</button><button type="button" class="btn ghost sm" id="sm-clear">모두 지우기</button>' +
        '<details id="sm-bulk" style="flex:1 1 100%"><summary class="om-dim" style="cursor:pointer">빈 칸 한 번에 채우기 (채취일 · ' + esc(aw) + " 이 모두 같을 때)</summary>" +
        '<div class="om-form" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px">' +
        '<input type="text" id="bk-date" inputmode="numeric" placeholder="채취일 ' + esc(SP.todayKST()) + '" aria-label="한 번에 넣을 채취일" style="width:170px">' +
        '<input type="text" id="bk-amt" inputmode="decimal" placeholder="' + esc(aw) + " (" + esc(t.unit) + ')" aria-label="한 번에 넣을 ' + esc(aw) + '" style="width:150px">' +
        '<button type="button" class="btn ghost sm" id="bk-go">시료명이 있는 줄의 빈 칸에 넣기</button></div></details></div>' +
        (editId ? "" : '<p class="om-dim" style="margin:0">접수하면 시료마다 의뢰번호가 붙은 라벨(예: S-2610-0001-01)이 정해지고 의뢰 화면에서 인쇄할 수 있습니다. 튜브에는 시료명을 목록과 똑같이 적어 주세요.</p>') +
        '<div id="sm-sum"></div>', nextLabel(), true);
      drawRows();
      if (srvErr && srvErr.step === 2) focusFirstBad();

      var tb = OM.$("#sm-rows");
      tb.addEventListener("input", function (ev) {
        var inp = ev.target, tr = inp.closest("tr"); if (!inp.dataset.c || !tr) return;
        D.samples[+tr.dataset.i][inp.dataset.c] = inp.value;
        changed(); paintRows();
      });
      tb.addEventListener("change", function (ev) {
        var inp = ev.target, tr = inp.closest("tr"); if (!inp.dataset.c || !tr) return;
        var s = D.samples[+tr.dataset.i], c = inp.dataset.c, v = clean(inp.value);
        v = c === "collected_on" ? SP.normDate(v) : c === "amount" ? normAmount(v, t.unit) : trim(v);
        if (v !== inp.value) inp.value = v;
        s[c] = v; s.seen = s.seen || {}; s.seen[c] = 1;
        changed(); later(paintRows);
      });
      // Enter: 아래 줄 같은 칸으로 (마지막 줄이면 한 줄 추가)
      tb.addEventListener("keydown", function (ev) {
        var inp = ev.target; if (ev.key !== "Enter" || !inp.dataset.c) return;
        ev.preventDefault();
        var i = +inp.closest("tr").dataset.i;
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        if (i + 1 >= D.samples.length) { D.samples.push({ name: "", collected_on: "", amount: "" }); drawRows(); }
        var nx = OM.$('#sm-rows tr[data-i="' + (i + 1) + '"] [data-c="' + inp.dataset.c + '"]'); if (nx) nx.focus();
      });
      // 칸에 여러 줄 · 여러 칸을 붙여 넣으면 엑셀처럼 그 자리부터 채움
      tb.addEventListener("paste", function (ev) {
        var inp = ev.target; if (!inp.dataset.c) return;
        var text = (ev.clipboardData || window.clipboardData).getData("text") || "";
        if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return;
        ev.preventDefault();
        pasteAt(text, +inp.closest("tr").dataset.i, COLS.indexOf(inp.dataset.c));
      });
      tb.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-rm]"); if (!b) return;
        var i = +b.dataset.rm, s = D.samples[i];
        snapshot();
        D.samples.splice(i, 1);
        if (!D.samples.length) D.samples.push({ name: "", collected_on: "", amount: "" });
        drawRows(); changed();
        if (!blankRow(s)) msg((i + 1) + "번째 줄(" + (trim(s.name) || "이름 없음") + ")을 지웠습니다.", "ok", true);
      });
      var ta = OM.$("#sm-paste");
      ta.addEventListener("paste", function () { setTimeout(function () { if (trim(ta.value)) { applyText(ta.value); ta.value = ""; } }, 0); });
      ta.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && trim(ta.value)) { ev.preventDefault(); applyText(ta.value); ta.value = ""; } });
      OM.$("#sm-add").onclick = function () {
        D.samples.push({ name: "", collected_on: "", amount: "" }); drawRows();
        OM.$('#sm-rows tr[data-i="' + (D.samples.length - 1) + '"] [data-c="name"]').focus();
      };
      OM.$("#sm-clear").onclick = function () {
        if (!filled().length) return;
        snapshot(); D.samples = [{ name: "", collected_on: "", amount: "" }, { name: "", collected_on: "", amount: "" }, { name: "", collected_on: "", amount: "" }];
        drawRows(); changed(); msg("목록을 모두 지웠습니다.", "ok", true);
      };
      OM.$("#bk-go").onclick = function () {
        var bd = SP.normDate(OM.$("#bk-date").value), ba = normAmount(OM.$("#bk-amt").value, t.unit), today = SP.todayKST();
        if (!trim(bd) && !trim(ba)) return msg("넣을 채취일이나 " + aw + "을 적어 주세요.", "err");
        if (trim(bd) && (!isoOk(bd) || bd > today)) return msg("채취일을 " + today + "처럼, 오늘이나 그 전 날짜로 적어 주세요.", "err");
        if (trim(ba) && amountErr(ba, t)) return msg(aw + ": " + amountErr(ba, t), "err");
        var rows = D.samples.filter(function (s) { return trim(s.name); });
        if (!rows.length) return msg("먼저 시료명을 넣어 주세요.", "err");
        snapshot();
        var n = 0;
        rows.forEach(function (s) {
          s.seen = s.seen || {};
          if (trim(bd) && !trim(s.collected_on)) { s.collected_on = bd; s.seen.collected_on = 1; n++; }
          if (trim(ba) && !trim(s.amount)) { s.amount = ba; s.seen.amount = 1; n++; }
        });
        drawRows(); changed();
        msg(n ? "빈 칸 " + n + "개를 채웠습니다." : "채울 빈 칸이 없습니다. 이미 값이 있는 칸은 바꾸지 않습니다.", "ok", !!n);
      };
      OM.$("#wz-next").onclick = function () {
        var st = sampleState();
        if (!st.ok) return;
        // 칸을 떠나기 전이라 아직 정리되지 않은 값("50 mg", "2026.10.14")도 정리해서 저장
        D.samples = filled().map(function (s) {
          s.name = trim(s.name); s.collected_on = SP.normDate(trim(s.collected_on)); s.amount = normAmount(trim(s.amount), t.unit);
          return s;
        });
        changed(); go(3);
      };

      function snapshot() { undo = JSON.parse(JSON.stringify(D.samples)); }
      function msg(text, kind, canUndo) {
        var m = OM.$("#sm-msg");
        m.className = "sp-msg " + (kind || "");
        m.innerHTML = esc(text) + (canUndo && undo ? ' <button type="button" class="om-link" id="sm-undo">되돌리기</button>' : "");
        var u = OM.$("#sm-undo");
        if (u) u.onclick = function () { D.samples = undo; undo = null; drawRows(); changed(); msg("되돌렸습니다.", "ok"); };
      }
      function blank() { return { name: "", collected_on: "", amount: "" }; }
      // 붙여 넣은 표 → 시료 목록 (비어 있으면 채우고, 이미 있으면 뒤에 더함)
      function applyText(text) {
        var rows = splitRows(text), sep = rows.sep; if (!rows.length) return msg("붙여 넣은 내용이 없습니다.", "err");
        var head = !rows.list && isHeader(rows[0]) ? rows.shift() : null;
        if (!rows.length) return msg("머리글만 있고 시료 줄이 없습니다. 시료 줄까지 함께 복사해 주세요.", "err");
        // 값이 하나라도 있는 열만 셈 (빈 열 · 줄 끝의 빈 칸은 빼고)
        var w = Math.max.apply(null, rows.map(function (r) { return r.length; })), cols = 0;
        for (var j = 0; j < w; j++) if (rows.some(function (r) { return !!r[j]; })) cols++;
        // 머리글 없이 열이 4개 이상이면 어느 열이 무엇인지 짐작하지 않음 (부피를 양으로, 번호를 시료명으로 잘못 읽을 수 있음)
        if (!head && cols > 3) return msg("열이 4개 이상이면 어느 열이 시료명 · 채취일 · " + aw + "인지 알 수 없습니다. 머리글 줄(시료명 · 채취일 · " + aw + ")까지 함께 복사하거나 세 열만 복사해 주세요.", "err");
        var c = guessCols(head, rows, t), hn = head ? head.filter(Boolean).length : 0;
        var add = [], over = [];
        rows.forEach(function (r) {
          var s = { name: c.name >= 0 ? r[c.name] || "" : "", collected_on: c.collected_on >= 0 ? SP.normDate(r[c.collected_on] || "") : "", amount: c.amount >= 0 ? normAmount(r[c.amount] || "", t.unit) : "" };
          // 쉼표로 나눈 줄의 칸이 머리글보다 많으면 소수점 쉼표(4,5)로 칸이 밀렸을 수 있어 양을 비움
          var shifted = head && sep !== "\t" && r.filter(Boolean).length > hn;
          if (shifted) s.amount = "";
          s.seen = { name: 1, collected_on: 1, amount: 1 };
          if (blankRow(s)) return;
          if (shifted) over.push(add.length);
          add.push(s);
        });
        if (!add.length) return msg("붙여 넣은 내용에서 시료를 찾지 못했습니다. 시료명 · 채취일 · " + aw + " 열을 복사했는지 확인해 주세요.", "err");
        snapshot();
        var keep = filled();
        D.samples = keep.concat(add);
        drawRows(); changed();
        var map = cols > 1 ? " " + COLS.filter(function (k) { return c[k] >= 0; }).map(function (k) { return (k === "amount" ? aw : COLNAME[k]) + " = " + (c[k] + 1) + "열"; }).join(", ") + "로 읽었습니다." : " 시료명만 넣었습니다. 채취일과 " + aw + "도 채워 주세요.";
        var notes = [];
        if (c.note) notes.push(c.note);
        if (over.length) {
          var nums = over.map(function (k) { return keep.length + k + 1; });
          notes.push(nums.slice(0, 5).join(", ") + (nums.length > 5 ? " 외 " + (nums.length - 5) + "줄" : "") + "번째 줄은 칸 수가 머리글보다 많아 " + (aw === "농도" ? "농도를" : "양을") + " 비웠습니다. 소수점은 점(.)으로 써 주세요.");
        }
        msg(add.length + "줄을 " + (keep.length ? "목록 뒤에 더했습니다." : "넣었습니다.") + map + (head ? " 첫 줄(머리글)은 건너뛰었습니다." : "") + (notes.length ? " " + notes.join(" ") : ""), notes.length ? "warn" : "ok", true);
        var st = sampleState(); if (st.bad) focusFirstBad();
      }
      function pasteAt(text, i0, c0) {
        // 칸 값은 splitRows 가 정리(전각 → 반각, 보이지 않는 글자 제거)해서 돌려줌
        var rows = splitRows(text); if (rows.length && !rows.list && isHeader(rows[0])) rows.shift();
        if (!rows.length) return;
        snapshot();
        rows.forEach(function (r, k) {
          var i = i0 + k; while (D.samples.length <= i) D.samples.push(blank());
          var s = D.samples[i]; s.seen = s.seen || {};
          r.forEach(function (v, j) {
            var c = COLS[c0 + j]; if (!c) return;
            s[c] = c === "collected_on" ? SP.normDate(v) : c === "amount" ? normAmount(v, t.unit) : trim(v);
            s.seen[c] = 1;
          });
        });
        drawRows(); changed();
        msg(rows.length + "줄을 표에 붙여 넣었습니다.", "ok", true);
      }
    }
    function labelText(seq, pad) {
      var n = ("00" + seq).slice(-pad);
      return editId ? order.order_no + "-" + n : n;
    }
    function drawRows() {
      var t = curType();
      OM.$("#sm-rows").innerHTML = D.samples.map(function (s, i) {
        function cell(c, attrs) {
          return '<td><input type="text" data-c="' + c + '" value="' + esc(s[c] || "") + '" aria-label="' + (i + 1) + "번째 줄 " + esc(c === "amount" ? amountWord(t) : COLNAME[c]) + '" autocomplete="off" ' + attrs + '><span class="sp-cellmsg" hidden></span></td>';
        }
        return '<tr data-i="' + i + '"><td class="mono" data-lbl></td>' +
          // 예시는 첫 줄에만 (빈 줄마다 있으면 값이 채워진 것으로 착각할 수 있음)
          cell("name", 'spellcheck="false" autocapitalize="off" style="min-width:96px"' + (i ? "" : ' placeholder="예: CASE-01"')) +
          cell("collected_on", 'inputmode="numeric" style="min-width:108px"' + (i ? "" : ' placeholder="YYYY-MM-DD"')) +
          cell("amount", 'inputmode="decimal" style="min-width:64px"' + (i ? "" : ' placeholder="숫자만"')) +
          '<td><button type="button" class="sp-rm" data-rm="' + i + '" aria-label="' + (i + 1) + '번째 줄 지우기" title="이 줄 지우기">×</button></td></tr>';
      }).join("");
      paintRows();
    }
    // 칸마다 오류 · 경고 표시, 라벨 번호, 요약, 다음 버튼 (입력 중인 칸은 다시 그리지 않음)
    function paintRows() {
      var st = sampleState(), pad = st.n > 99 ? 3 : 2, seq = 0;
      OM.$$("#sm-rows tr").forEach(function (tr) {
        var i = +tr.dataset.i, s = D.samples[i], e = st.errs[i], seen = s.seen || {};
        tr.querySelector("[data-lbl]").textContent = e ? labelText(++seq, pad) : "–";
        COLS.forEach(function (c) {
          var inp = tr.querySelector('[data-c="' + c + '"]'), m = inp.nextElementSibling;
          var err = e && e[c] && seen[c] ? e[c] : "", w = !err && e && e.warn[c] && seen[c] ? e.warn[c] : "";
          inp.classList.toggle("sp-invalid", !!err);
          inp.setAttribute("aria-invalid", err ? "true" : "false");
          m.hidden = !(err || w); m.textContent = err || w; m.style.color = w ? "var(--amber)" : "";
        });
      });
      var sum = OM.$("#sm-sum"), max = maxSamples();
      if (!st.n) sum.innerHTML = box("info", "시료를 한 줄 이상 입력해 주세요. 빈 줄은 저절로 빠집니다.");
      else if (st.n > max) sum.innerHTML = box("err", "한 번에 " + esc(max) + "개까지 의뢰할 수 있습니다 (지금 " + esc(st.n) + "개). 나눠서 의뢰해 주세요.");
      else if (st.bad && !st.shownBad) sum.innerHTML = box("info", esc(st.n) + "개 입력 중입니다. 칸을 다 채우면 바로 검사합니다.");
      else if (st.bad) {
        // 좁은 화면에서는 표의 오른쪽 칸(양)이 가려지므로, 보이는 오류를 3개까지 글로도 적어 줌
        var aw = amountWord(curType()), errs = [];
        st.errs.forEach(function (e, i) {
          if (!e) return; var seen = D.samples[i].seen || {};
          COLS.forEach(function (c) { if (e[c] && seen[c]) errs.push("<br>· " + esc(i + 1) + "번째 줄 " + esc(c === "amount" ? aw : COLNAME[c]) + ": " + esc(e[c])); });
        });
        sum.innerHTML = box("err", esc(st.n) + "개 중 <b>" + esc(st.bad) + "개</b> 시료에 고칠 값이 있습니다. 빨간 칸을 고치면 다음으로 넘어갈 수 있습니다." +
          errs.slice(0, 3).join("") + (errs.length > 3 ? " 외 " + esc(errs.length - 3) + "개" : "") +
          '<br><button type="button" class="om-link" id="sm-first">첫 번째 고칠 칸으로</button>');
      }
      else sum.innerHTML = box("info", "✓ " + esc(st.n) + "개 시료 모두 접수 기준에 맞습니다.");
      var f = OM.$("#sm-first"); if (f) f.onclick = focusFirstBad;
      var nx = OM.$("#wz-next"); nx.disabled = !st.ok; nx.style.cursor = st.ok ? "" : "not-allowed";
    }
    function focusFirstBad() {
      var st = sampleState();
      D.samples.forEach(function (s) { if (!blankRow(s)) s.seen = { name: 1, collected_on: 1, amount: 1 }; });
      paintRows();
      for (var i = 0; i < st.errs.length; i++) {
        var e = st.errs[i]; if (!hasErr(e)) continue;
        var c = COLS.filter(function (k) { return e[k]; })[0];
        var inp = OM.$('#sm-rows tr[data-i="' + i + '"] [data-c="' + c + '"]');
        if (inp) { inp.focus(); inp.scrollIntoView({ block: "center" }); }
        return;
      }
    }

    // ── 4단계: 수거 · 연락 ──
    function step3() {
      var p = pk(), t = curType(), h = hoursOf(t), today = SP.todayKST(), dlim = deadline();
      var minD = firstPickDay(), maxD = lastDay();
      if (dlim && dlim < maxD) maxD = dlim;
      // 고를 수 있는 날이 없으면(자정 직전에 기한이 오늘인 시료 등) 날짜 칸 대신 이유와 고칠 곳을 보여 줌
      var blocked = !minD || minD > maxD, dateHtml;
      if (blocked) {
        var late = h != null && minD ? filled().filter(function (s) { var c = SP.normDate(trim(s.collected_on)); return isoOk(c) && lastPick(c, h) < minD; }) : [];
        dateHtml = late.length
          ? box("err", "채취 후 " + esc(h) + "시간 안에 수거할 수 있는 날이 남지 않은 시료가 있습니다: " + esc(late.slice(0, 3).map(function (s) { return trim(s.name); }).join(", ")) +
              (late.length > 3 ? " 외 " + esc(late.length - 3) + "개" : "") + " (가장 빠른 수거일 " + esc(SP.dateLabel(minD)) + "). 시료를 다시 채취하거나 목록에서 빼 주세요. " + '<a href="#s2">시료 목록 고치기</a>')
          : box("err", "지금은 고를 수 있는 수거일이 없습니다. 카카오톡 채널로 문의해 주세요. 작성한 내용은 저장해 둡니다. " + '<a href="' + OM.KAKAO + '" target="_blank" rel="noopener">카카오톡 문의</a>');
      } else {
        dateHtml = '<div class="om-checks" id="qd"></div>' +
          '<input type="date" name="pickup_date" min="' + esc(minD) + '" max="' + esc(maxD) + '" value="' + esc(isoOk(D.pickup_date) ? D.pickup_date : "") + '" aria-label="수거 희망일 직접 고르기" style="max-width:240px">';
      }
      var eve = slotKeys().some(function (k) { return +p.slots[k].start >= 18; });
      var hint = [p.weekend ? "주말에도 수거합니다" : "평일에 수거합니다", eve ? "저녁 시간대도 있습니다" : "", "오늘 수거는 시간대 시작 " + p.lead + "시간 전까지 신청할 수 있습니다"].filter(Boolean).join(" · ");
      pane((origin === "prev" ? box("info", "지난 의뢰 정보를 불러왔습니다. 바뀐 점만 고쳐 주세요.") : "") +
        '<div class="om-form">' +
        '<h2 style="margin:0">수거 · 연락</h2>' +
        "<h3>언제 가져갈까요?</h3>" +
        '<div class="om-field" data-f="pickup_date">수거 희망일 <small>' + esc(hint) + "</small>" + dateHtml +
        '<span class="sp-msg" id="m-pickup_date" data-for="pickup_date"></span></div>' +
        fld("pickup_slot", "수거 시간대", "", '<select name="pickup_slot" style="max-width:320px"></select>') +
        (slotKeys().length ? "" : box("warn", "수거 시간대가 아직 준비되지 않았습니다. 카카오톡 채널로 문의해 주세요. 작성한 내용은 저장해 둡니다.")) +
        (h != null && dlim && !blocked && dlim >= minD ? box("warn", esc(t.name) + " 시료는 채취 후 " + esc(h) + "시간 안에 수거해야 합니다 (채취 시각을 받지 않아 " + esc(dueText(h)) + "까지). 지금 시료 목록 기준으로 <b>" + esc(SP.dateLabel(dlim)) + "</b>까지 수거할 수 있습니다.") : "") +
        "<h3>어디서 가져갈까요?</h3>" +
        fld("pickup_addr", "수거 주소", "도로명 주소, 건물 번호까지", txt("pickup_addr", D.pickup_addr, 'autocomplete="street-address" maxlength="200" placeholder="예: 대전 유성구 대학로 291"')) +
        fld("pickup_addr2", "상세 주소", "건물 · 층 · 호실 — 수거 기사가 찾아갈 곳", txt("pickup_addr2", D.pickup_addr2, 'maxlength="100" placeholder="예: E16 5층 512호"')) +
        "<h3>누구에게 연락할까요?</h3>" +
        '<div class="om-grid2">' +
        fld("lab_name", "기관 · 연구실", "", txt("lab_name", D.lab_name, 'autocomplete="organization" maxlength="100" placeholder="예: KAIST 생명과학과 OOO 연구실"')) +
        fld("pi_name", "연구책임자", "", txt("pi_name", D.pi_name, 'maxlength="50" placeholder="예: 홍길동"')) + "</div>" +
        fld("contact_phone", "현장 연락처", "수거 기사가 도착 전에 연락할 휴대폰", '<input type="tel" name="contact_phone" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" value="' + esc(D.contact_phone) + '" style="max-width:240px">') +
        "<h3>그 밖에</h3>" +
        '<div class="om-field" data-f="leftover">분석하고 남은 시료' + radios("leftover", L.leftover, D.leftover) + '<span class="sp-msg" id="m-leftover" data-for="leftover"></span></div>' +
        fld("irb_no", "IRB 승인 번호", "선택 · 사람 유래 시료라면 적어 주세요", txt("irb_no", D.irb_no, 'placeholder="예: KH2026-123"')) +
        fld("memo", "요청 사항", "선택 · 시료 상태, 수거 때 주의할 점 등", '<textarea name="memo" rows="3">' + esc(D.memo) + "</textarea>") +
        "</div>", nextLabel(), blocked);
      var root = OM.$("#wz-pane");
      autoFormat(root.querySelector('[name="contact_phone"]'), SP.fmtPhone);
      if (!blocked) paintDates();
      paintSlots();
      var chk = fields(root, R3, R3_ORDER, function (n, e) {
        if (e.type === "radio" && !e.checked) return;
        D[n] = e.value;
        if (n === "pickup_date") { paintSlots(); paintDates(); }
        changed();
      }, { pickup_date: ["pickup_slot"], pickup_slot: ["pickup_date"] });
      if (srvErr && srvErr.step === 3) chk.check();
      if (!blocked) root.querySelector("#qd").addEventListener("change", function (ev) {
        var r = ev.target; if (r.name !== "qd") return;
        var di = root.querySelector('[name="pickup_date"]'); di.value = r.value;
        di.dispatchEvent(new Event("change", { bubbles: true }));
      });
      OM.$("#wz-next").onclick = function () {
        if (blocked) return why("고를 수 있는 수거일이 없습니다. 위 안내를 확인해 주세요.");
        if (!chk.check()) return why("빨간 칸을 고쳐 주세요.");
        if (!sampleState().ok) { srvErr = { step: 2, msg: "시료 목록에 다시 확인할 값이 있습니다. 빨간 칸을 고쳐 주세요." }; return go(2); }
        D.lab_name = trim(D.lab_name); go(4);
      };

      // 빠른 날짜 고르기: 고를 수 있는 가까운 날 7개
      function paintDates() {
        var out = [], d = minD;
        while (out.length < 7 && d <= maxD) {
          if (p.weekend || !weekend(d)) out.push(d);
          d = SP.addDays(d, 1);
        }
        root.querySelector("#qd").innerHTML = out.map(function (x) {
          var tag = x === today ? "오늘 · " : x === SP.addDays(today, 1) ? "내일 · " : "";
          return '<label><input type="radio" name="qd" value="' + x + '"' + (x === D.pickup_date ? " checked" : "") + "> " + esc(tag + SP.dateLabel(x)) + "</label>";
        }).join("") + (out.length ? "" : '<span class="om-dim">고를 수 있는 날이 없습니다. 시료 목록의 채취일을 확인해 주세요.</span>');
      }
      function paintSlots() {
        var sel = root.querySelector('[name="pickup_slot"]'), isToday = D.pickup_date === today;
        sel.innerHTML = '<option value="">시간대를 골라 주세요</option>' + slotKeys().map(function (k) {
          var s = p.slots[k], open = !isToday || slotOpen(today, k);
          return '<option value="' + esc(k) + '"' + (k === D.pickup_slot ? " selected" : "") + (open ? "" : " disabled") + ">" + esc(s.label) + (open ? "" : " · 오늘 마감") + "</option>";
        }).join("");
      }
    }

    // ── 5단계: 결제 · 확인 ──
    function step4() {
      var t = curType(), sv = SERV[D.service], slot = pk().slots[D.pickup_slot], list = filled(), n = list.length, pad = n > 99 ? 3 : 2;
      var inv = D.pay_method === "invoice";
      function edit(k) { return ' <a href="#s' + k + '" class="om-link" style="font-size:13px">고치기</a>'; }
      var sampleTable = '<div class="sp-table-wrap"' + (n > 10 ? ' style="max-height:320px;overflow:auto"' : "") + '><table class="sp-table"><thead><tr><th>' + (editId ? "라벨" : "번호") + "</th><th>시료명</th><th>채취일</th><th>" + esc(amountWord(t)) + " (" + esc(t.unit) + ")</th></tr></thead><tbody>" +
        list.map(function (s, i) { return '<tr><td class="mono">' + esc(labelText(i + 1, pad)) + "</td><td>" + esc(trim(s.name)) + '</td><td class="mono">' + esc(s.collected_on) + '</td><td class="mono">' + esc(num(s.amount)) + "</td></tr>"; }).join("") + "</tbody></table></div>";
      var CHECKS = [
        ["label", "튜브에 적은 시료명이 위 목록과 같습니다."],
        ["temp", "시료를 " + (t.ship || "접수 기준") + " 조건으로 보관하고 있습니다."],
        ["hand", SP.dateLabel(D.pickup_date) + " " + (slot ? slot.label : "") + "에 " + trim(D.pickup_addr2) + "에서 시료를 건네줄 사람이 있습니다."]
      ];
      pane('<div class="om-form">' +
        '<h2 style="margin:0">결제 · 확인</h2>' +
        "<h3>결제 방법</h3>" +
        '<div class="sp-picks" role="group" aria-label="결제 방법" data-f="pay_method">' +
        '<button type="button" class="sp-pick" data-pay="credit" aria-pressed="' + (D.pay_method === "credit") + '"><b>충전금에서 차감</b><small>지금 잔액 ' + esc(OM.won(bal)) + "</small><small>미리 충전해 두고 의뢰마다 차감</small></button>" +
        '<button type="button" class="sp-pick" data-pay="invoice" aria-pressed="' + inv + '"><b>건별 청구 (세금계산서)</b><small>의뢰마다 세금계산서 발행</small><small>산학협력단 · 연구비 결제</small></button></div>' +
        '<span class="sp-msg" id="pay-msg" role="alert"></span>' +
        '<div id="pay-credit"' + (D.pay_method === "credit" ? "" : " hidden") + ">" +
        box("info", "금액은 운영자가 시료와 서비스를 확인한 뒤 정해 의뢰 화면에 알려 드립니다. 접수가 확정될 때 충전금에서 차감됩니다.") +
        (pend ? box("info", "입금 확인 중인 충전 신청 " + esc(OM.won(pend.amount)) + "이 있습니다. 입금이 확인되면 잔액에 더해집니다.")
          : bal <= 0 ? box("warn", "충전금이 0원입니다. 확정 전에 충전해 두시면 바로 진행됩니다. 작성 중인 의뢰는 저장해 둡니다. " + '<a href="?topup=1">충전 신청하기 →</a>') : "") + "</div>" +
        '<div id="pay-inv" style="display:grid;gap:18px"' + (inv ? "" : " hidden") + ">" +
        box("info", "금액은 운영자가 확인한 뒤 정해 의뢰 화면에 알려 드리고, 접수 확정 후 아래 정보로 세금계산서를 발행합니다.") +
        fld("biz_name", "세금계산서 받을 기관명 (상호)", "예: OO대학교 산학협력단", txt("biz_name", D.biz_name, 'autocomplete="organization" maxlength="100"')) +
        '<div class="om-grid2">' +
        fld("invoice_email", "세금계산서 받을 메일", "", '<input type="email" name="invoice_email" autocomplete="email" inputmode="email" maxlength="200" placeholder="tax@univ.ac.kr" value="' + esc(D.invoice_email) + '">') +
        fld("biz_no", "사업자등록번호", "선택 · 모르면 비워 두세요", '<input type="text" name="biz_no" inputmode="numeric" placeholder="000-00-00000" value="' + esc(D.biz_no) + '">') +
        "</div></div>" +
        '<h3 style="margin-top:6px">의뢰 내용 확인</h3>' +
        dl([
          ["시료", esc(t.name) + " " + esc(n) + "개" + edit(0)],
          ["서비스", esc(sv.name) + edit(1)],
          ["수거", esc(SP.dateLabel(D.pickup_date)) + " " + esc(slot ? slot.label : "") + edit(3)],
          ["주소", esc(trim(D.pickup_addr)) + "<br>" + esc(trim(D.pickup_addr2))],
          ["연구실", esc(trim(D.lab_name)) + " · " + esc(trim(D.pi_name))],
          ["현장 연락처", esc(D.contact_phone)],
          ["남은 시료", esc(L.leftover[D.leftover] || "-")]
        ].concat(trim(D.irb_no) ? [["IRB", esc(trim(D.irb_no))]] : []).concat(trim(D.memo) ? [["요청 사항", '<span class="om-pre" style="margin:0">' + esc(trim(D.memo)) + "</span>"]] : [])) +
        '<div style="display:grid;gap:6px"><span class="om-dim">시료 ' + esc(n) + "개" + edit(2) + "</span>" + sampleTable + "</div>" +
        '<h3 style="margin-top:6px">마지막으로 확인해 주세요</h3>' +
        '<div style="display:grid;gap:10px">' + CHECKS.map(function (c) {
          return '<label class="om-agree"><input type="checkbox" data-chk="' + c[0] + '"' + (checks[c[0]] ? " checked" : "") + "> <span>" + esc(c[1]) + "</span></label>";
        }).join("") + "</div>" +
        '<p class="om-dim" style="margin:0">' + (editId ? "저장하면 운영자가 고친 내용으로 다시 확인합니다." : "접수하면 운영자가 내용을 확인해 금액을 정하고 접수를 확정합니다. 확정되면 고른 날짜 · 시간대에 수거하러 가고, 그 시간이 어려우면 확정 전에 현장 연락처로 먼저 전화드립니다. 확정 전에는 언제든 고치거나 취소할 수 있습니다.") + "</p>" +
        "</div>", editId ? "고친 내용 저장하기" : "의뢰 접수하기", !allChecked());
      var root = OM.$("#wz-pane");
      autoFormat(root.querySelector('[name="biz_no"]'), SP.fmtBizNo);
      var chk = fields(root, R4, R4_ORDER, function (n, e) { D[n] = e.value; changed(); });
      // 지난 의뢰에서 불러온 메일에 오타가 의심되면 처음부터 보여 줌
      chk.touch("invoice_email");
      OM.$$("[data-pay]", root).forEach(function (b) {
        b.onclick = function () {
          D.pay_method = b.dataset.pay;
          OM.$$("[data-pay]", root).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          OM.$("#pay-credit").hidden = D.pay_method !== "credit"; OM.$("#pay-inv").hidden = D.pay_method !== "invoice";
          OM.$("#pay-msg").textContent = "";
          R4_ORDER.forEach(function (n) { chk.paint(n); });
          changed();
        };
      });
      OM.$$("[data-chk]", root).forEach(function (c) {
        c.onchange = function () {
          checks[c.dataset.chk] = c.checked;
          var nx = OM.$("#wz-next"); nx.disabled = !allChecked(); nx.style.cursor = allChecked() ? "" : "not-allowed";
          OM.$("#chk-hint").textContent = allChecked() ? "" : "세 가지를 모두 확인하면 " + (editId ? "저장" : "접수") + "할 수 있습니다.";
        };
      });
      var nx = OM.$("#wz-next");
      nx.insertAdjacentHTML("beforebegin", '<span class="om-dim" id="chk-hint" style="font-size:13px">' + (allChecked() ? "" : "세 가지를 모두 확인하면 " + (editId ? "저장" : "접수") + "할 수 있습니다.") + "</span>");
      if (srvErr && srvErr.step === 4) chk.check();
      nx.onclick = function () {
        if (!L.pay[D.pay_method]) { OM.$("#pay-msg").className = "sp-msg err"; OM.$("#pay-msg").textContent = "결제 방법을 골라 주세요."; root.querySelector("[data-pay]").focus(); return why("결제 방법을 골라 주세요."); }
        if (!chk.check()) return why("빨간 칸을 고쳐 주세요.");
        if (!allChecked()) return;
        submit(nx);
      };
      function allChecked() { return CHECKS.every(function (c) { return checks[c[0]]; }); }
    }

    // ── 접수 (sp_save_order) ──
    // DB 가 같은 규칙으로 다시 검사합니다. 시간이 지나 바뀌는 규칙(오늘 마감 등)도 있어 보내기 직전에 처음부터 다시 확인합니다.
    async function submit(btn) {
      for (var k = 0; k < 4; k++) {
        if (!valid(k)) { srvErr = { step: k, msg: "시간이 지나 다시 확인할 값이 생겼습니다 (예: 오늘 수거 마감). 빨간 칸을 고쳐 주세요." }; go(k); return; }
      }
      var inv = D.pay_method === "invoice";
      var o = {
        sample_type: D.sample_type, service: D.service, lab_name: trim(D.lab_name), pi_name: trim(D.pi_name), contact_phone: SP.fmtPhone(trim(D.contact_phone)),
        pickup_date: D.pickup_date, pickup_slot: D.pickup_slot, pickup_addr: trim(D.pickup_addr), pickup_addr2: trim(D.pickup_addr2),
        irb_no: trim(D.irb_no), leftover: D.leftover, memo: trim(D.memo), pay_method: D.pay_method,
        biz_name: inv ? trim(D.biz_name) : "", biz_no: inv ? trim(D.biz_no) : "", invoice_email: inv ? trim(D.invoice_email) : ""
      };
      // 저장해 둔 초안에 정리 전 값이 남아 있어도 DB 에는 정리한 값만 보냄
      var t = curType();
      var samples = filled().map(function (s) { return { name: trim(s.name), collected_on: SP.normDate(trim(s.collected_on)), amount: Number(normAmount(trim(s.amount), t.unit)) }; });
      var label = btn.textContent;
      btn.disabled = true; btn.textContent = "보내는 중…";
      try {
        var id = OM.unwrap(await sb.rpc("sp_save_order", { p_id: editId || null, o: o, samples: samples }));
        clearTimeout(saveT); store(key, null);
        location.href = "?id=" + encodeURIComponent(id || editId) + (editId ? "&updated=1" : "&created=1");
      } catch (e) {
        console.error(e);
        var m = OM.errMsg(e), to = errStep(m);
        OM.toast(m, true);
        btn.disabled = false; btn.textContent = label;
        if (to === "login") { store(key, { v: 1, at: Date.now(), step: 4, d: D }); location.replace("/samplo/login/?next=" + encodeURIComponent(location.pathname + location.search)); return; }
        if (to === "profile") { store(key, { v: 1, at: Date.now(), step: 4, d: D }); me = await SP.session(); return profileGate(); }
        srvErr = { step: to === "locked" ? 4 : to, msg: m, locked: to === "locked" };
        go(srvErr.step);
      }
    }
    // DB 오류 문장 → 고칠 단계
    function errStep(m) {
      if (/로그인이 필요|JWT|not authenticated/i.test(m)) return "login";
      if (/회원 정보/.test(m)) return "profile";
      if (/확정된 뒤|취소된 의뢰|찾을 수 없습니다/.test(m)) return "locked";
      if (/시간 안에 수거/.test(m)) return 3;
      if (/번 시료|시료를 1개|시료 목록|개까지 의뢰/.test(m)) return 2;
      if (/시료 종류/.test(m)) return 0;
      if (/\(으\)로는|서비스를 골라/.test(m)) return 1;
      if (/결제 방법|세금계산서|사업자등록번호/.test(m)) return 4;
      if (/연구실|연구책임자|연락처|주소|수거|주말|날짜|마감|남은 시료|IRB|요청 사항/.test(m)) return 3;
      return 4;
    }
  }

  // ───────── 의뢰 상세 ─────────
  async function detail(id) {
    var o = OM.unwrap(await sb.from("sp_orders").select("*").eq("id", id).maybeSingle());
    if (!o) return notFound();
    var res = await Promise.all([
      sb.from("sp_samples").select("*").eq("order_id", id).order("seq"),
      sb.from("sp_events").select("*").eq("order_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }),
      o.pay_method === "credit" && o.status === "submitted" ? sb.rpc("sp_balance") : Promise.resolve({ data: null })
    ]);
    var ss = OM.unwrap(res[0]) || [], evs = OM.unwrap(res[1]) || [], bal = OM.unwrap(res[2]);
    var mine = o.client_id === uid, st = o.status, t = S.criteria.types[o.sample_type] || { name: o.sample_type, unit: "" };
    var open = mine && st === "submitted";
    var decidable = mine && ["submitted", "completed", "cancelled"].indexOf(st) < 0;
    var waiting = ss.filter(function (s) { return (s.qc_status === "warn" || s.qc_status === "fail") && !s.decision; });
    var slotTxt = SP.dateLabel(o.pickup_date) + " " + SP.slotLabel(S.pickup, o.pickup_slot);

    var h = '<p class="om-dim sp-noprint"><a href="./">← 내 의뢰</a></p>' +
      '<div class="om-head"><div><h1 class="sp-num">' + esc(o.order_no) + "</h1><p>" + esc(t.name) + " " + esc(ss.length) + "개 · " + esc(SP.serviceName(S.criteria, o.service)) + " · " + SP.chip(st) + "</p></div>" +
      (open ? '<div class="om-actions sp-noprint"><a class="btn ghost sm" href="?edit=' + encodeURIComponent(id) + '">의뢰 고치기</a><button type="button" class="btn danger sm" id="b-cancel">의뢰 취소</button></div>' : "") + "</div>";
    if (!mine) h += box("warn", "운영자 보기: 다른 회원의 의뢰입니다. 이 화면에서는 고칠 수 없습니다.");
    // 확인 중(submitted) 안내. 방금 접수한 화면(created=1)에서는 접수 완료 문장과 합쳐 상자 하나로 보여 줌
    var SUBMITTED = "운영자가 확인해 금액을 정하고 접수를 확정하면 " + esc(slotTxt) + "에 수거하러 갑니다. 그 시간이 어려우면 현장 연락처로 먼저 전화드립니다. 확정 전에는 고치거나 취소할 수 있습니다.";
    var justCreated = !!OM.qs("created") && st === "submitted";
    if (justCreated) h += box("info", "<b>의뢰를 접수했습니다.</b> " + SUBMITTED);
    if (OM.qs("updated")) h += box("info", "고친 내용을 저장했습니다. 운영자가 다시 확인합니다.");
    if (open) h += '<form class="om-form sp-callout warn sp-noprint" id="cancel-box" hidden style="margin-bottom:16px">' +
      "<p style=\"margin:0\"><b>이 의뢰를 취소할까요?</b> 취소하면 되돌릴 수 없고, 다시 맡기려면 새로 의뢰해야 합니다.</p>" +
      '<label>취소 사유 <small>선택 · 운영자에게 전달됩니다</small><input type="text" name="note" maxlength="500"></label>' +
      '<div class="om-actions"><button type="submit" class="btn danger sm">의뢰 취소하기</button><button type="button" class="btn ghost sm" id="b-keep">그대로 두기</button></div></form>';

    // 진행 단계와 지금 할 일
    if (st !== "cancelled") h += SP.track(st);
    var STATUS_TEXT = {
      submitted: "<b>확인 중입니다.</b> " + SUBMITTED,
      confirmed: "<b>접수가 확정되었습니다.</b> " + esc(slotTxt) + "에 수거하러 갑니다. 튜브마다 시료명이 목록과 같은지 확인해 주세요.",
      in_transit: "<b>시료가 연구소로 이동 중입니다.</b> 도착하면 QC 결과를 이 화면에 알려 드립니다.",
      received: "<b>시료가 도착했습니다.</b> 시료마다 QC 결과가 아래 표에 표시됩니다.",
      extraction: "<b>추출 단계를 진행하고 있습니다.</b>",
      library: "<b>라이브러리를 만들고 있습니다.</b>",
      sequencing: "<b>시퀀싱을 진행하고 있습니다.</b>",
      data_ready: "<b>데이터가 도착했습니다.</b> 받는 방법은 운영자가 따로 안내합니다.",
      stored: "<b>시료를 보관하고 있습니다.</b>",
      completed: "<b>모든 단계를 마쳤습니다.</b> 이용해 주셔서 고맙습니다.",
      cancelled: "<b>취소된 의뢰입니다.</b>"
    };
    if (!justCreated) h += box(st === "cancelled" ? "err" : st === "submitted" ? "warn" : "info",
      (STATUS_TEXT[st] || esc(L.status[st] || st)) +
      (o.eta && ["completed", "cancelled"].indexOf(st) < 0 ? "<br>예상 완료일: <b>" + esc(SP.dateLabel(o.eta)) + "</b>" : "") +
      (o.admin_note && (st === "confirmed" || st === "cancelled") ? "<br>운영자 안내: " + esc(o.admin_note) : ""));

    // QC 결과 · 진행 방법 선택 (고를 시료는 표와 따로 카드로: 휴대폰에서도 가로 스크롤 없이 보이게)
    var issues = ss.filter(function (s) { return s.qc_status === "warn" || s.qc_status === "fail"; });
    if (waiting.length && decidable) h += box("warn", "<b>QC 확인이 필요한 시료가 " + esc(waiting.length) + "개 있습니다.</b> 시료마다 진행 방법을 골라 주세요. 고르기 전까지 그 시료는 다음 단계로 넘어가지 않습니다.");
    if (issues.length && decidable) {
      h += '<div class="om-card sp-noprint" id="qc-decide"><h2>QC 확인이 필요한 시료</h2>' +
        '<p class="om-dim">그대로 진행: 기준에 조금 못 미쳐도 진행 · 재추출: 남은 시료로 다시 추출 · 이 시료 제외: 이 시료만 빼고 진행 · 시료 다시 보내기: 새 시료를 받아 진행. 고른 방법에 따라 일정이나 금액이 달라질 수 있으며, 운영자가 따로 안내합니다.</p>' +
        '<ul class="om-list">' + issues.map(function (s) {
          return '<li style="padding:14px 0;display:grid;gap:8px"><div><b class="sp-num">' + esc(s.label) + "</b> · " + esc(s.name) + " " + SP.qcChip(s.qc_status) + "</div>" +
            ([s.qc_value, s.qc_note].filter(Boolean).length ? '<div class="om-dim">' + esc([s.qc_value, s.qc_note].filter(Boolean).join(" · ")) + "</div>" : "") +
            '<div class="om-actions" style="gap:6px" role="group" aria-label="' + esc(s.label) + ' 진행 방법">' + Object.keys(L.decision).map(function (k) {
              return '<button type="button" class="btn sm ' + (s.decision === k ? "primary" : "ghost") + '" data-dec="' + esc(k) + '" data-s="' + esc(s.id) + '" data-lbl="' + esc(s.label) + '" aria-pressed="' + (s.decision === k) + '">' + esc(L.decision[k]) + "</button>";
            }).join("") + "</div>" +
            (s.decision ? '<small class="sp-msg ok">' + "고른 방법: " + esc(L.decision[s.decision]) + " · " + esc(when(s.decided_at).d) + ". 바꾸려면 다른 방법을 누르세요.</small>" : '<small class="sp-msg warn">아직 고르지 않았습니다.</small>') + "</li>";
        }).join("") + "</ul></div>";
    }
    var qcRows = ss.map(function (s) {
      var dec = s.qc_status === "warn" || s.qc_status === "fail" ? (s.decision ? esc(L.decision[s.decision]) : decidable ? '<span style="color:var(--amber)">고르기 전</span>' : "선택 안 함") : "-";
      return '<tr><td class="mono">' + esc(s.label) + '</td><td style="white-space:nowrap">' + esc(s.name) + '</td><td class="mono">' + esc(s.collected_on) + '</td><td class="mono">' + esc(num(s.amount)) + " " + esc(t.unit) + "</td>" +
        "<td>" + SP.qcChip(s.qc_status) + "</td><td>" + esc([s.qc_value, s.qc_note].filter(Boolean).join(" · ") || "-") + '</td><td style="white-space:nowrap">' + dec + "</td></tr>";
    }).join("");
    h += '<div class="om-card sp-noprint"><h2>시료 · QC</h2>' +
      (ss.every(function (s) { return s.qc_status === "pending"; }) && st !== "cancelled" ? '<p class="om-dim">시료가 도착하면 시료마다 QC 결과가 여기에 표시됩니다. 기준에 못 미치는 시료는 진행 방법을 직접 고를 수 있습니다.</p>' : "") +
      '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>라벨</th><th>시료명</th><th>채취일</th><th>' + esc(amountWord(t)) + "</th><th>QC</th><th>값 · 메모</th><th>진행 방법</th></tr></thead><tbody>" + qcRows + "</tbody></table></div>" +
      "</div>";

    // 수거 · 결제
    var pay = [["방법", esc(L.pay[o.pay_method] || o.pay_method)]];
    if (o.quote_amount != null) {
      var v = OM.vatSplit(o.quote_amount);
      pay.push(["금액", "<b>" + esc(OM.won(v.total)) + '</b> <small class="om-dim">부가세 포함</small>'], ["공급가액", esc(OM.won(v.supply))], ["부가세", esc(OM.won(v.vat))]);
    } else if (st !== "cancelled") pay.push(["금액", "운영자가 확인한 뒤 정해 알려 드립니다."]);
    if (o.pay_method === "credit") {
      if (o.charged > 0) pay.push(["차감", "충전금에서 " + esc(OM.won(o.charged)) + " 차감"]);
      else if (st === "cancelled" && o.confirmed_at && o.quote_amount > 0) pay.push(["환불", "차감했던 충전금은 취소와 함께 돌려 드렸습니다."]);
      if (st === "submitted") pay.push(["잔액", esc(OM.won(bal || 0)) + (bal > 0 ? "" : ' · <a href="?topup=1">충전 신청</a>') + '<br><small class="om-dim">확정할 때 잔액이 모자라면 운영자가 연락드립니다.</small>']);
    } else {
      pay.push(["세금계산서", o.invoiced_at ? esc(when(o.invoiced_at).d) + " 발행 완료" : st === "cancelled" ? "-" : st === "submitted" ? "접수 확정 후 발행합니다." : "발행 준비 중입니다."]);
      pay.push(["받는 곳", esc(o.biz_name) + (o.biz_no ? " (" + esc(o.biz_no) + ")" : "") + "<br>" + esc(o.invoice_email)]);
    }
    var switchTo = o.pay_method === "credit" ? "invoice" : "credit", canSwitch = switchTo === "credit" || (clen(trim(o.biz_name)) >= 2 && SP.V.email(o.invoice_email));
    h += '<div class="om-grid2 sp-noprint"><div class="om-card"><h2>수거 · 연락</h2><dl class="om-dl">' +
      "<dt>수거</dt><dd>" + esc(slotTxt) + "</dd>" +
      "<dt>주소</dt><dd>" + esc(o.pickup_addr) + "<br>" + esc(o.pickup_addr2) + "</dd>" +
      "<dt>연구실</dt><dd>" + esc(o.lab_name) + " · " + esc(o.pi_name) + "</dd>" +
      "<dt>현장 연락처</dt><dd>" + esc(o.contact_phone) + "</dd>" +
      "<dt>남은 시료</dt><dd>" + esc(L.leftover[o.leftover] || o.leftover) + (o.leftover === "undecided" && st !== "cancelled" ? '<br><small class="om-dim">정하시면 <a href="' + OM.KAKAO + '" target="_blank" rel="noopener">카카오톡</a>으로 알려 주세요.</small>' : "") + "</dd>" +
      (o.irb_no ? "<dt>IRB</dt><dd>" + esc(o.irb_no) + "</dd>" : "") +
      (o.memo ? '<dt>요청 사항</dt><dd><span class="om-pre" style="margin:0;display:block">' + esc(o.memo) + "</span></dd>" : "") +
      "<dt>접수</dt><dd>" + esc(when(o.created_at).d + " " + when(o.created_at).t) + "</dd></dl></div>" +
      '<div class="om-card"><h2>결제</h2><dl class="om-dl">' + pay.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>" +
      (open ? '<div class="om-actions" style="margin-top:14px">' + (canSwitch
        ? '<button type="button" class="btn ghost sm" id="b-pay" data-to="' + switchTo + '">' + (switchTo === "credit" ? "충전금 차감으로 바꾸기" : "건별 청구로 바꾸기") + "</button>"
        : '<a class="btn ghost sm" href="?edit=' + encodeURIComponent(id) + '#s4">세금계산서 정보를 넣고 건별 청구로 바꾸기</a>') + "</div>" : "") +
      "</div></div>";

    // 진행 기록
    h += '<div class="om-card sp-noprint"><h2>진행 기록</h2>' + (evs.length ? '<ul class="sp-log">' + evs.map(function (e) {
      var w = when(e.created_at);
      return "<li><time>" + esc(w.d) + "<br>" + esc(w.t) + "</time><div>" + evText(e) + "</div></li>";
    }).join("") + "</ul>" : '<p class="om-dim">아직 기록이 없습니다.</p>') + "</div>";

    // 튜브 라벨
    if (st !== "cancelled") h += '<div class="om-card" id="labels-card"><div class="om-head" style="margin-bottom:12px"><div><h2 style="margin:0">튜브 라벨</h2>' +
      '<p class="om-dim sp-noprint" style="margin-top:6px">튜브에는 시료 목록과 똑같은 시료명을 적어 주세요. 아래 라벨(의뢰번호-번호 · 시료명)을 인쇄해 붙이면 대조가 더 빠릅니다.' + (open ? " 확정 전에 시료 목록을 고치면 라벨 번호가 다시 매겨지니, 확정 뒤에 인쇄해 주세요." : "") + "</p>" +
      '<p class="sp-print-only">' + esc(o.order_no) + " · " + esc(t.name) + " · " + esc(o.lab_name) + "</p></div>" +
      '<button type="button" class="btn ghost sm sp-noprint" id="b-print">라벨 인쇄</button></div>' +
      '<div class="sp-labels">' + ss.map(function (s) {
        return '<div class="sp-label"><b>' + esc(s.label) + "</b><br>" + esc(s.name) + "<br>채취 " + esc(s.collected_on) + "</div>";
      }).join("") + "</div></div>";

    main.innerHTML = h;

    // 동작 연결
    var bc = OM.$("#b-cancel"), cb = OM.$("#cancel-box");
    if (bc) {
      bc.onclick = function () { cb.hidden = false; cb.elements.note.focus(); };
      OM.$("#b-keep").onclick = function () { cb.hidden = true; };
      cb.onsubmit = function (ev) {
        ev.preventDefault();
        OM.run(cb.querySelector("button[type=submit]"), async function () {
          OM.unwrap(await sb.rpc("sp_cancel_order", { p_id: id, note: trim(cb.elements.note.value) }));
          OM.toast("의뢰를 취소했습니다."); await detail(id);
        });
      };
    }
    var bp = OM.$("#b-pay");
    if (bp) bp.onclick = function () {
      OM.run(bp, async function () {
        OM.unwrap(await sb.rpc("sp_set_pay_method", { p_id: id, method: bp.dataset.to }));
        OM.toast("결제 방법을 바꿨습니다: " + L.pay[bp.dataset.to]); await detail(id);
      });
    };
    OM.$$("[data-dec]").forEach(function (b) {
      b.onclick = function () {
        OM.run(b, async function () {
          OM.unwrap(await sb.rpc("sp_decide", { p_sample: b.dataset.s, p_decision: b.dataset.dec }));
          OM.toast(b.dataset.lbl + " 진행 방법: " + L.decision[b.dataset.dec]); await detail(id);
        });
      };
    });
    var pr = OM.$("#b-print");
    if (pr) pr.onclick = function () {
      // 라벨 카드만 인쇄: 나머지는 인쇄하는 동안만 숨김
      var keep = OM.$("#labels-card"), hidden = [];
      [].slice.call(main.children).forEach(function (el) { if (el !== keep && !el.classList.contains("sp-noprint")) { el.classList.add("sp-noprint"); hidden.push(el); } });
      function restore() { hidden.forEach(function (el) { el.classList.remove("sp-noprint"); }); hidden = []; window.removeEventListener("afterprint", restore); }
      window.addEventListener("afterprint", restore);
      window.print();
    };
  }
  // 진행 기록 한 줄 (QC · 선택 기록의 영문 값을 한국어로)
  function evText(e) {
    var n = e.note || "", head = L.event[e.kind] || e.kind;
    if (e.kind === "qc") n = n.replace(/^(\S+) (pending|pass|warn|fail)/, function (_, a, b) { return a + " " + L.qc[b]; });
    if (e.kind === "decision") n = n.replace(/^(\S+) (proceed|reextract|exclude|resend)$/, function (_, a, b) { return a + " → " + L.decision[b]; });
    if (e.kind === "status" && e.status) head += " · " + (L.status[e.status] || e.status);
    return "<b>" + esc(head) + "</b>" + (n ? "<br>" + esc(n) : "");
  }

  // ───────── 충전 신청 · 충전금 내역 ─────────
  async function topup() {
    var res = await Promise.all([
      sb.rpc("sp_balance"),
      sb.from("sp_topups").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
      sb.from("sp_ledger").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(100),
      sb.from("sp_orders").select("biz_name,biz_no,invoice_email").eq("client_id", uid).neq("biz_name", "").order("created_at", { ascending: false }).limit(1)
    ]);
    var bal = OM.unwrap(res[0]) || 0, tps = OM.unwrap(res[1]) || [], led = OM.unwrap(res[2]) || [], lastOrder = (OM.unwrap(res[3]) || [])[0];
    var pend = tps.filter(function (x) { return x.status === "requested"; })[0];
    var c = S.credit || {}, unit = c.unit == null ? 1000000 : +c.unit, maxU = c.max_units == null ? 50 : +c.max_units, bonus = +c.bonus_rate || 0;
    var bank = trim(S.bank) ? '<p class="om-pre" style="margin:0">' + esc(S.bank) + "</p>" : '<p style="margin:0">입금 계좌는 운영자가 휴대폰 문자로 보내 드립니다.</p>';
    var dr = load(DRAFT), back = draftUsable(dr) ? box("info", '작성 중인 의뢰가 있습니다. <a href="?new=1#s4">의뢰로 돌아가기 →</a>') : "";
    var TOPCHIP = { requested: "submitted", paid: "completed", cancelled: "cancelled" };

    var form;
    if (pend) {
      form = '<div class="om-card"><h2>입금을 기다리고 있습니다</h2><dl class="om-dl">' +
        "<dt>신청 금액</dt><dd><b>" + esc(OM.won(pend.amount)) + "</b> (" + esc(krMoney(pend.amount)) + ")</dd>" +
        "<dt>신청일</dt><dd>" + esc(when(pend.created_at).d) + "</dd>" +
        "<dt>증빙</dt><dd>" + esc(DOC[pend.doc_type] || pend.doc_type) + (pend.doc_type === "tax_invoice" ? "<br>" + esc(pend.biz_name) + (pend.biz_no ? " (" + esc(pend.biz_no) + ")" : "") + "<br>" + esc(pend.invoice_email) : "") + "</dd>" +
        (pend.memo ? "<dt>메모</dt><dd>" + esc(pend.memo) + "</dd>" : "") + "</dl>" +
        '<h3 style="margin-top:18px">입금 안내</h3>' + bank +
        '<p class="om-dim" style="margin-top:12px">입금이 확인되면 충전금에 바로 더해지고, 내 의뢰 화면에서 확인할 수 있습니다. 확인을 기다리는 신청은 한 번에 하나만 둘 수 있습니다.</p>' +
        '<div class="om-actions" style="margin-top:14px"><button type="button" class="btn ghost sm" id="tp-cancel">신청 취소</button>' +
        '<span id="tp-cancel-ask" hidden>이 신청을 취소할까요? <button type="button" class="btn danger sm" id="tp-cancel-yes">신청 취소하기</button> <button type="button" class="btn ghost sm" id="tp-cancel-no">그대로 두기</button></span></div></div>';
    } else {
      var opts = '<option value="">금액을 골라 주세요</option>';
      for (var k = 1; k <= maxU; k++) opts += '<option value="' + unit * k + '">' + esc(krMoney(unit * k)) + "</option>";
      var pre = lastOrder || tps.filter(function (x) { return x.doc_type === "tax_invoice"; })[0] || {};
      form = '<div class="om-card"><h2>충전 신청</h2>' +
        '<form class="om-form" id="f-top" novalidate>' +
        fld("amount", "충전 금액", esc(krMoney(unit)) + " 단위 · 한 번에 " + esc(krMoney(unit * maxU)) + "까지", '<select name="amount" style="max-width:280px">' + opts + "</select>") +
        '<div class="om-field" data-f="doc_type">증빙' + radios("doc_type", DOC, "tax_invoice") + '<span class="sp-msg" data-for="doc_type"></span></div>' +
        '<div id="tp-inv" style="display:grid;gap:18px">' +
        fld("biz_name", "세금계산서 받을 기관명 (상호)", "예: OO대학교 산학협력단", txt("biz_name", pre.biz_name || "", 'autocomplete="organization" maxlength="100"')) +
        '<div class="om-grid2">' +
        fld("email", "세금계산서 받을 메일", "", '<input type="email" name="email" autocomplete="email" inputmode="email" maxlength="200" placeholder="tax@univ.ac.kr" value="' + esc(pre.invoice_email || "") + '">') +
        fld("biz_no", "사업자등록번호", "선택 · 모르면 비워 두세요", '<input type="text" name="biz_no" inputmode="numeric" placeholder="000-00-00000" value="' + esc(pre.biz_no || "") + '">') +
        "</div></div>" +
        fld("memo", "메모", "선택 · 예: 입금자명이 기관명과 다르면 적어 주세요", txt("memo", "", 'maxlength="500"')) +
        (bonus > 0 ? box("info", "입금이 확인되면 충전 금액의 " + esc(Math.round(bonus * 1000) / 10) + "%를 보너스로 더 적립합니다.") : "") +
        '<p class="om-dim" style="margin:0">신청한 뒤 안내된 계좌로 입금하시면, 운영자가 입금을 확인하고 충전합니다.</p>' +
        '<button class="btn primary" type="submit" id="tp-go">충전 신청하기</button></form></div>';
    }

    var hist = '<div class="om-card" id="history"><h2>충전금 내역</h2>' + (led.length ?
      '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>날짜</th><th>내용</th><th style="text-align:right">금액</th></tr></thead><tbody>' +
      led.map(function (x) {
        return '<tr><td class="mono">' + esc(when(x.created_at).d) + "</td><td>" + esc(L.ledger[x.kind] || x.kind) + (x.note ? ' <small class="om-dim">' + esc(x.note) + "</small>" : "") + '</td><td class="mono" style="text-align:right">' + esc(signed(x.amount)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="om-dim">아직 내역이 없습니다.</p>') +
      (tps.length ? '<h3 style="margin-top:20px">충전 신청</h3><ul class="om-list">' + tps.map(function (x) {
        return '<li><div class="row"><b>' + esc(OM.won(x.amount)) + "</b><small>" + esc(when(x.created_at).d) + " 신청 · " + esc(DOC[x.doc_type] || x.doc_type) + '</small><span class="r"><span class="om-chip sp-s-' + (TOPCHIP[x.status] || "") + '">' + esc(L.topup[x.status] || x.status) + "</span>" +
          (x.paid_at ? "<span>" + esc(when(x.paid_at).d) + " 충전</span>" : "") + "</span></div></li>";
      }).join("") + "</ul>" : "") + "</div>";

    main.innerHTML = '<p class="om-dim"><a href="./">← 내 의뢰</a></p>' +
      '<div class="om-head"><div><h1>충전금</h1><p>' + esc(krMoney(unit)) + " 단위로 미리 충전해 두면, 충전금으로 결제한 의뢰는 접수가 확정될 때 자동으로 차감됩니다. 건별 청구(세금계산서)도 그대로 쓸 수 있습니다.</p></div></div>" + back +
      '<div class="sp-layout"><div>' + form + hist + "</div>" +
      '<aside class="sp-aside"><div class="om-card"><h2 style="font-size:17px">지금 잔액</h2><div class="sp-balance">' + esc(OM.won(bal)) + "</div></div>" +
      '<div class="om-card"><h2 style="font-size:17px">입금 안내</h2>' + bank + "</div></aside></div>";

    if (pend) {
      var ask = OM.$("#tp-cancel-ask");
      OM.$("#tp-cancel").onclick = function () { ask.hidden = false; this.hidden = true; };
      OM.$("#tp-cancel-no").onclick = function () { ask.hidden = true; OM.$("#tp-cancel").hidden = false; };
      OM.$("#tp-cancel-yes").onclick = function () {
        OM.run(this, async function () { OM.unwrap(await sb.rpc("sp_cancel_topup", { p_id: pend.id })); OM.toast("충전 신청을 취소했습니다."); await topup(); });
      };
      return;
    }
    var f = OM.$("#f-top"), st = { amount: "", doc_type: "tax_invoice", biz_name: f.elements.biz_name.value, email: f.elements.email.value, biz_no: SP.fmtBizNo(f.elements.biz_no.value), memo: "" };
    f.elements.biz_no.value = st.biz_no;
    autoFormat(f.elements.biz_no, SP.fmtBizNo);
    function inv() { return st.doc_type === "tax_invoice"; }
    var chk = fields(f, {
      amount: function () {
        var a = +st.amount;
        if (!a) return "충전 금액을 골라 주세요.";
        if (a % unit || a > unit * maxU) return krMoney(unit) + " 단위로 " + krMoney(unit * maxU) + "까지 고를 수 있습니다.";
        return "";
      },
      doc_type: function () { return DOC[st.doc_type] ? "" : "증빙 종류를 골라 주세요."; },
      biz_name: function () { return inv() ? minLen(st.biz_name, 2, "세금계산서 받을 기관명(상호)을 입력해 주세요.") : ""; },
      email: function () { return inv() ? emailRule(st.email, "세금계산서 받을 메일 주소를 입력해 주세요.", "email") : ""; },
      biz_no: function () { return inv() ? bizNoRule(st.biz_no) : ""; },
      memo: function () { return ""; }
    }, ["amount", "doc_type", "biz_name", "email", "biz_no", "memo"], function (n, e) {
      if (e.type === "radio" && !e.checked) return;
      st[n] = e.value;
      if (n === "doc_type") OM.$("#tp-inv").hidden = !inv();
      if (n === "amount") OM.$("#tp-go").textContent = st.amount ? krMoney(+st.amount) + " 충전 신청하기" : "충전 신청하기";
    });
    // 지난 의뢰 · 신청에서 불러온 메일에 오타가 의심되면 처음부터 보여 줌
    chk.touch("email");
    f.onsubmit = function (ev) {
      ev.preventDefault();
      if (!chk.check()) return;
      var btn = OM.$("#tp-go");
      OM.run(btn, async function () {
        OM.unwrap(await sb.rpc("sp_request_topup", {
          p_amount: +st.amount, p_doc_type: st.doc_type,
          p_biz_name: inv() ? trim(st.biz_name) : "", p_biz_no: inv() ? trim(st.biz_no) : "", p_email: inv() ? trim(st.email) : "", p_memo: trim(st.memo)
        }));
        OM.toast("충전 신청을 보냈습니다. 안내된 계좌로 입금해 주세요.");
        await topup();
      });
    };
  }

  // 시작: 위의 상수 · 함수가 모두 준비된 뒤에 화면을 그림
  try { S = await SP.loadSettings(); await route(); }
  catch (e) { fail(e); }
})();
