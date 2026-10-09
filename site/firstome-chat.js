/* 퍼스트옴 AI 상담 채팅창
 * 사용법: </body> 바로 앞에 한 줄
 *   <script src="/site/firstome-chat.js" data-api="https://firstome-agent.firstome.workers.dev/chat" defer></script>
 * API 키는 이 파일에 없습니다. 이 파일은 엔진(Cloudflare Worker)에 질문을 보내기만 합니다.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var API = script && script.getAttribute("data-api");
  if (!API || document.getElementById("fo-chat-root")) return;

  var KAKAO = "https://pf.kakao.com/_uuXFX/chat";
  var STORE = "fo-chat-v1";
  var GREETING = "안녕하세요, 퍼스트옴 AI 상담입니다. 시료 전처리, 분석 매칭, 의뢰 방법 등 궁금한 점을 물어보세요.";
  var SUGGESTIONS = ["어떤 시료를 맡길 수 있나요?", "의뢰는 어떻게 하나요?", "요금제가 궁금해요", "분석만 맡길 수 있나요?"];

  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || "[]"); } catch (e) { history = []; }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-12))); } catch (e) {} }

  var css = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:'IBM Plex Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif}",
    ".fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;height:52px;padding:0 20px 0 16px;border:0;border-radius:26px;background:#38d3c8;color:#04201d;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}",
    ".fab:hover{filter:brightness(1.06)}",
    ".dot{width:9px;height:9px;border-radius:50%;background:#04201d}",
    ".panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:#0b121a;color:#e9f1f6;border:1px solid #2a3d4b;border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.5)}",
    ".panel.open{display:flex}",
    ".head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1c2b37;background:#0f1922}",
    ".title{font-size:15px;font-weight:600}.sub{font-size:12px;color:#90a3b0;margin-top:2px}",
    ".x{background:none;border:0;color:#90a3b0;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px}",
    ".log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}",
    ".msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}",
    ".bot{align-self:flex-start;background:#0f1922;border:1px solid #1c2b37;border-top-left-radius:4px}",
    ".me{align-self:flex-end;background:#38d3c8;color:#04201d;border-top-right-radius:4px}",
    ".msg a{color:#86a9ff}.me a{color:#04201d}",
    ".typing{color:#617684}",
    ".chips{display:flex;flex-wrap:wrap;gap:6px}",
    ".chip{background:none;border:1px solid #2a3d4b;color:#e9f1f6;border-radius:16px;padding:6px 11px;font-size:13px;cursor:pointer}",
    ".chip:hover{border-color:#38d3c8}",
    ".foot{padding:10px 12px 12px;border-top:1px solid #1c2b37;background:#0f1922}",
    "form{display:flex;gap:8px}",
    "textarea{flex:1;resize:none;height:44px;max-height:120px;padding:11px 12px;border-radius:10px;border:1px solid #2a3d4b;background:#070c12;color:#e9f1f6;font-size:14.5px;line-height:1.4;outline:none}",
    "textarea:focus{border-color:#38d3c8}",
    ".send{width:64px;border:0;border-radius:10px;background:#38d3c8;color:#04201d;font-weight:600;font-size:14px;cursor:pointer}",
    ".send:disabled{opacity:.5;cursor:default}",
    ".note{margin-top:8px;font-size:11.5px;color:#617684}.note a{color:#90a3b0}",
    "@media (max-width:480px){.panel{right:8px;left:8px;width:auto;max-width:none;bottom:80px;height:calc(100vh - 100px)}.fab{right:16px;bottom:16px}}"
  ].join("");

  var host = document.createElement("div");
  host.id = "fo-chat-root";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" + css + "</style>" +
    '<button class="fab" type="button" aria-expanded="false"><span class="dot"></span>AI 상담</button>' +
    '<section class="panel" role="dialog" aria-label="퍼스트옴 AI 상담">' +
    '<div class="head"><div><div class="title">퍼스트옴 AI 상담</div><div class="sub">보통 몇 초 안에 답해요</div></div>' +
    '<button class="x" type="button" aria-label="닫기">×</button></div>' +
    '<div class="log" aria-live="polite"></div>' +
    '<div class="foot"><form><textarea rows="1" maxlength="1000" placeholder="궁금한 점을 입력하세요"></textarea>' +
    '<button class="send" type="submit">보내기</button></form>' +
    '<div class="note">AI 답변은 참고용이에요. 정확한 견적과 일정은 <a href="' + KAKAO + '" target="_blank" rel="noopener">카카오톡 상담</a>에서 안내해 드려요.</div></div>' +
    "</section>";

  var fab = root.querySelector(".fab");
  var panel = root.querySelector(".panel");
  var log = root.querySelector(".log");
  var form = root.querySelector("form");
  var input = root.querySelector("textarea");
  var send = root.querySelector(".send");
  var busy = false;

  // 답변 속 주소만 링크로 바꾸고 나머지는 글자 그대로 넣습니다 (HTML 주입 방지).
  function fill(el, text) {
    var re = /https?:\/\/[^\s)]+/g, last = 0, m;
    while ((m = re.exec(text))) {
      el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = m[0]; a.textContent = m[0]; a.target = "_blank"; a.rel = "noopener";
      el.appendChild(a);
      last = m.index + m[0].length;
    }
    el.appendChild(document.createTextNode(text.slice(last)));
  }
  function bubble(role, text, extra) {
    var el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "me" : "bot") + (extra ? " " + extra : "");
    fill(el, text);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function chips() {
    var box = document.createElement("div");
    box.className = "chips";
    SUGGESTIONS.forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = q;
      b.onclick = function () { box.remove(); ask(q); };
      box.appendChild(b);
    });
    log.appendChild(box);
  }
  function render() {
    log.textContent = "";
    bubble("assistant", GREETING);
    history.forEach(function (m) { bubble(m.role, m.content); });
    if (!history.length) chips();
  }

  function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    var c = root.querySelector(".chips"); if (c) c.remove();
    busy = true; send.disabled = true;
    history.push({ role: "user", content: text.slice(0, 1000) });
    save();
    bubble("user", text);
    var wait = bubble("assistant", "답변을 준비하고 있어요…", "typing");
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-12) })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        var reply = data && data.reply ? String(data.reply) : "지금은 답변이 어려워요. 카카오톡 상담으로 문의해 주세요: " + KAKAO;
        wait.remove();
        bubble("assistant", reply);
        history.push({ role: "assistant", content: reply });
        save();
      })
      .catch(function () {
        wait.remove();
        history.pop(); save();
        bubble("assistant", "연결이 원활하지 않아요. 잠시 후 다시 시도하거나 카카오톡 상담을 이용해 주세요: " + KAKAO);
      })
      .then(function () { busy = false; send.disabled = false; input.focus(); });
  }

  function toggle(open) {
    panel.classList.toggle("open", open);
    fab.setAttribute("aria-expanded", String(open));
    if (open) { if (!log.childNodes.length) render(); input.focus(); }
  }
  fab.onclick = function () { toggle(!panel.classList.contains("open")); };
  root.querySelector(".x").onclick = function () { toggle(false); };
  form.onsubmit = function (e) { e.preventDefault(); var t = input.value; input.value = ""; ask(t); };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
})();
