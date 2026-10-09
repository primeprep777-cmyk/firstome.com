// Shared behaviour: apply saved prefs early, reveal-on-scroll, image fallback.
(function(){
  var root = document.documentElement;
  var d = window.FIRSTOME_TWEAKS || {};
  window.applyFirstomePrefs = function(p){
    if (p.theme) root.setAttribute('data-theme', p.theme);
    if (p.imageTone) root.setAttribute('data-img', p.imageTone);
    if (p.motion) root.setAttribute('data-motion', p.motion);
  };
  window.applyFirstomePrefs(d);

  function onImgErr(img){ img.setAttribute('data-missing',''); }
  document.addEventListener('error', function(e){ if (e.target && e.target.tagName === 'IMG') onImgErr(e.target); }, true);

  function init(){
    document.querySelectorAll('.ph img').forEach(function(img){
      if (img.complete && img.naturalWidth === 0) onImgErr(img);
    });
    var els = document.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window)) { els.forEach(function(e){ e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function(e, i){
      var dl = e.getAttribute('data-d'); if (dl) e.style.transitionDelay = dl + 'ms';
      io.observe(e);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
