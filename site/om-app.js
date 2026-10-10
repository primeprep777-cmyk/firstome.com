/* 오믹스메이트 앱 공통: Supabase 연결, 로그인 확인, 머리글, 표시용 이름표, 작은 도우미.
   각 화면(om-login.js, om-client.js, om-expert.js, om-admin.js)이 window.OM 을 씁니다. */
(function () {
  var cfg = window.OM_CONFIG || {};
  var KAKAO = "https://pf.kakao.com/_uuXFX/chat";
  var ready = !!(cfg.url && cfg.anonKey && window.supabase);
  var sb = ready ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  var L = {
    dtype: { bulk: "Bulk RNA-seq", sc: "단일세포 RNA-seq", wgs: "WGS · WES", prot: "단백체 · 대사체", spatial: "공간오믹스", multi: "멀티오믹스 통합" },
    scope: { basic: "QC · 기본 분석", deg: "발현 차이 · 변이 해석", path: "경로 · 기능 분석", anno: "세포 유형 주석 · 궤적", integ: "통합 · 배치 보정 · 메타분석", ml: "바이오마커 · 예측 모델", fig: "논문용 그림", method: "방법(Methods) 초안", rev: "리뷰어 대응 분석" },
    speed: { std: "표준 납기", fast: "빠른 납기", slow: "여유 납기" },
    tierMin: { any: "전체 등급", gold: "Gold 이상", plat: "Platinum만" },
    tier: { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" },
    band: ["기본", "표준", "확장", "심화", "대규모"],
    samples: ["1~3개", "4~6개", "8개", "12개", "약 24개", "약 36개", "약 48개", "약 72개", "약 96개", "약 150개", "약 200개", "300개 이상"],
    status: { review: "검수 대기", open: "입찰 중", closed: "입찰 마감", selected: "선정 · 결제 대기", in_progress: "진행 중", delivered: "결과 제출됨", completed: "완료", cancelled: "취소", disputed: "분쟁 조정 중" },
    bidStatus: { submitted: "제출", withdrawn: "철회", selected: "선정", rejected: "미선정" },
    payMethod: { transfer: "계좌이체", card: "카드", research_card: "연구비 카드" },
    docType: { tax_invoice: "세금계산서", cash_receipt: "현금영수증", none: "필요 없음" },
    expertStatus: { pending: "심사 중", approved: "승인", rejected: "반려", suspended: "정지" }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function won(n) { return n == null ? "-" : Number(n).toLocaleString("ko-KR") + "원"; }
  function date(s) { if (!s) return "-"; var d = new Date(s); return d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate(); }
  function dleft(s) {
    if (!s) return "";
    var ms = new Date(s) - new Date(), d = Math.ceil(ms / 864e5);
    return ms <= 0 ? "마감" : d <= 1 ? "오늘 마감" : d + "일 남음";
  }
  function qs(k) { return new URLSearchParams(location.search).get(k); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
  function chip(status, map) { return '<span class="om-chip s-' + esc(status) + '">' + esc((map || L.status)[status] || status) + "</span>"; }
  function formData(form) {
    var o = {};
    new FormData(form).forEach(function (v, k) {
      if (form.elements[k] && form.elements[k].length && form.elements[k][0] && form.elements[k][0].type === "checkbox") (o[k] = o[k] || []).push(v);
      else o[k] = typeof v === "string" ? v.trim() : v;
    });
    return o;
  }

  var toastT;
  function toast(msg, bad) {
    var t = $("#om-toast");
    if (!t) { t = document.createElement("div"); t.id = "om-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.className = bad ? "bad on" : "on";
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = ""; }, 3600);
  }
  // Supabase 오류를 사람이 읽을 문장으로
  function errMsg(e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return "이메일 또는 비밀번호가 맞지 않습니다.";
    if (/Email not confirmed/i.test(m)) return "이메일 인증을 먼저 완료해 주세요. 받은편지함을 확인해 주세요.";
    if (/already registered/i.test(m)) return "이미 가입된 이메일입니다. 로그인해 주세요.";
    if (/row-level security|permission denied/i.test(m)) return "이 작업을 할 권한이 없습니다.";
    if (/Password should be/i.test(m)) return "비밀번호는 8자 이상으로 정해 주세요.";
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 카카오톡 채널로 문의해 주세요.";
    return m;
  }
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { toast(errMsg(e), true); console.error(e); }
    finally { if (btn) btn.disabled = false; }
  }
  // supabase 응답 { data, error } 를 풀어 error 면 던짐
  function unwrap(res) { if (res.error) throw res.error; return res.data; }

  var me = null;
  async function session() {
    if (!sb) return null;
    var s = (await sb.auth.getSession()).data.session;
    if (!s) return null;
    var prof = (await sb.from("profiles").select("*").eq("id", s.user.id).maybeSingle()).data;
    var ex = (await sb.from("experts").select("*").eq("id", s.user.id).maybeSingle()).data;
    me = { user: s.user, profile: prof || { name: "", org: "" }, expert: ex, isAdmin: !!(prof && prof.is_admin) };
    return me;
  }
  // 로그인이 필요한 화면: 안 되어 있으면 로그인 화면으로 보냄
  async function requireLogin() {
    if (!sb) { notReady(); return null; }
    var m = await session();
    if (!m) { location.replace("/omicsmate/login/?next=" + encodeURIComponent(location.pathname + location.search)); return null; }
    header(m);
    return m;
  }
  function notReady() {
    var main = $("#om-main");
    if (main) main.innerHTML =
      '<div class="om-card om-empty"><h2>온라인 의뢰·입찰은 오픈 준비 중입니다</h2>' +
      '<p>지금은 카카오톡 채널에서 상담과 의뢰를 받고 있습니다.</p>' +
      '<a class="btn primary" href="' + KAKAO + '" target="_blank" rel="noopener">카카오톡 상담하기</a></div>';
    header(null);
  }
  function header(m) {
    var nav = $("#om-nav");
    if (!nav) return;
    var here = location.pathname;
    function a(href, label) { return '<a href="' + href + '"' + (here.indexOf(href) === 0 ? ' class="on"' : "") + ">" + label + "</a>"; }
    if (!m) { nav.innerHTML = '<a href="/omicsmate/">서비스 소개</a>' + (sb ? a("/omicsmate/login/", "로그인") : ""); return; }
    nav.innerHTML = a("/omicsmate/app/", "내 의뢰") + a("/omicsmate/expert/", "전문가") +
      (m.isAdmin ? a("/omicsmate/admin/", "운영") : "") +
      '<span class="om-who">' + esc(m.profile.name || m.user.email) + '</span><button type="button" class="om-link" id="om-logout">로그아웃</button>';
    $("#om-logout").onclick = async function () { await sb.auth.signOut(); location.href = "/omicsmate/"; };
  }

  // 입찰 금액은 부가세 포함 총액: 공급가액 = 금액 ÷ 1.1
  function vatSplit(total) { var supply = Math.round(total / 1.1); return { supply: supply, vat: total - supply, total: total }; }
  function amountDl(total) {
    var v = vatSplit(total);
    return '<dl class="om-dl" style="margin-top:14px"><dt>결제 금액</dt><dd><b>' + won(v.total) + '</b> <small class="om-dim">부가세 포함</small></dd>' +
      "<dt>공급가액</dt><dd>" + won(v.supply) + "</dd><dt>부가세</dt><dd>" + won(v.vat) + "</dd></dl>";
  }

  function scopeText(arr) { return (arr || []).map(function (s) { return L.scope[s] || s; }).join(", "); }
  function reqSummary(r) {
    return '<dl class="om-dl">' +
      "<dt>데이터</dt><dd>" + esc(L.dtype[r.dtype] || r.dtype) + (r.n_samples ? " · " + esc(r.n_samples) : "") + "</dd>" +
      "<dt>분석 범위</dt><dd>" + esc(scopeText(r.scope)) + "</dd>" +
      "<dt>납기</dt><dd>" + esc(L.speed[r.speed] || r.speed) + (r.due_date ? " · 희망 " + date(r.due_date) : "") + "</dd>" +
      "<dt>희망 등급</dt><dd>" + esc(L.tierMin[r.tier_min] || r.tier_min) + "</dd>" +
      (r.est_band ? "<dt>예상 구간</dt><dd>구간 " + r.est_band + " · " + esc(L.band[r.est_band - 1]) + "</dd>" : "") +
      (r.data_status ? "<dt>데이터 상태</dt><dd>" + esc(r.data_status) + "</dd>" : "") +
      "</dl>" + (r.purpose ? '<p class="om-pre">' + esc(r.purpose) + "</p>" : "");
  }

  // 저장소 파일 목록 + 내려받기 링크
  async function fileList(bucket, reqId) {
    var files = unwrap(await sb.storage.from(bucket).list(reqId, { sortBy: { column: "created_at", order: "asc" } })) || [];
    files = files.filter(function (f) { return f.name && f.name !== ".emptyFolderPlaceholder"; });
    if (!files.length) return '<p class="om-dim">아직 파일이 없습니다.</p>';
    var out = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i], s = await sb.storage.from(bucket).createSignedUrl(reqId + "/" + f.name, 3600);
      var size = f.metadata && f.metadata.size ? " · " + (f.metadata.size / 1048576).toFixed(1) + "MB" : "";
      out.push('<li><a href="' + esc(s.data && s.data.signedUrl) + '" target="_blank" rel="noopener">' + esc(f.name) + "</a><small>" + size + "</small></li>");
    }
    return '<ul class="om-files">' + out.join("") + "</ul>";
  }
  async function upload(bucket, reqId, input) {
    var files = [].slice.call(input.files || []);
    for (var i = 0; i < files.length; i++) {
      var safe = files[i].name.replace(/[^\w.\-가-힣]/g, "_");
      unwrap(await sb.storage.from(bucket).upload(reqId + "/" + Date.now() + "_" + safe, files[i]));
    }
    return files.length;
  }

  window.OM = {
    sb: sb, ready: ready, KAKAO: KAKAO, L: L, me: function () { return me; },
    esc: esc, won: won, date: date, dleft: dleft, qs: qs, $: $, $$: $$, chip: chip, formData: formData,
    toast: toast, errMsg: errMsg, run: run, unwrap: unwrap, session: session, requireLogin: requireLogin,
    header: header, notReady: notReady, vatSplit: vatSplit, amountDl: amountDl, scopeText: scopeText, reqSummary: reqSummary, fileList: fileList, upload: upload
  };
})();
