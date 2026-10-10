// Samplo page interactions: auto-advancing tracker, QC choice, biobank request.
(function(){
  function init(){
    // Tracker
    var steps = ['접수','이동','도착·QC','추출','라이브러리','시퀀싱','데이터 도착','보관'];
    var status = [
      ['접수 완료','견적 확정, 접수 번호와 바코드 키트 발송'],
      ['시료 이동 중','콜드체인으로 랩에 오는 중 · 온도 정상'],
      ['도착·QC 중','수령 사진과 온도 기록 등록, 시료별 QC 측정'],
      ['핵산 추출 중','24개 중 18개 추출 완료'],
      ['라이브러리 제작 중','자동화 라인에서 24개 중 16개 완료'],
      ['시퀀싱 중','파트너 런 진행 · 예상 완료 10.21'],
      ['데이터 도착','데이터와 QC 리포트 내려받기 가능'],
      ['바이오뱅크 보관','남은 시료 48개 -80℃ 보관 중']
    ];
    var tr = document.querySelector('.trk');
    if (tr){
      var ol = tr.querySelector('.trk-steps');
      steps.forEach(function(s, i){ var li = document.createElement('li'); li.innerHTML = '<i>' + (i+1) + '</i><span>' + s + '</span>'; ol.appendChild(li); });
      var lis = ol.querySelectorAll('li'), idx = 4, timer = null, paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
      var pb = tr.querySelector('.trk-ctl [data-act=pause]');
      var h = tr.querySelector('.trk-now b'), sub = tr.querySelector('.trk-now span'), bar = tr.querySelector('.trk-bar i');
      function show(){
        lis.forEach(function(li, i){ li.className = i < idx ? 'done' : i === idx ? 'now' : ''; });
        h.textContent = '지금 ' + status[idx][0]; sub.textContent = status[idx][1];
        bar.style.width = ((idx + 1) / steps.length * 100) + '%';
      }
      function run(){ clearInterval(timer); if (!paused) timer = setInterval(function(){ idx = (idx + 1) % steps.length; show(); }, 2800);
        if (pb){ pb.textContent = paused ? '▶ 자동 재생' : '❚❚ 멈춤'; pb.setAttribute('aria-pressed', String(paused)); } }
      lis.forEach(function(li, i){ li.setAttribute('role', 'button'); li.tabIndex = 0; li.setAttribute('aria-label', (i+1) + '단계 ' + steps[i] + ' 보기');
        function go(){ idx = i; paused = true; show(); run(); }
        li.addEventListener('click', go); li.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } }); });
      if (pb) pb.addEventListener('click', function(){ paused = !paused; run(); });
      tr.addEventListener('mouseenter', function(){ clearInterval(timer); });
      tr.addEventListener('mouseleave', run);
      show(); run();
    }

    // QC choice
    var qc = document.querySelector('.qc');
    if (qc){
      var out = qc.querySelector('.qc-out');
      var msg = { go:'S07을 그대로 진행합니다. 리포트에 "고객 선택: 진행"으로 기록하고 일정은 바뀌지 않습니다.',
                  re:'S07을 남은 조직에서 다시 추출합니다. 예상 완료일이 하루 늦어지며 추적 화면에 바로 반영됩니다.',
                  ex:'S07을 이번 의뢰에서 제외하고 23개로 진행합니다. 제외한 시료는 바이오뱅크에 보관합니다.' };
      qc.querySelectorAll('button[data-v]').forEach(function(b){
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function(){
          qc.querySelectorAll('button[data-v]').forEach(function(x){ x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          out.textContent = '예시 · ' + msg[b.dataset.v]; out.classList.add('show');
        });
      });
    }

    // Biobank: 예시 화면 — fake success 대신 실제 경로 안내
    document.querySelectorAll('.bb-row button').forEach(function(b){
      b.addEventListener('click', function(){
        if (window.v4Toast) v4Toast('예시 화면이에요. 실제 서비스에서는 이 버튼으로 반출·재실험을 신청합니다. 사전 신청은 카카오톡으로 받아요.');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
