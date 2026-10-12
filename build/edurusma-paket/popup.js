// E-Duruşma Yardımcısı (bağımsız paket) — otomatik yenileme ayarı.
// Panel durumu content-durusma.js ile aynı anahtarda tutulur (edurusma_panel_v5),
// eski anahtar (edurusma_win_v1) uyumluluk için de yazılır.
(function () {
  var PANEL_KEY = 'edurusma_panel_v5';
  var LEGACY_KEY = 'edurusma_win_v1';
  var sel = document.getElementById('auto');
  if (!sel) return;
  chrome.storage.local.get([PANEL_KEY, LEGACY_KEY], function (r) {
    try {
      var v = r && r[PANEL_KEY] ? r[PANEL_KEY].autoMs : undefined;
      if (typeof v !== 'number' && r && r[LEGACY_KEY]) v = r[LEGACY_KEY].autoMs;
      if (typeof v !== 'number') v = 30000;
      sel.value = String(v == null ? 30000 : v);
    } catch (_) {}
  });
  sel.onchange = function () {
    var autoMs = parseInt(sel.value, 10) || 0;
    chrome.storage.local.get(PANEL_KEY, function (r) {
      var prev = (r && r[PANEL_KEY]) || {};
      prev.autoMs = autoMs;
      var obj = {};
      obj[PANEL_KEY] = prev;
      obj[LEGACY_KEY] = { autoMs: autoMs };
      chrome.storage.local.set(obj);
    });
  };
  var all = document.getElementById('all');
  if (all) {
    all.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        chrome.tabs.create({ url: 'https://github.com/mustafayildiran/pam-beesly-tebligat-asistani/releases' });
      } catch (_) {}
    });
  }
})();
