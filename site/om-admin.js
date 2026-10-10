/* /omicsmate/admin/ : 운영 화면 (profiles.is_admin = true 인 계정만)
   ?tab=experts 전문가 심사 · requests 의뢰 검수 · money 입금·정산 · all 전체 의뢰 · settings 설정 */
(async function () {
  var OM = window.OM, sb = OM.sb, L = OM.L, esc = OM.esc, main = OM.$("#om-main");
  var me = await OM.requireLogin(); if (!me) return;
  if (!me.isAdmin) { main.innerHTML = '<div class="om-card om-empty"><h2>운영자만 볼 수 있는 화면입니다</h2><p><a href="/omicsmate/app/">내 의뢰로 가기</a></p></div>'; return; }

  var TABS = { experts: "전문가 심사", requests: "의뢰 검수", money: "입금 · 정산", all: "전체 의뢰", settings: "설정" };
  var tab = TABS[OM.qs("tab")] ? OM.qs("tab") : "experts";
  var head = '<div class="om-head"><div><h1>운영</h1><p>심사, 검수, 입금 확인, 정산을 처리합니다.</p></div></div><div class="om-tabs">' +
    Object.keys(TABS).map(function (k) { return '<button type="button" class="' + (k === tab ? "on" : "") + '" onclick="location.href=\'?tab=' + k + '\'">' + TABS[k] + "</button>"; }).join("") + "</div>";

  function rpc(btn, name, args, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    OM.run(btn, async function () { OM.unwrap(await sb.rpc(name, args)); OM.toast("처리했습니다."); setTimeout(function () { location.reload(); }, 500); });
  }
  function reqRow(r, actions, extra) {
    var c = r.profiles || {};
    return '<li><div class="row" style="grid-template-columns:1fr auto"><b>' + esc(r.title) + " " + OM.chip(r.status) + "</b>" +
      "<small>" + esc(c.name || "") + (c.org ? " · " + esc(c.org) : "") + " · " + OM.date(r.created_at) + " 등록</small>" +
      '<div class="r">' + (actions || "") + "</div></div>" + (extra || "") + "</li>";
  }

  if (tab === "experts") {
    var ex = OM.unwrap(await sb.from("experts").select("*, profiles(name, org, phone)").in("status", ["pending", "rejected", "approved", "suspended"]).order("created_at", { ascending: false }));
    var groups = { pending: [], approved: [], rejected: [], suspended: [] };
    ex.forEach(function (e) { groups[e.status].push(e); });
    function block(e) {
      var p = e.profiles || {};
      var tiers = Object.keys(L.tier).map(function (t) { return '<option value="' + t + '"' + ((e.tier || "bronze") === t ? " selected" : "") + ">" + L.tier[t] + "</option>"; }).join("");
      return '<li style="padding:16px 4px"><b>' + esc(p.name) + "</b> " + OM.chip(e.status, L.expertStatus) + (e.tier ? " · " + L.tier[e.tier] : "") +
        '<p class="om-dim" style="margin:4px 0 8px">' + esc(p.org) + " · " + esc(p.phone) + " · " + OM.date(e.created_at) + " 신청 · 완료 " + e.completed_count + "건" + (e.rating ? " · ★" + e.rating : "") + "</p>" +
        '<dl class="om-dl"><dt>분야</dt><dd>' + esc(e.fields) + "</dd><dt>데이터</dt><dd>" + esc(e.dtypes.map(function (d) { return L.dtype[d]; }).join(", ")) + "</dd>" +
        '<dt>학력</dt><dd class="om-pre" style="margin:0">' + esc(e.education) + '</dd><dt>논문</dt><dd class="om-pre" style="margin:0">' + esc(e.papers) + "</dd>" +
        (e.bio ? '<dt>소개</dt><dd class="om-pre" style="margin:0">' + esc(e.bio) + "</dd>" : "") + "</dl>" +
        '<div class="om-actions om-form" style="margin-top:12px;display:flex" data-ex="' + e.id + '"><select name="tier" style="width:auto">' + tiers + '</select>' +
        '<input type="text" name="note" placeholder="메모 (반려·정지 사유)" style="flex:1;min-width:180px" value="' + esc(e.admin_note) + '">' +
        '<button class="btn primary sm" data-act="approved">' + (e.status === "approved" ? "등급 저장" : "승인") + "</button>" +
        (e.status !== "rejected" && e.status !== "approved" ? '<button class="btn ghost sm" data-act="rejected">반려</button>' : "") +
        (e.status === "approved" ? '<button class="btn danger sm" data-act="suspended">정지</button>' : "") + "</div></li>";
    }
    main.innerHTML = head + ["pending", "approved", "rejected", "suspended"].map(function (s) {
      return '<div class="om-card"><h2>' + L.expertStatus[s] + " " + groups[s].length + "명</h2>" + (groups[s].length ? '<ul class="om-list">' + groups[s].map(block).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>";
    }).join("");
    OM.$$("[data-ex] button").forEach(function (b) {
      b.onclick = function () {
        var box = b.parentNode, act = b.dataset.act;
        rpc(b, "review_expert", { ex: box.dataset.ex, new_status: act, new_tier: box.querySelector("[name=tier]").value, note: box.querySelector("[name=note]").value },
          act === "approved" ? null : (act === "rejected" ? "반려할까요?" : "활동을 정지할까요?"));
      };
    });
  }

  if (tab === "requests") {
    var rs = OM.unwrap(await sb.from("requests").select("*, profiles(name, org)").in("status", ["review", "open", "closed"]).order("created_at"));
    var counts = {};
    if (rs.length) OM.unwrap(await sb.from("bids").select("request_id").in("request_id", rs.map(function (r) { return r.id; })).eq("status", "submitted")).forEach(function (b) { counts[b.request_id] = (counts[b.request_id] || 0) + 1; });
    main.innerHTML = head + '<div class="om-card"><h2>검수 대기 · 입찰 중 ' + rs.length + "건</h2>" + (rs.length ? '<ul class="om-list">' + rs.map(function (r) {
      var act = r.status === "review"
        ? '<input type="text" data-note="' + r.id + '" placeholder="메모 (반려 사유)" style="font:inherit;padding:6px 9px;border:1px solid var(--line2);border-radius:6px"><button class="btn primary sm" data-pub="' + r.id + '">공개</button><button class="btn danger sm" data-rej="' + r.id + '">반려</button>'
        : "<span>입찰 " + (counts[r.id] || 0) + "건 · " + OM.dleft(r.bid_deadline) + "</span>" + (r.status === "open" ? '<button class="btn ghost sm" data-close="' + r.id + '">입찰 마감</button>' : "");
      return reqRow(r, act, '<details style="padding:0 4px 14px"><summary class="om-dim">내용 보기</summary>' + OM.reqSummary(r) + "</details>");
    }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>";
    OM.$$("[data-pub]").forEach(function (b) { b.onclick = function () { rpc(b, "publish_request", { req: b.dataset.pub, note: "" }); }; });
    OM.$$("[data-rej]").forEach(function (b) {
      b.onclick = function () {
        var note = OM.$('[data-note="' + b.dataset.rej + '"]').value;
        if (!note) { OM.toast("반려 사유를 메모에 적어 주세요. 의뢰인에게 보입니다.", true); return; }
        rpc(b, "cancel_request", { req: b.dataset.rej, note: note }, "이 의뢰를 반려(취소)할까요?");
      };
    });
    OM.$$("[data-close]").forEach(function (b) { b.onclick = function () { rpc(b, "close_request", { req: b.dataset.close }, "입찰을 마감할까요? 의뢰인은 받은 입찰 중에서 계속 선정할 수 있습니다."); }; });
  }

  if (tab === "money") {
    var mr = OM.unwrap(await sb.from("requests").select("*, profiles(name, org), payments(*), bids!requests_selected_bid_fk(amount, days, experts(tier, profiles(name)))")
      .in("status", ["selected", "in_progress", "delivered", "completed", "disputed"]).order("updated_at", { ascending: false }));
    var bres = await sb.from("billing").select("*"), bills = {};
    (bres.data || []).forEach(function (b) { bills[b.request_id] = b; });
    function billText(r) {
      var b = bills[r.id];
      if (!b) return "결제 정보 미입력";
      return L.payMethod[b.method] + " · " + L.docType[b.doc_type] + (b.method !== "transfer" ? (b.card_link_sent ? " · 링크 " + OM.date(b.card_link_sent) + " 발송" : " · 결제 링크 발송 필요") : "");
    }
    var toIssue = mr.filter(function (r) { var b = bills[r.id]; return b && b.doc_type !== "none" && b.invoice_status === "requested" && ["in_progress", "delivered", "completed", "disputed"].indexOf(r.status) >= 0; });
    var waitPay = mr.filter(function (r) { return r.status === "selected"; });
    var toPay = mr.filter(function (r) { return r.status === "completed" && r.payments && !r.payments.payout_at; });
    var running = mr.filter(function (r) { return ["in_progress", "delivered", "disputed"].indexOf(r.status) >= 0; });
    var paidOut = mr.filter(function (r) { return r.status === "completed" && r.payments && r.payments.payout_at; });
    function line(r) { var b = r.bids || {}, e = b.experts || {}; return OM.won(b.amount) + " · 전문가 " + esc((e.profiles || {}).name || "") + " (" + esc(L.tier[e.tier] || "") + ")"; }
    main.innerHTML = head +
      '<div class="om-card"><h2>결제 확인 대기 ' + waitPay.length + "건</h2>" + (waitPay.length ? '<ul class="om-list">' + waitPay.map(function (r) {
        var b = bills[r.id];
        return reqRow(r, "<span>" + line(r) + "</span><span>" + esc(billText(r)) + "</span>" +
          (b && b.method !== "transfer" && !b.card_link_sent ? '<button class="btn ghost sm" data-link="' + r.id + '">링크 보냄</button>' : "") +
          '<button class="btn primary sm" data-paid="' + r.id + '">결제 확인</button>');
      }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>" +
      '<div class="om-card"><h2>세금계산서 · 현금영수증 발행 대기 ' + toIssue.length + "건</h2>" +
      '<p class="om-dim">결제가 확인된 건입니다. 홈택스에서 발행한 뒤 "발행 완료"를 눌러 주세요. 금액은 부가세 포함 총액 기준입니다.</p>' +
      (toIssue.length ? '<ul class="om-list">' + toIssue.map(function (r) {
        var b = bills[r.id], v = OM.vatSplit((r.bids || {}).amount || 0);
        var dl = '<dl class="om-dl" style="padding:0 4px 16px"><dt>종류</dt><dd>' + esc(L.docType[b.doc_type]) + " · " + esc(L.payMethod[b.method]) + "</dd>" +
          (b.doc_type === "tax_invoice" ? "<dt>사업자번호</dt><dd>" + esc(b.biz_no) + "</dd><dt>상호</dt><dd>" + esc(b.biz_name) + "</dd><dt>대표자</dt><dd>" + esc(b.ceo) + "</dd>" +
            (b.biz_address ? "<dt>주소</dt><dd>" + esc(b.biz_address) + "</dd>" : "") + "<dt>받는 메일</dt><dd>" + esc(b.email) + "</dd>" : "<dt>번호</dt><dd>" + esc(b.biz_no) + "</dd>") +
          "<dt>금액</dt><dd>공급가액 " + OM.won(v.supply) + " · 부가세 " + OM.won(v.vat) + " · 합계 " + OM.won(v.total) + "</dd>" +
          (b.project_no ? "<dt>과제번호</dt><dd>" + esc(b.project_no) + "</dd>" : "") + (b.memo ? "<dt>요청</dt><dd>" + esc(b.memo) + "</dd>" : "") + "</dl>";
        return reqRow(r, '<button class="btn primary sm" data-issued="' + r.id + '">발행 완료</button>', dl);
      }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>" +
      '<div class="om-card"><h2>전문가 지급 대기 ' + toPay.length + "건</h2>" + (toPay.length ? '<ul class="om-list">' + toPay.map(function (r) {
        var p = r.payments; return reqRow(r, "<span>지급액 " + OM.won(p.payout_amount) + " (수수료 " + Math.round(p.fee_rate * 100) + '%)</span><button class="btn primary sm" data-payout="' + r.id + '">지급 완료</button>');
      }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>" +
      '<div class="om-card"><h2>진행 중 ' + running.length + "건</h2>" + (running.length ? '<ul class="om-list">' + running.map(function (r) {
        return reqRow(r, "<span>" + line(r) + "</span>" + (r.status !== "disputed" ? '<button class="btn danger sm" data-dispute="' + r.id + '">분쟁</button>' : ""));
      }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>" +
      '<div class="om-card"><h2>지급 완료 ' + paidOut.length + "건</h2>" + (paidOut.length ? '<ul class="om-list">' + paidOut.map(function (r) {
        return reqRow(r, "<span>" + OM.won(r.payments.payout_amount) + " · " + OM.date(r.payments.payout_at) + "</span>");
      }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>";
    OM.$$("[data-paid]").forEach(function (b) { b.onclick = function () { rpc(b, "confirm_payment", { req: b.dataset.paid }, "의뢰인 결제(입금 또는 카드)를 확인했나요? 진행 중으로 바뀝니다."); }; });
    OM.$$("[data-link]").forEach(function (b) { b.onclick = function () { rpc(b, "mark_card_link_sent", { req: b.dataset.link }, "카드 결제 링크를 의뢰인에게 보냈나요?"); }; });
    OM.$$("[data-issued]").forEach(function (b) { b.onclick = function () { rpc(b, "mark_invoice_issued", { req: b.dataset.issued }, "홈택스에서 발행을 마쳤나요? 의뢰인 화면에 발행 완료로 표시됩니다."); }; });
    OM.$$("[data-payout]").forEach(function (b) { b.onclick = function () { rpc(b, "mark_payout", { req: b.dataset.payout }, "전문가에게 지급을 마쳤나요?"); }; });
    OM.$$("[data-dispute]").forEach(function (b) {
      b.onclick = function () { var note = prompt("분쟁 사유"); if (note) rpc(b, "mark_dispute", { req: b.dataset.dispute, note: note }); };
    });
  }

  if (tab === "all") {
    var all = OM.unwrap(await sb.from("requests").select("*, profiles(name, org)").order("created_at", { ascending: false }).limit(200));
    main.innerHTML = head + '<div class="om-card"><h2>전체 의뢰 ' + all.length + "건</h2>" + (all.length ? '<ul class="om-list">' + all.map(function (r) {
      return reqRow(r, "<span>" + esc(L.dtype[r.dtype]) + "</span>", '<details style="padding:0 4px 14px"><summary class="om-dim">내용 보기</summary>' + OM.reqSummary(r) + "</details>");
    }).join("") + "</ul>" : '<p class="om-dim">없음</p>') + "</div>";
  }

  if (tab === "settings") {
    var st = {}; OM.unwrap(await sb.from("settings").select("*")).forEach(function (s) { st[s.key] = s.value; });
    var fee = st.fee_rate || {}, co = st.company || {};
    main.innerHTML = head + '<div class="om-card"><form class="om-form" id="f-set">' +
      '<div class="om-field">회사 정보 <small>견적서의 공급자 칸에 나옵니다. 비어 있으면 "법인 설립 후 기재"로 표시됩니다.</small><div class="om-grid2">' +
      [["co_name", "상호", co.name || "퍼스트옴"], ["co_biz_no", "사업자등록번호", co.biz_no], ["co_ceo", "대표자", co.ceo], ["co_phone", "연락처", co.phone], ["co_email", "메일", co.email], ["co_address", "주소", co.address]]
        .map(function (f) { return "<label>" + f[1] + '<input type="text" name="' + f[0] + '" value="' + esc(f[2] || "") + '"></label>'; }).join("") + "</div></div>" +
      '<label>입금 안내 <small>선정 후 의뢰인 화면에 보입니다. 예: 국민은행 000-000000-00-000 (주)퍼스트옴</small><input type="text" name="bank" value="' + esc((st.bank || {}).text || "") + '"></label>' +
      '<label>입찰 기간 (일) <small>공개 후 입찰을 받는 기간</small><input type="number" name="bid_days" min="1" max="60" value="' + esc(st.bid_days || 7) + '"></label>' +
      '<div class="om-field">등급별 수수료율 (%) <small>입찰 금액에서 떼는 비율. 이미 입금 확인된 건에는 적용되지 않습니다.</small><div class="om-grid2">' +
      Object.keys(L.tier).map(function (t) { return "<label>" + L.tier[t] + '<input type="number" name="fee_' + t + '" min="0" max="50" step="0.5" value="' + Math.round((fee[t] || 0) * 1000) / 10 + '"></label>'; }).join("") +
      '</div></div><div class="om-actions"><button class="btn primary" type="submit">저장</button></div></form></div>' +
      '<p class="om-note">운영자 계정을 추가하려면 Supabase 대시보드의 Table Editor에서 그 사람의 profiles 행의 is_admin 을 true 로 바꿉니다.</p>';
    OM.$("#f-set").onsubmit = function (e) {
      e.preventDefault(); var d = OM.formData(this), btn = this.querySelector("button[type=submit]"), fr = {};
      Object.keys(L.tier).forEach(function (t) { fr[t] = Math.round(+d["fee_" + t] * 10) / 1000; });
      OM.run(btn, async function () {
        OM.unwrap(await sb.from("settings").upsert([{ key: "bank", value: { text: d.bank } }, { key: "bid_days", value: +d.bid_days || 7 }, { key: "fee_rate", value: fr },
          { key: "company", value: { name: d.co_name, biz_no: d.co_biz_no, ceo: d.co_ceo, phone: d.co_phone, email: d.co_email, address: d.co_address } }]));
        OM.toast("저장했습니다.");
      });
    };
  }
})();
