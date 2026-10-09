// Firstome logo concepts — A: Mile line · B: 1·o monogram · C: Family wells
// Usage: <span data-logo [data-brand="teal|blue|amber"]></span>  (full lockup)
//        <span data-logo-mark [data-brand]></span>               (mark only)
// Kind comes from data-logo-kind on the element, else <html data-logo>, else "A".
(function(){
  var COL = { teal:'var(--teal)', blue:'var(--blue)', amber:'var(--amber)' };
  var NAMES = {
    '':    { A:'firstome',    B:'First<i>ome</i>',     C:'FIRSTOME' },
    teal:  { A:'samplo',      B:'Sam<i>plo</i>',       C:'SAMPLO' },
    blue:  { A:'omicsmate',   B:'Omics<i>Mate</i>',    C:'OMICSMATE' },
    amber: { A:'firstome dx', B:'First<i>ome</i> Dx',  C:'FIRSTOME DX' }
  };
  function mark(kind, brand){
    var c = brand ? COL[brand] : 'currentColor';
    if (kind === 'B'){
      // "1" bar + "o" ring: the first step into omics
      return '<svg viewBox="0 0 34 24" aria-hidden="true"><rect x="1" y="2" width="6.5" height="20" rx="3.25" fill="currentColor"/>' +
             '<circle cx="22" cy="12" r="7.6" fill="none" stroke="' + (brand ? c : 'var(--teal)') + '" stroke-width="5"/></svg>';
    }
    if (kind === 'C'){
      // 2×2 wells: parent fills all (ink + three brand colours); each brand lights only its own well
      var cells = [['', 6, 6], ['teal', 18, 6], ['blue', 6, 18], ['amber', 18, 18]];
      return '<svg viewBox="0 0 24 24" aria-hidden="true">' + cells.map(function(w){
        var on = !brand || brand === w[0] || (!w[0]);
        var fill = w[0] ? COL[w[0]] : 'currentColor';
        if (brand && w[0] !== brand) return '<circle cx="' + w[1] + '" cy="' + w[2] + '" r="4.4" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.4"/>';
        return '<circle cx="' + w[1] + '" cy="' + w[2] + '" r="5.2" fill="' + fill + '"/>';
      }).join('') + '</svg>';
    }
    // A — start dot + the mile line
    return '<svg viewBox="0 0 46 24" aria-hidden="true"><circle cx="8" cy="12" r="7" fill="' + (brand ? c : 'var(--teal)') + '"/>' +
           '<rect x="19" y="10.2" width="25" height="3.6" rx="1.8" fill="currentColor"/><rect x="41" y="5" width="3.6" height="14" rx="1.8" fill="currentColor"/></svg>';
  }
  function lockup(kind, brand){
    return '<span class="lg lg-' + kind + '">' + mark(kind, brand) + '<span class="lg-w">' + NAMES[brand || ''][kind] + '</span></span>';
  }
  function kindOf(el){ return el.getAttribute('data-logo-kind') || document.documentElement.getAttribute('data-logokind') || 'A'; }
  window.FirstomeLogo = { mark: mark, lockup: lockup };
  window.renderLogos = function(){
    document.querySelectorAll('body [data-logo]').forEach(function(el){ el.innerHTML = lockup(kindOf(el), el.getAttribute('data-brand') || ''); });
    document.querySelectorAll('body [data-logo-mark]').forEach(function(el){ el.innerHTML = '<span class="lgm">' + mark(kindOf(el), el.getAttribute('data-brand') || '') + '</span>'; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.renderLogos); else window.renderLogos();
})();
