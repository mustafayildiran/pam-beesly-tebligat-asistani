/* UYAP EYP Görüntüleyici - SAYFA dünyası kancası (world: MAIN)
 * chrome.* API'si YOKTUR. Sadece ağ yanıtlarını koklar, ZIP bulursa
 * izole dünyadaki content.js'e postMessage ile aktarır.
 * UYAP'ın kendi belge önizleyicisi dosyayı zaten indirdiği için
 * ("Desteklenmeyen belge türü" demeden önce), baytlar buradan yakalanır.
 * Kullanıcıya indirme yaptırılmaz.
 */
(function () {
  'use strict';
  if (window.__eypInjectLoaded) return;
  window.__eypInjectLoaded = true;

  function emit(url, fileName, buffer, source) {
    const msg = { source: '__eyp_inject', kind: 'EYP_BLOB', url: url || '', fileName: fileName || 'belge.eyp', buffer: buffer, origin: source || '' };
    try {
      window.postMessage(msg, '*', [buffer]);
    } catch (e) {
      try { window.postMessage(msg, '*'); } catch (e2) {}
    }
  }

  function sniff(url, fileName, buffer, source) {    if (!buffer || buffer.byteLength < 4) return;
    const h = new Uint8Array(buffer, 0, 4);
    if (h[0] !== 0x50 || h[1] !== 0x4b) return; // "PK" ZIP imzası yoksa ilgilenme
    let fn = fileName || '';
    if (!fn) {
      try { fn = decodeURIComponent(String(url || '').split('?')[0].split('/').pop()) || 'belge.eyp'; }
      catch (e) { fn = 'belge.eyp'; }
    }
    emit(url, fn, buffer.slice(0), source);
  }

  function nameFromDisposition(cd) {
    if (!cd) return '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i);
    return m ? decodeURIComponent(m[1].trim()) : '';
  }

  // 1) fetch
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const resp = await origFetch(input, init);
      try {
        const reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        const cd = resp.headers.get('content-disposition') || '';
        if (/\.eyp/i.test(reqUrl) || /\.eyp/i.test(cd) || ct.indexOf('zip') !== -1 || ct.indexOf('octet-stream') !== -1) {
          if (resp.ok) {
            resp.clone().arrayBuffer().then(
              function (b) { sniff(reqUrl, nameFromDisposition(cd), b, 'fetch'); },
              function () {}
            );
          }
        }
      } catch (e) {}
      return resp;
    };
  } catch (e) {}

  // 2) XMLHttpRequest (PrimeFaces/JSF arka plan istekleri genelde XHR'dır)
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__eypUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', function () {
        try {
          const u = this.__eypUrl || this.responseURL || '';
          if (this.response instanceof ArrayBuffer) sniff(u, '', this.response, 'xhr');
          else if (this.response instanceof Blob) {
            this.response.arrayBuffer().then(function (b) { sniff(u, '', b, 'xhr-blob'); });
          }
        } catch (e) {}
      });
      return origSend.apply(this, arguments);
    };
  } catch (e) {}

  // 3) Önizleyicinin ürettiği blob URL'leri
  try {
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      const u = origCreate(blob);
      try {
        if (blob instanceof Blob && blob.size > 100 && blob.size < 300 * 1024 * 1024) {
          const t = (blob.type || '').toLowerCase();
          if (t.indexOf('text/') !== 0 && t.indexOf('json') === -1) {
            blob.slice(0, 4).arrayBuffer().then(function (head) {
              const x = new Uint8Array(head);
              if (x[0] === 0x50 && x[1] === 0x4b) {
                blob.arrayBuffer().then(function (b) { sniff(u, 'belge.eyp', b, 'blob'); });
              }
            });
          }
        }
      } catch (e) {}
      return u;
    };
  } catch (e) {}
  // Content script'in yoklama ping'ine cevap (sürüm uyumluluk kontrolü)
  try {
    window.addEventListener('message', function (ev) {
      const d = ev.data;
      if (d && d.source === '__eyp_content' && d.kind === 'EYP_PING') {
        try { window.postMessage({ source: '__eyp_inject', kind: 'EYP_PONG' }, '*'); } catch (e) {}
      }
    });
  } catch (e) {}
})();
