// ===== EYP Görüntüleyici (uyap-eyp-goruntuleyici birleşimi) =====
// UYAP'ta .eyp indirmeden görüntüleme: indirme yakalama + bayt tekrarı.
// UYAP EYP Görüntüleyici - service worker
// Amaç: kullanıcıya DOSYA İNDİRTMEDEN baytları yakalamak.
// 1) Content script "Görüntüle"ye basılınca EYP_ARM gönderir (25 sn pencere açılır).
// 2) Bu pencerede UYAP'tan çıkan indirme (downloads.onCreated) iptal edilip
//    gerçek URL + POST gövdesi content script'e verilir; o da aynı isteği
//    fetch ile tekrarlayıp baytları doğrudan görüntüleyicide açar.
// armed bilgisi chrome.storage.session'da tutulur: service worker uyuyup
// uyanınca hafızadaki değişken sıfırlanır, indirme yakalama kaçardı.
let armedMem = { until: 0, fileName: 'belge.eyp', tabId: null };
let lastPost = null; // {url, method, contentType, formData, raw}
let lastPostAt = 0;

async function saveArmed(a) {
  armedMem = a;
  try { await chrome.storage.session.set({ eypArmed: a }); } catch (e) {}
}

async function getArmed() {
  if (Date.now() < armedMem.until) return armedMem;
  try {
    const s = await chrome.storage.session.get('eypArmed');
    if (s && s.eypArmed && Date.now() < s.eypArmed.until) {
      armedMem = s.eypArmed;
      return armedMem;
    }
  } catch (e) {}
  return { until: 0, fileName: 'belge.eyp', tabId: null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'EYP_ARM') {
    saveArmed({ until: Date.now() + 25000, fileName: msg.fileName || 'belge.eyp', tabId: sender.tab ? sender.tab.id : null }).then(() => sendResponse({ ok: true }));
    lastPost = null;
    return true;
  }
  if (msg && msg.type === 'EYP_OPEN_VIEWER') {
    chrome.tabs.create({ url: chrome.runtime.getURL('eyp-viewer.html') });
    sendResponse({ ok: true });
    return true;
  }
});

function isArmedObj(a) {
  return a && Date.now() < a.until;
}

// POST gövdesini yakala (UYAP dosya indirmeleri genelde POST'tur)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    getArmed().then((armed) => {
      if (!isArmedObj(armed)) return;
      if (details.tabId !== -1 && armed.tabId !== null && details.tabId !== armed.tabId) return;
      if (details.method === 'POST' && details.requestBody) {
        const rb = details.requestBody;
        lastPost = {
          url: details.url,
          method: 'POST',
          contentType: '',
          formData: rb.formData || null,
          raw: rb.raw && rb.raw[0] && rb.raw[0].bytes ? [{ bytes: rb.raw[0].bytes }] : null
        };
        lastPostAt = Date.now();
        lastPost._reqId = details.requestId;
      } else if (details.method === 'GET' && /\.eyp(\?|#|$)/i.test(details.url)) {
        lastPost = { url: details.url, method: 'GET' };
        lastPostAt = Date.now();
      }
    });
  },
  { urls: ['*://*.uyap.gov.tr/*', '*://uyap.gov.tr/*'] },
  ['requestBody']
);

// POST'un Content-Type başlığını yakala (gövdeyi aynen tekrarlamak için)
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    getArmed().then((armed) => {
      if (!isArmedObj(armed) || !lastPost || details.requestId !== lastPost._reqId) return;
      const h = (details.requestHeaders || []).find((x) => x.name.toLowerCase() === 'content-type');
      if (h) lastPost.contentType = h.value;
    });
  },
  { urls: ['*://*.uyap.gov.tr/*', '*://uyap.gov.tr/*'] },
  ['requestHeaders']
);

function looksLikeDoc(item) {
  const fn = (item.filename || '').toLowerCase();
  const mime = (item.mime || '').toLowerCase();
  return /\.eyp$/i.test(fn) || /\.zip$/i.test(fn) || /\.udf$/i.test(fn) ||
    mime.indexOf('zip') !== -1 || mime.indexOf('octet-stream') !== -1;
}

chrome.downloads.onCreated.addListener(async (item) => {
  const armed = await getArmed();
  if (!isArmedObj(armed)) return;
  // UYAP tetiklemeli indirme: iptal et, kullanıcı Downloads klasörüne dokunmasın
  if (!looksLikeDoc(item) && !/uyap/i.test(item.referrer || '') && !/uyap/i.test(item.url || '')) return;
  try { await chrome.downloads.cancel(item.id); } catch (e) {}
  try { await chrome.downloads.erase({ id: item.id }); } catch (e) {}
  const usePost = lastPost && Date.now() - lastPostAt < 30000 ? lastPost : null;
  if (usePost) delete usePost._reqId;
  if (armed.tabId !== null) {
    try {
      await chrome.tabs.sendMessage(armed.tabId, {
        type: 'EYP_CAPTURED_DL',
        url: item.url,
        filename: item.filename ? item.filename.split(/[\\/]/).pop() : armed.fileName,
        post: usePost
      });
    } catch (e) {}
  }
});
