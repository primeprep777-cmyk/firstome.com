// Brand canvas backgrounds. <div class="bfx" data-fx="samplo|omicsmate|dx|family"></div>
// Theme-aware (reads CSS vars), pauses offscreen, static frame on reduced-motion, DPR capped.
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  function motionOff(){ return reduce || root.getAttribute('data-motion') === 'off'; }
  function css(el, name, fb){ var v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fb; }
  function rgba(hex, a){
    hex = hex.replace('#',''); if (hex.length === 3) hex = hex.split('').map(function(c){return c+c;}).join('');
    var n = parseInt(hex,16); return 'rgba(' + (n>>16&255) + ',' + (n>>8&255) + ',' + (n&255) + ',' + a + ')';
  }
  function rand(a,b){ return a + Math.random()*(b-a); }

  // ---------- effects ----------
  var FX = {};

  // 샘플로: tube rack scanned by a moving line, frost particles drifting
  FX.samplo = function(s){
    var rack = [], frost = [], scanX = 0;
    s.layout = function(){
      rack = []; frost = [];
      var gap = Math.max(26, Math.min(40, s.w/34)), r = gap*0.28;
      var cols = Math.ceil(s.w/gap)+1, rows = Math.ceil(s.h/gap)+1;
      for (var y=0;y<rows;y++) for (var x=0;x<cols;x++){
        rack.push({x:x*gap+gap/2+(y%2?gap/2:0), y:y*gap+gap/2, r:r, lit:0, filled:Math.random()<.72, done:Math.random()<.15});
      }
      for (var i=0;i<Math.round(s.w*s.h/14000);i++) frost.push({x:rand(0,s.w),y:rand(0,s.h),r:rand(.6,2.2),vx:rand(-.12,.12),vy:rand(-.28,-.05),a:rand(.15,.6)});
      scanX = s.w*.35;
    };
    s.draw = function(t, dt){
      var c = s.ctx, col = s.col(), ink = s.ink();
      c.clearRect(0,0,s.w,s.h);
      scanX += dt*0.11; if (scanX > s.w + 120) scanX = -120;
      for (var i=0;i<rack.length;i++){
        var p = rack[i], d = Math.abs(p.x - scanX);
        if (d < 18 && p.filled) p.lit = 1;
        p.lit = Math.max(0, p.lit - dt*0.0007);
        c.beginPath(); c.arc(p.x,p.y,p.r,0,6.283);
        c.strokeStyle = rgba(ink, .10); c.lineWidth = 1; c.stroke();
        if (p.filled){
          c.beginPath(); c.arc(p.x,p.y,p.r*.52,0,6.283);
          c.fillStyle = p.lit > 0 ? rgba(col, .15 + p.lit*.75) : (p.done ? rgba(col,.22) : rgba(ink,.10));
          c.fill();
        }
      }
      var g = c.createLinearGradient(scanX-90,0,scanX+6,0);
      g.addColorStop(0, rgba(col,0)); g.addColorStop(1, rgba(col,.20));
      c.fillStyle = g; c.fillRect(scanX-90,0,96,s.h);
      c.fillStyle = rgba(col,.85); c.fillRect(scanX,0,1.5,s.h);
      for (var j=0;j<frost.length;j++){
        var f = frost[j]; f.x += f.vx*dt*.06; f.y += f.vy*dt*.06;
        if (f.y < -4){ f.y = s.h+4; f.x = rand(0,s.w); }
        c.beginPath(); c.arc(f.x,f.y,f.r,0,6.283); c.fillStyle = rgba(ink, f.a*.35); c.fill();
      }
    };
  };

  // 오믹스메이트: point cloud that keeps settling into clusters (AI 1차 분석), then re-scatters
  FX.omicsmate = function(s){
    var pts = [], centers = [], phase = 0, timer = 0, palette;
    function pickCenters(){
      centers = []; var k = 5;
      for (var i=0;i<k;i++) centers.push({x:rand(s.w*.42, s.w*.94), y:rand(s.h*.14, s.h*.86), r:rand(28, 70)});
    }
    s.layout = function(){
      pts = []; pickCenters();
      var n = Math.min(900, Math.round(s.w*s.h/1300));
      for (var i=0;i<n;i++){ var k = i % centers.length; pts.push({x:rand(0,s.w),y:rand(0,s.h),tx:0,ty:0,k:k,r:rand(1,2.3)}); }
      setTargets();
    };
    function setTargets(){
      for (var i=0;i<pts.length;i++){
        var p = pts[i];
        if (phase === 0){ p.tx = rand(s.w*.3, s.w); p.ty = rand(0, s.h); }
        else { var cc = centers[p.k], a = rand(0,6.283), d = Math.pow(Math.random(), .6)*cc.r; p.tx = cc.x + Math.cos(a)*d*1.35; p.ty = cc.y + Math.sin(a)*d; }
      }
    }
    s.draw = function(t, dt){
      var c = s.ctx, ink = s.ink();
      palette = [s.col(), css(s.el,'--teal','#38d3c8'), '#a98bff', s.col(), '#6fc3ff'];
      timer += dt;
      if (timer > (phase ? 6200 : 2600)){ timer = 0; phase = 1 - phase; if (phase) pickCenters(); setTargets(); }
      c.clearRect(0,0,s.w,s.h);
      var ease = 1 - Math.pow(1 - 0.035, dt/16);
      for (var i=0;i<pts.length;i++){
        var p = pts[i];
        p.x += (p.tx - p.x)*ease + Math.sin(t*.0011 + i)*.08;
        p.y += (p.ty - p.y)*ease + Math.cos(t*.0013 + i)*.08;
        c.beginPath(); c.arc(p.x,p.y,p.r,0,6.283);
        c.fillStyle = phase ? rgba(palette[p.k % palette.length], .7) : rgba(ink, .22);
        c.fill();
      }
      if (phase && timer > 1400){
        var a = Math.min(1,(timer-1400)/600);
        c.font = '500 11px "JetBrains Mono", monospace';
        for (var j=0;j<centers.length;j++){
          var cc = centers[j];
          c.strokeStyle = rgba(ink, .18*a); c.setLineDash([3,4]);
          c.beginPath(); c.ellipse(cc.x, cc.y, cc.r*1.55, cc.r*1.15, 0, 0, 6.283); c.stroke(); c.setLineDash([]);
          c.fillStyle = rgba(ink, .45*a); c.fillText('C' + (j+1), cc.x + cc.r*1.1, cc.y - cc.r*1.05);
        }
      }
    };
  };

  // 퍼스트옴 Dx: patient dot-matrix; a biomarker sweep selects likely responders
  FX.dx = function(s){
    var dots = [], sweep = -0.2, gap;
    s.layout = function(){
      dots = []; gap = Math.max(18, Math.min(26, s.w/52));
      var cols = Math.ceil(s.w/gap), rows = Math.ceil(s.h/gap);
      for (var y=0;y<rows;y++) for (var x=0;x<cols;x++){
        var nx = x/cols, ny = y/rows;
        var score = Math.sin(nx*7.1+ny*3.3)*.5 + Math.sin(nx*2.3-ny*5.7+1.2)*.5 + rand(-.35,.35);
        dots.push({x:x*gap+gap/2, y:y*gap+gap/2, s:score, sel:0});
      }
    };
    s.draw = function(t, dt){
      var c = s.ctx, col = s.col(), ink = s.ink();
      sweep += dt*0.00012; if (sweep > 1.35) { sweep = -0.2; for (var k=0;k<dots.length;k++) dots[k].sel = 0; }
      var sx = sweep * s.w;
      c.clearRect(0,0,s.w,s.h);
      for (var i=0;i<dots.length;i++){
        var p = dots[i], passed = p.x < sx;
        var hit = passed && p.s > .42;
        p.sel += ((hit ? 1 : 0) - p.sel) * Math.min(1, dt*.006);
        var r = gap*.16 + p.sel*gap*.12;
        c.beginPath(); c.arc(p.x,p.y,r,0,6.283);
        if (p.sel > .05){ c.fillStyle = rgba(col, .25 + p.sel*.65); c.fill(); }
        else { c.fillStyle = rgba(ink, passed ? .07 : .14); c.fill(); }
      }
      var g = c.createLinearGradient(sx-140,0,sx,0);
      g.addColorStop(0, rgba(col,0)); g.addColorStop(1, rgba(col,.14));
      c.fillStyle = g; c.fillRect(sx-140,0,140,s.h);
      c.fillStyle = rgba(col,.75); c.fillRect(sx,0,1.5,s.h);
      c.font = '500 11px "JetBrains Mono", monospace'; c.fillStyle = rgba(col,.9);
      if (sx > 0 && sx < s.w - 120) c.fillText('BIOMARKER+ ▸', sx + 8, 20);
    };
  };

  // 퍼스트옴 family: three brand streams flowing into one line
  FX.family = function(s){
    var parts = [], cols;
    s.layout = function(){
      parts = []; var n = Math.min(260, Math.round(s.w/5));
      for (var i=0;i<n;i++) parts.push({u:Math.random(), lane:i%3, sp:rand(.00005,.00011), off:rand(-1,1), r:rand(1,2.4)});
    };
    function pos(u, lane, off){
      var y0 = s.h*(.24 + lane*.26), yM = s.h*.55;
      var m = Math.min(1, Math.max(0, (u - .25)/.5)); m = m*m*(3-2*m);
      var y = y0 + (yM - y0)*m + Math.sin(u*9 + lane*2)*s.h*.025*(1-m) + off*(10*(1-m) + 3);
      return [u*s.w*1.1 - s.w*.05, y];
    }
    s.draw = function(t, dt){
      var c = s.ctx, ink = s.ink();
      cols = [css(s.el,'--teal','#38d3c8'), css(s.el,'--blue','#86a9ff'), css(s.el,'--amber','#f0b445')];
      c.clearRect(0,0,s.w,s.h);
      for (var L=0; L<3; L++){
        c.beginPath();
        for (var u=0; u<=1.001; u+=.01){ var q = pos(u, L, 0); if (u===0) c.moveTo(q[0],q[1]); else c.lineTo(q[0],q[1]); }
        c.strokeStyle = rgba(cols[L], .22); c.lineWidth = 1; c.stroke();
      }
      for (var i=0;i<parts.length;i++){
        var p = parts[i]; p.u += p.sp*dt; if (p.u > 1) p.u -= 1;
        var q = pos(p.u, p.lane, p.off);
        c.beginPath(); c.arc(q[0],q[1],p.r,0,6.283);
        c.fillStyle = rgba(cols[p.lane], p.u > .75 ? .85 : .55); c.fill();
      }
    };
  };

  // ---------- runner ----------
  function mount(el){
    var kind = el.getAttribute('data-fx'); if (!FX[kind]) return;
    var cv = document.createElement('canvas'); el.appendChild(cv);
    var s = { el: el, ctx: cv.getContext('2d'), w: 0, h: 0 };
    s.col = function(){ return css(el, '--c', '#38d3c8'); };
    s.ink = function(){ return css(el, '--ink', '#e9f1f6'); };
    FX[kind](s);
    function size(){
      var r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (r.width < 2 || r.height < 2) return;
      s.w = r.width; s.h = r.height; lw = s.w; lh = s.h; cv.width = s.w*dpr; cv.height = s.h*dpr;
      s.ctx.setTransform(dpr,0,0,dpr,0,0); s.layout();
      if (motionOff()) { for (var i=0;i<90;i++) s.draw(i*60, 60); }
    }
    var visible = false, last = 0, raf = 0;
    function loop(t){
      raf = 0; if (!visible || motionOff()) return;
      var dt = last ? Math.min(64, t - last) : 16; last = t;
      s.draw(t, dt); raf = requestAnimationFrame(loop);
    }
    function start(){ if (!raf && visible && !motionOff()){ last = 0; raf = requestAnimationFrame(loop); } }
    size();
    // re-measure when the host box changes (web fonts arriving, viewport resize); the canvas is stretched by CSS until then
    var to, lw = s.w, lh = s.h;
    function resized(){ var r = el.getBoundingClientRect(); if (Math.abs(r.width - lw) < 1 && Math.abs(r.height - lh) < 1) return; lw = r.width; lh = r.height; clearTimeout(to); to = setTimeout(size, 120); }
    if ('ResizeObserver' in window) new ResizeObserver(resized).observe(el); else window.addEventListener('resize', resized);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resized);
    if ('IntersectionObserver' in window){
      new IntersectionObserver(function(en){ visible = en[0].isIntersecting; start(); }).observe(el);
    } else { visible = true; start(); }
    new MutationObserver(function(){ if (motionOff()) size(); else start(); }).observe(root, { attributes: true, attributeFilter: ['data-motion','data-theme'] });
  }

  // film bands: parallax + lazy video
  function bands(){
    var list = [].slice.call(document.querySelectorAll('.vband'));
    list.forEach(function(b){
      var v = b.querySelector('video[data-src]');
      if (v && 'IntersectionObserver' in window){
        new IntersectionObserver(function(en, ob){
          if (!en[0].isIntersecting) { if (v.src) v.pause(); return; }
          if (!v.src){ var sm = window.matchMedia('(max-width:720px)').matches && v.getAttribute('data-src-m'); v.src = sm || v.getAttribute('data-src'); v.addEventListener('canplay', function(){ v.classList.add('ready'); }, { once: true }); v.addEventListener('error', function(){ v.remove(); }, { once: true }); v.load(); }
          if (!motionOff()) { var p = v.play(); if (p && p.catch) p.catch(function(){}); }
        }, { rootMargin: '200px 0px' }).observe(b);
      }
    });
    if (!list.length) return;
    var ticking = false;
    function par(){
      ticking = false; if (motionOff()) return;
      var vh = window.innerHeight;
      list.forEach(function(b){
        var r = b.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh) return;
        var p = (r.top + r.height/2 - vh/2) / (vh + r.height);
        var m = b.querySelector('.vb-media'); if (m) m.style.transform = 'translate3d(0,' + (p*-70).toFixed(1) + 'px,0)';
      });
    }
    window.addEventListener('scroll', function(){ if (!ticking){ ticking = true; requestAnimationFrame(par); } }, { passive: true });
    par();
  }

  function init(){ document.querySelectorAll('.bfx[data-fx]').forEach(mount); bands(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
