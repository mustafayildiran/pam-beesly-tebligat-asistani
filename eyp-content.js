/* UYAP EYP Görüntüleyici - content script (avukat.uyap.gov.tr)
 * v1.0.1: UYAP doğrudan <a href=".eyp"> vermez (JSF/PrimeFaces arka plan istekleri kullanır).
 * Bu yüzden ağ seviyesinde yakalama yapılır: fetch + XHR + blob URL'leri izlenir,
 * ZIP imzalı (PK..) yanıtlar önbelleğe alınır, "Görüntüle" bunları açar.
 */
(function () {
  'use strict';
  if (window.__eypViewerLoaded) return;
  window.__eypViewerLoaded = true;

  const state = { stack: [], lastAttempt: null, pendingCapture: null };
  const objectUrls = [];
  const netCache = []; // {url, fileName, buffer, time, source}
  const MAX_CACHE = 10;

  function toast(msg, ms) {
    let el = document.getElementById('eyp-toast-live');
    if (!el) {
      el = document.createElement('div');
      el.id = 'eyp-toast-live';
      el.className = 'eyp-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.display = 'none'; }, ms || 3500);
  }

  function trackUrl(url, fileName) {
    if (!url) return;
    if (/\.eyp(\?|#|$)/i.test(url) || /\.eyp$/i.test(fileName || '')) {
      state.lastAttempt = { url, fileName: fileName || 'belge.eyp' };
    }
  }

  function cacheBlob(url, fileName, buffer, source) {
    if (!buffer || buffer.byteLength < 4) return false;
    const b = new Uint8Array(buffer.slice(0, 4));
    const isZip = b[0] === 0x50 && b[1] === 0x4b;
    if (!isZip) return false;
    const looksEyp = /\.eyp/i.test(url || '') || /\.eyp/i.test(fileName || '') ||
      /(eyp|evrak|uyap|belge|download|preview|show|open|get)/i.test(url || '');
    netCache.push({ url, fileName: fileName || guessName(url), buffer: buffer.slice(0), time: Date.now(), source });
    while (netCache.length > MAX_CACHE) netCache.shift();
    console.log('[EYP] ağdan ZIP yakalandı:', fileName, (buffer.byteLength / 1024).toFixed(0) + 'KB', source);
    // Bekleyen bir "Görüntüle" tıklaması varsa otomatik aç
    if (state.pendingCapture) {
      const want = state.pendingCapture;
      const ageOk = true;
      if (ageOk && (looksEyp || (Date.now() - want.at) < 20000)) {
        const p = state.pendingCapture;
        state.pendingCapture = null;
        toast('Dosya yakalandı, açılıyor: ' + (fileName || ''), 2000);
        openBuffer(buffer, fileName || p.fileName || 'belge.eyp');
        return true;
      }
    }
    return looksEyp;
  }

  function guessName(url) {
    try {
      const u = String(url || '').split('?')[0].split('/').pop() || '';
      if (u) return decodeURIComponent(u);
    } catch (e) {}
    return 'belge.eyp';
  }

  function fileNameFromDisposition(cd) {
    if (!cd) return '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i);
    return m ? decodeURIComponent(m[1].trim()) : '';
  }

  /* ---------- ağ kancaları ----------
   * Sayfa isteklerini content script göremez (izole dünya). Asıl yakalama
   * inject.js'te (world: MAIN) yapılır; bulduğu ZIP baytlarını buraya
   * postMessage ile gönderir. Ayrıca indirme başlarsa background iptal edip
   * URL/POST gövdesini verir, biz aynı isteği fetch ile tekrarlarız.
   * Hiçbir akışta kullanıcıya dosya indirtmeyiz. */

  function listenPageWorld() {
    if (window.__eypMsgHooked) return;
    window.__eypMsgHooked = true;
    window.addEventListener('message', function (ev) {
      const d = ev.data;
      if (!d || d.source !== '__eyp_inject') return;
      if (d.kind === 'EYP_PONG') { window.__eypPageHook = true; return; }
      if (d.kind !== 'EYP_BLOB') return;
      cacheBlob(d.url, d.fileName, d.buffer, d.origin || 'page');
    });
    // Sayfa kancası (inject.js, world:MAIN) yoksa yakalama imkânsızdır:
    // kullanıcı eski sürümde kalmış demektir, açıkça uyar.
    setTimeout(function () {
      if (!window.__eypPageHook) {
        console.warn('[EYP] sayfa kancası bulunamadı — uzantı güncel değil olabilir');
        toastAction('Eklenti güncel değil gibi görünüyor: chrome://extensions → ↻ → sekmeyi yenileyin.', 'Tamam', 15000);
      }
    }, 2500);
    try { window.postMessage({ source: '__eyp_content', kind: 'EYP_PING' }, '*'); } catch (e) {}
  }

  function armBackground(fileName) {
    try {
      chrome.runtime.sendMessage({ type: 'EYP_ARM', fileName: fileName || 'belge.eyp' }, function () {});
    } catch (e) {}
  }

  // Tanı günlüğü: son 20 ağ denemesi (F12 Console'da __eypDebug() ile görülür)
  const attemptLog = [];
  function elog(label, url, method, status, bytes, magic) {
    const row = { at: new Date().toISOString(), label, method: method || 'GET', status, bytes: bytes || 0, zip: !!magic, url: String(url || '').slice(0, 300) };
    attemptLog.push(row);
    while (attemptLog.length > 20) attemptLog.shift();
    console.log('[EYP]', label, method || 'GET', row.status, (row.bytes / 1024).toFixed(0) + 'KB', 'zip:' + row.zip, row.url);
    return row;
  }

  async function fetchBuf(label, url, opts) {
    const method = (opts && opts.method) || 'GET';
    const r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    const b = await r.arrayBuffer();
    const magic = window.EypParser ? EypParser.isZipMagic(b) : false;
    elog(label, url, method, r.status, b.byteLength, magic);
    if (!r.ok) throw new Error(label + ': HTTP ' + r.status + ' ← ' + String(url).slice(0, 160));
    return { status: r.status, buffer: b, isZip: magic, contentType: r.headers.get('content-type') || '' };
  }

  // Background'un iptal ettiği indirmenin tekrarı: aynı URL/POST'u fetch ile al
  async function replayDownload(info) {
    const name = info.filename || (info.post && guessName(info.post.url)) || armedName() || 'belge.eyp';
    const post = info.post;
    if (post && /^post$/i.test(post.method || '')) {
      if (post.formData) {
        // Önce urlencoded dene (JSF standardı), ZIP gelmezse multipart dene
        const usp = new URLSearchParams();
        Object.keys(post.formData).forEach(function (k) {
          post.formData[k].forEach(function (v) { usp.append(k, v); });
        });
        try {
          const r = await fetchBuf('replay-urlencoded', post.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: usp.toString()
          });
          if (r.isZip) {
            await openBuffer(r.buffer, name);
            return true;
          }
          console.warn('[EYP] urlencoded yanıt ZIP değil (' + r.contentType + '), multipart deneniyor');
        } catch (e) { console.warn('[EYP] urlencoded başarısız:', e.message); }
        const fd = new FormData();
        Object.keys(post.formData).forEach(function (k) {
          post.formData[k].forEach(function (v) { fd.append(k, v); });
        });
        const r2 = await fetchBuf('replay-multipart', post.url, { method: 'POST', body: fd });
        // ZIP değilse bile aç: ham PDF / düz metin olabilir, görüntüleyici karar verir
        await openBuffer(r2.buffer, name);
        return true;
      }
      if (post.raw && post.raw.length && post.raw[0].bytes) {
        const bytes = new Uint8Array(post.raw[0].bytes);
        const headers = post.contentType ? { 'Content-Type': post.contentType } : {};
        const r = await fetchBuf('replay-raw', post.url, { method: 'POST', headers: headers, body: bytes });
        await openBuffer(r.buffer, name);
        return true;
      }
      // POST olduğu biliniyor ama gövde yakalanamadı: kör GET atıp 404 üretme.
      throw new Error('POST gövdesi yakalanamadı, GET denenmedi ← ' + String(post.url).slice(0, 160));
    }
    const r = await fetchBuf('replay-get', info.url, {});
    await openBuffer(r.buffer, name);
    return true;
  }

  // Bilinen POST uç noktasına kör GET atıp 404 üretme: gövde yoksa dur.
  // (Bu kontrol replayDownload içinde post dalında yapılır; buraya sadece
  // gerçekten GET olan akışlar düşer.)

  function armedName() {
    return state.pendingCapture ? state.pendingCapture.fileName : 'belge.eyp';
  }

  function listenBackground() {
    if (window.__eypBgHooked) return;
    window.__eypBgHooked = true;
    try {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'EYP_CAPTURED_DL') {
          state.pendingCapture = null;
          toast('Dosya yakalandı, açılıyor…', 2000);
          replayDownload(msg).catch(function (e) {
            console.warn(e);
            toastAction('Açılamadı: ' + e.message, 'Tanıyı kopyala', 12000);
          });
        }
      });
    } catch (e) {}
  }

  function diagText() {
    try {
      const head = '[EYP tanı] sayfaKancasi=' + (!!window.__eypPageHook) +
        ' bekleyen=' + (state.pendingCapture ? state.pendingCapture.fileName : 'yok') +
        ' yakalanan=' + netCache.length;
      const rows = attemptLog.map(function (r) {
        return r.at + ' | ' + r.label + ' | ' + r.method + ' ' + r.status + ' | ' + r.bytes + 'B zip:' + r.zip + '\n' + r.url;
      });
      return head + '\n' + (rows.length ? rows.join('\n') : '(henüz ağ denemesi yok)');
    } catch (e) { return '[EYP tanı alınamadı]'; }
  }

  // Hata mesajı + tek tıkla tanı kopyalama düğmesi
  function toastAction(msg, btnLabel, ms) {
    const old = document.getElementById('eyp-toast-live');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'eyp-toast-live';
    box.className = 'eyp-toast';
    box.style.display = 'block';
    const span = document.createElement('span');
    span.textContent = msg + ' ';
    const btn = document.createElement('button');
    btn.textContent = btnLabel;
    btn.style.cssText = 'background:#fff;color:#111827;border:0;border-radius:6px;padding:4px 10px;margin-left:8px;cursor:pointer;font-weight:700;';
    btn.onclick = function () {
      const txt = diagText();
      function done(ok) { btn.textContent = ok ? 'Kopyalandı ✓' : 'Kopyalanamadı'; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta); ta.select();
        try { done(document.execCommand('copy')); } catch (e) { done(false); }
        ta.remove();
      }
    };
    box.appendChild(span); box.appendChild(btn);
    document.documentElement.appendChild(box);
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { box.remove(); }, ms || 12000);
  }

  function latestCachedEyp(maxAgeMs) {
    const now = Date.now();
    for (let i = netCache.length - 1; i >= 0; i--) {
      if (now - netCache[i].time <= (maxAgeMs || 60000)) return netCache[i];
    }
    return null;
  }

  // UYAP tıklama sonrası gerçekte ne istedi? Kaynak zaman çizelgesinden oku.
  // (fetch/XHR kancasına takılmayan iframe/PDF önizlemeleri burada görünür.)
  function resourceUrls() {
    try { return performance.getEntriesByType('resource').map(function (r) { return r.name; }); }
    catch (e) { return []; }
  }
  function isStaticAsset(u) {
    return /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|#|$)/i.test(u) ||
      /^data:/i.test(u) || /chrome-extension:/i.test(u) || /fonts\.g(oogleapis|static)\./i.test(u);
  }
  function isDocish(u) {
    return /eyp|evrak|belge|dosya|download|preview|document|show|stream|view|icerik|rapor|karar|tutanak|teblig|files?|attachment/i.test(u);
  }
  function loggedUrl(u) {
    return attemptLog.some(function (r) { return r.url === String(u).slice(0, 300); });
  }
  // Metin mi ikili mi? (UYAP .eyp adıyla düz metin de sunabiliyor)
  function looksLikeText(buffer) {
    if (!buffer || buffer.byteLength < 16) return false;
    try {
      const b = new Uint8Array(buffer.slice(0, 4096));
      let bad = 0;
      for (let i = 0; i < b.length; i++) {
        const c = b[i];
        if (c === 0 || (c < 9) || (c > 13 && c < 32) || c === 127) bad++;
      }
      return bad / b.length < 0.02;
    } catch (e) { return false; }
  }

  /* ---------- overlay / önizleme (değişmedi) ---------- */

  function ensureOverlay() {
    let ov = document.getElementById('eyp-viewer-overlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'eyp-viewer-overlay';
    ov.hidden = true;
    ov.innerHTML =
      '<div class="eyp-modal" role="dialog" aria-label="EYP Görüntüleyici">' +
        '<div class="eyp-header">' +
          '<span class="eyp-badge">EYP</span>' +
          '<span class="eyp-title" id="eyp-title">EYP Görüntüleyici</span>' +
          '<button class="eyp-btn-light" id="eyp-back" hidden>← Geri</button>' +
          '<button class="eyp-btn-light" id="eyp-download">İndir</button>' +
          '<button class="eyp-btn-close" id="eyp-close">Kapat ✕</button>' +
        '</div>' +
        '<div class="eyp-meta-bar" id="eyp-meta"></div>' +
        '<div class="eyp-body">' +
          '<div class="eyp-sidebar" id="eyp-list"></div>' +
          '<div class="eyp-main">' +
            '<div class="eyp-preview-bar" id="eyp-preview-bar"></div>' +
            '<div class="eyp-preview" id="eyp-preview"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.documentElement.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) hideOverlay(); });
    document.getElementById('eyp-close').addEventListener('click', hideOverlay);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideOverlay(); });
    document.getElementById('eyp-back').addEventListener('click', () => {
      if (state.stack.length > 1) { state.stack.pop(); renderTop(); }
    });
    document.getElementById('eyp-download').addEventListener('click', () => {
      const top = state.stack[state.stack.length - 1];
      if (top && top.buffer) downloadBlob(top.buffer, top.fileName);
    });
    return ov;
  }

  function hideOverlay() {
    const ov = document.getElementById('eyp-viewer-overlay');
    if (ov) ov.hidden = true;
  }
  function showOverlay() {
    ensureOverlay().hidden = false;
  }

  function downloadBlob(buffer, fileName) {    const type = window.EypParser ? EypParser.mimeForExt((fileName || '').split('.').pop()) : 'application/octet-stream';
    const blob = buffer instanceof Blob ? buffer : new Blob([buffer], { type: type });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'belge';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function looksLikePdf(buffer) {
    if (!buffer || buffer.byteLength < 5) return false;
    try {
      const h = new Uint8Array(buffer.slice(0, 5));
      return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2D; // %PDF-
    } catch (e) { return false; }
  }

  function previewFile(file, barEl, previewEl) {
    barEl.innerHTML = '';
    previewEl.innerHTML = '';
    const nameEl = document.createElement('span');
    nameEl.style.fontWeight = '600';
    nameEl.textContent = file.name + ' (' + (window.EypParser ? EypParser.formatSize(file.size || (file.buffer && file.buffer.byteLength)) : '') + ')';
    barEl.appendChild(nameEl);
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    barEl.appendChild(spacer);

    const ext = (file.ext || '').toLowerCase();

    if (ext === 'eyp' && file.buffer && window.EypParser && EypParser.isZipMagic(file.buffer)) {
      const btn = document.createElement('button');
      btn.className = 'eyp-btn-light';
      btn.style.border = '1px solid #cbd5e1';
      btn.textContent = '📦 İçini aç';
      btn.onclick = async () => {
        try {
          const parsed = await EypParser.parsePackage(file.buffer, file.name);
          state.stack.push({ parsed, buffer: file.buffer, fileName: file.name });
          renderTop();
        } catch (e) { toast('İç EYP açılamadı: ' + e.message); }
      };
      barEl.appendChild(btn);
    }

    const dl = document.createElement('button');
    dl.className = 'eyp-btn-light';
    dl.style.border = '1px solid #cbd5e1';
    dl.textContent = '⬇ İndir';
    dl.onclick = () => downloadBlob(file.buffer, file.name);
    barEl.appendChild(dl);

    if (!file.buffer) {
      previewEl.innerHTML = '<div class="eyp-empty">Önizleme yok</div>';
      return;
    }
    const blob = new Blob([file.buffer], { type: window.EypParser ? EypParser.mimeForExt(ext) : 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);

    if (ext === 'pdf') {
      const f = document.createElement('iframe');
      f.src = url;
      previewEl.appendChild(f);
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
      const img = document.createElement('img');
      img.src = url;
      img.style.objectFit = 'contain';
      img.style.background = '#fff';
      previewEl.appendChild(img);
    } else if (['tif', 'tiff'].includes(ext)) {
      previewEl.innerHTML = '<div class="eyp-empty">TIFF dosyaları tarayıcıda doğrudan gösterilemiyor.<br>İndirip görüntüleyin.<br><br></div>';
      const b = document.createElement('button');
      b.textContent = 'Dosyayı indir';
      b.className = 'eyp-btn-light';
      b.onclick = () => downloadBlob(file.buffer, file.name);
      previewEl.firstChild.appendChild(b);
    } else if (['xml', 'html', 'htm', 'txt', 'rels', 'imz'].includes(ext) || file.name === '[Content_Types].xml') {
      const fr = new FileReader();
      fr.onload = () => {
        const pre = document.createElement('pre');
        pre.textContent = String(fr.result).slice(0, 200000);
        previewEl.appendChild(pre);
      };
      fr.readAsText(blob);
    } else if (ext === 'udf' && EypParser.isZipMagic(file.buffer)) {
      previewEl.innerHTML = '<div class="eyp-empty">UDF paketi — listeden content.xml önizlenebilir.<br>“İndir” ile orijinali saklayabilirsiniz.</div>';
    } else if (file.buffer && looksLikePdf(file.buffer)) {
      // UYAP bazen .eyp adıyla ham PDF sunar: uzantıya değil içeriğe bak
      const pdfUrl = URL.createObjectURL(new Blob([file.buffer], { type: 'application/pdf' }));
      objectUrls.push(pdfUrl);
      const f = document.createElement('iframe');
      f.src = pdfUrl;
      previewEl.appendChild(f);
    } else if (file.buffer && looksLikeText(file.buffer)) {
      // .eyp adıyla gelen düz metin (örn. gönderi bildirimi): metin olarak göster
      barEl.appendChild(document.createTextNode(' · metin görünümü'));
      const pre = document.createElement('pre');
      try {
        pre.textContent = new TextDecoder('utf-8').decode(file.buffer.slice(0, 500000)).slice(0, 200000);
      } catch (e) { pre.textContent = '(metin çözülemedi)'; }
      previewEl.appendChild(pre);
    } else {
      previewEl.innerHTML = '<div class="eyp-empty">Bu tür (' + (ext || '?').toUpperCase() + ') tarayıcıda önizlenemiyor.<br><br></div>';
      const b = document.createElement('button');
      b.textContent = 'Dosyayı indir (' + file.name + ')';
      b.className = 'eyp-btn-light';
      b.onclick = () => downloadBlob(file.buffer, file.name);
      previewEl.firstChild.appendChild(b);
    }
  }

  function sidebarEntry(label, files, activeFile, onPick, nested) {
    const box = document.getElementById('eyp-list');
    if (!files || !files.length) return;
    const h = document.createElement('h4');
    h.textContent = label;
    box.appendChild(h);
    files.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'eyp-file' + (activeFile === f ? ' active' : '');
      const ext = document.createElement('span');
      ext.className = 'eyp-ext' + (nested ? ' eyp-nested' : '');
      ext.textContent = (f.ext || '?').toUpperCase().slice(0, 4);
      const nm = document.createElement('span');
      nm.className = 'eyp-fname';
      nm.textContent = f.name || f.path;
      nm.title = f.path || f.name;
      const sz = document.createElement('span');
      sz.className = 'eyp-fsize';
      sz.textContent = window.EypParser ? EypParser.formatSize(f.size || (f.buffer && f.buffer.byteLength)) : '';
      btn.appendChild(ext); btn.appendChild(nm); btn.appendChild(sz);
      btn.onclick = () => onPick(f, btn);
      box.appendChild(btn);
    });
  }

  function renderTop() {
    const top = state.stack[state.stack.length - 1];
    if (!top) return;
    showOverlay();
    document.getElementById('eyp-back').hidden = state.stack.length <= 1;
    try {
      renderParsed(top.parsed, top.fileName);
    } catch (e) {
      console.error('[EYP] render hatası', e);
      state.stack.pop();
      hideOverlay();
      toastAction('Görüntü oluşturulamadı: ' + e.message, 'Tanıyı kopyala', 12000);
    }
  }

  function renderParsed(parsed, fileName) {
    const title = document.getElementById('eyp-title');
    const meta = document.getElementById('eyp-meta');
    const list = document.getElementById('eyp-list');
    const bar = document.getElementById('eyp-preview-bar');
    const prev = document.getElementById('eyp-preview');
    list.innerHTML = ''; bar.innerHTML = ''; prev.innerHTML = '';
    meta.innerHTML = '';
    title.textContent = (parsed.konu ? parsed.konu + ' — ' : '') + (fileName || '');

    function metaItem(k, v) {
      if (!v) return;
      const s = document.createElement('span');
      s.innerHTML = '<b>' + k + ':</b> ';
      s.appendChild(document.createTextNode(String(v)));
      meta.appendChild(s);
    }

    if (parsed.kind === 'eyp') {
      metaItem('Konu', parsed.konu);
      metaItem('Sürüm', parsed.version);
      if (parsed.ustveri) {
        metaItem('Gönderen', parsed.ustveri.olusturanAdi);
        metaItem('Belge No', parsed.ustveri.belgeNo);
        metaItem('Tarih', parsed.ustveri.tarih);
      }
      metaItem('Üst yazı', parsed.ustYazi ? parsed.ustYazi.name : 'yok');
      metaItem('Ek sayısı', parsed.ekler ? parsed.ekler.length : 0);
      const all = [];
      if (parsed.ustYazi) all.push(parsed.ustYazi);
      (parsed.ustYaziFiles || []).filter(f => f !== parsed.ustYazi).forEach(f => all.push(f));
      if (all.length) {
        const h = document.createElement('h4'); h.textContent = 'Üst yazı'; list.appendChild(h);
        all.forEach((f) => {
          const btn = document.createElement('button');
          btn.className = 'eyp-file' + (f === parsed.ustYazi ? ' active' : '');
          const ext = document.createElement('span'); ext.className = 'eyp-ext'; ext.textContent = (f.ext || '?').toUpperCase();
          const nm = document.createElement('span'); nm.className = 'eyp-fname'; nm.textContent = f.name; nm.title = f.path;
          const sz = document.createElement('span'); sz.className = 'eyp-fsize'; sz.textContent = EypParser.formatSize(f.size);
          btn.appendChild(ext); btn.appendChild(nm); btn.appendChild(sz);
          btn.onclick = () => { list.querySelectorAll('.eyp-file').forEach(b => b.classList.remove('active')); btn.classList.add('active'); previewFile(f, bar, prev); };
          list.appendChild(btn);
        });
      }
      sidebarEntry('Ekler', parsed.ekler, null, (f, btn) => {
        list.querySelectorAll('.eyp-file').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        previewFile(f, bar, prev);
      }, true);
      if (parsed.ustYazi) previewFile(parsed.ustYazi, bar, prev);
      else if (parsed.ekler && parsed.ekler[0]) previewFile(parsed.ekler[0], bar, prev);
      else prev.innerHTML = '<div class="eyp-empty">Görüntülenecek üst yazı bulunamadı.</div>';
    } else if (parsed.kind === 'uyap-evrak') {
      metaItem('Tür', 'UYAP evrak paketi');
      metaItem('Dosya', fileName);
      if (parsed.anaEvrak) {
        const h = document.createElement('h4'); h.textContent = 'Ana evrak'; list.appendChild(h);
        const f = parsed.anaEvrak;
        const btn = document.createElement('button');
        btn.className = 'eyp-file active';
        btn.innerHTML = '<span class="eyp-ext">PDF</span>';
        const nm = document.createElement('span'); nm.className = 'eyp-fname'; nm.textContent = f.name; nm.title = f.path;
        btn.appendChild(nm);
        btn.onclick = () => previewFile(f, bar, prev);
        list.appendChild(btn);
      }
      sidebarEntry('Ekler (içinde .eyp olabilir)', parsed.ekler, null, (f, btn) => {
        list.querySelectorAll('.eyp-file').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        previewFile(f, bar, prev);
      }, true);
      if (parsed.anaEvrak) previewFile(parsed.anaEvrak, bar, prev);
    } else if (parsed.kind === 'udf') {
      metaItem('Tür', 'UDF (UYAP doküman)');
      const h = document.createElement('h4'); h.textContent = 'İçerik'; list.appendChild(h);
      const files = (parsed.files || []).slice().sort((a, b) => (a.name === 'content.xml' ? -1 : 0));
      files.forEach((f) => {
        const btn = document.createElement('button');
        btn.className = 'eyp-file';
        btn.innerHTML = '<span class="eyp-ext">' + (f.ext || '?').toUpperCase() + '</span>';
        const nm = document.createElement('span'); nm.className = 'eyp-fname'; nm.textContent = f.name;
        btn.appendChild(nm);
        btn.onclick = () => {
          list.querySelectorAll('.eyp-file').forEach(b => b.classList.remove('active')); btn.classList.add('active');
          if (f.name === 'content.xml') {
            bar.innerHTML = '<span><b>content.xml</b> (UDF metni)</span>';
            prev.innerHTML = '';
            const pre = document.createElement('pre');
            pre.textContent = new TextDecoder('utf-8').decode(f.buffer.slice(0, 500000)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 50000);
            prev.appendChild(pre);
          } else previewFile(f, bar, prev);
        };
        list.appendChild(btn);
      });
      prev.innerHTML = '<div class="eyp-empty">Soldan content.xml seçerek metni önizleyin.</div>';
    } else if (parsed.kind === 'zip') {
      metaItem('Tür', 'ZIP arşivi');
      sidebarEntry('Dosyalar', parsed.files, null, (f, btn) => {
        list.querySelectorAll('.eyp-file').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        previewFile(f, bar, prev);
      });
      prev.innerHTML = '<div class="eyp-empty">Soldan bir dosya seçin.</div>';
    } else {
      metaItem('Not', parsed.message || '');
      prev.innerHTML = '';
      previewFile({ name: parsed.fileName, ext: parsed.ext, buffer: parsed.buffer, size: parsed.buffer.byteLength }, bar, prev);
    }
  }

  async function openBuffer(buffer, fileName) {
    if (!window.EypParser) { toast('Parser yüklenemedi (eyp-parser.js).'); return; }
    try {
      const parsed = await EypParser.parsePackage(buffer, fileName);
      elog('parse-ok:' + parsed.kind, fileName, 'ZIP', 200, buffer.byteLength, true);
      state.stack.push({ parsed, buffer, fileName });
      if (state.stack.length > 8) state.stack.shift();
      renderTop();
    } catch (e) {
      elog('parse-fail', fileName, 'ZIP', 0, buffer ? buffer.byteLength : 0, false);
      console.error(e);
      toastAction('Dosya açılamadı: ' + e.message, 'Tanıyı kopyala', 12000);
    }
  }

  async function fetchAndShow(url, fileName) {
    trackUrl(url, fileName);
    try {
      toast('EYP indiriliyor…', 2000);
      const r = await fetchBuf('direct-get', url, {});
      let fn = fileName || guessName(url);
      await openBuffer(r.buffer, fn);
      return true;
    } catch (e) {
      console.warn('[EYP] fetch başarısız', e.message);
      // ağ önbelleğinde bir şey var mı?
      const hit = latestCachedEyp(60000);
      if (hit) {
        toast('Önbellekten açılıyor…', 2000);
        await openBuffer(hit.buffer, hit.fileName);
        return true;
      }
      toast('Doğrudan indirilemedi (F12 Console çıktısını gönderin)', 4000);
      return false;
    }
  }

  /* ---------- .eyp satırını bulma + akıllı açma ---------- */

  function findEypTarget(el) {
    if (!el || el === document) return null;
    let cur = el;
    for (let i = 0; i < 8 && cur && cur !== document.documentElement; i++) {
      if (cur.getAttribute) {
        const href = cur.getAttribute('href') || '';
        const dl = cur.getAttribute('download') || '';
        const dataUrl = cur.getAttribute('data-url') || (cur.dataset && cur.dataset.url) || '';
        const title = cur.getAttribute('title') || '';
        const txt = (cur.textContent || '').slice(0, 250);
        const cand = href || dataUrl || dl;
        if (/\.eyp(\?|#|$)/i.test(href) || /\.eyp(\?|#|$)/i.test(dataUrl) || /\.eyp(\?|#|$)/i.test(dl) ||
            /\.eyp$/i.test(title.trim()) || (/\.eyp/i.test(txt) && cand)) {
          const m = (dl || title || txt).match(/[\w\-\(\)çğıöşüÇĞİÖŞÜ ]+\.eyp/i);
          return { el: cur, url: href || dataUrl || null, fileName: (m ? m[0] : 'belge.eyp').trim() };
        }
        const onclick = cur.getAttribute('onclick') || '';
        if (/\.eyp/i.test(onclick)) {
          const m = onclick.match(/[\w\-\(\)çğıöşüÇĞİÖŞÜ ]+\.eyp/i);
          return { el: cur, url: null, fileName: m ? m[0] : 'belge.eyp', onclick, clickEl: cur };
        }
        // Dosya adı .eyp ile biten satır (bağlantısız): satırın tıklanabilir atasını sakla
        if (/\.eyp\s*$/i.test(txt.trim()) && txt.trim().length < 150) {
          let clickable = cur;
          let p = cur.parentElement;
          for (let j = 0; j < 4 && p; j++) {
            if (p.tagName === 'A' || p.tagName === 'BUTTON' || (p.getAttribute && (p.getAttribute('onclick') || p.getAttribute('href')))) {
              clickable = p; break;
            }
            p = p.parentElement;
          }
          const m2 = txt.match(/[\w\-\(\)çğıöşüÇĞİÖŞÜ ]+\.eyp/i);
          return { el: cur, url: null, fileName: m2 ? m2[0].trim() : txt.trim(), clickEl: clickable, textRow: true };
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Bağlantısız satırda "Görüntüle": indirme YAPTIRILMAZ.
  // Sıra: önbellek → background'u kur + UYAP tıklamasını tetikle (ağdan/indirilen
  // isteği background yakalar, iptal eder, biz fetch ile tekrarlayıp açarız).
  async function smartOpen(target) {
    const fileName = target.fileName || 'belge.eyp';
    // 1) Son 60 saniyede yakalanmış bir ZIP varsa hemen aç
    const hit = latestCachedEyp(60000);
    if (hit) {
      await openBuffer(hit.buffer, /\.eyp/i.test(hit.fileName) ? hit.fileName : fileName);
      return;
    }
    // 2) Doğrudan URL varsa fetch dene
    if (target.url && !/^javascript:/i.test(target.url)) {
      const ok = await fetchAndShow(new URL(target.url, location.href).href, fileName);
      if (ok) return;
    }
    // 3) UYAP'ın kendi indirme/önizleme akışını tetikle, baytları ağdan yakala.
    //    Background 25 sn boyunca indirme isteğini izler; indirme başlarsa
    //    iptal edip bize verir, biz doğrudan açarız. Kullanıcı dosya görmez.
    armBackground(fileName);
    state.pendingCapture = { fileName: fileName, at: Date.now() };
    toast('Açılıyor… (dosya indirilmeden görüntülenecek)', 3000);
    // Tıklama sonrası UYAP'ın gerçekte ne istediğini kaynak zaman çizelgesinden
    // izle; belgeye benzeyen ilk yanıtı alıp doğrudan aç. (Kanca ve indirme
    // yakalamaya takılmayan iframe/PDF önizlemeleri burada görünür.)
    const seenRes = new Set(resourceUrls());
    let observed = 0;
    const poll = setInterval(function () {
      if (!state.pendingCapture) { clearInterval(poll); return; }
      let fresh = [];
      try {
        fresh = resourceUrls().filter(function (u) {
          return !seenRes.has(u) && !isStaticAsset(u) && u.indexOf('blob:') !== 0;
        });
        fresh.forEach(function (u) { seenRes.add(u); });
      } catch (e) { return; }
      if (!fresh.length) return;
      observed += fresh.length;
      // Kendi denemelerimizi tekrar loglama (attemptLog'da varlar)
      const unlogged = fresh.filter(function (u) { return !loggedUrl(u); });
      unlogged.forEach(function (u) { elog('uyap-istek', u, 'GET', 0, 0, false); });
      const cands = fresh.filter(function (u) { return !loggedUrl(u) && isDocish(u); });
      cands.sort(function (a, b) { return (/\.eyp/i.test(b) ? 1 : 0) - (/\.eyp/i.test(a) ? 1 : 0); });
      if (!cands.length) return;
      fetchBuf('gozlem-doc', cands[0], {}).then(function (r) {
        if (!state.pendingCapture) return;
        state.pendingCapture = null;
        clearInterval(poll);
        return openBuffer(r.buffer, guessName(cands[0]) || fileName);
      }).catch(function () { /* sonraki tur devam eder */ });
    }, 800);
    setTimeout(function () { clearInterval(poll); }, 21000);
    setTimeout(function () {
      if (state.pendingCapture) {
        state.pendingCapture = null;
        toastAction('Dosya yakalanamadı' + (observed ? ' (' + observed + ' istek görüldü).' : '.') + ' ', 'Tanıyı kopyala', 12000);
      }
    }, 20000);
    try {
      const el = target.clickEl || target.el;
      // En yakın tıklanabilir öğeyi bul
      let n = el;
      for (let j = 0; j < 5 && n; j++) {
        if (n.tagName === 'A' || n.tagName === 'BUTTON' || (n.getAttribute && (n.getAttribute('onclick') || n.getAttribute('href')))) break;
        n = n.parentElement;
      }
      const node = n || el;
      if (node) {
        // .click() sentetik dispatchEvent'ten daha sadıktır: onclick işleyicileri,
        // form gönderimleri ve bağlantı takibi için orijinal akışı çalıştırır.
        try { node.click(); }
        catch (e) {
          const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
          ev.__eypInternal = true;
          node.dispatchEvent(ev);
        }
      }
    } catch (e) {}
    setTimeout(scanErrorDialog, 800);
  }

  function hookClicks() {
    document.addEventListener('click', async (e) => {
      if (e.__eypInternal) return; // kendi tetiklediğimiz tıklama
      const t = findEypTarget(e.target);
      if (!t) return;
      if (t.url && !/^javascript:/i.test(t.url)) {
        e.preventDefault();
        e.stopPropagation();
        await fetchAndShow(new URL(t.url, location.href).href, t.fileName);
      } else {
        // UYAP'ın kendi akışını bozma; yakalama için izle + background'u kur
        trackUrl(t.url, t.fileName);
        armBackground(t.fileName || 'belge.eyp');
        state.pendingCapture = { fileName: t.fileName || 'belge.eyp', at: Date.now() };
        setTimeout(() => { state.pendingCapture = null; }, 25000);
        setTimeout(scanErrorDialog, 600);
      }
    }, true);
  }

  // Aynı satıra ikinci düğme eklenmesini önler (iki tarama turu da buradan geçer)
  function nearbyButton(el) {
    let n = el;
    for (let i = 0; i < 4 && n && n !== document.body; i++) {
      try { if (n.querySelector && n.querySelector('.eyp-inline-btn')) return true; } catch (e) {}
      n = n.parentElement;
    }
    return false;
  }

  function injectInlineButtons() {
    // Üst menü/navigasyon alanlarına dokunma (sahte "Görüntüle" düğmeleri buradan çıkıyordu)
    function inChrome(el) {
      try { return !!el.closest('header, nav, footer, aside, .navbar, .menu, .ui-menubar'); } catch (_) { return false; }
    }
    function visible(el) {
      try {
        const r = el.getBoundingClientRect();
        return (r.width > 0 || r.height > 0) && el.offsetParent !== null;
      } catch (_) { return true; }
    }
    document.querySelectorAll('a[href*=".eyp" i], [download*=".eyp" i], [title*=".eyp" i]').forEach((a) => {
      if (a.dataset.eypHooked || nearbyButton(a)) { a.dataset.eypHooked = '1'; return; }
      if (inChrome(a) || !visible(a)) { a.dataset.eypHooked = '1'; return; }
      a.dataset.eypHooked = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'eyp-inline-btn';
      btn.textContent = '👁 Görüntüle';
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        await smartOpen({ url: a.getAttribute('href') || a.dataset.url, fileName: a.getAttribute('download') || a.textContent.trim().slice(0, 120) || 'belge.eyp', el: a });
      });
      a.after(btn);
    });
    // Bağlantısız .eyp metin satırları (UYAP tablo hücreleri)
    document.querySelectorAll('td, span, div, li').forEach((el) => {
      if (el.dataset.eypTextHooked || nearbyButton(el)) return;
      if (inChrome(el) || !visible(el)) return;
      const isLeaf = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3;
      if (!isLeaf) return;
      const txt = el.textContent.trim();
      if (!/\.eyp$/i.test(txt) || txt.length > 140) return;
      el.dataset.eypTextHooked = '1';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'eyp-inline-btn'; btn.textContent = '👁 Görüntüle';
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const t = findEypTarget(el) || { el, fileName: txt };
        await smartOpen(t);
      });
      el.appendChild(btn);
    });
  }

  function scanErrorDialog() {
    let bodyText = '';
    try { bodyText = document.body.innerText || ''; } catch (e) {}
    if (!/Desteklenmeyen belge türü/i.test(bodyText)) return;
    if (document.getElementById('eyp-error-btn')) return;
    const candidates = Array.from(document.querySelectorAll('div, span, p')).filter(el => /Desteklenmeyen belge türü/.test(el.textContent) && el.textContent.length < 500);
    const host = candidates[0];
    if (!host) return;
    const box = (host.closest && host.closest('div[class*="modal"], div[class*="dialog"], div[role="dialog"]')) || host.parentElement;
    if (!box) return;
    const btn = document.createElement('button');
    btn.id = 'eyp-error-btn';
    btn.textContent = '📦 EYP Görüntüleyici ile açmayı dene';
    btn.style.cssText = 'background:#2e7d32;color:#fff;border:0;border-radius:8px;padding:10px 14px;margin-top:10px;cursor:pointer;font-size:13px;font-weight:600;';
    btn.onclick = async () => {
      const hit = latestCachedEyp(120000);
      if (hit) {
        await openBuffer(hit.buffer, hit.fileName);
        return;
      }
      if (state.lastAttempt && state.lastAttempt.url) {
        await fetchAndShow(state.lastAttempt.url, state.lastAttempt.fileName);
        return;
      }
      toast('Önbellekte dosya yok. Sayfadaki 👁 Görüntüle düğmesini kullanın.', 3000);
    };
    box.appendChild(btn);
    // Hata diyaloğu = UYAP önizlemesi tetiklendi demek; 20 sn yakalamayı açık tut
    if (!state.pendingCapture) {
      state.pendingCapture = { fileName: 'belge.eyp', at: Date.now() };
      setTimeout(() => { state.pendingCapture = null; }, 20000);
    }
  }

  // Yüzen "EYP Aç" düğmesi Beesly'de kapalı — dosya seçimi yalnızca
  // sayfa içi 👁 Görüntüle düğmeleri ve hata diyaloğu üzerinden yapılır.

  function observe() {
    const mo = new MutationObserver(() => {
      try { injectInlineButtons(); scanErrorDialog(); } catch (e) {}
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.__eypOpen = (url, fileName) => fetchAndShow(url, fileName);
  window.__eypOpenBuffer = (buf, name) => openBuffer(buf, name);
  window.__eypDebug = () => attemptLog.slice();
  window.__eypNetCache = () => netCache.map(c => ({ file: c.fileName, kb: Math.round(c.buffer.byteLength / 1024), src: c.source }));

  listenPageWorld();
  listenBackground();
  hookClicks();
  observe();
  injectInlineButtons();
  setInterval(scanErrorDialog, 1500);
  console.log('[EYP Görüntüleyici] aktif (v1.1.6, MAIN-kanca + indirme-yakalama)');
})();
