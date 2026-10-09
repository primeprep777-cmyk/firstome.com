/* /omicsmate/login/ : 로그인 · 회원가입 · 비밀번호 재설정 */
(async function () {
  var OM = window.OM, sb = OM.sb, main = OM.$("#om-main");
  if (!sb) return OM.notReady();
  OM.header(null);

  var next = OM.qs("next") || "";
  if (!/^\/omicsmate\//.test(next)) next = "";
  var role = OM.qs("role") === "expert" ? "expert" : "client";
  function go(m) { location.replace(next || (role === "expert" || (m && m.expert) ? "/omicsmate/expert/" : "/omicsmate/app/")); }
  function back() { return location.origin + "/omicsmate/login/?" + new URLSearchParams({ next: next, role: role }).toString(); }

  // 비밀번호 재설정 메일의 링크로 들어온 경우
  var recovering = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange(function (ev) { if (ev === "PASSWORD_RECOVERY") { recovering = true; show("newpw"); } });

  var m = await OM.session();
  if (m && !recovering) return go(m);

  var views = {
    login:
      '<form class="om-form" id="f-login">' +
      '<label>이메일<input type="email" name="email" required autocomplete="email"></label>' +
      '<label>비밀번호<input type="password" name="password" required autocomplete="current-password"></label>' +
      '<button class="btn primary" type="submit">로그인</button>' +
      '<p class="om-dim"><button type="button" class="om-link" data-go="reset">비밀번호를 잊으셨나요?</button></p></form>',
    signup:
      '<form class="om-form" id="f-signup">' +
      '<div class="om-field">어떻게 이용하시나요?<div class="om-checks">' +
      '<label><input type="radio" name="role" value="client"' + (role === "client" ? " checked" : "") + '> 분석을 의뢰하려고요</label>' +
      '<label><input type="radio" name="role" value="expert"' + (role === "expert" ? " checked" : "") + '> 전문가로 입찰하려고요</label></div>' +
      '<small>나중에 둘 다 할 수 있습니다.</small></div>' +
      '<label>이름<input type="text" name="name" required autocomplete="name"></label>' +
      '<label>소속 <small>학교 · 연구소 · 병원 · 회사</small><input type="text" name="org" required autocomplete="organization"></label>' +
      '<label>이메일<input type="email" name="email" required autocomplete="email"></label>' +
      '<label>비밀번호 <small>8자 이상</small><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>' +
      '<label class="om-agree"><input type="checkbox" name="agree" required> <span>오믹스메이트 <a href="/omicsmate/terms/" target="_blank">이용약관</a>과 <a href="/omicsmate/privacy/" target="_blank">개인정보 처리방침</a>에 동의합니다.</span></label>' +
      '<button class="btn primary" type="submit">가입하기</button></form>',
    reset:
      '<form class="om-form" id="f-reset"><p class="om-dim">가입한 이메일로 비밀번호 재설정 링크를 보내 드립니다.</p>' +
      '<label>이메일<input type="email" name="email" required autocomplete="email"></label>' +
      '<button class="btn primary" type="submit">재설정 링크 받기</button></form>',
    newpw:
      '<form class="om-form" id="f-newpw"><label>새 비밀번호 <small>8자 이상</small><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>' +
      '<button class="btn primary" type="submit">비밀번호 바꾸기</button></form>',
    sent: function (email, what) {
      return '<div class="om-empty" style="padding:24px 0"><h2>메일을 확인해 주세요</h2><p><b>' + OM.esc(email) + "</b>로 " + what +
        ' 링크를 보냈습니다. 메일이 안 보이면 스팸함도 확인해 주세요.</p><button type="button" class="om-link" data-go="login">로그인 화면으로</button></div>';
    }
  };

  main.innerHTML =
    '<div class="om-auth"><div class="om-head"><div><h1>오믹스메이트</h1><p>분석 의뢰와 전문가 입찰을 한곳에서</p></div></div>' +
    '<div class="om-card"><div class="om-tabs" role="tablist"><button type="button" data-go="login">로그인</button><button type="button" data-go="signup">회원가입</button></div>' +
    '<div id="om-auth-body"></div></div></div>';
  var body = OM.$("#om-auth-body");

  function show(v, html) {
    body.innerHTML = html || views[v];
    OM.$$(".om-tabs button", main).forEach(function (b) { b.classList.toggle("on", b.dataset.go === v); });
    var f = body.querySelector("form"); if (f) { f.onsubmit = handlers[f.id]; var i = f.querySelector("input:not([type=radio])"); if (i) i.focus(); }
  }
  main.addEventListener("click", function (e) { var t = e.target.closest("[data-go]"); if (t) show(t.dataset.go); });

  var handlers = {
    "f-login": function (e) {
      e.preventDefault(); var d = OM.formData(this), btn = this.querySelector("button[type=submit]");
      OM.run(btn, async function () {
        OM.unwrap(await sb.auth.signInWithPassword({ email: d.email, password: d.password }));
        go(await OM.session());
      });
    },
    "f-signup": function (e) {
      e.preventDefault(); var d = OM.formData(this), btn = this.querySelector("button[type=submit]");
      role = d.role === "expert" ? "expert" : "client";
      OM.run(btn, async function () {
        var res = OM.unwrap(await sb.auth.signUp({
          email: d.email, password: d.password,
          options: { data: { name: d.name, org: d.org, agreed: true, role: role }, emailRedirectTo: back() }
        }));
        if (res.session) go(await OM.session());
        else show("sent", views.sent(d.email, "가입 인증"));
      });
    },
    "f-reset": function (e) {
      e.preventDefault(); var d = OM.formData(this), btn = this.querySelector("button[type=submit]");
      OM.run(btn, async function () {
        OM.unwrap(await sb.auth.resetPasswordForEmail(d.email, { redirectTo: back() }));
        show("sent", views.sent(d.email, "비밀번호 재설정"));
      });
    },
    "f-newpw": function (e) {
      e.preventDefault(); var d = OM.formData(this), btn = this.querySelector("button[type=submit]");
      OM.run(btn, async function () {
        OM.unwrap(await sb.auth.updateUser({ password: d.password }));
        OM.toast("비밀번호를 바꿨습니다.");
        go(await OM.session());
      });
    }
  };

  show(recovering ? "newpw" : (OM.qs("mode") === "signup" || OM.qs("role") ? "signup" : "login"));
})();
