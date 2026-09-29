// Beesly background service worker (MV3)
// Köprü + sonuç cache'i + gömülü UETS girişi + PTT direkt API + sağ-tık menüsü.
//
// PTT 4xx birincil yol (AHG eklenti incelemesinden doğrulandı):
//   POST https://api.ptt.gov.tr/api/ShipmentTracking  body: "barkod"  (token yok)
// Olmazsa (401/403/ağ hatası) yedek: ptt.gov.tr sekmesinde Turnstile ile sorgu.

const UETS_TRACK_PAGE = "https://ptt.etebligat.gov.tr/track-message";
const UETS_LOGIN_PAGE = "https://ptt.etebligat.gov.tr/login";
const UETS_API = "https://api.etebligat.gov.tr/v1";

function fmtExtId(v) {
  // Siteyle aynı format: 15 haneyse 5-5-5 tireli yaz
  let extId = String(v || "").replace(/[^0-9]/g, "");
  if (extId.length === 15) {
    extId = `${extId.substring(0, 5)}-${extId.substring(5, 10)}-${extId.substring(10, 15)}`;
  }
  return extId;
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function sessGet(keys) {
  try {
    if (chrome.storage.session) {
      const s = await chrome.storage.session.get(keys);
      const k = Array.isArray(keys) ? keys[0] : keys;
      if (s && s[k]) return s;
      // Tarayıcı yeniden başladıysa session silinir; disk yedeğinden canlandır
      const bak = await chrome.storage.local.get("beeslyUetsTokenBak");
      if (bak?.beeslyUetsTokenBak && (k === "beeslyUetsToken" || (Array.isArray(keys) && keys.includes("beeslyUetsToken")))) {
        await chrome.storage.session.set({ beeslyUetsToken: bak.beeslyUetsTokenBak });
        return await chrome.storage.session.get(keys);
      }
      return s;
    }
  } catch (_) {}
  return await chrome.storage.local.get(keys);
}

async function sessSet(obj) {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set(obj);
      // Yeniden başlatmaya karşı disk yedeği (sitenin kendi localStorage'ı gibi)
      if (obj.beeslyUetsToken) {
        await chrome.storage.local.set({ beeslyUetsTokenBak: obj.beeslyUetsToken });
      }
      return;
    }
  } catch (_) {}
  await chrome.storage.local.set(obj);
}

async function sessRemove(keys) {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.remove(keys);
    }
  } catch (_) {}
  await chrome.storage.local.remove(keys);
  // Yedek token'ı da temizle
  const list = Array.isArray(keys) ? keys : [keys];
  if (list.includes("beeslyUetsToken")) {
    try {
      await chrome.storage.local.remove("beeslyUetsTokenBak");
    } catch (_) {}
  }
}

function setBadge(ok) {
  try {
    chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
    chrome.action.setBadgeBackgroundColor({ color: ok ? "#2e7d32" : "#c62828" });
  } catch (_) {}
}

// ---- UETS direkt sorgu (oturum token'ıyla, sekmesiz) ----
function summarizeUets(json) {
  const evs = json?.evidences || json?.data?.evidences || (Array.isArray(json) ? json : []);
  if (Array.isArray(evs) && evs.length) {
    const last = evs[evs.length - 1];
    const main = last.type_text || last.event || last.type || "Kayıt bulundu";
    const time = last.time || "";
    return {
      ok: true,
      text: `${main}${time ? " | " + time : ""}${evs.length > 1 ? ` (${evs.length} kayıt)` : ""}`,
      status: String(main),
      date: String(time),
      count: evs.length
    };
  }
  return { ok: false, text: "Boş yanıt" };
}

// 401 sayacı: tek seferlik red cevabında token silinmez,
// üst üste 2. redde oturum ölü sayılır (Chrome açıkken gereksiz giriş engellenir)
async function uetsFailCount() {
  try {
    const s = await sessGet("beeslyUetsFails");
    return s?.beeslyUetsFails || 0;
  } catch (_) {
    return 0;
  }
}
async function setUetsFails(n) {
  try {
    await sessSet({ beeslyUetsFails: n });
  } catch (_) {}
}

async function queryUetsDirect(barcode) {
  const sess = await sessGet("beeslyUetsToken");
  let token = sess?.beeslyUetsToken?.access_token;
  const ageMin =
    sess?.beeslyUetsToken?.at != null ? Math.round((Date.now() - sess.beeslyUetsToken.at) / 60000) : -1;
  if (!token) throw Object.assign(new Error("no-session"), { code: "NO_SESSION" });
  const call = (t) =>
    fetch(`${UETS_API}/messages/evidences/${encodeURIComponent(barcode)}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer " + t }
    });
  let r = await call(token);
  if (r.status === 401 || r.status === 403) {
    // Kısa ömürlü token bitmiş olabilir: refresh dene, olmazsa ölü say
    const nt = await tryRefreshUets();
    if (nt) {
      token = nt;
      r = await call(token);
    }
  }
  if (r.status === 401 || r.status === 403) {
    const fails = await uetsFailCount();
    if (fails >= 1) {
      await setUetsFails(0);
      const e = new Error("auth");
      e.code = "SESSION_DEAD";
      e.tokenAgeMin = ageMin;
      throw e;
    }
    await setUetsFails(fails + 1);
    const e = new Error("UETS yanıt vermedi, tekrar deneyin.");
    e.code = "SESSION_RETRY";
    e.tokenAgeMin = ageMin;
    throw e;
  }
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.tokenAgeMin = ageMin;
    throw e;
  }
  const json = await r.json();
  await setUetsFails(0);
  return { summary: summarizeUets(json), raw: json };
}

function urlParam(o) {
  return Object.keys(o || {})
    .map((k) => k + "=" + encodeURIComponent(o[k]))
    .join("&");
}

// Sitenin kendi akışı: GET /refresh? + urlParam(refreshToken)
async function tryRefreshUets() {
  try {
    const sess = await sessGet("beeslyUetsToken");
    const rt = sess?.beeslyUetsToken?.refresh_token;
    if (!rt) return null;
    const q = typeof rt === "object" ? urlParam(rt) : "refresh_token=" + encodeURIComponent(rt);
    const r = await fetch(`${UETS_API}/refresh?${q}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!r.ok) return null;
    const body = await r.json().catch(() => null);
    if (!body?.access_token) return null;
    await sessSet({
      beeslyUetsToken: { access_token: body.access_token, refresh_token: body.refresh_token || rt, at: Date.now() }
    });
    await setUetsFails(0);
    await chrome.storage.local.set({ beeslyUets: { connected: true, at: Date.now(), via: "form" } });
    return body.access_token;
  } catch (_) {
    return null;
  }
}

// Eklentinin açtığı yedek sekmeler: sonuç kaydedilince otomatik kapatılır,
// sekme çubuğunda kalabalık yapmaz.
const autoTabs = new Set();
try {
  chrome.tabs.onRemoved.addListener((id) => autoTabs.delete(id));
} catch (_) {}

// ---- PTT motoru (Tebligat Takip yaklaşımıyla birebir) ----
// Turnstile yalnızca sayfa bağlamında (MAIN world) sağlıklı çalışır;
// kalıcı gizli sekme + token ön-ısıtma + token tekrar kullanımı.
const PTT_URL = "https://www.ptt.gov.tr/";
const TURNSTILE_SITEKEY = "0x4AAAAAADnH93jtxBes4VLj"; // ptt.gov.tr sitesinin kendi anahtarı
const TAB_LOAD_TIMEOUT = 25000;
const IDLE_CLOSE_MIN = 10;

let pttQueue = Promise.resolve();
function pttEnqueue(fn) {
  const run = pttQueue.then(fn);
  pttQueue = run.catch(() => {});
  return run;
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("sekme yüklenemedi")); }, TAB_LOAD_TIMEOUT);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") { cleanup(); resolve(); }
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete" && !t.discarded) { cleanup(); resolve(); }
    }).catch((e) => { cleanup(); reject(e); });
  });
}

async function getPttTab() {
  // Kullanıcı zaten PTT açmışsa yeni sekme yok: onunkini kullan
  try {
    const open = await chrome.tabs.query({ url: "https://www.ptt.gov.tr/*" });
    const good = open.find((t) => !(t.url || "").includes("etebligat"));
    if (good?.id) return good.id;
  } catch (_) {}
  const { pttTabId } = await sessGet("pttTabId");
  if (pttTabId) {
    let tab = null;
    try { tab = await chrome.tabs.get(pttTabId); } catch (_) {}
    const url = tab ? tab.url || tab.pendingUrl || "" : "";
    if (url.startsWith(PTT_URL)) {
      if (tab.discarded) {
        await chrome.tabs.reload(tab.id);
        await waitForLoad(tab.id).catch(() => {});
      }
      return tab.id;
    }
  }
  const tab = await chrome.tabs.create({ url: PTT_URL, active: false });
  await sessSet({ pttTabId: tab.id });
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (_) {}
  await waitForLoad(tab.id);
  return tab.id;
}

// ptt.gov.tr sekmesinin içinde (MAIN world) çalışır
async function pagePtt(action, no, sitekey) {
  const API = "https://api.ptt.gov.tr/api";
  const TOKEN_TTL = 240000;
  const st = window.__beeslyPtt || (window.__beeslyPtt = { widgetId: null, pending: null, trackingToken: null });
  if (st.prefetch === undefined) st.prefetch = null;

  function settle(fn, arg) {
    const p = st.pending;
    st.pending = null;
    if (p) p[fn](arg);
  }

  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  }

  async function loadTurnstile() {
    if (window.turnstile) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("turnstile script yüklenemedi"));
      document.head.appendChild(s);
    });
  }

  async function getTurnstileToken() {
    await loadTurnstile();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle("reject", new Error("turnstile zaman aşımı")), 30000);
      st.pending = {
        resolve: (t) => { clearTimeout(timer); resolve(t); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      };
      try {
        if (st.widgetId === null) {
          const el = document.createElement("div");
          el.style.display = "none";
          document.body.appendChild(el);
          st.widgetId = window.turnstile.render(el, {
            sitekey,
            size: "invisible",
            execution: "execute",
            callback: (t) => settle("resolve", t),
            "error-callback": () => settle("reject", new Error("turnstile hatası")),
            "timeout-callback": () => settle("reject", new Error("turnstile zaman aşımı"))
          });
        } else {
          window.turnstile.reset(st.widgetId);
        }
        window.turnstile.execute(st.widgetId);
      } catch (e) {
        settle("reject", e);
      }
    });
  }

  function prefetchToken() {
    const pf = st.prefetch;
    if (pf && (pf.readyAt === null || Date.now() - pf.readyAt < TOKEN_TTL)) return;
    const entry = { promise: null, readyAt: null };
    entry.promise = getTurnstileToken().then(
      (t) => { entry.readyAt = Date.now(); return t; },
      (e) => { if (st.prefetch === entry) st.prefetch = null; throw e; }
    );
    entry.promise.catch(() => {});
    st.prefetch = entry;
  }

  async function takeToken() {
    const pf = st.prefetch;
    st.prefetch = null;
    if (pf) {
      try {
        const t = await pf.promise;
        if (Date.now() - pf.readyAt < TOKEN_TTL) return t;
      } catch (_) {}
    }
    return getTurnstileToken();
  }

  async function getTrackingToken() {
    const turnstileToken = await takeToken();
    const r = await fetchWithTimeout(`${API}/TrackingToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken })
    }, 20000);
    if (!r.ok) throw new Error(`token alınamadı: ${r.status}`);
    const token = (await r.json()).token;
    if (!token) throw new Error("token alınamadı");
    return token;
  }

  async function query(token, ms) {
    const r = await fetchWithTimeout(`${API}/ShipmentTracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tracking-Token": token },
      body: JSON.stringify(no)
    }, ms);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  if (action === "warm") {
    try {
      await loadTurnstile();
      prefetchToken();
    } catch (_) {}
    return { warmed: true };
  }

  if (st.trackingToken) {
    try {
      return { data: await query(st.trackingToken, 8000), reused: true };
    } catch (_) {
      st.trackingToken = null;
    }
  }

  try {
    st.trackingToken = await getTrackingToken();
  } catch (e) {
    return { error: String(e?.message || e), stage: "verify" };
  } finally {
    prefetchToken();
  }

  try {
    return { data: await query(st.trackingToken, 20000), reused: false };
  } catch (e) {
    st.trackingToken = null;
    return { error: String(e?.message || e), stage: "query" };
  }
}

function pttWarmUp() {
  return pttEnqueue(async () => {
    const tabId = await getPttTab();
    chrome.alarms.create("beeslyPttIdle", { delayInMinutes: IDLE_CLOSE_MIN });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pagePtt,
      args: ["warm", null, TURNSTILE_SITEKEY]
    });
  }).catch(() => {});
}

async function runTrackPtt(no) {
  return pttEnqueue(async () => {
    let tabId;
    try {
      tabId = await getPttTab();
    } catch (_) {
      throw new Error("PTT sitesi açılamadı. İnternet bağlantınızı kontrol edin.");
    }
    chrome.alarms.create("beeslyPttIdle", { delayInMinutes: IDLE_CLOSE_MIN });
    let res;
    try {
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: pagePtt,
        args: ["track", no, TURNSTILE_SITEKEY]
      });
      res = inj?.result;
    } catch (_) {
      throw new Error("PTT sayfasında sorgu çalıştırılamadı. Lütfen tekrar deneyin.");
    }
    if (!res) throw new Error("PTT sayfasında sorgu çalıştırılamadı. Lütfen tekrar deneyin.");
    if (res.error) {
      throw new Error(res.stage === "verify"
        ? "PTT doğrulaması tamamlanamadı: " + res.error
        : "Bağlantı hatası: " + res.error);
    }
    return res.data;
  });
}

// Boşta kalan PTT sekmesini kapat (yalnızca eklentinin açtığı sekme)
try {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "beeslyPttIdle") return;
    const { pttTabId } = await sessGet("pttTabId");
    if (!pttTabId) return;
    await sessRemove("pttTabId");
    try {
      const tab = await chrome.tabs.get(pttTabId);
      if ((tab.url || "").startsWith(PTT_URL)) await chrome.tabs.remove(pttTabId);
    } catch (_) {}
  });
} catch (_) {}

function formatPttTarih(t) {
  const m = String(t || "").trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(t || "");
}

function parsePttResult(json) {
  const row = Array.isArray(json) ? json[0] : json;
  if (!row) return { summary: { ok: false, text: "Boş yanıt" }, raw: json };
  // PTT, başarılı sorguda bile errorMessage: "BAŞARILI" döner — bu hata değil!
  const apiMsg = String(row.errorMessage || "").trim();
  const apiOk = /^(BAŞARILI|BASARILI|SUCCESS|OK)$/i.test(apiMsg);
  if (row.errorState && !apiOk) {
    return { summary: { ok: false, text: apiMsg || "Kayıt bulunamadı." }, raw: json };
  }
  const moves = (row.hareketDongu || []).map((m) => ({
    tarih: m.tarih || "",
    saat: m.saat || "",
    isyeri: m.isyeri || "",
    aciklama: m.aciklama || "",
    islemDetay: (m.islem_detay || "").trim()
  }));
  const up = (s) => String(s || "").toLocaleUpperCase("tr-TR");
  const slash = (t) => {
    const m = String(t || "").match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(t || "");
  };
  const sd = row.sondurum || {};
  const teslim = !!sd.teslim_durum_aciklama && sd.teslim_tarihi && sd.teslim_tarihi !== "0";
  const durum = teslim ? sd.teslim_durum_aciklama : sd.son_durum_aciklama || apiMsg || "Durum bilgisi yok";
  const durumTarihi = formatPttTarih(teslim ? sd.teslim_tarihi : sd.son_durum_tarihi);
  const tSlash = teslim ? slash(sd.teslim_tarihi) : "";
  const teslimDetay = teslim
    ? moves.find((h) => h.tarih === tSlash && up(h.aciklama).includes("TESLİM")) ||
      moves.find((h) => up(h.aciklama).includes("TESLİM")) ||
      null
    : null;
  const kabul = row.kabul || {};
  return {
    summary: {
      ok: true,
      text: durum,
      durumTarihi,
      kabulTarih: kabul.kabul_tarihi || "",
      kabul: {
        gonderici: kabul.gonderici || "",
        alici: kabul.alici || "",
        kabulIsyeri: kabul.kabul_isyeri || "",
        kabulTarihi: kabul.kabul_tarihi || ""
      },
      teslimDetay,
      moves
    },
    raw: json
  };
}

// UYAP sekmesinde kal: PTT sekmesi kalıcı + gizli tutulur, sonuç storage'a yazılır.
async function openPtt(barcode) {
  const key = "beeslyResult_" + barcode;
  const dbgKey = "beeslyDebug_" + barcode;
  await chrome.storage.local.set({ beeslyBarcode: barcode, beeslyTs: Date.now(), [key]: null });
  try {
    const json = await runTrackPtt(barcode);
    const { summary, raw } = parsePttResult(json);
    await chrome.storage.local.set({ [key]: { at: Date.now(), summary, raw }, [dbgKey]: { direct: "main-world" } });
    setBadge(summary.ok);
  } catch (e) {
    await chrome.storage.local.set({
      [key]: { at: Date.now(), summary: { ok: false, text: String(e.message || e) } },
      [dbgKey]: { direct: String(e.message || e) }
    });
    setBadge(false);
  }
}

async function openUets(barcode) {
  const key = "beeslyResult_" + barcode;
  const dbgKey = "beeslyDebug_" + barcode;
  await chrome.storage.local.set({ beeslyBarcode: barcode, beeslyTs: Date.now(), [key]: null });
  try {
    const { summary, raw } = await queryUetsDirect(barcode);
    await chrome.storage.local.set({ [key]: { at: Date.now(), summary, raw }, [dbgKey]: { direct: "ok" } });
    setBadge(summary.ok);
    return;
  } catch (e) {
    const age = e.tokenAgeMin != null && e.tokenAgeMin >= 0 ? ` age=${e.tokenAgeMin}m` : "";
    await chrome.storage.local.set({ [dbgKey]: { direct: String(e.code || e.message || e) + age } });
    if (e.code === "SESSION_DEAD") {
      await sessRemove("beeslyUetsToken");
      await chrome.storage.local.set({ beeslyUets: { connected: false, at: Date.now() } });
    } else if (e.code === "NO_SESSION") {
      // Bayat "bağlı" rozetini temizle ki popup doğruyu göstersin
      await chrome.storage.local.set({ beeslyUets: { connected: false, at: Date.now() } });
    }
    // Oturum yoksa/bozulduysa form doldurma yedeği (gizli UETS sekmesi)
    const tab = await chrome.tabs.create({ url: UETS_TRACK_PAGE, active: false });
    if (tab?.id) autoTabs.add(tab.id);
  }
}

// ---- Sağ-tık menüsü: yalnızca popup'ı açar (sorgulamaz) ----
// Tıklama kullanıcı hareketi sayıldığı için openPopup burada çalışır.
// Seçili barkodu popup kendisi okuyup kartı başa alır.
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: "beesly-sorgula",
      title: "Beesly ile sorgula",
      contexts: ["selection"]
    });
  } catch (_) {}
});

function openPopupWindow(srcTabId) {
  try {
    let url = chrome.runtime.getURL("popup.html");
    if (srcTabId) url += "?srcTab=" + srcTabId;
    chrome.windows.create({
      url,
      type: "popup",
      width: 420,
      height: 600,
      focused: false
    });
  } catch (_) {}
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "beesly-sorgula") return;
  // windowId ile dene (odak çalmaz); olmazsa pencere yedeği (kaynak sekmeyle)
  const windowId = tab?.windowId;
  const openOptions = windowId ? { windowId } : {};
  try {
    chrome.action.openPopup(openOptions).catch(() => openPopupWindow(tab?.id));
  } catch (_) {
    openPopupWindow(tab?.id);
  }
});

// ---- Klavye kısayolu (Ctrl+Shift+Y): yalnızca popup'ı açar ----
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "beesly-query-selection") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const url = (tab.url || tab.pendingUrl || "").toLowerCase();
    if (!url.includes("uyap")) return;
    const openOptions = tab.windowId ? { windowId: tab.windowId } : {};
    try {
      await chrome.action.openPopup(openOptions);
    } catch (_) {
      openPopupWindow(tab.id);
    }
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "BEESLY_OPEN_PTT") {
      await openPtt(msg.barcode);
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_OPEN_PTT_PAGE") {
      // Kullanıcı "PTT'de aç" istedi: görünür sekme + form otomatik dolar
      await chrome.storage.local.set({ beeslyViewBarcode: { code: msg.barcode, at: Date.now() } });
      await chrome.tabs.create({ url: PTT_URL });
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_OPEN_UETS") {
      await openUets(msg.barcode);
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_GET_RESULT") {
      const key = "beeslyResult_" + msg.barcode;
      const data = await chrome.storage.local.get(key);
      sendResponse({ result: data[key] ?? null });
    } else if (msg?.type === "BEESLY_GET_DEBUG") {
      const data = await chrome.storage.local.get("beeslyDebug_" + msg.barcode);
      sendResponse({ debug: data["beeslyDebug_" + msg.barcode] ?? null });
    } else if (msg?.type === "BEESLY_UYAP_COUNT") {
      // UYAP sekmesinde barkod sayısını rozette göster (sekmeye özel)
      try {
        const tabId = sender?.tab?.id;
        if (tabId) {
          chrome.action.setBadgeText({ tabId, text: msg.count > 0 ? String(msg.count) : "" });
          chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a365d" });
        }
      } catch (_) {}
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_QUERY_DONE") {      setBadge(!!msg.ok);
      try {
        const dbgKey = "beeslyDebug_" + msg.barcode;
        const cur = await chrome.storage.local.get(dbgKey);
        const dbg = cur[dbgKey] || {};
        dbg.fallback = msg.ok ? "ok" : String(msg.error || "hata");
        await chrome.storage.local.set({ [dbgKey]: dbg });
      } catch (_) {}
      // Sonuç kaydedildi, yedek sekmeye gerek kalmadı: kapat
      try {
        const tabId = sender?.tab?.id;
        if (tabId && autoTabs.has(tabId)) {
          autoTabs.delete(tabId);
          await chrome.tabs.remove(tabId);
        }
      } catch (_) {}
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_OPEN_LOGIN") {
      await chrome.tabs.create({ url: UETS_LOGIN_PAGE });
      sendResponse({ ok: true });
    } else if (msg?.type === "PTT_WARM") {
      // Popup açıldı: PTT sekmesini + Turnstile token'ını önceden hazırla
      pttWarmUp();
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_UETS_STATUS") {
      const sess = await sessGet("beeslyUetsToken");
      if (sess?.beeslyUetsToken?.access_token) {
        sendResponse({ status: { connected: true, at: sess.beeslyUetsToken.at || 0, via: "form" } });
        return;
      }
      const data = await chrome.storage.local.get("beeslyUets");
      const flag = data.beeslyUets;
      // Sayfa bayrağı 24 saatten eskiyse bayat say (yanıltıcı "bağlı" rozeti olmasın)
      const fresh = flag?.connected && flag.at && Date.now() - flag.at < 24 * 60 * 60 * 1000;
      sendResponse({ status: fresh ? flag : { connected: false, at: 0 } });
    } else if (msg?.type === "BEESLY_UETS_TOKEN") {
      const sess = await sessGet("beeslyUetsToken");
      sendResponse({ token: sess?.beeslyUetsToken?.access_token || null });
    } else if (msg?.type === "BEESLY_UETS_CAPTCHA") {
      const r = await fetch(`${UETS_API}/captcha`, { method: "GET" });
      if (!r.ok) throw new Error("Güvenlik kodu alınamadı: " + r.status);
      const key = r.headers.get("X-Captcha-Key") || r.headers.get("x-captcha-key") || "";
      const buf = await r.arrayBuffer();
      const mime = r.headers.get("Content-Type") || "image/png";
      sendResponse({ ok: true, captchaKey: key, image: `data:${mime};base64,${bufToBase64(buf)}` });
    } else if (msg?.type === "BEESLY_UETS_LOGIN") {
      const extId = fmtExtId(msg.extId);
      const r = await fetch(`${UETS_API}/clients/_authentication`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ext_id: extId,
          password: msg.password || "",
          captcha_code: msg.captchaCode || "",
          captcha_key: msg.captchaKey || ""
        })
      });
      const body = await r.json().catch(() => ({}));
      if (body?.access_token) {
        await sessSet({
          beeslyUetsToken: { access_token: body.access_token, refresh_token: body.refresh_token || body.refreshToken || body.data?.refresh_token || body.data?.refreshToken || null, at: Date.now() }
        });
        // Site oturumunu da canlandırmak için profil sakla (hassas alanlar ayıklanır)
        try {
          const prof = JSON.parse(JSON.stringify(body));
          ["password", "passwd", "captcha_code", "captcha_key", "validation_code"].forEach((k) => delete prof[k]);
          await sessSet({ beeslyUetsProfile: prof });
        } catch (_) {}
        await setUetsFails(0);
        await chrome.storage.local.set({ beeslyUets: { connected: true, at: Date.now(), via: "form" } });
        sendResponse({ ok: true });
        return;
      }
      if (r.status === 401) {
        sendResponse({ ok: false, error: body?.message || "Giriş bilgileri doğru değil." });
        return;
      }
      if (r.status === 201) {
        sendResponse({
          ok: false,
          needCode: true,
          message: body?.message || "Doğrulama kodu gönderildi.",
          extra: body && typeof body === "object" ? body : {}
        });
        return;
      }
      sendResponse({ ok: false, error: body?.message || `Giriş başarısız: ${r.status}` });
    } else if (msg?.type === "BEESLY_UETS_VERIFY") {
      const payload = {
        ...(msg.extra && typeof msg.extra === "object" ? msg.extra : {}),
        ext_id: fmtExtId(msg.extId),
        password: msg.password || "",
        captcha_code: msg.captchaCode || "",
        captcha_key: msg.captchaKey || "",
        validation_code: String(msg.validationCode || "").replace(/[^0-9]/g, "")
      };
      const r = await fetch(`${UETS_API}/clients/_authentication`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await r.json().catch(() => ({}));
      if (body?.access_token) {
        await sessSet({
          beeslyUetsToken: { access_token: body.access_token, refresh_token: body.refresh_token || body.refreshToken || body.data?.refresh_token || body.data?.refreshToken || null, at: Date.now() }
        });
        try {
          const prof = JSON.parse(JSON.stringify(body));
          ["password", "passwd", "captcha_code", "captcha_key", "validation_code"].forEach((k) => delete prof[k]);
          await sessSet({ beeslyUetsProfile: prof });
        } catch (_) {}
        await setUetsFails(0);
        await chrome.storage.local.set({ beeslyUets: { connected: true, at: Date.now(), via: "form" } });
        sendResponse({ ok: true });
        return;
      }
      if (r.status === 201) {
        sendResponse({ ok: false, needCode: true, message: "Kod kabul edilmedi, yeni kod gönderildi. Yeni kodu girin.", extra: body });
        return;
      }
      sendResponse({ ok: false, error: body?.message || `Doğrulama başarısız: ${r.status}` });
      return;
    } else if (msg?.type === "BEESLY_UETS_LOGOUT") {
      await sessRemove("beeslyUetsToken");
      await sessRemove("beeslyUetsProfile");
      await chrome.storage.local.set({ beeslyUets: { connected: false, at: Date.now() } });
      sendResponse({ ok: true });
    } else if (msg?.type === "BEESLY_UETS_PROFILE") {
      const sess = await sessGet("beeslyUetsProfile");
      sendResponse({ profile: sess?.beeslyUetsProfile || null });
    } else if (msg?.type === "BEESLY_UETS_TEST") {
      // Canlı teşhis: token var mı, refresh anahtarı var mı, yenileme çalışıyor mu?
      // (Yenileme başarısız olursa mevcut token'a dokunulmaz.)
      const sess = await sessGet("beeslyUetsToken");
      const hasToken = !!sess?.beeslyUetsToken?.access_token;
      const hasRefresh = !!sess?.beeslyUetsToken?.refresh_token;
      let refreshOk = null;
      // Refresh anahtarı yoksa denenecek şey yok — BAŞARISIZ yazıp korkutma
      if (hasToken && hasRefresh) {
        refreshOk = !!(await tryRefreshUets());
      }
      sendResponse({ hasToken, hasRefresh, refreshOk });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true; // async sendResponse için gerekli
});
