/* /samplo/login/ : 로그인 · 회원가입 · 비밀번호 재설정 · 새 비밀번호
   가입은 한 화면에서 끝냅니다. 칸마다 벗어날 때(blur)와 제출할 때 검사하고, 틀린 첫 칸으로 커서를 옮깁니다.
   서버가 오류를 돌려줘도 입력한 내용은 그대로 두고, 오류는 해당 칸 아래에 보여 줍니다.
   ?next=/samplo/… : 로그인 뒤 갈 곳 (기본 /samplo/app/) · ?mode=signup|reset : 처음 보여 줄 화면 */
(async function () {
  var OM = window.OM, SP = window.SP, sb = OM.sb, main = OM.$("#om-main");
  if (!sb) return SP.notReady();
  SP.header(null);

  var cfg = window.OM_CONFIG || {};
  var kakaoOn = cfg.kakao === true;

  // 로그인 뒤 갈 곳: /samplo/ 아래만 허용 (로그인 화면 자신은 제외)
  var next = OM.qs("next") || "";
  if (!/^\/samplo\//.test(next) || /^\/samplo\/login/.test(next)) next = "";
  var dest = next || "/samplo/app/";
  var forOrder = /[?&](new|edit)=/.test(dest);
  function go() { location.replace(dest); }
  function back() { return location.origin + "/samplo/login/?next=" + encodeURIComponent(dest); }

  // 메일 링크 · 카카오 로그인에서 돌아온 결과는 주소의 # 또는 ? 에 붙어 옵니다. supabase-js 가 곧 지우므로 먼저 읽어 둡니다.
  var hp = new URLSearchParams(location.hash.replace(/^#/, ""));
  function hq(k) { return hp.get(k) || OM.qs(k) || ""; }
  var recovering = hp.get("type") === "recovery";
  var notice = linkError(hq("error_code"), hq("error"), hq("error_description"));

  var body = null, cur = "", tried = false;
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "PASSWORD_RECOVERY") { recovering = true; if (body && cur !== "newpw") show("newpw"); }
  });

  var m = await SP.session();
  if (m && !recovering) return go();
  // 오류가 붙은 주소는 정리해서 새로고침해도 같은 안내가 다시 뜨지 않게
  if (notice) try { history.replaceState(null, "", location.pathname + (next ? "?next=" + encodeURIComponent(next) : "")); } catch (e) {}

  function linkError(code, err, desc) {
    if (!code && !err && !desc) return "";
    if (code === "otp_expired" || /expired|invalid/i.test(desc))
      return "메일의 링크가 만료되었거나 이미 사용되었습니다. 가입 인증을 이미 마쳤다면 그대로 로그인해 주세요. 비밀번호를 바꾸려던 거라면 '비밀번호를 잊으셨나요?'에서 링크를 다시 받아 주세요.";
    if (err === "access_denied") return "로그인을 마치지 못했습니다. 다시 시도하거나 이메일로 가입해 주세요.";
    return "로그인을 마치지 못했습니다 (" + (desc || err || code) + "). 다시 시도하거나 카카오톡 채널로 문의해 주세요.";
  }

  // ───────── 입력한 내용 보관 (탭을 바꾸거나 새로고침해도 남김. 비밀번호는 저장하지 않음) ─────────
  var KEEP = { name: 1, org: 1, phone: 1, email: 1 };
  var keep = {};
  try { keep = JSON.parse(sessionStorage.getItem("sp-signup") || "{}") || {}; } catch (e) { keep = {}; }
  function remember(inp) {
    if (inp.type === "checkbox") { keep[inp.name] = inp.checked; return; }
    if (!KEEP[inp.name]) return;
    keep[inp.name] = inp.value;
    try { sessionStorage.setItem("sp-signup", JSON.stringify({ name: keep.name, org: keep.org, phone: keep.phone, email: keep.email })); } catch (e) {}
  }
  function forget() { try { sessionStorage.removeItem("sp-signup"); } catch (e) {} }

  // ───────── 칸 검사 ─────────
  var JAMO = /[ㄱ-ㅎㅏ-ㅣ]/, HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
  var okTypo = "";   // "이대로 쓰기"를 누른 이메일
  function E(t, html) { return { e: html ? t : OM.esc(t) }; }
  function W(html) { return { w: html }; }
  function nfkc(v) { v = String(v || ""); return v.normalize ? v.normalize("NFKC") : v; }
  function pwRules(v) { return { len: v.length >= 8, mix: /[A-Za-z]/.test(v) && /\d/.test(v) }; }
  // +82 10-… 로 붙여 넣어도 010-… 로
  function phoneFmt(v) { var d = nfkc(v).replace(/\D/g, ""); if (/^821\d/.test(d)) d = "0" + d.slice(2); return SP.fmtPhone(d); }

  // 고칠 점이 있으면 { e: 오류 HTML } 또는 { w: 안내 HTML }, 문제없으면 null
  function check(inp, submitting) {
    var k = inp.name, v = inp.type === "checkbox" ? inp.checked : inp.value.trim();
    var strict = cur !== "login";            // 로그인은 가입 때 검사를 통과한 값이라 형식만 봄
    var hard = submitting || tried;          // 한 번 제출을 시도한 뒤에는 안내도 오류로
    // 서버가 돌려준 오류는 값을 고칠 때까지 남김
    if (inp._srv && inp._srv.v === inp.value) return { e: inp._srv.t };
    if (k === "name") {
      if (!v) return E("이름을 입력해 주세요.");
      if (JAMO.test(v)) return E("이름에 덜 완성된 글자(ㄱ, ㅏ 같은)가 있습니다. 다시 확인해 주세요.");
      if (/[^\p{L}\s.·'-]/u.test(v)) return E("이름에는 글자만 넣어 주세요. 숫자와 기호는 뺍니다.");
      if (v.replace(/[\s.·'-]/g, "").length < 2) return E("이름을 2자 이상 입력해 주세요.");
      return null;
    }
    if (k === "org") {
      if (!v) return E("소속을 입력해 주세요. 예: ○○대학교 △△연구실");
      if (JAMO.test(v)) return E("소속에 덜 완성된 글자(ㄱ, ㅏ 같은)가 있습니다. 다시 확인해 주세요.");
      if (v.length < 2) return E("소속을 2자 이상 입력해 주세요.");
      return null;
    }
    if (k === "phone") {
      if (!v) return E("휴대폰 번호를 입력해 주세요.");
      if (!SP.V.phone(v)) return E("010으로 시작하는 휴대폰 번호 10–11자리를 입력해 주세요.");
      return null;
    }
    if (k === "email") {
      if (!v) return E("이메일을 입력해 주세요.");
      if (HANGUL.test(v)) return E("이메일에 한글이 들어 있습니다. 한/영 키를 바꿔 다시 입력해 주세요.");
      if (!SP.V.email(v)) return E("이메일 형식이 맞지 않습니다. 예: name@lab.ac.kr");
      var fix = SP.V.emailTypo(v);
      if (fix && v.toLowerCase() !== okTypo) {
        var tip = "혹시 <b>" + OM.esc(fix) + '</b>인가요? <button type="button" class="om-link" data-act="fix" data-v="' + OM.esc(fix) + '">바꾸기</button>';
        if (hard && strict) return E("주소를 확인해 주세요. " + tip + ' · <button type="button" class="om-link" data-act="keep-typo">이대로 쓰기</button>', true);
        return W(tip);
      }
      return null;
    }
    if (k === "password") {
      var p = inp.value;
      if (!p) return E(cur === "newpw" ? "새 비밀번호를 입력해 주세요." : "비밀번호를 입력해 주세요.");
      if (!strict) return HANGUL.test(p) ? W("비밀번호에 한글이 들어 있습니다. 한/영 키를 확인해 주세요.") : null;
      if (HANGUL.test(p)) return E("비밀번호에 한글이 들어 있습니다. 한/영 키를 바꿔 다시 입력해 주세요.");
      if (/^\s|\s$/.test(p)) return E("비밀번호 앞이나 뒤에 빈칸이 있습니다. 빈칸을 지워 주세요.");
      var r = pwRules(p);
      if (!r.len || !r.mix) return E("비밀번호는 8자 이상으로, 영문과 숫자를 섞어 주세요.");
      if (p.length > 72) return E("비밀번호는 72자까지 쓸 수 있습니다.");
      return null;
    }
    if (k === "agree") return v ? null : E("이용약관과 개인정보 처리방침에 동의해야 가입할 수 있습니다.");
    return null;
  }

  // 칸 표시: 빨간 테두리 + 아래 문장. 같은 내용이면 다시 그리지 않음 (안내 속 버튼이 눌리기 전에 사라지지 않게)
  function setMsg(el, kind, html) {
    var cls = "sp-msg" + (kind ? " " + kind : "");
    if (el._h === html && el.className === cls) return;
    el._h = html; el.className = cls; el.innerHTML = html;
  }
  function mark(inp, r) {
    var w = inp.closest(".sp-f"), msg = w && w.querySelector("#m-" + inp.name), bad = !!(r && r.e);
    if (w) w.classList.toggle("sp-invalid", bad);
    inp.setAttribute("aria-invalid", String(bad));
    if (msg) setMsg(msg, r ? (r.e ? "err" : "warn") : "", r ? (r.e || r.w) : "");
    return !bad;
  }
  // 칸을 벗어날 때 빈칸 · 전각 문자 · 하이픈 정리
  function tidy(inp) {
    var k = inp.name, a = inp.value, b = a;
    if (k === "name" || k === "org") b = a.replace(/\s+/g, " ").trim();
    else if (k === "email") b = nfkc(a).replace(/\s+/g, "");
    else if (k === "phone") b = phoneFmt(a);
    if (b !== a) { inp.value = b; remember(inp); }
  }
  function formErr(f, html) {
    var el = f && f.querySelector("#sp-ferr");
    if (!el) return;
    el.innerHTML = html || ""; el.hidden = !html;
  }
  // 모든 칸 검사 → 틀린 첫 칸으로 커서. 모두 맞으면 true
  function validate(f) {
    tried = true;
    var bad = [];
    OM.$$("[data-check]", f).forEach(function (inp) {
      if (inp.type !== "checkbox") tidy(inp);
      inp._dirty = true;
      if (!mark(inp, check(inp, true))) bad.push(inp);
    });
    formErr(f, bad.length > 1 ? "고칠 칸이 " + bad.length + "곳 있습니다. 빨간 안내를 확인해 주세요." : "");
    if (bad.length) bad[0].focus();
    return !bad.length;
  }
  function val(f, k) { return f.elements[k].value.trim(); }

  // ───────── 서버 오류 → 칸과 문장 ─────────
  function authErr(e) {
    var msg = (e && (e.message || e.error_description)) || String(e), c = (e && e.code) || "";
    var sec = msg.match(/after (\d+) seconds?/i);
    if (c === "invalid_credentials" || /Invalid login credentials/i.test(msg))
      return { k: "password", t: "이메일 또는 비밀번호가 맞지 않습니다. 비밀번호가 기억나지 않으면 아래 '비밀번호를 잊으셨나요?'를 눌러 주세요." };
    if (c === "email_not_confirmed" || /Email not confirmed/i.test(msg))
      return { k: "email", h: '아직 이메일 인증을 마치지 않았습니다. 받은 메일의 링크를 눌러 주세요. <button type="button" class="om-link" data-act="resend-login">인증 메일 다시 받기</button>' };
    if (c === "user_already_exists" || c === "email_exists" || /already (been )?registered|already exists/i.test(msg))
      return { k: "email", h: '이미 가입된 이메일입니다. 오믹스메이트 계정도 같은 이메일로 로그인할 수 있습니다. <button type="button" class="om-link" data-go="login">로그인하기</button>' };
    if (c === "same_password" || /different from the old/i.test(msg))
      return { k: "password", t: "지금 쓰는 비밀번호와 다른 비밀번호로 정해 주세요." };
    if (c === "weak_password" || /Password should|weak|easy to guess|pwned/i.test(msg))
      return { k: "password", t: /pwned|easy to guess|leak/i.test(msg + " " + (e.reasons || []).join(" ")) ? "널리 알려진 흔한 비밀번호입니다. 다른 비밀번호로 정해 주세요." : "더 안전한 비밀번호가 필요합니다. 영문과 숫자에 기호도 섞어 다시 정해 주세요." };
    if (c === "email_address_invalid" || /validate email|invalid format|Email address .* is invalid/i.test(msg))
      return { k: "email", t: "쓸 수 없는 이메일 주소입니다. 주소를 다시 확인해 주세요." };
    if (c === "email_address_not_authorized" || /not authorized/i.test(msg))
      return { t: "지금은 이 주소로 메일을 보낼 수 없습니다. 카카오톡 채널로 알려 주시면 바로 도와드리겠습니다." };
    if (/rate.?limit|too many/i.test(msg + " " + c) || (e && e.status === 429) || sec)
      return { t: "요청이 너무 잦습니다. " + (sec ? sec[1] + "초" : "1분쯤") + " 뒤에 다시 시도해 주세요." };
    if (c === "signup_disabled" || /signups? not allowed/i.test(msg))
      return { t: "지금은 온라인 가입을 받지 않습니다. 카카오톡 채널로 문의해 주세요." };
    if (c === "session_not_found" || /session missing|session_not_found/i.test(msg))
      return { h: '재설정 링크의 유효 시간이 지났습니다. <button type="button" class="om-link" data-go="reset">재설정 링크 다시 받기</button>' };
    return { t: OM.errMsg(e) };
  }
  // 오류를 해당 칸(없으면 버튼 위)에 보여 줌. 입력한 값은 건드리지 않음
  function fail(f, e) {
    console.error(e);
    var r = authErr(e), html = r.h || OM.esc(r.t), inp = r.k && f.elements[r.k];
    if (inp) {
      inp._srv = { v: inp.value, t: html };
      mark(inp, { e: html }); formErr(f, ""); inp.focus();
    } else formErr(f, html);
  }

  // ───────── 화면 조각 ─────────
  function v(k) { return OM.esc(keep[k] || ""); }
  function field(k, label, hint, input) {
    return '<div class="om-field sp-f"><label for="sp-' + k + '">' + label + (hint ? " <small>" + hint + "</small>" : "") + "</label>" + input +
      '<p class="sp-msg" id="m-' + k + '" aria-live="polite"></p></div>';
  }
  function inp(k, type, attrs) {
    return '<input id="sp-' + k + '" name="' + k + '" type="' + type + '" value="' + v(k) + '" aria-describedby="m-' + k + '" data-check ' + attrs + ">";
  }
  function emailField() {
    return field("email", "이메일", "", inp("email", "email", 'autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="예: name@lab.ac.kr"'));
  }
  function pwField(isNew) {
    return '<div class="om-field sp-f"><label for="sp-password">' + (cur === "newpw" ? "새 비밀번호" : "비밀번호") + "</label>" +
      '<span class="sp-pw"><input id="sp-password" name="password" type="password" data-check aria-describedby="m-password m-caps" autocomplete="' + (isNew ? "new-password" : "current-password") + '">' +
      '<button type="button" data-act="pw" aria-pressed="false" aria-label="비밀번호 보기">보기</button></span>' +
      (isNew ? '<ul class="sp-rules" aria-label="비밀번호 조건"><li data-r="len">8자 이상</li><li data-r="mix">영문과 숫자 섞기</li></ul>' : "") +
      '<p class="sp-msg warn" id="m-caps" hidden>Caps Lock이 켜져 있습니다.</p>' +
      '<p class="sp-msg" id="m-password" aria-live="polite"></p></div>';
  }
  function errBox() { return '<p class="sp-callout err" id="sp-ferr" role="alert" hidden></p>'; }
  function noticeBox() {
    if (!notice) return "";
    var h = '<p class="sp-callout warn" role="alert">' + OM.esc(notice) + "</p>";
    notice = "";   // 한 번만
    return h;
  }
  function kakaoBox() {
    if (!kakaoOn) return "";
    return '<div class="sp-kakao-box"><button type="button" class="btn sp-kakao" data-act="kakao">카카오로 3초 만에 시작</button>' +
      '<p class="om-dim">처음이면 첫 의뢰 전에 소속 · 휴대폰과 약관 동의만 한 번 받습니다.</p></div>' +
      '<p class="sp-or">또는 이메일로</p>';
  }

  var sentKind = "", sentTo = "";
  var views = {
    login: function () {
      return noticeBox() + kakaoBox() +
        '<form class="om-form" id="f-login" novalidate>' + emailField() + pwField(false) + errBox() +
        '<button class="btn primary" type="submit">로그인</button>' +
        '<p class="sp-center"><button type="button" class="om-link" data-go="reset">비밀번호를 잊으셨나요?</button></p>' +
        '<p class="om-dim sp-center">처음이신가요? <button type="button" class="om-link" data-go="signup">회원가입</button></p></form>';
    },
    signup: function () {
      return noticeBox() + kakaoBox() +
        '<form class="om-form" id="f-signup" novalidate>' +
        field("name", "이름", "", inp("name", "text", 'autocomplete="name" placeholder="예: 홍길동" maxlength="40"')) +
        field("org", "소속", "학교 · 병원 · 연구소 · 회사", inp("org", "text", 'autocomplete="organization" placeholder="예: ○○대학교 △△연구실" maxlength="80"')) +
        field("phone", "휴대폰", "수거와 진행 상황을 안내할 때 연락드립니다", inp("phone", "tel", 'autocomplete="tel" inputmode="tel" placeholder="010-0000-0000"')) +
        emailField() + pwField(true) +
        '<div class="om-field sp-f"><label class="om-agree"><input type="checkbox" name="agree" data-check aria-describedby="m-agree"' + (keep.agree ? " checked" : "") + "> " +
        '<span>샘플로 <a href="/samplo/terms/" target="_blank" rel="noopener">이용약관</a>과 <a href="/privacy/" target="_blank" rel="noopener">개인정보 처리방침</a>을 읽었고 동의합니다. (필수)</span></label>' +
        '<p class="sp-msg" id="m-agree" aria-live="polite"></p></div>' +
        errBox() +
        '<button class="btn primary" type="submit">' + (forOrder ? "가입하고 의뢰 시작하기" : "가입하기") + "</button>" +
        '<p class="om-dim">연구실 정보와 수거 주소는 첫 의뢰 때 한 번만 받고, 다음 의뢰부터는 지난 정보를 불러와 채워 드립니다.</p></form>';
    },
    reset: function () {
      return noticeBox() + '<form class="om-form" id="f-reset" novalidate><p class="om-dim">가입한 이메일을 적어 주세요. 비밀번호를 새로 정하는 링크를 보내 드립니다.</p>' +
        emailField() + errBox() +
        '<button class="btn primary" type="submit">재설정 링크 받기</button>' +
        '<p class="sp-center"><button type="button" class="om-link" data-go="login">로그인으로 돌아가기</button></p></form>';
    },
    newpw: function () {
      return '<form class="om-form" id="f-newpw" novalidate><p class="om-dim">앞으로 쓸 새 비밀번호를 정해 주세요.</p>' + pwField(true) + errBox() +
        '<button class="btn primary" type="submit">비밀번호 바꾸고 계속하기</button></form>';
    },
    sent: function () {
      var up = sentKind === "signup";
      return '<div class="sp-sent" role="status"><h2>메일을 확인해 주세요</h2>' +
        "<p><b>" + OM.esc(sentTo) + "</b>로 " + (up ? "가입 인증" : "비밀번호 재설정") + " 링크를 보냈습니다. " +
        (up ? "메일의 링크를 누르면 바로 로그인됩니다." : "메일의 링크를 누르면 새 비밀번호를 정할 수 있습니다.") + "</p>" +
        '<ul class="om-dim"><li>몇 분이 지나도 안 보이면 스팸함을 확인해 주세요.</li>' +
        (up ? "<li>주소를 잘못 적었다면 고쳐서 다시 가입해 주세요.</li>" : "<li>가입한 주소일 때만 메일이 갑니다.</li>") + "</ul>" +
        '<div class="om-actions"><button type="button" class="btn ghost sm" data-act="resend">메일 다시 보내기</button>' +
        (up ? '<button type="button" class="btn ghost sm" data-go="signup" data-focus="email">이메일 주소 고치기</button>' : "") +
        '<button type="button" class="om-link" data-go="login">로그인 화면으로</button></div></div>';
    }
  };

  main.innerHTML =
    '<div class="om-auth"><div class="om-head"><div><h1>샘플로</h1><p>' +
    (forOrder ? "로그인하거나 1분 만에 가입하면 바로 의뢰서를 쓸 수 있습니다." : "시료 의뢰부터 수거 · QC · 보관까지 한곳에서 확인합니다.") + "</p></div></div>" +
    '<div class="om-card"><div class="om-tabs" role="tablist" id="sp-tabs">' +
    '<button type="button" role="tab" aria-selected="false" data-go="login">로그인</button>' +
    '<button type="button" role="tab" aria-selected="false" data-go="signup">회원가입</button></div>' +
    '<div id="sp-auth-body"></div></div>' +
    '<p class="om-dim sp-center">오믹스메이트 계정으로도 로그인할 수 있습니다.<br>가입이 어렵거나 급한 의뢰는 <a href="' + OM.KAKAO + '" target="_blank" rel="noopener">카카오톡 채널</a>로 문의해 주세요.</p></div>';
  body = OM.$("#sp-auth-body");

  function show(view, focusName) {
    cur = view; tried = false;
    body.innerHTML = views[view]();
    OM.$("#sp-tabs").hidden = view === "newpw";
    OM.$$("#sp-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.go === view); b.setAttribute("aria-selected", String(b.dataset.go === view)); });
    if (view === "sent") tick();
    var f = body.querySelector("form");
    if (!f) return;
    f.onsubmit = submit[f.id];
    // 남아 있던 값은 바로 검사해서 보여 줌
    OM.$$("input[data-check]", f).forEach(function (i) { if (i.type !== "checkbox" && i.value) { i._dirty = true; mark(i, check(i, false)); } });
    var to = (focusName && f.elements[focusName]) ||
      OM.$$("input[data-check]", f).filter(function (i) { return i.type !== "checkbox" && !i.value; })[0] || f.querySelector("input");
    if (to) { to.focus(); if (focusName && to.select) to.select(); }
  }

  // ───────── 입력 중 · 칸을 벗어날 때 ─────────
  main.addEventListener("input", function (e) {
    var t = e.target;
    if (!t.name || !t.hasAttribute("data-check")) return;
    if (t.name === "phone" && t.selectionStart === t.value.length) t.value = phoneFmt(t.value);   // 하이픈 자동 (끝에서 입력할 때만)
    if (t.name === "password") OM.$$(".sp-rules li", body).forEach(function (li) { li.classList.toggle("on", !!pwRules(t.value)[li.dataset.r]); });
    remember(t);
    t._dirty = true;
    formErr(t.form, "");
    // 값을 하나라도 고치면 서버 오류로 막아 둔 칸을 풀어 줌 (다시 보내면 서버가 또 검사함)
    if (t.form) OM.$$("[data-check]", t.form).forEach(function (i) { i._srv = null; });
    // 이미 빨간 칸이면 고치는 즉시 풀어 줌
    var w = t.closest(".sp-f");
    if (w && (w.classList.contains("sp-invalid") || t.type === "checkbox")) mark(t, check(t, false));
  });
  main.addEventListener("change", function (e) {
    var t = e.target;
    if (t.type === "checkbox" && t.hasAttribute("data-check")) { remember(t); mark(t, check(t, false)); }
  });
  main.addEventListener("focusout", function (e) {
    var t = e.target;
    if (!t.hasAttribute || !t.hasAttribute("data-check") || t.type === "checkbox" || !t._dirty) return;
    tidy(t);
    mark(t, check(t, false));
  });
  // Caps Lock 안내
  function caps(e) {
    if (e.target.name !== "password" || !e.getModifierState) return;
    var c = OM.$("#m-caps", body);
    if (c) c.hidden = !e.getModifierState("CapsLock");
  }
  main.addEventListener("keydown", caps);
  main.addEventListener("keyup", caps);
  // 안내 속 버튼 · 비밀번호 보기 버튼을 눌러도 입력 칸의 커서가 빠지지 않게
  main.addEventListener("mousedown", function (e) {
    if (e.target.closest(".sp-msg button, [data-act=pw]")) e.preventDefault();
  });

  main.addEventListener("click", function (e) {
    var g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); return show(g.dataset.go, g.dataset.focus); }
    var a = e.target.closest("[data-act]");
    if (!a) return;
    var act = a.dataset.act, f = body.querySelector("form");
    if (act === "pw") {
      var p = a.parentNode.querySelector("input"), showing = p.type === "password";
      p.type = showing ? "text" : "password";
      a.textContent = showing ? "숨기기" : "보기";
      a.setAttribute("aria-pressed", String(showing));
      a.setAttribute("aria-label", showing ? "비밀번호 숨기기" : "비밀번호 보기");
    } else if (act === "fix" && f) {
      var em = f.elements.email;
      em.value = a.dataset.v; remember(em); em._srv = null;
      mark(em, check(em, false)); em.focus();
    } else if (act === "keep-typo" && f) {
      okTypo = f.elements.email.value.trim().toLowerCase();
      mark(f.elements.email, check(f.elements.email, false));
    } else if (act === "kakao") {
      OM.run(a, async function () {
        OM.unwrap(await sb.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo: back() } }));
      });
    } else if (act === "resend") resend(a, sentKind, sentTo);
    else if (act === "resend-login" && f) {
      if (!SP.V.email(val(f, "email"))) { f.elements.email.focus(); return OM.toast("이메일 주소를 먼저 확인해 주세요.", true); }
      resend(a, "signup", val(f, "email"));
    }
  });

  // ───────── 메일 다시 보내기 (60초에 한 번) ─────────
  var coolUntil = 0, coolT = null;
  function tick() {
    var b = OM.$("[data-act=resend]", body), left = Math.ceil((coolUntil - Date.now()) / 1000);
    if (!b) return;
    b.disabled = left > 0;
    b.textContent = left > 0 ? "메일 다시 보내기 (" + left + "초)" : "메일 다시 보내기";
  }
  function cool() {
    coolUntil = Date.now() + 60000; clearInterval(coolT);
    coolT = setInterval(function () { tick(); if (Date.now() > coolUntil) clearInterval(coolT); }, 1000);
  }
  async function resend(btn, kind, email) {
    btn.disabled = true;
    try {
      if (kind === "signup") OM.unwrap(await sb.auth.resend({ type: "signup", email: email, options: { emailRedirectTo: back() } }));
      else OM.unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: back() }));
    } catch (er) {
      console.error(er);
      var r = authErr(er);
      OM.toast(r.t || "메일을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.", true);
      btn.disabled = false;
      return;
    }
    if (cur !== "sent") { sentKind = kind; sentTo = email; show("sent"); }
    OM.toast("메일을 다시 보냈습니다.");
    cool(); tick();
  }
  function sent(kind, email) { sentKind = kind; sentTo = email; cool(); show("sent"); }

  // ───────── 제출 ─────────
  var submit = {
    "f-login": function (e) {
      e.preventDefault(); var f = this;
      if (!validate(f)) return;
      OM.run(f.querySelector("button[type=submit]"), async function () {
        try { OM.unwrap(await sb.auth.signInWithPassword({ email: val(f, "email"), password: f.elements.password.value })); }
        catch (er) { return fail(f, er); }
        forget(); go();
      });
    },
    "f-signup": function (e) {
      e.preventDefault(); var f = this;
      if (!validate(f)) return;
      var email = val(f, "email");
      OM.run(f.querySelector("button[type=submit]"), async function () {
        var res;
        try {
          res = OM.unwrap(await sb.auth.signUp({
            email: email, password: f.elements.password.value,
            // DB 트리거(handle_new_user)가 이름 · 소속 · 휴대폰 · 동의 시각을 profiles 로 옮깁니다.
            // sp_agreed 는 샘플로 약관 동의 표시 (트리거가 profiles.sp_agreed_at 에 기록 → 첫 의뢰 때 동의를 다시 묻지 않음)
            options: { data: { name: val(f, "name"), org: val(f, "org"), phone: phoneFmt(val(f, "phone")), agreed: true, sp_agreed: true }, emailRedirectTo: back() }
          }));
        } catch (er) { return fail(f, er); }
        // 이미 가입된 주소면 Supabase 는 오류 대신 identities 가 빈 사용자를 돌려줍니다 (메일 인증을 켠 경우)
        if (res && res.user && res.user.identities && !res.user.identities.length && !res.session)
          return fail(f, { code: "user_already_exists", message: "User already registered" });
        forget();
        if (res && res.session) return go();
        sent("signup", email);
      });
    },
    "f-reset": function (e) {
      e.preventDefault(); var f = this;
      if (!validate(f)) return;
      var email = val(f, "email");
      OM.run(f.querySelector("button[type=submit]"), async function () {
        try { OM.unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: back() })); }
        catch (er) { return fail(f, er); }
        sent("reset", email);
      });
    },
    "f-newpw": function (e) {
      e.preventDefault(); var f = this;
      if (!validate(f)) return;
      OM.run(f.querySelector("button[type=submit]"), async function () {
        try { OM.unwrap(await sb.auth.updateUser({ password: f.elements.password.value })); }
        catch (er) { return fail(f, er); }
        recovering = false;
        body.innerHTML = '<p class="sp-callout info" role="status">비밀번호를 바꿨습니다. 잠시 뒤 이동합니다.</p>';
        setTimeout(go, 900);
      });
    }
  };

  var mode = OM.qs("mode");
  show(recovering ? "newpw" : (mode === "signup" || mode === "reset") ? mode : "login");
})();
