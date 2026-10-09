/* /omicsmate/app/ : 연구자(의뢰인) 화면
   ?new=1  의뢰 작성 (예상 비용 계산기에서 넘어온 조건을 채워 둠)
   ?id=…   의뢰 상세 · 입찰 비교 · 선택 · 파일 · 결과 승인
   (없음)  내 의뢰 목록 */
(async function () {
  var OM = window.OM, sb = OM.sb, L = OM.L, esc = OM.esc, main = OM.$("#om-main");
  var me = await OM.requireLogin(); if (!me) return;

  var STEPS = ["review", "open", "selected", "in_progress", "delivered", "completed"];
  function steps(status) {
    var i = STEPS.indexOf(status);
    return '<ol class="om-steps">' + STEPS.map(function (s, k) {
      return '<li class="' + (i < 0 ? "" : k < i ? "done" : k === i ? "now" : "") + '">' + L.status[s].replace(" · 입금 대기", "") + "</li>";
    }).join("") + "</ol>";
  }

  if (OM.qs("new")) return newForm();
  if (OM.qs("id")) return detail(OM.qs("id"));
  return list();

  // ───────── 목록 ─────────
  async function list() {
    var rows = OM.unwrap(await sb.from("requests").select("id,title,dtype,status,created_at,bid_deadline").eq("client_id", me.user.id).order("created_at", { ascending: false }));
    var counts = {};
    if (rows.length) {
      var bids = OM.unwrap(await sb.from("bids").select("request_id").in("request_id", rows.map(function (r) { return r.id; })).neq("status", "withdrawn"));
      bids.forEach(function (b) { counts[b.request_id] = (counts[b.request_id] || 0) + 1; });
    }
    var active = rows.filter(function (r) { return ["completed", "cancelled"].indexOf(r.status) < 0; });
    var done = rows.filter(function (r) { return ["completed", "cancelled"].indexOf(r.status) >= 0; });
    function li(r) {
      var extra = r.status === "open" ? "입찰 " + (counts[r.id] || 0) + "건 · " + OM.dleft(r.bid_deadline) : OM.date(r.created_at) + " 등록";
      return '<li><a class="row" href="?id=' + r.id + '"><b>' + esc(r.title) + "</b><small>" + esc(L.dtype[r.dtype]) + '</small><span class="r">' + OM.chip(r.status) + "<span>" + extra + "</span></span></a></li>";
    }
    main.innerHTML =
      '<div class="om-head"><div><h1>내 의뢰</h1><p>' + esc(me.profile.name || "") + "님이 등록한 분석 의뢰입니다.</p></div>" +
      '<a class="btn primary" href="?new=1">새 의뢰 등록</a></div>' +
      (rows.length ? "" : '<div class="om-card om-empty"><h2>아직 등록한 의뢰가 없습니다</h2><p>예상 비용 계산기에서 조건을 고르거나, 바로 의뢰를 작성해 보세요.</p><div class="om-actions" style="justify-content:center"><a class="btn primary" href="?new=1">의뢰 작성하기</a><a class="btn ghost" href="/omicsmate/#estimate">예상 비용 계산기</a></div></div>') +
      (active.length ? '<div class="om-card"><h2>진행 중</h2><ul class="om-list">' + active.map(li).join("") + "</ul></div>" : "") +
      (done.length ? '<div class="om-card"><h2>완료 · 취소</h2><ul class="om-list">' + done.map(li).join("") + "</ul></div>" : "");
  }

  // ───────── 의뢰 작성 · 수정 ─────────
  function requestForm(r) {
    function radios(name, map, val) {
      return Object.keys(map).map(function (k) { return '<label><input type="radio" name="' + name + '" value="' + k + '"' + (k === val ? " checked" : "") + "> " + esc(map[k]) + "</label>"; }).join("");
    }
    function checks(name, map, vals) {
      return Object.keys(map).map(function (k) { return '<label><input type="checkbox" name="' + name + '" value="' + k + '"' + (vals.indexOf(k) >= 0 ? " checked" : "") + "> " + esc(map[k]) + "</label>"; }).join("");
    }
    var sampOpts = L.samples.map(function (s) { return '<option' + (s === r.n_samples ? " selected" : "") + ">" + s + "</option>"; }).join("");
    return '<form class="om-form" id="f-req">' +
      '<label>의뢰 제목 <small>예: 간암 조직 scRNA-seq 세포 유형 주석과 발현 차이 분석</small><input type="text" name="title" required minlength="2" maxlength="120" value="' + esc(r.title || "") + '"></label>' +
      '<div class="om-field">데이터 종류<div class="om-checks">' + radios("dtype", L.dtype, r.dtype || "bulk") + "</div></div>" +
      '<label>시료 수 <small>데이터가 있는 시료 기준</small><select name="n_samples">' + sampOpts + "</select></label>" +
      '<div class="om-field">분석 범위 <small>QC · 기본 분석은 항상 포함됩니다</small><div class="om-checks">' + checks("scope", L.scope, r.scope || ["basic"]) + "</div></div>" +
      '<div class="om-grid2"><div class="om-field">납기<div class="om-checks">' + radios("speed", L.speed, r.speed || "std") + "</div></div>" +
      '<div class="om-field">입찰 받을 전문가 등급<div class="om-checks">' + radios("tier_min", L.tierMin, r.tier_min || "any") + "</div></div></div>" +
      '<label>연구 목적과 요청 사항 <small>전문가가 입찰 금액을 정할 수 있게 비교 그룹, 원하는 결과물, 참고 논문 등을 적어 주세요. 개인정보나 미공개 결과는 적지 마세요.</small><textarea name="purpose" rows="6">' + esc(r.purpose || "") + "</textarea></label>" +
      '<div class="om-grid2"><label>데이터 상태 <small>예: FASTQ 보유, 시퀀싱 중, 샘플로 의뢰 예정</small><input type="text" name="data_status" value="' + esc(r.data_status || "") + '"></label>' +
      '<label>희망 완료일 <small>선택</small><input type="date" name="due_date" value="' + esc(r.due_date || "") + '"></label></div>' +
      '<p class="om-note">등록하면 운영자가 내용을 확인한 뒤 조건에 맞는 전문가에게 <b>요약만</b> 공개합니다. 데이터 파일은 선정한 전문가에게만 열립니다.</p>' +
      '<div class="om-actions"><button class="btn primary" type="submit">' + (r.id ? "수정 저장" : "의뢰 등록") + '</button><a class="btn ghost" href="' + (r.id ? "?id=" + r.id : "./") + '">취소</a></div></form>';
  }
  function readForm(f) {
    var d = OM.formData(f), scope = d.scope || [];
    if (!Array.isArray(scope)) scope = [scope];
    if (scope.indexOf("basic") < 0) scope.unshift("basic");
    return { title: d.title, dtype: d.dtype, n_samples: d.n_samples, scope: scope, speed: d.speed, tier_min: d.tier_min,
             purpose: d.purpose, data_status: d.data_status, due_date: d.due_date || null };
  }
  function newForm() {
    var n = parseInt(OM.qs("n"), 10), band = parseInt(OM.qs("band"), 10);
    var pre = {
      dtype: L.dtype[OM.qs("dtype")] ? OM.qs("dtype") : "bulk",
      n_samples: L.samples[(n || 5) - 1] || L.samples[4],
      scope: (OM.qs("scope") || "basic").split(",").filter(function (s) { return L.scope[s]; }),
      speed: L.speed[OM.qs("speed")] ? OM.qs("speed") : "std",
      tier_min: L.tierMin[OM.qs("tier")] ? OM.qs("tier") : "any"
    };
    main.innerHTML = '<div class="om-head"><div><h1>새 분석 의뢰</h1><p>' + (OM.qs("dtype") ? "예상 비용 계산기에서 고른 조건을 채워 두었습니다." : "조건을 고르고 연구 목적을 적어 주세요.") + "</p></div></div>" +
      '<div class="om-card">' + requestForm(pre) + "</div>";
    OM.$("#f-req").onsubmit = function (e) {
      e.preventDefault(); var btn = this.querySelector("button[type=submit]"), v = readForm(this);
      if (band >= 1 && band <= 5) v.est_band = band;
      OM.run(btn, async function () {
        var row = OM.unwrap(await sb.from("requests").insert(v).select("id").single());
        location.href = "?id=" + row.id + "&created=1";
      });
    };
  }

  // ───────── 상세 ─────────
  async function detail(id) {
    var r = OM.unwrap(await sb.from("requests").select("*").eq("id", id).maybeSingle());
    if (!r) { main.innerHTML = '<div class="om-card om-empty"><h2>의뢰를 찾을 수 없습니다</h2><p><a href="./">내 의뢰로 돌아가기</a></p></div>'; return; }
    var bids = OM.unwrap(await sb.from("bids").select("*, experts(tier, rating, completed_count, fields, education, papers, profiles(name, org))").eq("request_id", id).neq("status", "withdrawn").order("amount"));
    var sel = bids.filter(function (b) { return b.id === r.selected_bid; })[0];
    var deliveries = OM.unwrap(await sb.from("deliveries").select("*").eq("request_id", id).order("created_at"));
    var pay = OM.unwrap(await sb.from("payments").select("*").eq("request_id", id).maybeSingle());
    var bank = OM.unwrap(await sb.from("settings").select("value").eq("key", "bank").maybeSingle());
    var review = OM.unwrap(await sb.from("reviews").select("*").eq("request_id", id).maybeSingle());

    var h = '<p class="om-dim"><a href="./">← 내 의뢰</a></p>' +
      '<div class="om-head"><div><h1>' + esc(r.title) + "</h1><p>" + OM.date(r.created_at) + " 등록 · " + OM.chip(r.status) + "</p></div>" +
      (["review", "open", "closed"].indexOf(r.status) >= 0 ? '<div class="om-actions">' + (r.status === "review" ? '<a class="btn ghost sm" href="?id=' + id + '&edit=1">수정</a>' : "") + '<button class="btn danger sm" id="b-cancel">의뢰 취소</button></div>' : "") +
      "</div>" + steps(r.status);

    if (OM.qs("created")) h += '<p class="om-note" style="margin-bottom:16px">의뢰를 등록했습니다. 운영자가 확인하면 전문가에게 공개되고, 입찰이 오면 이 화면에서 비교할 수 있습니다.</p>';
    if (r.admin_note && ["review", "cancelled"].indexOf(r.status) >= 0) h += '<p class="om-note" style="margin-bottom:16px">운영자 메모: ' + esc(r.admin_note) + "</p>";

    // 상태별 안내
    if (r.status === "review") h += card("검수 대기 중", "운영자가 내용을 확인하고 있습니다. 공개되면 입찰 기간(기본 7일)이 시작됩니다.");
    if (r.status === "open" || r.status === "closed") h += bidsCard(r, bids);
    if (r.status === "selected" && sel) {
      h += card("입금을 기다리고 있습니다",
        "<b>" + esc(sel.experts.profiles.name) + "</b> 전문가를 선정했습니다. 아래 금액을 입금하시면 운영자가 확인 후 분석이 시작됩니다. 대금은 결과를 승인할 때까지 오믹스메이트가 보관합니다.",
        '<dl class="om-dl" style="margin-top:14px"><dt>입금액</dt><dd><b>' + OM.won(sel.amount) + "</b></dd><dt>입금 안내</dt><dd>" + esc(bank && bank.value && bank.value.text || "운영자가 입금 계좌를 메일로 안내해 드립니다.") + "</dd></dl>");
    }
    if (sel && ["in_progress", "delivered", "completed", "disputed"].indexOf(r.status) >= 0) {
      h += card("담당 전문가", "",
        '<dl class="om-dl"><dt>전문가</dt><dd>' + esc(sel.experts.profiles.name) + " · " + esc(L.tier[sel.experts.tier] || "") + "</dd><dt>금액</dt><dd>" + OM.won(sel.amount) +
        (pay ? " · " + OM.date(pay.paid_at) + " 입금 확인" : "") + "</dd><dt>기간</dt><dd>" + sel.days + "일</dd></dl>");
    }
    if (deliveries.length) {
      h += '<div class="om-card"><h2>결과물</h2>' + deliveries.map(function (d, i) { return '<p class="om-pre"><b>' + (i + 1) + "차 제출 · " + OM.date(d.created_at) + "</b>\n" + esc(d.note) + "</p>"; }).join("") +
        '<div id="deliv-files" style="margin-top:14px"><p class="om-dim">파일 불러오는 중…</p></div>' +
        (r.status === "delivered" ?
          '<form class="om-form" id="f-approve" style="margin-top:20px"><h3>결과를 확인하셨나요?</h3>' +
          '<div class="om-field">평점<div class="om-checks">' + [5, 4, 3, 2, 1].map(function (n) { return '<label><input type="radio" name="rating" value="' + n + '"' + (n === 5 ? " checked" : "") + "> " + "★".repeat(n) + "</label>"; }).join("") + "</div></div>" +
          '<label>후기 <small>선택</small><textarea name="comment" rows="3"></textarea></label>' +
          '<label>수정 요청 내용 <small>수정이 필요하면 적고 "수정 요청"을 눌러 주세요</small><textarea name="revision" rows="3"></textarea></label>' +
          '<div class="om-actions"><button class="btn primary" type="submit">승인하고 정산하기</button><button class="btn ghost" type="button" id="b-revise">수정 요청</button></div>' +
          '<p class="om-note">승인하면 보관 중인 대금이 전문가에게 지급됩니다.</p></form>' : "") +
        "</div>";
    }
    if (review) h += card("내 평가", "★".repeat(review.rating) + (review.comment ? " · " + esc(review.comment) : ""));

    // 의뢰 내용 + 데이터 파일
    h += '<div class="om-grid2"><div class="om-card"><h2>의뢰 내용</h2>' + OM.reqSummary(r) + "</div>" +
      '<div class="om-card"><h2>데이터 파일</h2><p class="om-dim">선정한 전문가와 운영자만 볼 수 있습니다. 대용량 FASTQ는 클라우드 링크를 의뢰 내용에 적어 주셔도 됩니다.</p>' +
      '<div id="req-files"><p class="om-dim">불러오는 중…</p></div>' +
      (["cancelled", "completed"].indexOf(r.status) < 0 ? '<label class="btn ghost sm" style="margin-top:12px">파일 올리기<input type="file" id="up-req" multiple hidden></label>' : "") +
      "</div></div>";

    if (OM.qs("edit") && r.status === "review") h = '<p class="om-dim"><a href="?id=' + id + '">← 의뢰로</a></p><div class="om-head"><div><h1>의뢰 수정</h1></div></div><div class="om-card">' + requestForm(r) + "</div>";
    main.innerHTML = h;

    // 동작 연결
    var f = OM.$("#f-req");
    if (f) f.onsubmit = function (e) {
      e.preventDefault(); var btn = this.querySelector("button[type=submit]"), v = readForm(this);
      OM.run(btn, async function () { OM.unwrap(await sb.from("requests").update(v).eq("id", id)); location.href = "?id=" + id; });
    };
    if (OM.$("#req-files")) OM.fileList("request-files", id).then(function (x) { OM.$("#req-files").innerHTML = x; }).catch(function (e) { OM.$("#req-files").textContent = OM.errMsg(e); });
    if (OM.$("#deliv-files")) OM.fileList("deliverables", id).then(function (x) { OM.$("#deliv-files").innerHTML = x; }).catch(function (e) { OM.$("#deliv-files").textContent = OM.errMsg(e); });
    var up = OM.$("#up-req");
    if (up) up.onchange = function () {
      OM.run(null, async function () {
        OM.toast("올리는 중…"); var n = await OM.upload("request-files", id, up);
        OM.toast(n + "개 파일을 올렸습니다."); OM.$("#req-files").innerHTML = await OM.fileList("request-files", id);
      });
    };
    var bc = OM.$("#b-cancel");
    if (bc) bc.onclick = function () {
      if (!confirm("이 의뢰를 취소할까요? 받은 입찰도 모두 닫힙니다.")) return;
      OM.run(bc, async function () { OM.unwrap(await sb.rpc("cancel_request", { req: id, note: "" })); location.reload(); });
    };
    OM.$$("[data-pick]").forEach(function (b) {
      b.onclick = function () {
        var bid = bids.filter(function (x) { return x.id === b.dataset.pick; })[0];
        if (!confirm(bid.experts.profiles.name + " 전문가(" + OM.won(bid.amount) + ", " + bid.days + "일)를 선정할까요? 다른 입찰은 미선정으로 닫힙니다.")) return;
        OM.run(b, async function () { OM.unwrap(await sb.rpc("select_bid", { bid: bid.id })); location.reload(); });
      };
    });
    var fa = OM.$("#f-approve");
    if (fa) {
      fa.onsubmit = function (e) {
        e.preventDefault(); var d = OM.formData(fa), btn = fa.querySelector("button[type=submit]");
        if (!confirm("결과를 승인할까요? 승인하면 대금이 전문가에게 지급됩니다.")) return;
        OM.run(btn, async function () { OM.unwrap(await sb.rpc("approve_delivery", { req: id, rating: +d.rating, comment: d.comment || "" })); location.reload(); });
      };
      OM.$("#b-revise").onclick = function () {
        var d = OM.formData(fa); if (!d.revision) { OM.toast("수정 요청 내용을 적어 주세요.", true); fa.revision.focus(); return; }
        OM.run(this, async function () { OM.unwrap(await sb.rpc("request_revision", { req: id, note: d.revision })); location.reload(); });
      };
    }
  }

  function card(title, text, extra) { return '<div class="om-card"><h2>' + title + "</h2>" + (text ? "<p>" + text + "</p>" : "") + (extra || "") + "</div>"; }

  function bidsCard(r, bids) {
    var head = r.status === "open" ? "입찰 " + bids.length + "건 · " + OM.dleft(r.bid_deadline) + " (" + OM.date(r.bid_deadline) + ")" : "입찰이 마감되었습니다. 받은 입찰 중에서 선정할 수 있습니다.";
    if (!bids.length) return card("받은 입찰", head + (r.status === "open" ? "<br>입찰이 들어오면 여기에 나타납니다." : ""));
    var rows = bids.map(function (b) {
      var e = b.experts || {}, p = e.profiles || {};
      return "<tr><td data-k=\"전문가\"><b>" + esc(p.name) + "</b><span class=\"sub\">" + esc(L.tier[e.tier] || "") + (e.rating ? " · ★" + e.rating : "") + " · 완료 " + (e.completed_count || 0) + "건</span>" +
        '<span class="sub">' + esc(e.fields || "") + "</span>" + (e.papers ? '<details><summary class="sub">논문 · 학력</summary><p class="om-pre sub">' + esc(e.education) + "\n" + esc(e.papers) + "</p></details>" : "") + "</td>" +
        '<td class="num" data-k="금액">' + OM.won(b.amount) + '</td><td class="num" data-k="기간">' + b.days + "일</td>" +
        '<td data-k="접근 방법 · 산출물"><span class="om-pre" style="margin:0;display:block">' + esc(b.approach) + "</span>" + (b.deliverables ? '<span class="sub">산출물: ' + esc(b.deliverables) + "</span>" : "") +
        (b.question ? '<span class="sub">질문: ' + esc(b.question) + "</span>" : "") + "</td>" +
        '<td data-k=""><button class="btn primary sm" data-pick="' + b.id + '">선정</button></td></tr>';
    }).join("");
    return '<div class="om-card"><h2>받은 입찰</h2><p class="om-dim">' + head + '</p><table class="om-bids"><thead><tr><th>전문가</th><th>금액(수수료 포함)</th><th>기간</th><th>접근 방법 · 산출물</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
})();
