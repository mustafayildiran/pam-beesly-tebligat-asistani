// E-Duruşma yan paneli: yalnızca canlı takip sayfası + zum.
// Seçim ve liste işlemleri sayfanın içinde yapılır; panel yalnızca gösterir.
(function () {
  'use strict';
  const TAKIP_URL = 'https://avukat.uyap.gov.tr/durusma-takip';
  const ZOOM_KEY = 'edurusma_side_zoom';
  const frame = document.getElementById('sp-frame');
  const zoomVal = document.getElementById('sp-zoom-val');
  const statusEl = document.getElementById('sp-status');

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }
  function applyZoom(z) {
    try {
      frame.style.zoom = String(z);
      zoomVal.textContent = Math.round(z * 100) + '%';
      chrome.storage.local.set({ [ZOOM_KEY]: z });
    } catch (_) {}
  }

  document.getElementById('sp-zoom-in').addEventListener('click', () => {
    const cur = parseFloat(frame.style.zoom) || 1;
    applyZoom(Math.min(1.25, Math.round((cur + 0.1) * 100) / 100));
  });
  document.getElementById('sp-zoom-out').addEventListener('click', () => {
    const cur = parseFloat(frame.style.zoom) || 1;
    applyZoom(Math.max(0.5, Math.round((cur - 0.1) * 100) / 100));
  });
  document.getElementById('sp-framerefresh').addEventListener('click', () => {
    try { frame.src = TAKIP_URL; setStatus('Takip sayfası yenileniyor...'); } catch (_) {}
  });
  frame.addEventListener('load', () => {
    setStatus('Yüklendi: ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  });

  (async function init() {
    try {
      const z = await chrome.storage.local.get(ZOOM_KEY);
      const zv = z && typeof z[ZOOM_KEY] === 'number' ? z[ZOOM_KEY] : 0.85;
      frame.style.zoom = String(zv);
      zoomVal.textContent = Math.round(zv * 100) + '%';
    } catch (_) { frame.style.zoom = '0.85'; zoomVal.textContent = '85%'; }
  })();
})();
