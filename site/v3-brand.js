// v4 brand-site function layer: mobile section bar, active section, copy templates, toast.
(function(){
  var $ = function(s, r){ return (r||document).querySelector(s); };
  var $$ = function(s, r){ return [].slice.call((r||document).querySelectorAll(s)); };

  // toast (single polite live region)
  var toast = document.createElement('div');
  toast.className = 'v4-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  var tt;
  window.v4Toast = function(msg){ toast.textContent = msg; toast.classList.add('on'); clearTimeout(tt); tt = setTimeout(function(){ toast.classList.remove('on'); }, 3600); };

  // copy helper
  function copy(text){
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function(res, rej){
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } ta.remove();
    });
  }
  window.v4Copy = copy;
  $$('[data-copy]').forEach(function(b){
    b.addEventListener('click', function(){
      var src = $(b.getAttribute('data-copy')); if (!src) return;
      var label = b.textContent;
      copy(src.textContent.trim()).then(function(){
        b.textContent = '복사됨 ✓'; b.classList.add('ok');
        v4Toast('복사했어요. 카카오톡 대화창에 붙여넣기만 하면 됩니다.');
        setTimeout(function(){ b.textContent = label; b.classList.remove('ok'); }, 2400);
      }, function(){ v4Toast('복사가 막혀 있어요. 내용을 길게 눌러 직접 복사해 주세요.'); });
    });
  });

  // mobile section bar (from header nav)
  var links = $('header.top nav.links'), top = $('header.top');
  if (links && top){
    var bar = document.createElement('nav');
    bar.className = 'secbar'; bar.setAttribute('aria-label', '이 페이지 섹션');
    bar.innerHTML = '<div class="secbar-in">' + links.innerHTML + '</div>';
    top.appendChild(bar);
    var all = $$('a', links).concat($$('a', bar));
    var ids = $$('a', links).map(function(a){ return a.getAttribute('href'); });
    var last = null;
    function upd(){
      var act = null;
      ids.forEach(function(h){ var s = document.querySelector(h); if (s && s.getBoundingClientRect().top < innerHeight * .35) act = h; });
      if (act === last) return; last = act;
      all.forEach(function(a){ var on = a.getAttribute('href') === act; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      var cur = act && $('a[href="' + act + '"]', bar), inn = $('.secbar-in', bar);
      if (cur && inn) inn.scrollTo({ left: cur.offsetLeft - 20, behavior: 'smooth' });
    }
    var tk = false;
    addEventListener('scroll', function(){ if (tk) return; tk = true; requestAnimationFrame(function(){ tk = false; upd(); }); }, { passive: true });
    upd();
  }

  // demo-only controls inside 예시 화면: say so instead of faking success
  $$('[data-demo]').forEach(function(el){
    el.addEventListener('click', function(e){ e.preventDefault(); v4Toast(el.getAttribute('data-demo')); });
  });
})();
