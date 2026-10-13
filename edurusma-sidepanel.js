// E-Duruşma yan paneli: sade liste (dosya no + tarih + açıklama + görüntüle).
// Veriyi sekmadaki content script'ten ister; "Dosya Görüntüle" sayfadaki
// göz düğmesine bastırır. Liste kaydırıldıkça içerik tarafında birikir.
(function () {
  'use strict';
  const AUTO_KEY = 'edurusma_side_auto';
  const statusEl = document.getElementById('sp-status');
  const listBox = document.getElementById('sp-list');
  const autoSel = document.getElementById('sp-auto');
  let timer = null;
  let lastTabId = null;

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }
  function shortDurum(s) {
    const t = String(s || '').trim();
    if (/yapıldı/i.test(t)) return 'Yapıldı';
    if (/devam/i.test(t)) return 'Devam Ediyor';
    return t.slice(0, 24);
  }

  function saatOf(tarih) {
    const m = String(tarih || '').match(/(\d{1,2}):(\d{2})/) || [];
    return m.length ? (String(m[1]).padStart(2, '0') + ':' + m[2]) : '';
  }

  async function gotoRow(r) {
    try {
      if (!lastTabId) return;
      const resp = await chrome.tabs.sendMessage(lastTabId, { type: 'EDURUSMA_GOTO', dosya: r.dosya, saat: saatOf(r.tarih) });
      if (!resp || !resp.ok) setStatus('Satır sayfada bulunamadı (liste dışında olabilir).');
    } catch (_) {}
  }

  async function openDosya(r) {
    try {
      if (!lastTabId) return;
      setStatus('Dosya açılıyor: ' + r.dosya + ' ...');
      const resp = await chrome.tabs.sendMessage(lastTabId, { type: 'EDURUSMA_OPEN_DOSYA', dosya: r.dosya });
      setStatus(resp && resp.ok ? 'Dosya açıldı: ' + r.dosya : 'Düğme bulunamadı: ' + r.dosya);
    } catch (_) {
      setStatus('Sayfaya ulaşılamadı.');
    }
  }

  function render(rows) {
    listBox.innerHTML = '';
    if (!rows.length) {
      const e = document.createElement('div');
      e.className = 'sp-empty';
      e.textContent = 'Liste boş. Sayfada mahkemeyi seçip Görüntüle’ye basın.';
      listBox.appendChild(e);
      return;
    }
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'sp-row';
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'sp-rowmain';
      main.title = 'Sayfada bu satıra git';
      main.textContent = `${r.dosya} · ${r.tarih}`;
      const sub = document.createElement('span');
      sub.className = 'sp-sub';
      sub.textContent = shortDurum(r.aciklama);
      main.appendChild(sub);
      main.addEventListener('click', () => gotoRow(r));
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'sp-open';
      open.title = 'Dosya Görüntüle';
      open.textContent = '👁 Görüntüle';
      open.addEventListener('click', () => openDosya(r));
      row.append(main, open);
      listBox.appendChild(row);
    });
  }

  function hint(msg) {
    listBox.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'sp-empty';
    e.textContent = msg;
    listBox.appendChild(e);
  }

  async function load(silent) {
    if (!silent) setStatus('Yükleniyor...');
    let tab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    } catch (_) {}
    if (!tab || !tab.id || !/uyap/i.test(tab.url || '')) {
      hint('UYAP duruşma sayfasını açın; liste burada görünecek.');
      setStatus('Hazır');
      return;
    }
    lastTabId = tab.id;
    let host = '';
    try { host = new URL(tab.url || '').hostname; } catch (_) {}
    setStatus('Okunuyor: ' + (host || 'bilinmiyor') + ' ...');
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'EDURUSMA_GET_LIST' });
      if (resp && resp.ok && Array.isArray(resp.rows)) {
        render(resp.rows);
        setStatus('Güncellendi: ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ` · ${resp.rows.length} satır`);
      } else {
        hint('Liste okunamadı. Sayfada mahkemeyi seçip Görüntüle’ye basın.');
        setStatus('Hazır · 0 satır');
      }
    } catch (e) {
      const why = (chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) || String((e && e.message) || e);
      hint('Sayfaya ulaşılamadı.');
      setStatus('Hata: ' + why + ' — eklentiyi chrome://extensions üzerinden yenileyin');
    }
  }

  function restartAuto() {
    if (timer) { clearInterval(timer); timer = null; }
    const ms = parseInt(autoSel.value, 10) || 0;
    try { chrome.storage.local.set({ [AUTO_KEY]: ms }); } catch (_) {}
    if (ms > 0) timer = setInterval(() => load(true), ms);
  }

  document.getElementById('sp-refresh').addEventListener('click', async () => {
    // Yenile = sıfırdan tara (önbelleği temizle, güncel listeyi oku)
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.id) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'EDURUSMA_CLEAR_CACHE' }); } catch (_) {}
      }
    } catch (_) {}
    load(false);
  });
  autoSel.addEventListener('change', () => { restartAuto(); setStatus('Otomatik: ' + (autoSel.value === '0' ? 'kapalı' : (autoSel.value / 1000) + ' sn')); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
  (async function init() {
    try {
      const r = await chrome.storage.local.get(AUTO_KEY);
      if (r && typeof r[AUTO_KEY] === 'number') autoSel.value = String(r[AUTO_KEY]);
    } catch (_) {}
    restartAuto();
    load(false);
  })();
})();
