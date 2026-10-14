/* 샘플로 앱 공통: 로그인 확인, 머리글, 이름표, 접수 기준 불러오기, 입력 검사.
   om-app.js(Supabase 연결과 작은 도우미) 다음에 불러오고, 각 화면(sp-login.js, sp-client.js, sp-admin.js)이 window.SP 를 씁니다.
   계정과 운영자 권한은 오믹스메이트와 같이 씁니다. DB 는 supabase/samplo.sql. */
(function () {
  var OM = window.OM, sb = OM.sb;

  var L = {
    // 주문 상태. 고객 화면의 추적 단계는 TRACK 순서를 따릅니다 (소개 페이지의 8단계와 같음).
    status: {
      submitted: "접수 확인 중", confirmed: "접수 확정", in_transit: "이동 중", received: "도착 · QC",
      extraction: "추출", library: "라이브러리", sequencing: "시퀀싱", data_ready: "데이터 도착",
      stored: "보관 중", completed: "완료", cancelled: "취소"
    },
    // 바이오뱅크 보관은 아직 사전 신청만 받음 (소개 페이지의 바이오뱅킹 "사전 신청")
    leftover: { biobank: "바이오뱅크 보관 (사전 신청)", return: "돌려받기", discard: "폐기", undecided: "나중에 정하기" },
    pay: { credit: "충전금에서 차감", invoice: "건별 청구 (세금계산서)" },
    qc: { pending: "측정 전", pass: "통과", warn: "확인 필요", fail: "기준 미달" },
    decision: { proceed: "그대로 진행", reextract: "재추출", exclude: "이 시료 제외", resend: "시료 다시 보내기" },
    topup: { requested: "입금 확인 중", paid: "충전 완료", cancelled: "취소" },
    ledger: { topup: "충전", bonus: "충전 보너스", charge: "의뢰 차감", refund: "환불", adjust: "조정" },
    event: { submitted: "의뢰 접수", updated: "의뢰 수정", confirmed: "접수 확정", status: "단계 변경", qc: "QC 결과", decision: "진행 방법 선택", cancelled: "취소", invoiced: "세금계산서 발행", note: "안내" }
  };
  var TRACK = ["confirmed", "in_transit", "received", "extraction", "library", "sequencing", "data_ready", "stored"];
  // 첫 단계는 운영자가 확인을 마친 "접수 확정"입니다 (의뢰를 낸 직후는 아직 불이 들어오지 않음)
  var TRACK_LABEL = ["접수 확정", "이동", "도착 · QC", "추출", "라이브러리", "시퀀싱", "데이터 도착", "보관"];

  // ───────── 한국 시간 ─────────
  function kstParts(d) {
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(d || new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  function todayKST() { var p = kstParts(); return p.year + "-" + p.month + "-" + p.day; }
  function hourKST() { return parseInt(kstParts().hour, 10); }
  function addDays(iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5); }
  function dow(iso) { return new Date(iso + "T00:00:00Z").getUTCDay(); }
  function dateLabel(iso) {
    if (!iso) return "-";
    var d = new Date(iso + "T00:00:00Z");
    return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일 (" + "일월화수목금토"[d.getUTCDay()] + ")";
  }

  // ───────── 입력 검사 (supabase/samplo.sql 의 sp_save_order 와 같은 규칙) ─────────
  var TYPOS = { "gmial.com": "gmail.com", "gmali.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "naver.co": "naver.com", "navr.com": "naver.com", "nave.com": "naver.com", "daum.ner": "daum.net", "hanmial.net": "hanmail.net", "hanmail.com": "hanmail.net" };
  // 숫자만 남김. 전각 숫자(０１０)는 보통 숫자로, +82 10-… 는 010-… 로 바꿉니다 (가입 화면 sp-login 과 같음)
  function digits(v) {
    v = String(v || "");
    if (v.normalize) v = v.normalize("NFKC");
    var d = v.replace(/\D/g, "");
    return /^821\d/.test(d) ? "0" + d.slice(2) : d;
  }
  var JAMO = /[ㄱ-ㅎㅏ-ㅣ]/;
  var V = {
    phone: function (v) { return /^01[016789]\d{7,8}$/.test(digits(v)); },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); },
    emailTypo: function (v) {
      var m = String(v || "").trim().split("@"); if (m.length !== 2) return null;
      var fix = TYPOS[m[1].toLowerCase()]; return fix ? m[0] + "@" + fix : null;
    },
    bizNo: function (v) {
      var d = String(v || "").replace(/\D/g, ""); if (d.length !== 10) return false;
      var w = [1, 3, 7, 1, 3, 7, 1, 3, 5], s = 0;
      for (var i = 0; i < 9; i++) s += +d[i] * w[i];
      s += Math.floor(+d[8] * 5 / 10);
      return (10 - s % 10) % 10 === +d[9];
    },
    sampleName: function (v) { return /^[A-Za-z0-9_-]{1,20}$/.test(String(v || "").trim()); },
    addr: function (v) { v = String(v || "").trim(); return v.length >= 6 && /\d/.test(v); },
    // 이름 · 소속: 고칠 점이 있으면 안내 문장, 없으면 "" (가입 화면 sp-login 과 같은 규칙. 정보 입력 카드에서도 씀)
    nameErr: function (v) {
      v = String(v || "").trim();
      if (!v) return "이름을 입력해 주세요.";
      if (JAMO.test(v)) return "이름에 덜 완성된 글자(ㄱ, ㅏ 같은)가 있습니다. 다시 확인해 주세요.";
      if (/[^\p{L}\s.·'-]/u.test(v)) return "이름에는 글자만 넣어 주세요. 숫자와 기호는 뺍니다.";
      if (v.replace(/[\s.·'-]/g, "").length < 2) return "이름을 2자 이상 입력해 주세요.";
      return "";
    },
    orgErr: function (v) {
      v = String(v || "").trim();
      if (!v) return "소속을 입력해 주세요. 예: ○○대학교 △△연구실";
      if (JAMO.test(v)) return "소속에 덜 완성된 글자(ㄱ, ㅏ 같은)가 있습니다. 다시 확인해 주세요.";
      if (Array.from(v).length < 2) return "소속을 2자 이상 입력해 주세요.";
      return "";
    }
  };
  function fmtPhone(v) {
    var d = digits(v).slice(0, 11);
    if (d.length < 4) return d;
    // 휴대폰이 아닌 번호(02 · 031 같은 지역번호)는 숫자만 남기고 하이픈을 억지로 넣지 않습니다. 아래 오류 문구가 고칠 방법을 알려 줍니다.
    if (!/^01/.test(d)) return d;
    if (d.length < 8) return d.slice(0, 3) + "-" + d.slice(3);
    return d.slice(0, 3) + "-" + d.slice(3, d.length - 4) + "-" + d.slice(-4);
  }
  function fmtBizNo(v) {
    var d = String(v || "").replace(/\D/g, "").slice(0, 10);
    return d.length <= 3 ? d : d.length <= 5 ? d.slice(0, 3) + "-" + d.slice(3) : d.slice(0, 3) + "-" + d.slice(3, 5) + "-" + d.slice(5);
  }
  // "2026.10.8", "2026/10/08", "20261008", "2026년 10월 8일", "26.10.8", 엑셀의 "2026-10-08 00:00:00" → "2026-10-08".
  // 알아볼 수 없으면 그대로 돌려줌. 두 자리 연도는 . 이나 / 로 나눈 것만 (12-03-05 같은 시료 번호가 날짜로 바뀌지 않도록)
  function normDate(v) {
    v = String(v || "").trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?$/, "");
    var m = v.match(/^(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})\.?$/) || v.match(/^(\d{4})(\d{2})(\d{2})$/) ||
            v.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
    var y = m && m[1];
    if (!m) { m = v.match(/^(\d{2})[.\/](\d{1,2})[.\/](\d{1,2})\.?$/); y = m && "20" + m[1]; }
    return m ? y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2) : v;
  }

  // ───────── 설정 (접수 기준 · 수거 · 충전 · 입금 안내) ─────────
  var settings = null;
  async function loadSettings() {
    if (settings) return settings;
    var rows = OM.unwrap(await sb.from("settings").select("key,value").in("key", ["sp_criteria", "sp_pickup", "sp_credit", "sp_bank"]));
    var s = {}; rows.forEach(function (r) { s[r.key] = r.value; });
    settings = { criteria: s.sp_criteria || { types: {}, services: {} }, pickup: s.sp_pickup || { slots: {} }, credit: s.sp_credit || { unit: 1000000 }, bank: (s.sp_bank || {}).text || "" };
    return settings;
  }

  // ───────── 로그인 · 머리글 ─────────
  var me = null;
  async function session() {
    if (!sb) return null;
    var s = (await sb.auth.getSession()).data.session;
    if (!s) return null;
    // 회원 정보를 못 불러왔으면(네트워크 오류 등) 빈 정보로 넘어가지 않고 오류로 알림 (정보 입력 카드나 "운영자만"이 잘못 뜨지 않도록)
    var pr = await sb.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
    if (pr.error) throw pr.error;
    var prof = pr.data;
    me = { user: s.user, profile: prof || { name: "", org: "", phone: "" }, isAdmin: !!(prof && prof.is_admin) };
    return me;
  }
  // 의뢰 전에 정보 입력 카드가 필요한지: 샘플로 약관 동의(sp_agreed_at)와 올바른 이름 · 소속 · 휴대폰 (DB sp_save_order 와 같은 조건)
  function needsProfile(m) { var p = m.profile || {}; return !p.sp_agreed_at || !V.phone(p.phone) || !!V.nameErr(p.name) || !!V.orgErr(p.org); }

  // samplo.sql 을 아직 실행하지 않았으면 표가 없다는 오류가 옴
  function missingDb(e) {
    var t = (e && (e.code || "")) + " " + (e && e.message || "");
    return /42P01|PGRST20[25]|does not exist|Could not find the (table|function)/i.test(t);
  }
  async function dbReady() {
    var r = await sb.from("sp_orders").select("id", { head: true, count: "exact" }).limit(1);
    return !(r.error && missingDb(r.error));
  }

  function closed(title, text) {
    var main = OM.$("#om-main");
    if (main) main.innerHTML =
      '<div class="om-card om-empty"><h2>' + OM.esc(title) + "</h2><p>" + OM.esc(text) + "</p>" +
      '<a class="btn primary" href="' + OM.KAKAO + '" target="_blank" rel="noopener">카카오톡 상담하기</a></div>';
  }
  function notReady() { header(null); closed("온라인 의뢰는 오픈 준비 중입니다", "지금은 카카오톡 채널에서 상담과 의뢰를 받고 있습니다."); }

  // 로그인이 필요한 화면: 안 되어 있으면 로그인 화면으로 보냄
  // 온라인 의뢰를 고객에게 여는 스위치는 om-config.js 의 samplo (기본 false). 꺼져 있어도 운영자는 설정 · 시험을 할 수 있습니다.
  async function requireLogin() {
    if (!sb) { notReady(); return null; }
    var m;
    try { m = await session(); } catch (e) { header(null); closed("화면을 불러오지 못했습니다", OM.errMsg(e) + " 잠시 뒤 새로고침해 주세요."); return null; }
    if (!m) { location.replace("/samplo/login/?next=" + encodeURIComponent(location.pathname + location.search)); return null; }
    header(m);
    if (!(await dbReady())) { closed("온라인 의뢰는 오픈 준비 중입니다", "계정은 만들어졌습니다. 의뢰 접수가 열리면 이 화면에서 바로 이용할 수 있습니다."); return null; }
    if ((window.OM_CONFIG || {}).samplo !== true && !m.isAdmin) {
      closed("온라인 의뢰는 오픈 준비 중입니다", "계정은 만들어졌습니다. 의뢰 접수가 열리면 이 화면에서 바로 이용할 수 있습니다. 지금은 카카오톡 채널에서 상담과 의뢰를 받고 있습니다.");
      return null;
    }
    return m;
  }

  function header(m) {
    var nav = OM.$("#om-nav");
    if (!nav) return;
    var here = location.pathname + location.search;
    function a(href, label, on) { return '<a href="' + href + '"' + (on ? ' class="on"' : "") + ">" + label + "</a>"; }
    if (!m) { nav.innerHTML = '<a href="/samplo/">서비스 소개</a>' + (sb ? a("/samplo/login/", "로그인", /\/samplo\/login\//.test(here)) : ""); return; }
    var isNew = /[?&](new|edit)=/.test(location.search);
    nav.innerHTML =
      a("/samplo/app/", "내 의뢰", /^\/samplo\/app\/?$/.test(location.pathname) && !isNew) +
      a("/samplo/app/?new=1", "새 의뢰", isNew) +
      (m.isAdmin ? a("/samplo/admin/", "운영", /^\/samplo\/admin\//.test(location.pathname)) : "") +
      '<span class="om-who">' + OM.esc(m.profile.name || m.user.email) + '</span><button type="button" class="om-link" id="om-logout">로그아웃</button>';
    OM.$("#om-logout").onclick = async function () {
      // 같이 쓰는 실험실 PC 를 생각해, 이 브라우저에 남은 의뢰 작성 내용(연구실 · 연락처 · 주소 · 세금계산서 메일)을 지움
      try {
        var ks = [];
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf("sp-draft-") === 0) ks.push(k); }
        ks.forEach(function (k) { localStorage.removeItem(k); });
        sessionStorage.removeItem("sp-signup");
      } catch (e) {}
      await sb.auth.signOut();
      location.href = "/samplo/";
    };
  }

  // ───────── 표시 도우미 ─────────
  function chip(status) { return '<span class="om-chip sp-s-' + OM.esc(status) + '">' + OM.esc(L.status[status] || status) + "</span>"; }
  function qcChip(q) { return '<span class="om-chip sp-qc-' + OM.esc(q) + '">' + OM.esc(L.qc[q] || q) + "</span>"; }
  // 8단계 추적 막대
  function track(status) {
    var i = TRACK.indexOf(status);
    if (status === "completed") i = TRACK.length;
    return '<ol class="sp-track" aria-label="진행 단계">' + TRACK.map(function (s, k) {
      var c = status === "cancelled" ? "" : k < i ? "done" : k === i ? "now" : "";
      return '<li class="' + c + '"' + (c === "now" ? ' aria-current="step"' : "") + "><i>" + (k + 1) + "</i><span>" + TRACK_LABEL[k] + "</span></li>";
    }).join("") + "</ol>";
  }
  function typeName(crit, k) { var t = crit.types[k]; return t ? t.name : k; }
  function serviceName(crit, k) { var s = crit.services[k]; return s ? s.name : k; }
  function slotLabel(pick, k) { var s = (pick.slots || {})[k]; return s ? s.label : k; }

  window.SP = {
    sb: sb, L: L, TRACK: TRACK, TRACK_LABEL: TRACK_LABEL, V: V, me: function () { return me; },
    todayKST: todayKST, hourKST: hourKST, addDays: addDays, daysBetween: daysBetween, dow: dow, dateLabel: dateLabel,
    fmtPhone: fmtPhone, fmtBizNo: fmtBizNo, normDate: normDate,
    loadSettings: loadSettings, session: session, needsProfile: needsProfile, requireLogin: requireLogin, header: header,
    notReady: notReady, missingDb: missingDb, dbReady: dbReady,
    chip: chip, qcChip: qcChip, track: track, typeName: typeName, serviceName: serviceName, slotLabel: slotLabel
  };
})();
