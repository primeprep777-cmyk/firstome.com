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
  var PRIV = /firstome\.com$/.test(location.hostname) ? "/privacy/" : "Privacy.html";

  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || "[]"); } catch (e) { history = []; }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-12))); } catch (e) {} }

  // 페이지 브랜드 색을 따릅니다: body.c-teal / c-blue / c-amber, 없으면 퍼스트옴 잉크
  var bc = document.body.className;
  var AC = /c-blue/.test(bc) ? "#3a5fd6" : /c-amber/.test(bc) ? "#b77500" : /c-teal/.test(bc) ? "#0a9a8f" : "#0d1214";
  var BRAND = /c-blue/.test(bc) ? "오믹스메이트" : /c-amber/.test(bc) ? "퍼스트옴 Dx" : /c-teal/.test(bc) ? "샘플로" : "퍼스트옴";
  var SUGGESTIONS = {
    "샘플로": ["어떤 시료를 맡길 수 있나요?", "시료는 어떻게 보내나요?", "QC에서 문제가 생기면요?", "남은 시료 보관은?"],
    "오믹스메이트": ["예상 비용은 어떻게 정해지나요?", "입찰은 어떻게 진행되나요?", "데이터 보안은요?", "전문가로 참여하려면?"],
    "퍼스트옴 Dx": ["어떤 단계부터 협업하나요?", "비밀유지 계약은 언제 하나요?", "RUO와 임상 단계 차이는?", "시료 동의 범위는요?"],
    "퍼스트옴": ["지금 바로 시료를 맡길 수 있나요?", "어느 브랜드에 문의해야 하나요?", "요금은 언제 공개되나요?", "분석만 맡길 수 있나요?"]
  }[BRAND];
  var GREETING = "안녕하세요, " + BRAND + " AI 상담입니다. 서비스와 의뢰 절차를 바로 안내해 드려요. 견적과 일정 확정은 카카오톡에서 담당자가 도와드립니다.";
  var css = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:'IBM Plex Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif}",
    ".fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:9px;height:50px;padding:0 20px 0 16px;border:1px solid rgba(13,18,20,.14);border-radius:999px;background:#fff;color:#0d1214;font-size:14.5px;font-weight:600;cursor:pointer;box-shadow:0 10px 30px -10px rgba(13,18,20,.35);transition:transform .25s,box-shadow .25s}",
    ".fab:hover{transform:translateY(-2px);box-shadow:0 16px 36px -12px rgba(13,18,20,.4)}",
    ".fab:focus-visible,.x:focus-visible,.chip:focus-visible,.send:focus-visible,.note a:focus-visible{outline:2px solid " + AC + ";outline-offset:2px}",
    ".fab small{font-weight:400;font-size:12px;color:#878e92;margin-left:2px}",
    ".dot{width:9px;height:9px;border-radius:50%;background:" + AC + ";box-shadow:0 0 0 3px color-mix(in oklab," + AC + " 22%,transparent)}",
    ".fab[aria-expanded=true]{background:#0d1214;color:#fff;border-color:#0d1214}",
    ".panel{position:fixed;right:20px;bottom:82px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);height:580px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:#f4f4f1;color:#0d1214;border:1px solid #dcdcd5;border-radius:14px;overflow:hidden;box-shadow:0 30px 70px -20px rgba(13,18,20,.4)}",
    ".panel.open{display:flex;animation:pin .3s cubic-bezier(.2,.7,.1,1)}",
    "@keyframes pin{from{opacity:0;transform:translateY(10px)}}",
    ".head{display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid #dcdcd5;background:#fff}",
    ".title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}",
    ".badge{font-size:10.5px;font-weight:600;letter-spacing:.06em;padding:2px 7px;border-radius:4px;background:color-mix(in oklab," + AC + " 12%,#fff);color:" + AC + "}",
    ".sub{font-size:12.5px;color:#4f585c;margin-top:4px;line-height:1.5}",
    ".x{background:none;border:0;color:#4f585c;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:6px}",
    ".x:hover{background:#ebebe6}",
    ".log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}",
    ".msg{max-width:86%;padding:10px 13px;border-radius:12px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}",
    ".bot{align-self:flex-start;background:#fff;border:1px solid #dcdcd5;border-top-left-radius:3px}",
    ".me{align-self:flex-end;background:#0d1214;color:#fff;border-top-right-radius:3px}",
    ".msg a{color:" + AC + "}.me a{color:#fff}",
    ".typing{color:#878e92}",
    ".who{font-size:11px;color:#878e92;margin:2px 0 -6px 2px}",
    ".chips{display:flex;flex-wrap:wrap;gap:6px}",
    ".chip{background:#fff;border:1px solid #c6c6bd;color:#0d1214;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer}",
    ".chip:hover{border-color:" + AC + ";color:" + AC + "}",
    ".human{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 16px 10px;padding:10px 12px;border-radius:10px;background:#fee500;color:#191919;text-decoration:none;font-size:13.5px;font-weight:600}",
    ".human small{display:block;font-weight:400;font-size:12px;color:#4a4000}",
    ".foot{padding:10px 12px 12px;border-top:1px solid #dcdcd5;background:#fff}",
    "form{display:flex;gap:8px}",
    "textarea{flex:1;resize:none;height:44px;max-height:120px;padding:11px 12px;border-radius:10px;border:1px solid #c6c6bd;background:#f4f4f1;color:#0d1214;font-size:14.5px;line-height:1.4;outline:none}",
    "textarea:focus{border-color:" + AC + ";background:#fff}",
    ".send{width:68px;border:0;border-radius:10px;background:#0d1214;color:#fff;font-weight:600;font-size:14px;cursor:pointer}",
    ".send:hover{background:" + AC + "}",
    ".send:disabled{opacity:.4;cursor:default}",
    ".note{margin-top:8px;font-size:11.5px;color:#878e92;line-height:1.5}.note a{color:#4f585c}",
    "@media (max-width:480px){.panel{right:8px;left:8px;width:auto;max-width:none;bottom:76px;height:calc(100vh - 96px)}.fab{right:14px;bottom:14px;height:46px}.fab small{display:none}}",
    "@media (prefers-reduced-motion:reduce){.panel.open{animation:none}.fab{transition:none}}"
  ].join("");

  var host = document.createElement("div");
  host.id = "fo-chat-root";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" + css + "</style>" +
    '<button class="fab" type="button" aria-expanded="false" aria-controls="fo-panel"><span class="dot"></span>AI에게 묻기<small>24시간</small></button>' +
    '<section class="panel" id="fo-panel" role="dialog" aria-modal="false" aria-labelledby="fo-t">' +
    '<div class="head"><div><div class="title" id="fo-t">' + BRAND + ' AI 상담 <span class="badge">AI</span></div><div class="sub">서비스와 절차를 바로 안내해요. 견적·일정 확정은 담당자가 해요.</div></div>' +
    '<button class="x" type="button" aria-label="AI 상담 닫기">×</button></div>' +
    '<div class="log" aria-live="polite"></div>' +
    '<a class="human" href="' + KAKAO + '" target="_blank" rel="noopener"><span>사람과 상담하기<small>카카오톡 1:1 채팅 · 평일 업무시간 답변</small></span><span aria-hidden="true">↗</span></a>' +
    '<div class="foot"><form><textarea rows="1" maxlength="1000" placeholder="궁금한 점을 입력하세요"></textarea>' +
    '<button class="send" type="submit">보내기</button></form>' +
    '<div class="note">AI 답변은 참고용이며, 대화는 이 탭에만 저장되고 탭을 닫으면 지워져요. 환자 정보·개인정보는 입력하지 마세요. <a href="' + PRIV + '" target="_blank" rel="noopener">개인정보처리방침</a></div></div>' +
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

  function toggle(open, refocus) {
    panel.classList.toggle("open", open);
    fab.setAttribute("aria-expanded", String(open));
    if (open) { if (!log.childNodes.length) render(); input.focus(); }
    else if (refocus) fab.focus();
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("open")) toggle(false, true); });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("open")) { e.stopPropagation(); toggle(false, true); } });
  // 외부에서 질문을 넣어 열 수 있게: window.FirstomeChat.ask("...")
  window.FirstomeChat = { open: function () { toggle(true); }, ask: function (q) { toggle(true); ask(q); } };
  fab.onclick = function () { toggle(!panel.classList.contains("open")); };
  root.querySelector(".x").onclick = function () { toggle(false, true); };
  form.onsubmit = function (e) { e.preventDefault(); var t = input.value; input.value = ""; ask(t); };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
})();
