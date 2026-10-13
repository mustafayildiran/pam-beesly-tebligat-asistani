// E-Duruşma Yardımcısı - sade gömülü takip penceresi
// /durusma-sorgulama içinde yüzen küçük panel + iframe (/durusma-takip).
// Sekme değişimi yok -> e-duruşma bağlantısı açık kalır. Sade görünüm hep açık.
(function () {
  'use strict';
  const ED_VER = '0.3.0';
  if (window.__EDURUSMA_V__ === ED_VER) return;
  window.__EDURUSMA_V__ = ED_VER;
  window.__EDURUSMA_LOADED__ = true;

  const TAKIP_URL = 'https://avukat.uyap.gov.tr/durusma-takip';
  const isSorgulama = () => /durusma-sorgu/i.test(location.href + ' ' + document.title);
  const LS_KEY = 'edurusma_panel_v5';

  const state = { w: 340, h: 420, top: null, bottom: 70, left: null, right: 14, autoMs: 30000, open: false, mini: false };
  let uiBuilt = false;

  async function loadState() {
    try {
      const r = await chrome.storage.local.get(LS_KEY);
      if (r && r[LS_KEY]) Object.assign(state, r[LS_KEY]);
    } catch (e) {}
    state.slim = true;
    // Pencere ekrandan büyük kalmasın (kaydırma hissini öldürür)
    state.w = Math.max(300, Math.min(window.innerWidth - 20, +state.w || 340));
    state.h = Math.max(280, Math.min(window.innerHeight - 20, +state.h || 420));
  }
  function saveState() {
    try { chrome.storage.local.set({ [LS_KEY]: { w: state.w, h: state.h, top: state.top, bottom: state.bottom, left: state.left, right: state.right, autoMs: state.autoMs, open: state.open, mini: state.mini } }); } catch (e) {}
  }
  try {
    chrome.storage.onChanged.addListener(ch => {
      if (ch[LS_KEY] && ch[LS_KEY].newValue && typeof ch[LS_KEY].newValue.autoMs === 'number') {
        state.autoMs = ch[LS_KEY].newValue.autoMs;
        const sel = document.getElementById('edurusma-auto');
        if (sel) sel.value = String(state.autoMs || 0);
        restartTimer();
      }
    });
  } catch (e) {}

  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'id') n.id = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (text != null) n.textContent = text;
    return n;
  }

  let panel, iframe, statusTxt, timer = null, fitTimer = null, openBtn, pendingScroll = null, bugunBar = null, bugunTimer = null, takipObserver = null, bugunDeb = null;

  function fmtTime(d) { return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function setStatus(msg) { if (statusTxt) statusTxt.textContent = msg; }
  function autoLabel() { return !state.autoMs ? 'kapalı' : (state.autoMs / 1000) + ' sn'; }

  function refreshIframe() {
    if (!iframe) return;
    // Kullanıcı listeyi incelerken yenileyip başa atma
    try { if (panel && panel.matches(':hover')) { setStatus('Otomatik yenileme atlandı (inceleniyor)'); return; } } catch (e) {}
    try {
      const w = iframe.contentWindow;
      if (w) { try { pendingScroll = { x: w.scrollX, y: w.scrollY }; } catch (e) {} w.location.reload(); }
      else iframe.src = TAKIP_URL;
    } catch (e) { iframe.src = TAKIP_URL; }
    setStatus('Yenilendi: ' + fmtTime(new Date()));
  }

  // İçerik iframe'den uzunsa: çerçeveyi içeriğe göre esnet, kaydırmayı panele al.
  // (Tekerlek her zaman paneli kaydırır; iframe içi sıkışmaz.)
  // NOT: ölçüm için iframe yüklenmesini bekle; liste geç gelirse autoGrow yakalar.
  function fitIframe() {
    if (!iframe || !state.open) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      const h = Math.max(
        doc.body.scrollHeight || 0,
        doc.documentElement.scrollHeight || 0,
        doc.body.offsetHeight || 0
      );
      const cur = iframe.clientHeight || 0;
      if (h > cur + 20) iframe.style.height = Math.min(h + 24, 5000) + 'px';
    } catch (e) {}
  }
  function unfitIframe() { if (iframe) iframe.style.height = ''; }

  function restartTimer() {
    if (timer) { clearInterval(timer); timer = null; }
    if (fitTimer) { clearInterval(fitTimer); fitTimer = null; }
    if (bugunTimer) { clearInterval(bugunTimer); bugunTimer = null; }
    if (state.open && !state.mini) {
      fitTimer = setInterval(fitIframe, 4000);
      bugunTimer = setInterval(updateBugun, 20000);
      if (state.autoMs > 0) timer = setInterval(refreshIframe, state.autoMs);
    } else {
      try { if (takipObserver) { takipObserver.disconnect(); takipObserver = null; } } catch (e) {}
    }
  }

  // Takip sayfası önce mahkeme seçim ekranı gösterir; Görüntüle'ye basılınca
  // liste AJAX ile gelir (iframe yeniden yüklenmez). Belgeyi izleyip
  // ızgara belirince/değişince şeridi güncelle.
  function scheduleBugun() {
    if (bugunDeb) clearTimeout(bugunDeb);
    bugunDeb = setTimeout(updateBugun, 800);
  }
  function watchTakipDoc() {
    try { if (takipObserver) { takipObserver.disconnect(); takipObserver = null; } } catch (e) {}
    let doc;
    try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (e) { return; }
    if (!doc || !doc.documentElement) return;
    try {
      takipObserver = new MutationObserver(scheduleBugun);
      takipObserver.observe(doc.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  // ---- Bugünkü duruşmalar şeridi ----
  // iframe ile aynı kaynaktan okunur: Duruşma Tarihi sütununda bugünün
  // tarihiyle başlayan satırlar saat + sıra numarasıyla listelenir.
  // Sıradaki (saati gelmemiş ilk) duruşma işaretlenir; tıklayınca
  // listede o satıra kaydırılır.
  function todayStrTR() {
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
  // Sayfadaki tüm ızgaraları topla (liste iç içe bir çerçevede de olabilir)
  function docGrids(doc, depth) {
    const out = [];
    try {
      doc.querySelectorAll('.dx-datagrid').forEach(g => out.push(g));
      if ((depth || 0) < 2) {
        doc.querySelectorAll('iframe').forEach(f => {
          try {
            const dd = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            if (dd) docGrids(dd, (depth || 0) + 1).forEach(g => out.push(g));
          } catch (e) {}
        });
      }
    } catch (e) {}
    return out;
  }
  function readTakipRows() {
    let doc;
    try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (e) { return { status: 'unknown', gridCount: 0 }; }
    if (!doc || !doc.querySelector) return { status: 'unknown', gridCount: 0 };
    // Sayfada birden fazla tablo olabilir (mahkeme seçim listesi ayrı ızgaradır):
    // "Duruşma Tarihi" başlığını taşıyan ızgarayı bul.
    const grids = docGrids(doc, 0);
    let grid = null, headers = [], iTarih = -1, iMah = -1, iDosya = -1;
    for (const g of grids) {
      const h = Array.from(g.querySelectorAll('.dx-header-row td')).map(td => (td.innerText || '').trim());
      const it = h.findIndex(x => /duruşma tarihi/i.test(x));
      if (it >= 0) {
        grid = g; headers = h; iTarih = it;
        iMah = h.findIndex(x => /^mahkeme/i.test(x));
        iDosya = h.findIndex(x => /dosya no/i.test(x));
        break;
      }
    }
    if (!grid) {
      // Henüz liste yok: mahkeme seçim ekranı mı?
      let txt = '';
      try { txt = (doc.body && doc.body.innerText) || ''; } catch (e) {}
      if (/görüntüle/i.test(txt) && /mahkeme/i.test(txt)) return { status: 'select', gridCount: grids.length };
      return { status: 'unknown', gridCount: grids.length };
    }
    const rows = [];
    grid.querySelectorAll('.dx-data-row').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim());
      if (!cells.some(c => c)) return; // boş ara satır
      rows.push({
        el: tr,
        tarih: iTarih >= 0 ? (cells[iTarih] || '') : '',
        mahkeme: iMah >= 0 ? (cells[iMah] || '') : '',
        dosya: iDosya >= 0 ? (cells[iDosya] || '') : ''
      });
    });
    return { status: 'grid', rows, gridCount: grids.length };
  }
  function updateBugun() {
    if (!bugunBar || !state.open || state.mini) return;
    bugunBar.innerHTML = '';
    let data = { status: 'unknown' };
    try { data = readTakipRows() || data; } catch (e) {}
    const t = todayStrTR();
    const head = el('div', { class: 'ed-bugun-head' }, `Bugün · ${t}`);
    try { head.title = `teşhis: ızgara=${data.gridCount || 0}, durum=${data.status}`; } catch (e) {}
    bugunBar.appendChild(head);
    if (data.status === 'select') {
      bugunBar.appendChild(el('div', { class: 'ed-bugun-empty' }, 'Önce listeden mahkemeyi seçip Görüntüle’ye basın'));
      return;
    }
    if (data.status !== 'grid') { bugunBar.appendChild(el('div', { class: 'ed-bugun-empty' }, 'Liste okunamadı')); return; }
    const rows = data.rows;
    // Tarih hücresi "13.10.2026 09:00" biçimindedir; günü kapsama ile eşleştir
    const todays = rows.filter(r => (r.tarih || '').indexOf(t) !== -1);
    if (!todays.length) {
      const info = el('div', { class: 'ed-bugun-empty' }, `Bugün duruşma yok · listede ${rows.length} satır`);
      info.title = rows.length ? ('İlk satır: ' + rows[0].tarih) : 'Satır okunamadı';
      bugunBar.appendChild(info);
      return;
    }
    head.textContent = `Bugün (${todays.length}) · ${t}`;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const minsOf = (r) => {
      const m = r.tarih.match(/(\d{1,2}):(\d{2})/) || [];
      return m.length ? (+m[1]) * 60 + (+m[2]) : null;
    };
    const mins = todays.map(minsOf);
    let nextIdx = -1;
    mins.forEach((m, i) => { if (m != null && m >= nowMin && nextIdx < 0) nextIdx = i; });
    const pad = (n) => String(n).padStart(2, '0');
    const list = el('div', { class: 'ed-bugun-list' });
    todays.forEach((r, i) => {
      const saat = mins[i] != null ? `${pad(Math.floor(mins[i] / 60))}:${pad(mins[i] % 60)}` : '??:??';
      const cls = 'ed-bugun-item' + (i === nextIdx ? ' ed-next' : '') + (mins[i] != null && mins[i] < nowMin ? ' ed-past' : '');
      const b = el('button', { type: 'button', class: cls, title: `${r.mahkeme} ${r.dosya} ${r.tarih} (listede göster)` },
        `${i === nextIdx ? '◉ ' : ''}${i + 1}) ${saat} · ${r.dosya} · ${shortMahkeme(r.mahkeme)}`);
      b.addEventListener('click', () => {
        try {
          r.el.scrollIntoView({ block: 'center' });
          r.el.style.outline = '2px solid #1a56db';
          setTimeout(() => { try { r.el.style.outline = ''; } catch (e) {} }, 2500);
        } catch (e) {}
      });
      list.appendChild(b);
    });
    bugunBar.appendChild(list);
  }

  // Sade görünüm + tam kaydırma: üst menüler gizlenir, iç kaydırma alanları
  // etkisizleştirilir; böylece liste tek parça uzar, kaydırma panelde olur.
  function applySlim() {
    if (!iframe) return;
    let doc;
    try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (e) { return; }
    if (!doc || !doc.body) return;
    try {
      let st = doc.getElementById('edurusma-slim-style');
      if (st) st.remove();
      st = doc.createElement('style');
      st.id = 'edurusma-slim-style';
      st.textContent = 'header,nav,.navbar,.topbar,app-header,app-topbar,app-sidebar,.sidebar,.layout-topbar,.layout-sidebar{display:none!important}'
        + 'body{margin:0!important}html,body{height:auto!important;min-height:0!important;overflow:visible!important}'
        + '.content,.layout-main{margin:0!important;padding:8px!important;height:auto!important;min-height:0!important;overflow:visible!important}'
        + '.dx-scrollable-container,.dx-scrollable-content{overflow:visible!important;height:auto!important;max-height:none!important}'
        + '.dx-datagrid-rowsview{max-height:none!important}'
        + 'html,body{scrollbar-width:none!important}::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}';
      doc.head.appendChild(st);
    } catch (e) {}
  }

  function applyGeom() {
    if (!panel) return;
    panel.style.width = state.w + 'px';
    panel.style.height = state.h + 'px';
    panel.style.bottom = '';
    if (state.top == null) {
      panel.style.top = Math.max(10, window.innerHeight - state.h - (state.bottom ?? 70)) + 'px';
    } else panel.style.top = state.top + 'px';
    if (state.left != null) { panel.style.left = state.left + 'px'; panel.style.right = 'auto'; }
    else { panel.style.right = (state.right ?? 14) + 'px'; panel.style.left = 'auto'; }
    refreshSizeBtns();
  }

  function setMini(on) {
    state.mini = !!on;
    if (panel) panel.classList.toggle('ed-mini', state.mini);
    saveState(); restartTimer();
  }

  function refreshSizeBtns() {
    if (!panel) return;
    const btns = panel.querySelectorAll('.ed-sizes button');
    const sizes = [[340, 420], [360, 440], [440, 560]];
    btns.forEach((b, i) => b.classList.toggle('ed-active', state.w === sizes[i][0] && state.h === sizes[i][1]));
  }

  function toggle(force) {
    state.open = force != null ? force : panel.classList.contains('ed-hidden');
    panel.classList.toggle('ed-hidden', !state.open);
    saveState(); restartTimer();
    if (state.open) { setTimeout(fitIframe, 500); setTimeout(fitIframe, 2000); setTimeout(updateBugun, 800); }
  }

  function buildPanel() {
    panel = el('div', { id: 'edurusma-takip-panel' });
    panel.classList.add('ed-hidden');

    const header = el('div', { id: 'edurusma-takip-header' });
    const title = el('span', { class: 'ed-title' }, 'Duruşma Takip');
    title.title = 'Sürükleyerek taşı (çift tık: küçült/büyüt)';
    const sel = el('select', { id: 'edurusma-auto', title: 'Otomatik yenileme' });
    [['0', 'Oto: kapalı'], ['15000', 'Oto: 15 sn'], ['30000', 'Oto: 30 sn'], ['60000', 'Oto: 60 sn'], ['120000', 'Oto: 2 dk']].forEach(([v, t]) => sel.appendChild(el('option', { value: v }, t)));
    sel.value = String(state.autoMs || 0);
    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('change', () => { state.autoMs = parseInt(sel.value, 10) || 0; saveState(); restartTimer(); setStatus('Otomatik: ' + autoLabel()); });

    const btnRefresh = el('button', { type: 'button', title: 'Şimdi yenile' }, 'Yenile');
    btnRefresh.addEventListener('click', e => { e.stopPropagation(); refreshIframe(); });
    const btnMin = el('button', { type: 'button', title: 'Küçült / büyüt' }, '—');
    btnMin.addEventListener('click', e => { e.stopPropagation(); setMini(!state.mini); });
    const btnClose = el('button', { type: 'button', title: 'Kapat' }, '✕');
    btnClose.addEventListener('click', e => { e.stopPropagation(); toggle(false); });

    header.append(title, sel, btnRefresh, btnMin, btnClose);
    header.addEventListener('dblclick', e => { if (e.target === header || e.target === title) setMini(!state.mini); });
    panel.appendChild(header);

    const body = el('div', { id: 'edurusma-takip-body' });
    bugunBar = el('div', { id: 'edurusma-bugun' });
    body.appendChild(bugunBar);
    iframe = el('iframe', { src: TAKIP_URL, title: 'Duruşma Takip' });
    iframe.setAttribute('scrolling', 'yes');
    iframe.addEventListener('load', () => {
      setStatus('Yüklendi: ' + fmtTime(new Date()));
      applySlim();
      unfitIframe();
      fitIframe();
      watchTakipDoc();
      setTimeout(fitIframe, 1500);
      setTimeout(fitIframe, 3500);
      setTimeout(updateBugun, 1500);
      setTimeout(updateBugun, 3500);
      if (pendingScroll) {
        const p = pendingScroll; pendingScroll = null;
        try { iframe.contentWindow.scrollTo(p.x, p.y); } catch (e) {}
      }
    });
    body.appendChild(iframe);
    const grip = el('div', { id: 'edurusma-takip-resize', title: 'Sürükleyerek boyutlandır' });
    body.appendChild(grip);

    const status = el('div', { id: 'edurusma-takip-status' });
    statusTxt = el('span', {}, 'Hazır');
    const sizes = el('span', { class: 'ed-sizes' });
    [['S', 340, 420], ['M', 360, 440], ['L', 440, 560]].forEach(([label, w, h]) => {
      const b = el('button', { type: 'button', title: label === 'S' ? 'Küçük' : label === 'M' ? 'Orta' : 'Büyük' }, label);
      b.addEventListener('click', ev => { ev.stopPropagation(); state.w = w; state.h = h; setMini(false); applyGeom(); saveState(); });
      sizes.appendChild(b);
    });
    status.append(statusTxt, sizes);
    panel.append(body, status);
    (document.body || document.documentElement).appendChild(panel);
    applyGeom();
    setMini(!!state.mini);
    makeDraggable(header);
    makeResizable(grip);
  }

  function makeDraggable(handle) {
    let sx, sy, st, sl, sr, useLeft, dragging = false;
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'OPTION') return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect();
      st = r.top; sl = r.left; sr = window.innerWidth - r.right;
      useLeft = state.left != null;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      state.top = Math.max(0, Math.min(window.innerHeight - 60, st + e.clientY - sy));
      const nx = sl + e.clientX - sx;
      if (useLeft) state.left = Math.max(0, Math.min(window.innerWidth - 80, nx));
      else state.right = Math.max(0, Math.min(window.innerWidth - 80, sr - (e.clientX - sx)));
      applyGeom();
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; saveState(); } });
  }

  function makeResizable(grip) {
    let sx, sy, sw, sh, resizing = false;
    grip.addEventListener('mousedown', e => {
      resizing = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect(); sw = r.width; sh = r.height;
      e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', e => {
      if (!resizing) return;
      state.w = Math.max(300, Math.min(window.innerWidth - 20, sw + e.clientX - sx));
      state.h = Math.max(280, Math.min(window.innerHeight - 20, sh + e.clientY - sy));
      applyGeom();
    });
    window.addEventListener('mouseup', () => { if (resizing) { resizing = false; saveState(); } });
  }

  function buildBtn() {
    openBtn = el('button', { id: 'edurusma-open-btn', type: 'button', title: 'Duruşma Takip penceresini aç/kapat' }, '◎ Takip');
    openBtn.addEventListener('click', () => toggle());
    (document.body || document.documentElement).appendChild(openBtn);
  }

  function ensureUI() {
    if (!isSorgulama()) {
      if (uiBuilt && panel && openBtn) {
        panel.classList.add('ed-hidden');
        openBtn.style.display = 'none';
        if (timer) { clearInterval(timer); timer = null; }
      }
      return;
    }
    if (!uiBuilt) {
      if (!document.body && !document.documentElement) return;
      uiBuilt = true;
      buildPanel();
      buildBtn();
      if (state.open) toggle(true);
    } else if (panel && openBtn) {
      openBtn.style.display = '';
      if (state.open) { panel.classList.remove('ed-hidden'); restartTimer(); }
    }
  }

  function startRouteWatcher() {
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) { last = location.href; ensureUI(); }
      else if (!uiBuilt) ensureUI();
    }, 800);
    window.addEventListener('hashchange', ensureUI);
    window.addEventListener('popstate', () => setTimeout(ensureUI, 300));
    try {
      const ps = history.pushState, rs = history.replaceState;
      history.pushState = function () { const r = ps.apply(this, arguments); setTimeout(ensureUI, 300); return r; };
      history.replaceState = function () { const r = rs.apply(this, arguments); setTimeout(ensureUI, 300); return r; };
    } catch (e) {}
  }

  // ---- DevExtreme grid okuyucu (sonraki adım: satır + e-duruşma durumu) ----
  function scrapeSorgulama() {
    const grids = Array.from(document.querySelectorAll('.dx-datagrid'));
    return grids.slice(0, 3).map(g => {
      const headers = Array.from(g.querySelectorAll('.dx-header-row td')).map(td => (td.innerText || '').trim());
      const rows = Array.from(g.querySelectorAll('.dx-data-row')).map(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim());
        const txt = (tr.innerText || '');
        let eDurusma = '';
        if (/katıl/i.test(txt)) eDurusma = 'katil-butonu-var';
        else if (/kabul/i.test(txt)) eDurusma = 'kabul';
        else if (/talep gönder/i.test(txt)) eDurusma = 'talep-gonder';
        return { cells, eDurusma };
      });
      return { headers, count: rows.length, rows: rows.slice(0, 200) };
    });
  }
  window.__EDURUSMA_SCRAPE__ = scrapeSorgulama;
  window.__EDURUSMA__ = { version: ED_VER, state, scrape: scrapeSorgulama, open: () => ensureUI() };

  (async function init() {
    await loadState();
    console.info('[EDurusma] init', location.href);
    startRouteWatcher();
    ensureUI();
    window.addEventListener('load', ensureUI);
    setTimeout(ensureUI, 2500);
  })();
})();
