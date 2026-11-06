// GitHub Pages などでは、計算を速くする設定（複数スレッド）に必要な見出しを付けられない。
// sw.js に付けてもらうため、初回だけ登録して1回読み直す。
(function () {
  if (window.crossOriginIsolated || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  var KEY = 'monosagashi-coi-reloaded';
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    function reloadOnce() {
      var done = false;
      try { done = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1'); } catch (e) { done = true; }
      if (!done) location.reload();
    }
    if (navigator.serviceWorker.controller) { reloadOnce(); return; }
    var w = reg.installing || reg.waiting || reg.active;
    if (!w) return;
    if (w.state === 'activated') { navigator.serviceWorker.ready.then(reloadOnce); return; }
    w.addEventListener('statechange', function () { if (w.state === 'activated') reloadOnce(); });
  }).catch(function () { /* 使えなくても1スレッドで動く */ });
})();
