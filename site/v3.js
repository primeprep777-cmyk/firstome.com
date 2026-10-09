// Firstome v3 interactions: header, reveals, manifesto word-lighting, reel inset, The Mile pinned scene, cursor.
(function(){
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function(s, r){ return (r||document).querySelector(s); };
  var $$ = function(s, r){ return [].slice.call((r||document).querySelectorAll(s)); };

  // split headline lines
  $$('[data-split]').forEach(function(el){
    el.innerHTML = el.innerHTML.split(/<br\s*\/?>/i).map(function(l){ return '<span class="split-line"><span>' + l + '</span></span>'; }).join('');
    $$('.split-line > span', el).forEach(function(s, i){ s.style.transitionDelay = (i*90 + (+el.dataset.d||0)) + 'ms'; });
  });
  // manifesto words
  var mani = $('.mani p.big');
  var words = [];
  if (mani){
    mani.innerHTML = mani.innerHTML.replace(/(<[^>]+>)|([^\s<]+)/g, function(m, tag, w){ return tag ? tag : '<span class="w-dim">' + w + '</span>'; });
    words = $$('.w-dim', mani);
  }

  // reveal
  var io = new IntersectionObserver(function(en){ en.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin:'0px 0px -10% 0px' });
  $$('.rv,[data-split],.gi').forEach(function(el){ if (el.dataset.d && el.classList.contains('rv')) el.style.transitionDelay = el.dataset.d + 'ms'; io.observe(el); });

  // Mile scene
  var STAGES = [
    { km:'0.0', n:'시료 접수', who:'샘플로', c:'teal', h:'맡기는 순간,<br>추적이 시작됩니다.', p:'견적이 확정되면 접수 번호와 바코드 키트가 나갑니다. 연구실에서 스캔하는 순간 진행 화면이 열립니다.' },
    { km:'0.2', n:'전처리·QC', who:'샘플로', c:'teal', h:'진행 전에,<br>품질부터 확인합니다.', p:'도착 사진과 온도, 시료별 QC 값이 바로 올라옵니다. 기준에 못 미치면 진행 전에 고객이 정합니다.' },
    { km:'0.4', n:'시퀀싱', who:'검증된 파트너', c:'muted', h:'시퀀싱은<br>가장 잘하는 곳에서.', p:'검증된 파트너에게 넘기고, 런 시작과 완료까지 같은 화면에서 이어서 보여 드립니다.' },
    { km:'0.6', n:'데이터 전달', who:'샘플로', c:'teal', h:'데이터와 리포트를,<br>한 번에.', p:'원자료와 QC 리포트를 포털에 올립니다. 예상 완료일이 바뀌면 이유와 함께 먼저 알립니다.' },
    { km:'0.8', n:'분석 연결', who:'오믹스메이트', c:'blue', h:'분석은<br>클릭 한 번으로.', p:'AI가 1차 분석을 끝내고, 검증된 전문가들이 입찰합니다. 결과를 확인한 뒤에 정산합니다.' },
    { km:'1.0', n:'보관 · 임상', who:'샘플로 · 퍼스트옴 Dx', c:'amber', h:'남은 시료는,<br>다음 연구로.', p:'바이오뱅크에 보관한 시료와 같은 기준의 데이터가 제약사의 바이오마커 발굴로 이어집니다.' }
  ];
  var mile = $('.mile'), cur = -1;
  if (mile){
    var track = $('.track', mile), N = STAGES.length;
    STAGES.forEach(function(s, i){
      var t = document.createElement('div'); t.className = 'tick'; t.style.left = (i/(N-1)*100) + '%';
      t.style.setProperty('--tc', 'var(--' + s.c + ')');
      t.innerHTML = '<span>' + s.n + '</span><b></b>'; track.appendChild(t);
      if (i < N-1){ var g = document.createElement('div'); g.className = 'seg'; g.style.left = (i/(N-1)*100) + '%'; g.style.width = (100/(N-1)) + '%'; g.style.background = 'var(--' + STAGES[i+1].c + ')'; track.appendChild(g); }
    });
    var ticks = $$('.tick', track), segs = $$('.seg', track), tube = $('.tube', mile), odo = $('.odo b', mile), st = $('.stage', mile);
    var renderStage = function(i){
      if (i === cur) return; cur = i; var s = STAGES[i];
      mile.style.setProperty('--sc', 'var(--' + s.c + ')');
      st.innerHTML = '<div><div class="who mono"><i></i>' + s.who + '</div><h3>' + s.h + '</h3></div><p>' + s.p + '</p>';
      st.classList.remove('swap'); void st.offsetWidth; st.classList.add('swap');
      ticks.forEach(function(t, j){ t.classList.toggle('on', j <= i); t.classList.toggle('cur', j === i); });
    };
    mile._update = function(){
      var r = mile.getBoundingClientRect(), tot = mile.offsetHeight - innerHeight;
      var p = Math.max(0, Math.min(1, -r.top / tot));
      var x = p * (N-1);
      segs.forEach(function(g, j){ g.style.transform = 'scaleX(' + Math.max(0, Math.min(1, x - j)) + ')'; });
      tube.style.left = (p*100) + '%';
      odo.textContent = p.toFixed(2);
      renderStage(Math.min(N-1, Math.round(x)));
    };
  }

  // reel inset (opens up from rounded card to full-bleed)
  var reel = $('.reel'), tc = $('.reel .tc'), vid = $('.reel video');
  // hero film: light file on phones; with reduced motion only the poster is shown
  if (vid && vid.dataset.src && !reduce){
    vid.src = (matchMedia('(max-width:720px)').matches && vid.dataset.srcM) || vid.dataset.src;
    vid.autoplay = true; var pp = vid.play(); if (pp && pp.catch) pp.catch(function(){});
  }
  function reelUpd(){
    if (!reel) return;
    var r = reel.getBoundingClientRect(), vh = innerHeight;
    var p = Math.max(0, Math.min(1, (vh - r.top) / (vh * 0.9)));
    var ins = (1 - p) * Math.min(80, innerWidth * .06);
    reel.style.setProperty('--inset', ins.toFixed(1) + 'px');
    reel.style.setProperty('--rad', ((1-p)*24).toFixed(1) + 'px');
    var m = reel.querySelector('video,img'); if (m) m.style.transform = 'translate3d(0,' + ((r.top/vh) * -60).toFixed(1) + 'px,0)';
  }
  if (vid && tc) setInterval(function(){ var t = vid.currentTime||0; tc.textContent = 'TC 00:00:' + String(Math.floor(t)).padStart(2,'0') + ':' + String(Math.floor((t%1)*24)).padStart(2,'0'); }, 1000/12);

  // manifesto lighting
  function maniUpd(){
    if (!words.length) return;
    var r = mani.getBoundingClientRect(), vh = innerHeight;
    var p = Math.max(0, Math.min(1, (vh*0.82 - r.top) / (r.height + vh*0.25)));
    var k = Math.round(p * words.length);
    for (var i=0;i<words.length;i++) words[i].classList.toggle('on', i < k);
  }

  // header
  var hd = $('.hd'), lastY = 0;
  function hdUpd(){
    var y = scrollY; hd.classList.toggle('solid', y > 40);
    hd.classList.toggle('hide', y > 600 && y > lastY + 2 && !(mile && mile.contains(document.activeElement)));
    if (y < lastY - 2) hd.classList.remove('hide'); lastY = y;
  }

  var ticking = false;
  function onScroll(){ if (ticking) return; ticking = true; requestAnimationFrame(function(){ ticking = false; hdUpd(); reelUpd(); maniUpd(); if (mile) mile._update(); }); }
  addEventListener('scroll', onScroll, { passive:true }); addEventListener('resize', onScroll);
  onScroll();
  if (reduce) words.forEach(function(w){ w.classList.add('on'); });

  // cursor
  var cd = $('.cur');
  if (cd && matchMedia('(hover:hover) and (pointer:fine)').matches){
    var mx=0,my=0,cx=0,cy=0;
    addEventListener('mousemove', function(e){ mx=e.clientX; my=e.clientY; });
    (function loop(){ cx += (mx-cx)*.2; cy += (my-cy)*.2; cd.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)'; requestAnimationFrame(loop); })();
    $$('a,.br,button').forEach(function(a){ a.addEventListener('mouseenter', function(){ cd.classList.add('big'); }); a.addEventListener('mouseleave', function(){ cd.classList.remove('big'); }); });
  }
})();
