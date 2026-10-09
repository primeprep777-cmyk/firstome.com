/* /omicsmate/expert/ : 전문가 화면
   신청 전 · 심사 중 → 신청서
   승인 후 → (없음) 공개 의뢰 목록 · ?tab=mine 내 입찰·과제 · ?id=… 입찰 작성 · ?job=… 선정된 과제 */
(async function () {
  var OM = window.OM, sb = OM.sb, L = OM.L, esc = OM.esc, main = OM.$("#om-main");
  var me = await OM.requireLogin(); if (!me) return;
  var ex = me.expert;

  if (!ex || OM.qs("apply") || ex.status === "rejected") return applyForm();
  if (ex.status === "pending") return pending();
  if (ex.status === "suspended") {
    main.innerHTML = '<div class="om-card om-empty"><h2>전문가 활동이 일시 정지되었습니다</h2><p>' + esc(ex.admin_note || "자세한 내용은 카카오톡 채널로 문의해 주세요.") + '</p><a class="btn ghost" href="' + OM.KAKAO + '" target="_blank" rel="noopener">문의하기</a></div>';
    return;
  }
  if (OM.qs("id")) return bidPage(OM.qs("id"));
  if (OM.qs("job")) return jobPage(OM.qs("job"));
  return home(OM.qs("tab") === "mine");

  // ───────── 신청 ─────────
  function applyForm() {
    var e = ex || { fields: "", dtypes: [], education: "", papers: "", bio: "" };
    var checks = Object.keys(L.dtype).map(function (k) { return '<label><input type="checkbox" name="dtypes" value="' + k + '"' + (e.dtypes.indexOf(k) >= 0 ? " checked" : "") + "> " + esc(L.dtype[k]) + "</label>"; }).join("");
    main.innerHTML =
      '<div class="om-head"><div><h1>전문가 신청</h1><p>심사를 통과하면 Bronze 등급으로 시작해 조건에 맞는 의뢰에 입찰할 수 있습니다.</p></div></div>' +
      (ex && ex.status === "rejected" ? '<p class="om-note" style="margin-bottom:16px">지난 신청이 반려되었습니다' + (ex.admin_note ? ": " + esc(ex.admin_note) : ".") + " 내용을 보완해 다시 제출해 주세요.</p>" : "") +
      '<div class="om-card"><form class="om-form" id="f-apply">' +
      '<label>연락처 <small>심사 결과와 과제 안내에 씁니다</small><input type="tel" name="phone" value="' + esc(me.profile.phone || "") + '" required></label>' +
      '<label>전문 분야 <small>예: 종양 단일세포 분석, 면역 레퍼토리, 대사체 통계</small><input type="text" name="fields" required value="' + esc(e.fields) + '"></label>' +
      '<div class="om-field">다룰 수 있는 데이터<div class="om-checks">' + checks + "</div></div>" +
      '<label>학력 · 소속 <small>학위, 전공, 현재 소속과 직위</small><textarea name="education" rows="3" required>' + esc(e.education) + "</textarea></label>" +
      '<label>논문 실적 <small>분석을 맡았던 논문 위주로 DOI나 링크를 한 줄에 하나씩</small><textarea name="papers" rows="5" required>' + esc(e.papers) + "</textarea></label>" +
      '<label>자기소개 <small>주로 쓰는 도구와 파이프라인, 가능한 작업량</small><textarea name="bio" rows="4">' + esc(e.bio) + "</textarea></label>" +
      '<p class="om-note">심사는 신원·학력 확인과 짧은 시범 과제로 진행합니다. 결과는 메일과 이 화면에서 알려 드립니다.</p>' +
      '<div class="om-actions"><button class="btn primary" type="submit">' + (ex ? "다시 제출" : "신청하기") + "</button></div></form></div>";
    OM.$("#f-apply").onsubmit = function (ev) {
      ev.preventDefault(); var d = OM.formData(this), btn = this.querySelector("button[type=submit]");
      var v = { fields: d.fields, dtypes: [].concat(d.dtypes || []), education: d.education, papers: d.papers, bio: d.bio };
      OM.run(btn, async function () {
        OM.unwrap(await sb.from("profiles").update({ phone: d.phone }).eq("id", me.user.id));
        if (ex) OM.unwrap(await sb.from("experts").update(v).eq("id", me.user.id));
        else OM.unwrap(await sb.from("experts").insert(v));
        location.href = "./";
      });
    };
  }
  function pending() {
    main.innerHTML = '<div class="om-card om-empty"><h2>신청서를 심사하고 있습니다</h2><p>' + OM.date(ex.created_at) + ' 신청 · 결과는 메일과 이 화면에서 알려 드립니다.</p><a class="btn ghost" href="?apply=1">신청서 수정</a></div>';
  }

  function tabs(mine) {
    return '<div class="om-head"><div><h1>전문가</h1><p>' + esc(me.profile.name) + " · " + esc(L.tier[ex.tier] || "") + (ex.rating ? " · ★" + ex.rating : "") + " · 완료 " + ex.completed_count + "건</p></div></div>" +
      '<div class="om-tabs"><button type="button" class="' + (mine ? "" : "on") + '" onclick="location.href=\'./\'">공개 의뢰</button><button type="button" class="' + (mine ? "on" : "") + '" onclick="location.href=\'?tab=mine\'">내 입찰 · 과제</button></div>';
  }

  // ───────── 목록 ─────────
  async function home(mine) {
    if (mine) {
      var bids = OM.unwrap(await sb.rpc("my_bids"));
      var jobs = bids.filter(function (b) { return b.status === "selected"; });
      var others = bids.filter(function (b) { return b.status !== "selected"; });
      function li(b, href, right) { return '<li><a class="row" href="' + href + '"><b>' + esc(b.title) + "</b><small>" + esc(L.dtype[b.dtype]) + " · " + OM.won(b.amount) + " · " + b.days + '일</small><span class="r">' + right + "</span></a></li>"; }
      main.innerHTML = tabs(true) +
        '<div class="om-card"><h2>진행 과제</h2>' + (jobs.length ? '<ul class="om-list">' + jobs.map(function (b) { return li(b, "?job=" + b.request_id, OM.chip(b.request_status)); }).join("") + "</ul>" : '<p class="om-dim">선정된 과제가 없습니다.</p>') + "</div>" +
        '<div class="om-card"><h2>내 입찰</h2>' + (others.length ? '<ul class="om-list">' + others.map(function (b) {
          var open = b.status === "submitted" && b.request_status === "open";
          return li(b, open ? "?id=" + b.request_id : "#", OM.chip(b.status, L.bidStatus) + "<span>" + (open ? OM.dleft(b.bid_deadline) : OM.date(b.created_at)) + "</span>");
        }).join("") + "</ul>" : '<p class="om-dim">아직 입찰한 의뢰가 없습니다.</p>') + "</div>";
      return;
    }
    var rows = OM.unwrap(await sb.rpc("open_requests"));
    main.innerHTML = tabs(false) +
      '<div class="om-card"><h2>입찰할 수 있는 의뢰 ' + rows.length + "건</h2>" +
      '<p class="om-dim">내 등급으로 입찰할 수 있는 의뢰만 보입니다. 의뢰인 정보와 데이터 파일은 선정된 뒤에 열립니다.</p>' +
      (rows.length ? '<ul class="om-list">' + rows.map(function (r) {
        return '<li><a class="row" href="?id=' + r.id + '"><b>' + esc(r.title) + "</b><small>" + esc(L.dtype[r.dtype]) + (r.n_samples ? " · " + esc(r.n_samples) : "") + " · " + esc(OM.scopeText(r.scope)) + "</small>" +
          '<span class="r">' + (r.my_bid ? OM.chip(r.my_bid_status, L.bidStatus) : "<span>입찰 " + r.bid_count + "건</span>") + "<span>" + OM.dleft(r.bid_deadline) + "</span></span></a></li>";
      }).join("") + "</ul>" : '<p class="om-dim" style="margin-top:12px">지금은 입찰할 수 있는 의뢰가 없습니다. 새 의뢰가 공개되면 이 목록에 나타납니다.</p>') + "</div>";
  }

  // ───────── 입찰 작성 ─────────
  async function bidPage(id) {
    var r = (OM.unwrap(await sb.rpc("open_requests")) || []).filter(function (x) { return x.id === id; })[0];
    if (!r) { main.innerHTML = '<div class="om-card om-empty"><h2>입찰이 마감되었거나 볼 수 없는 의뢰입니다</h2><p><a href="./">공개 의뢰로 돌아가기</a></p></div>'; return; }
    var bid = r.my_bid ? OM.unwrap(await sb.from("bids").select("*").eq("id", r.my_bid).single()) : null;
    var canEdit = !bid || bid.status === "submitted";
    var rate = OM.unwrap(await sb.from("settings").select("value").eq("key", "fee_rate").maybeSingle());
    var fee = rate && rate.value && rate.value[ex.tier];
    main.innerHTML = '<p class="om-dim"><a href="./">← 공개 의뢰</a></p>' +
      '<div class="om-head"><div><h1>' + esc(r.title) + "</h1><p>입찰 " + r.bid_count + "건 · " + OM.dleft(r.bid_deadline) + " (" + OM.date(r.bid_deadline) + ")</p></div></div>" +
      '<div class="om-grid2"><div class="om-card"><h2>의뢰 요약</h2>' + OM.reqSummary(r) + "</div>" +
      '<div class="om-card"><h2>' + (bid ? "내 입찰 " + OM.chip(bid.status, L.bidStatus) : "입찰하기") + "</h2>" +
      (canEdit ?
        '<form class="om-form" id="f-bid">' +
        '<label>금액 (원) <small>수수료 포함 금액입니다. 의뢰인에게 이 금액이 그대로 보입니다.' + (fee != null ? " 내 등급 수수료 " + Math.round(fee * 100) + "%를 뺀 금액을 받습니다." : "") + '</small><input type="number" name="amount" min="10000" step="10000" required value="' + (bid ? bid.amount : "") + '"></label>' +
        '<p class="om-dim" id="net"></p>' +
        '<label>기간 (일) <small>입금 확인 후 결과 제출까지</small><input type="number" name="days" min="1" max="365" required value="' + (bid ? bid.days : "") + '"></label>' +
        '<label>접근 방법 <small>사용할 파이프라인, 분석 단계, 비교 방법</small><textarea name="approach" rows="5" required>' + esc(bid ? bid.approach : "") + "</textarea></label>" +
        '<label>산출물 <small>예: 보고서(PDF), 그림 원본, 분석 코드, 처리된 데이터</small><input type="text" name="deliverables" value="' + esc(bid ? bid.deliverables : "") + '"></label>' +
        '<label>의뢰인에게 질문 <small>선택</small><textarea name="question" rows="2">' + esc(bid ? bid.question : "") + "</textarea></label>" +
        '<div class="om-actions"><button class="btn primary" type="submit">' + (bid ? "입찰 수정" : "입찰 제출") + "</button>" + (bid ? '<button class="btn danger" type="button" id="b-withdraw">입찰 철회</button>' : "") + "</div></form>"
        : '<p class="om-dim">이 입찰은 더 이상 수정할 수 없습니다.</p>') +
      "</div></div>";
    var f = OM.$("#f-bid"); if (!f) return;
    function net() { var a = +f.amount.value; OM.$("#net").textContent = a && fee != null ? "받는 금액 약 " + OM.won(Math.round(a * (1 - fee))) : ""; }
    f.amount.oninput = net; net();
    f.onsubmit = function (e) {
      e.preventDefault(); var d = OM.formData(f), btn = f.querySelector("button[type=submit]");
      var v = { amount: +d.amount, days: +d.days, approach: d.approach, deliverables: d.deliverables, question: d.question };
      OM.run(btn, async function () {
        if (bid) OM.unwrap(await sb.from("bids").update(v).eq("id", bid.id));
        else { v.request_id = id; OM.unwrap(await sb.from("bids").insert(v)); }
        OM.toast(bid ? "입찰을 수정했습니다." : "입찰을 제출했습니다."); setTimeout(function () { location.href = "?tab=mine"; }, 700);
      });
    };
    var w = OM.$("#b-withdraw");
    if (w) w.onclick = function () {
      if (!confirm("입찰을 철회할까요? 같은 의뢰에 다시 입찰할 수 없습니다.")) return;
      OM.run(w, async function () { OM.unwrap(await sb.rpc("withdraw_bid", { bid: bid.id })); location.href = "?tab=mine"; });
    };
  }

  // ───────── 선정된 과제 ─────────
  async function jobPage(id) {
    var r = OM.unwrap(await sb.from("requests").select("*").eq("id", id).maybeSingle());
    if (!r) { main.innerHTML = '<div class="om-card om-empty"><h2>과제를 찾을 수 없습니다</h2><p><a href="?tab=mine">내 과제로 돌아가기</a></p></div>'; return; }
    var bid = OM.unwrap(await sb.from("bids").select("*").eq("id", r.selected_bid).single());
    var client = OM.unwrap(await sb.from("profiles").select("name, org").eq("id", r.client_id).maybeSingle()) || {};
    var pay = OM.unwrap(await sb.from("payments").select("*").eq("request_id", id).maybeSingle());
    var dels = OM.unwrap(await sb.from("deliveries").select("*").eq("request_id", id).order("created_at"));
    var ev = OM.unwrap(await sb.from("events").select("kind, note, created_at").eq("request_id", id).eq("kind", "revision").order("created_at", { ascending: false }).limit(1));
    var msg = {
      selected: "의뢰인 입금을 기다리고 있습니다. 운영자가 입금을 확인하면 진행 중으로 바뀝니다. 그 전에 데이터를 미리 살펴봐도 됩니다.",
      in_progress: "분석을 진행해 주세요. 결과 파일을 올리고 설명을 적어 제출하면 의뢰인이 확인합니다.",
      delivered: "결과를 제출했습니다. 의뢰인이 확인하고 있습니다.",
      completed: "완료된 과제입니다. 데이터 접근은 완료 30일 뒤 닫힙니다.",
      disputed: "운영자가 분쟁을 조정하고 있습니다."
    }[r.status] || "";
    main.innerHTML = '<p class="om-dim"><a href="?tab=mine">← 내 입찰 · 과제</a></p>' +
      '<div class="om-head"><div><h1>' + esc(r.title) + "</h1><p>" + OM.chip(r.status) + " · 의뢰인 " + esc(client.name || "") + (client.org ? " (" + esc(client.org) + ")" : "") + "</p></div></div>" +
      '<div class="om-card"><p style="margin:0">' + msg + "</p>" +
      (r.status === "in_progress" && ev.length ? '<p class="om-note" style="margin-top:12px">의뢰인 수정 요청 (' + OM.date(ev[0].created_at) + "): " + esc(ev[0].note) + "</p>" : "") +
      '<dl class="om-dl" style="margin-top:14px"><dt>입찰 금액</dt><dd>' + OM.won(bid.amount) + "</dd><dt>기간</dt><dd>" + bid.days + "일</dd>" +
      (pay ? "<dt>입금 확인</dt><dd>" + OM.date(pay.paid_at) + "</dd><dt>받을 금액</dt><dd>" + OM.won(pay.payout_amount) + (pay.payout_at ? " · " + OM.date(pay.payout_at) + " 지급" : r.status === "completed" ? " · 지급 준비 중" : " · 결과 승인 후 지급") + "</dd>" : "") +
      "</dl></div>" +
      '<div class="om-grid2"><div class="om-card"><h2>의뢰 내용</h2>' + OM.reqSummary(r) + "</div>" +
      '<div class="om-card"><h2>데이터 파일</h2><div id="req-files"><p class="om-dim">불러오는 중…</p></div></div></div>' +
      '<div class="om-card"><h2>결과 제출</h2>' +
      dels.map(function (d, i) { return '<p class="om-pre"><b>' + (i + 1) + "차 제출 · " + OM.date(d.created_at) + "</b>\n" + esc(d.note) + "</p>"; }).join("") +
      '<div id="deliv-files" style="margin-top:12px"></div>' +
      (r.status === "in_progress" || r.status === "selected" ?
        '<label class="btn ghost sm" style="margin-top:12px">결과 파일 올리기<input type="file" id="up-deliv" multiple hidden></label>' : "") +
      (r.status === "in_progress" ?
        '<form class="om-form" id="f-deliver" style="margin-top:16px"><label>결과 설명 <small>무엇을 했고 어떤 파일이 무엇인지, 해석할 때 주의할 점</small><textarea name="note" rows="5" required></textarea></label>' +
        '<div class="om-actions"><button class="btn primary" type="submit">결과 제출</button></div></form>' : "") +
      "</div>";
    OM.fileList("request-files", id).then(function (x) { OM.$("#req-files").innerHTML = x; }).catch(function (e) { OM.$("#req-files").textContent = OM.errMsg(e); });
    function loadDeliv() { return OM.fileList("deliverables", id).then(function (x) { OM.$("#deliv-files").innerHTML = x; }).catch(function (e) { OM.$("#deliv-files").textContent = OM.errMsg(e); }); }
    loadDeliv();
    var up = OM.$("#up-deliv");
    if (up) up.onchange = function () { OM.run(null, async function () { OM.toast("올리는 중…"); var n = await OM.upload("deliverables", id, up); OM.toast(n + "개 파일을 올렸습니다."); await loadDeliv(); }); };
    var f = OM.$("#f-deliver");
    if (f) f.onsubmit = function (e) {
      e.preventDefault(); var d = OM.formData(f), btn = f.querySelector("button[type=submit]");
      if (!confirm("결과를 제출할까요? 의뢰인에게 결과 확인 요청이 갑니다.")) return;
      OM.run(btn, async function () { OM.unwrap(await sb.rpc("submit_delivery", { req: id, note: d.note })); location.reload(); });
    };
  }
})();
