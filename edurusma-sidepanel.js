// E-Duruşma yan paneli: listedeki veriyi sekmadaki content script'ten ister,
// tam boy gösterir. Sayfa değişse de panel açık kalır.
(function () {
  'use strict';
  const AUTO_KEY = 'edurusma_side_auto';
  const statusEl = document.getElementById('sp-status');
  const todayBox = document.getElementById('sp-today');
  const allBox = document.getElementById('sp-all');
  const autoSel = document.getElementById('sp-auto');
  let timer = null;
  let lastTabId = null;

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }
  function todayStr() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
  function shortMahkeme(s) {
    return String(s || '')
      .replace('Ağır Ceza Mahkemesi', 'ACM')
      .replace('Asliye Ceza Mahkemesi', 'Asliye Ceza')
      .replace('Asliye Hukuk Mahkemesi', 'Asliye Hukuk')
      .replace('Sulh Ceza Hakimliği', 'SCH')
      .replace('Sulh Hukuk Mahkemesi', 'Sulh Hukuk')
      .replace('İcra Hukuk Mahkemesi', 'İcra Hukuk')
      .replace(' Mahkemesi', '').replace(' Hakimliği', '').trim();
  }
  function minsOf(tarih) {
    const m = String(tarih || '').match(/(\d{1,2}):(\d{2})/) || [];
    return m.length ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function shortDurum(s) {
    const t = String(s || '').trim();
    if (/yapıldı/i.test(t)) return 'Yapıldı';
    if (/devam/i.test(t)) return 'Devam Ediyor';
    return t.slice(0, 24);
  }
  function fmtSaat(mins) {
    if (mins == null) return '??:??';
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }

  function itemEl(r, label, cls, sub) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sp-item' + (cls ? ' ' + cls : '');
    b.title = `${r.mahkeme} ${r.dosya} ${r.tarih} (sayfada göster)`;
    b.textContent = label;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sp-sub';
      s.textContent = sub;
      b.appendChild(s);
    }
    b.addEventListener('click', () => gotoRow(r));
    return b;
  }

  async function gotoRow(r) {
    try {
      if (!lastTabId) return;
      const m = String(r.tarih || '').match(/(\d{1,2}):(\d{2})/) || [];
      const saat = m.length ? (m[1].padStart(2, '0') + ':' + m[2]) : '';
      const resp = await chrome.tabs.sendMessage(lastTabId, { type: 'EDURUSMA_GOTO', dosya: r.dosya, saat });
      if (!resp || !resp.ok) setStatus('Satır sayfada bulunamadı (liste dışında olabilir).');
    } catch (_) {}
  }

  function render(rows) {
    todayBox.innerHTML = '';
    allBox.innerHTML = '';
    const t = todayStr();
    const todays = rows.filter(r => (r.tarih || '').indexOf(t) !== -1);
    const head = document.createElement('div');
    head.className = 'sp-dayhead';
    head.textContent = `Bugün (${todays.length}) · ${t}`;
    todayBox.appendChild(head);
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    if (!todays.length) {
      const e = document.createElement('div');
      e.className = 'sp-empty';
      e.textContent = rows.length ? 'Bugün duruşma yok' : 'Liste boş';
      todayBox.appendChild(e);
    } else {
      let nextIdx = -1;
      const mins = todays.map(r => minsOf(r.tarih));
      mins.forEach((m, i) => { if (m != null && m >= nowMin && nextIdx < 0) nextIdx = i; });
      const list = document.createElement('div');
      list.className = 'sp-list';
      todays.forEach((r, i) => {
        const cls = (i === nextIdx ? 'ed-next' : '') + (mins[i] != null && mins[i] < nowMin ? ' ed-past' : '');
        list.appendChild(itemEl(r, `${i === nextIdx ? '◉ ' : ''}${i + 1}) ${fmtSaat(mins[i])} · ${r.dosya}`, cls.trim(), `${shortMahkeme(r.mahkeme)} · ${shortDurum(r.aciklama)}`));
      });
      todayBox.appendChild(list);
    }
    if (rows.length) {
      const list = document.createElement('div');
      list.className = 'sp-list';
      rows.forEach((r) => {
        list.appendChild(itemEl(r, `${r.tarih} · ${r.dosya}`, '', `${shortMahkeme(r.mahkeme)} · ${shortDurum(r.aciklama)}`));
      });
      allBox.appendChild(list);
    }
  }

  function hint(msg) {
    todayBox.innerHTML = '';
    allBox.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'sp-empty';
    e.textContent = msg;
    todayBox.appendChild(e);
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
