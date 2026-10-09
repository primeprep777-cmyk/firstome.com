// Scroll-driven 6-stage sample flow. On desktop: progress = scroll through .hf. On mobile (no sticky): auto-advances.
(function(){
  var STAGES = [
    { n:'시료 접수', k:'STEP 1 · INTAKE', who:'퍼스트옴', t:'맡기는 순간 추적이 시작됩니다',
      p:'견적이 확정되면 접수 번호와 바코드 키트가 나갑니다. 연구실에서 스캔하는 순간 진행 화면이 열립니다.',
      log:[['10.11','접수 번호 S-2611-0042 발급'],['10.11','채취 키트 24개 발송']] },
    { n:'전처리·QC', k:'STEP 2 · PREP & QC', who:'퍼스트옴', t:'진행 전에 품질부터 확인합니다',
      p:'도착 사진과 온도 기록, 시료별 QC 결과를 바로 올립니다. 기준에 못 미치면 진행 전에 여쭙니다.',
      log:[['10.13','랩 도착 · 수령 온도 -72℃'],['10.13','S07 RIN 6.1 → 고객이 "진행" 선택']] },
    { n:'시퀀싱', k:'STEP 3 · SEQUENCING', who:'검증된 파트너', partner:true, t:'시퀀싱은 가장 잘하는 곳에서',
      p:'검증된 시퀀싱 파트너에게 넘기고, 런 시작과 완료까지 같은 화면에서 이어서 보여 드립니다.',
      log:[['10.18','파트너 런 시작'],['10.21','런 완료 · Q30 93%']] },
    { n:'데이터 전달', k:'STEP 4 · DELIVERY', who:'퍼스트옴', t:'데이터와 QC 리포트를 한 번에',
      p:'원자료와 QC 리포트를 포털에 올리면 바로 내려받습니다. 예상 완료일이 바뀌면 이유와 함께 먼저 알립니다.',
      log:[['10.23','데이터 412GB 업로드 완료'],['10.23','예정보다 하루 빠르게 전달']] },
    { n:'분석 연결', k:'STEP 5 · ANALYSIS', who:'오믹스메이트', t:'분석이 필요하면 클릭 한 번으로',
      p:'데이터가 오믹스메이트로 바로 넘어가 AI 1차 분석을 받고, 주제에 맞는 분석 전문가와 연결됩니다.',
      log:[['10.24','AI 1차 분석 시작'],['10.25','추천 전문가 2명 매칭']] },
    { n:'시료 보관', k:'STEP 6 · BIOBANK', who:'퍼스트옴', t:'남은 시료는 다시 쓸 수 있게',
      p:'남은 조직과 추출물은 바이오뱅크에 보관합니다. 리뷰어가 추가 실험을 요청해도 다시 모을 필요가 없습니다.',
      log:[['10.24','남은 시료 48개 -80℃ 보관'],['—','보관 만료 30일 전 알림 예약']] }
  ];

  function build(root){
    var track = root.querySelector('.hf-track');
    var N = STAGES.length;
    STAGES.forEach(function(s, i){
      var el = document.createElement('div');
      el.className = 'hf-node' + (s.partner ? ' partner' : '');
      el.style.left = (i / (N - 1) * 100) + '%';
      el.innerHTML = '<div class="hf-dot">' + (i + 1) + '</div><span>' + s.n + '</span>';
      track.appendChild(el);
    });
    var nodes = track.querySelectorAll('.hf-node');
    var fill = track.querySelector('.hf-fill');
    var stage = root.querySelector('.hf-stage');
    var cur = -1;

    function render(idx, frac){
      fill.style.width = (Math.min(1, frac) * 100) + '%';
      nodes.forEach(function(n, i){
        n.classList.toggle('done', i < idx);
        n.classList.toggle('now', i === idx);
      });
      if (idx === cur) return;
      cur = idx;
      var s = STAGES[idx];
      stage.innerHTML =
        '<span class="k">' + s.k + '</span>' +
        '<h3>' + s.t + '</h3><span class="hf-who' + (s.partner ? ' p' : '') + '">' + s.who + '</span>' +
        '<p>' + s.p + '</p>' +
        '<div class="hf-log" style="grid-column:1/-1">' + s.log.map(function(l){ return '<div><b>' + l[0] + '</b>' + l[1] + '</div>'; }).join('') + '</div>';
      stage.classList.remove('hf-swap'); void stage.offsetWidth; stage.classList.add('hf-swap');
    }

    var mq = window.matchMedia('(max-width:960px)');
    var autoIdx = 0, timer = null;
    function onScroll(){
      if (mq.matches) return;
      var r = root.getBoundingClientRect();
      var total = root.offsetHeight - window.innerHeight;
      var p = Math.max(0, Math.min(1, -r.top / Math.max(1, total)));
      var idx = Math.min(N - 1, Math.floor(p * N * 0.999));
      // fill tracks continuous progress between nodes
      var frac = Math.min(1, (p * N - 0.5) / (N - 1));
      render(idx, Math.max(0, frac));
    }
    function setMode(){
      clearInterval(timer);
      if (mq.matches){
        render(autoIdx, autoIdx / (N - 1));
        timer = setInterval(function(){ autoIdx = (autoIdx + 1) % N; render(autoIdx, autoIdx / (N - 1)); }, 3200);
      } else onScroll();
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    if (mq.addEventListener) mq.addEventListener('change', setMode);
    nodes.forEach(function(n, i){
      n.style.cursor = 'pointer';
      n.addEventListener('click', function(){
        if (mq.matches){ autoIdx = i; render(i, i / (N - 1)); return; }
        var total = root.offsetHeight - window.innerHeight;
        window.scrollTo({ top: root.offsetTop + total * ((i + 0.5) / N), behavior: 'smooth' });
      });
    });
    setMode();
  }
  function init(){ document.querySelectorAll('.hf').forEach(build); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
