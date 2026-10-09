/* /omicsmate/app/quote/?bid=… : 입찰 하나에 대한 견적서 (인쇄 · PDF 저장용)
   공급자 정보는 운영 화면 > 설정 > 회사 정보(settings.company)에서 채웁니다. */
(async function () {
  var OM = window.OM, sb = OM.sb, L = OM.L, esc = OM.esc, main = OM.$("#om-main");
  var me = await OM.requireLogin(); if (!me) return;
  var bidId = OM.qs("bid");
  var b = bidId && OM.unwrap(await sb.from("bids").select("*, experts(tier, profiles(name))").eq("id", bidId).maybeSingle());
  var r = b && OM.unwrap(await sb.from("requests").select("*").eq("id", b.request_id).maybeSingle());
  if (!b || !r) { main.innerHTML = '<div class="om-card om-empty"><h2>견적서를 만들 수 없습니다</h2><p>의뢰인 본인의 의뢰에 들어온 입찰만 견적서로 볼 수 있습니다.</p><a class="btn ghost" href="../">내 의뢰</a></div>'; return; }
  var co = (OM.unwrap(await sb.from("settings").select("value").eq("key", "company").maybeSingle()) || {}).value || {};
  var billRes = await sb.from("billing").select("*").eq("request_id", r.id).maybeSingle();
  var bill = !billRes.error && billRes.data && billRes.data.doc_type === "tax_invoice" ? billRes.data : null;

  var v = OM.vatSplit(b.amount), today = new Date();
  var no = "Q-" + today.getFullYear() + String(today.getMonth() + 1).padStart(2, "0") + String(today.getDate()).padStart(2, "0") + "-" + b.id.slice(0, 6).toUpperCase();
  var valid = new Date(today.getTime() + 30 * 864e5);
  var pending = "법인 설립 후 기재";
  function row(k, val) { return "<tr><th>" + k + "</th><td>" + (val ? esc(val) : '<span class="om-dim">' + pending + "</span>") + "</td></tr>"; }
  var e = b.experts || {};

  main.innerHTML =
    '<div class="om-actions om-noprint" style="margin-bottom:16px"><a class="btn ghost sm" href="../?id=' + r.id + '">← 의뢰로</a><button class="btn primary sm" onclick="window.print()">인쇄 · PDF로 저장</button></div>' +
    '<article class="om-quote">' +
    '<div class="om-quote-head"><h1>견 적 서</h1><p class="om-dim">견적번호 ' + no + " · 견적일 " + OM.date(today) + " · 유효기간 " + OM.date(valid) + "까지</p></div>" +
    '<div class="om-quote-parties">' +
    '<div><h3>수신</h3><table>' +
    row("기관", bill ? bill.biz_name : me.profile.org) + row("사업자번호", bill ? bill.biz_no : "") .replace(pending, "-") +
    row("담당자", me.profile.name) + row("메일", bill && bill.email || me.user.email) + (bill && bill.project_no ? row("과제번호", bill.project_no) : "") + "</table></div>" +
    '<div><h3>공급자</h3><table>' +
    row("상호", co.name || "퍼스트옴") + row("사업자번호", co.biz_no) + row("대표자", co.ceo) + row("주소", co.address) + row("연락처", [co.phone, co.email].filter(Boolean).join(" · ")) + "</table></div>" +
    "</div>" +
    '<p class="om-quote-total">합계 금액 <b>' + OM.won(v.total) + "</b> <small>(부가세 포함)</small></p>" +
    '<table class="om-quote-items"><thead><tr><th>품목</th><th>수량</th><th>공급가액</th><th>부가세</th><th>합계</th></tr></thead><tbody>' +
    "<tr><td><b>오믹스 데이터 분석 용역</b><br>" + esc(r.title) + '<br><small class="om-dim">' + esc(L.dtype[r.dtype]) + (r.n_samples ? " · " + esc(r.n_samples) : "") + " · " + esc(OM.scopeText(r.scope)) + "</small></td>" +
    '<td class="num">1식</td><td class="num">' + OM.won(v.supply) + '</td><td class="num">' + OM.won(v.vat) + '</td><td class="num">' + OM.won(v.total) + "</td></tr>" +
    '</tbody><tfoot><tr><th colspan="2">합계</th><td class="num">' + OM.won(v.supply) + '</td><td class="num">' + OM.won(v.vat) + '</td><td class="num"><b>' + OM.won(v.total) + "</b></td></tr></tfoot></table>" +
    '<dl class="om-dl" style="margin-top:20px"><dt>수행 기간</dt><dd>결제 확인 후 ' + b.days + "일</dd>" +
    "<dt>수행</dt><dd>오믹스메이트 " + esc(L.tier[e.tier] || "") + " 등급 전문가" + (b.status === "selected" ? " " + esc((e.profiles || {}).name || "") : "") + "</dd>" +
    (b.deliverables ? "<dt>산출물</dt><dd>" + esc(b.deliverables) + "</dd>" : "") +
    "<dt>결제 조건</dt><dd>선정 후 선결제, 결과 승인 시까지 오믹스메이트가 대금을 보관(에스크로)</dd>" +
    "<dt>증빙</dt><dd>세금계산서 또는 현금영수증 발행 가능</dd></dl>" +
    '<p class="om-dim" style="margin-top:24px">위와 같이 견적합니다. · 오믹스메이트 (퍼스트옴)</p>' +
    "</article>";
})();
