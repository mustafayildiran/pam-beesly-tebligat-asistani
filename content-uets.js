// content-uets.js — https://ptt.etebligat.gov.tr/* üzerinde çalışır.
// UETS Gönderi Sorgulama: GET https://api.etebligat.gov.tr/v1/messages/evidences/{barkod}
// Auth: Bearer <accessToken> (sayfanın localStorage'ından alınır).
// Akış:
//  1) Önce doğrudan API denenir (hızlı + popup'ta sonuç gösterilir).
//  2) Olmazsa forma otomatik yaz + Sorgula'ya bas (sayfa kendi auth'u ile çözer),
//     ardından sonuç DOM'dan okunup storage'a yazılır.

const UETS_API = "https://api.etebligat.gov.tr/v1";

function getTokenCandidates() {
  const out = [];
  try {
    for (const k of ["accessToken", "access_token", "token", "jwt", "authToken", "id_token"]) {
      const v = localStorage.getItem(k);
      if (v) out.push(v);
      const sv = sessionStorage.getItem(k);
      if (sv) out.push(sv);
    }
    // "user" objesi içinde de token olabilir
    for (const k of ["user", "auth", "session"]) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const o = JSON.parse(raw);
        for (const fk of ["access_token", "accessToken", "token"]) {
          if (o && typeof o[fk] === "string") out.push(o[fk]);
        }
      } catch (_) {}
    }
  } catch (_) {}
  // "Bearer " öneki / tırnak temizliği + şifreli görünenleri ele
  return [...new Set(out)]
    .map((t) => String(t).replace(/^Bearer\s+/i, "").replace(/^"|"$/g, "").trim())
    .filter((t) => t.length > 20 && /^[A-Za-z0-9\-._~+/=]+$/.test(t));
}

async function queryUetsApi(barcode) {
  // 1) Öncelik: eklenti içi formla alınan oturum token'ı (background'da tutulur)
  try {
    const resp = await chrome.runtime.sendMessage({ type: "BEESLY_UETS_TOKEN" });
    if (resp?.token) {
      const r = await fetch(`${UETS_API}/messages/evidences/${encodeURIComponent(barcode)}`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: "Bearer " + resp.token }
      });
      if (r.ok) return await r.json();
      if (r.status === 401 || r.status === 403) {
        throw new Error("Oturum süresi dolmuş. Giriş formundan yeniden giriş yapın.");
      }
      throw new Error("UETS sorgu başarısız: " + r.status);
    }
  } catch (e) {
    if (/Oturum süresi|başarısız/.test(e.message)) throw e;
    // background'a ulaşılamazsa sayfa token'larına düş
  }
  // 2) UETS sekmesindeki mevcut oturum (siteye giriş yapılmışsa)
  const tokens = getTokenCandidates();
  if (!tokens.length) throw new Error("UETS girişi bulunamadı (token yok). Önce UETS'e giriş yapın.");
  let lastErr = null;
  for (const tok of tokens) {
    const r = await fetch(`${UETS_API}/messages/evidences/${encodeURIComponent(barcode)}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer " + tok }
    });
    if (r.status === 401 || r.status === 403) {
      lastErr = new Error("Yetki reddedildi (401/403). UETS'te yeniden giriş yapın.");
      continue;
    }
    if (!r.ok) {
      lastErr = new Error("UETS sorgu başarısız: " + r.status);
      continue;
    }
    return await r.json();
  }
  throw lastErr || new Error("UETS sorgulanamadı");
}

function summarizeUetsResult(json) {
  try {
    if (!json) return { ok: false, text: "Boş yanıt" };
    // Gerçek format: { reference_id, evidences: [{ type, type_text, event, time }] }
    const evs = json.evidences || json.data?.evidences || (Array.isArray(json) ? json : []);
    if (Array.isArray(evs) && evs.length) {
      const last = evs[evs.length - 1];
      const main = last.type_text || last.event || last.type || "Kayıt bulundu";
      const time = last.time || last.tarih || last.date || "";
      const first = evs[0].type_text || "";
      const extra = evs.length > 1 ? ` (${evs.length} kayıt)` : "";
      return {
        ok: true,
        text: `${main}${time ? " | " + time : ""}${extra}`,
        status: String(main),
        date: String(time),
        desc: String(first),
        count: evs.length
      };
    }
    // Eski tahminler (farklı endpoint ihtimaline karşı)
    const obj = Array.isArray(json) ? json[0] : json.body || json.data || json;
    const status =
      obj?.status ?? obj?.durum ?? obj?.state ?? obj?.tebligatDurumu ?? obj?.deliveryStatus ?? "";
    const date =
      obj?.date ?? obj?.tarih ?? obj?.createdAt ?? obj?.created_at ?? obj?.notificationDate ?? "";
    const desc =
      obj?.description ?? obj?.aciklama ?? obj?.subject ?? obj?.konu ?? "";
    const main = status || desc || JSON.stringify(obj).slice(0, 200);
    return {
      ok: true,
      text: `${main}${date ? " | " + date : ""}`,
      status: String(status || ""),
      date: String(date || ""),
      desc: String(desc || "")
    };
  } catch (_) {
    return { ok: false, text: "Yanıt çözümlenemedi" };
  }
}

// Dunder Mifflin dokunuşu: UETS sekmesinde yüzen mini rozet
function beeslyBanner(text, mood) {
  try {
    let el = document.getElementById("beesly-uets-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "beesly-uets-banner";
      el.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:999999;background:#1a365d;color:#fff;" +
        "font:12px Arial,sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.background = mood === true ? "#2f855a" : mood === false ? "#c53030" : "#1a365d";
    if (mood !== undefined) setTimeout(() => el && el.remove(), 6000);
  } catch (_) {}
}

// Site oturum köprüsü: eklenti girişindeki profili, sitenin kendi
// saveAccessData/setAllReturn biçimiyle localStorage'a yazar.
// Böylece "Hesabı Aç"/Gönderi Sorgulama sayfaları login duvarına takılmaz.
async function bridgeSiteSession() {
  try {
    if (localStorage.getItem("beeslyBridgedAt")) return; // sekme başına bir kez
    const resp = await chrome.runtime.sendMessage({ type: "BEESLY_UETS_PROFILE" });
    const p = resp?.profile;
    if (!p || !p.access_token || !p.id || !p.attributes) return;
    const existing = localStorage.getItem("accessToken");
    // Sitede başka bir oturum varsa (farklı token) dokunma — sayfa onunkini kullanır
    if (existing && existing !== p.access_token) return;
    if (localStorage.getItem("accessToken") === p.access_token) {
      localStorage.setItem("beeslyBridgedAt", String(Date.now()));
      return;
    }
    const prefs = p.attributes.preferences || {};
    const user = JSON.parse(JSON.stringify(p));
    ["access_token", "tcn", "vgn", "msn", "dtn", "ext_type"].forEach((k) => delete user[k]);
    user.admin = 0;
    if (Array.isArray(user.clients)) {
      const c = user.clients.find((t) => String(t.id) === String(user.id));
      if (c && c.admin) user.admin = Number(c.admin);
    }
    localStorage.setItem("accessToken", p.access_token);
    if (p.refresh_token || p.refreshToken) {
      localStorage.setItem("refreshToken", p.refresh_token || p.refreshToken);
    }
    localStorage.setItem("userRoles", JSON.stringify(["ADMIN"]));
    localStorage.setItem("expire", String(Math.floor(Date.now() / 1000)));
    localStorage.setItem("current_id", String(p.id));
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("per_page_item", String((p.attributes.preferences && prefs.per_page_item) || 10));
    localStorage.setItem("refresh_time", String(prefs.refresh_time || 5));
    localStorage.setItem("attributes", JSON.stringify(p.attributes));
    localStorage.setItem("login_type", "kullaniciGirisi");
    localStorage.setItem("beeslyBridgedAt", String(Date.now()));
  } catch (_) {}
}

function angularSetValue(input, value) {  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function autoFillUets(barcode) {
  const candidates = Array.from(
    document.querySelectorAll('input[type="text"], input:not([type])')
  ).filter((el) => el.offsetParent !== null);
  candidates.sort((a, b) => {
    const score = (el) => {
      const s = ((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.name || "")).toLowerCase();
      return /barkod|takip|sorgu|gönderi|gonderi|uets|tebligat|evrak|numara/.test(s) ? 0 : 1;
    };
    return score(a) - score(b);
  });
  const input = candidates[0];
  if (!input) return false;
  input.focus();
  angularSetValue(input, barcode);
  setTimeout(() => {
    const btn =
      Array.from(document.querySelectorAll("button")).find((b) =>
        /sorgula|sorgu|ara|araştır|görüntüle/i.test(b.textContent || "")
      ) || document.querySelector('button[type="submit"]');
    if (btn) btn.click();
  }, 600);
  return true;
}

async function saveResult(barcode, summary, raw, notify = true) {
  await chrome.storage.local.set({
    ["beeslyResult_" + barcode]: { at: Date.now(), summary, raw: raw ?? null }
  });
  if (!notify) return; // ara kayıt: sekme kapanmasın, rozet değişmesin
  try {
    chrome.runtime.sendMessage({
      type: "BEESLY_QUERY_DONE",
      barcode,
      ok: !!summary?.ok,
      error: summary?.text || ""
    });
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Site oturumu yedeği: form doldurulup Sorgula'ya basıldıktan sonra
// sonuç tablosunu sayfadan oku (API jetonu yokken site girişiyle çalışır)
async function scrapeUetsPage(timeoutMs = 35000) {
  const t0 = Date.now();
  const skip = /^(Ana Sayfa|Gelen Kutusu|Gönderilen|Arşiv|Raporlar|Klasörler|Adres Defteri|Ayarlar|Çıkış|Gönderi Sorgulama|Gizlilik|Yasal|İletişim|UETS)/;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1500);
    let txt = "";
    try { txt = document.body?.innerText || ""; } catch (_) {}
    const lines = txt.split("\n").map((s) => s.trim()).filter((s) => s.length > 2 && !skip.test(s));
    const good = lines.filter(
      (l) => /\b\d{2}[./]\d{2}[./]\d{4}\b/.test(l) || /KABUL|TEBL[Iİ]G|TESL[Iİ]M|OKUN|KANUN|RED|İADE|GÖNDER[Iİ]LD[Iİ]/.test(l)
    );
    if (good.length >= 1 && good.some((l) => /KABUL|TEBL[Iİ]G|TESL[Iİ]M|OKUN|KANUN/.test(l))) {
      const head = good.find((l) => /KABUL|TEBL[Iİ]G|TESL[Iİ]M|OKUN|KANUN/.test(l)) || good[0];
      return {
        summary: {
          ok: true,
          text: head,
          moves: good.slice(0, 20).map((t) => ({ tarih: "", aciklama: t })),
          scraped: true
        }
      };
    }
  }
  return null;
}

async function handleStoredBarcode() {
  const { beeslyBarcode, beeslyTs } = await chrome.storage.local.get(["beeslyBarcode", "beeslyTs"]);
  if (!beeslyBarcode || !/^5\d{12}$/.test(beeslyBarcode)) return;
  if (beeslyTs && Date.now() - beeslyTs > 5 * 60 * 1000) return;

  if (location.pathname.includes("/login")) {
    beeslyBanner("Jim bakıyor... önce UETS girişi gerekli.", false);
    await saveResult(beeslyBarcode, {
      ok: false,
      text: "UETS girişi gerekli: açılan sayfada giriş yapın, sonra popup'tan tekrar Sorgula'ya basın."
    });
    return;
  }

  beeslyBanner("Beesly barkodunu yapıştırdı, Pam dosyalıyor...");
  // 1) Doğrudan API
  try {
    const json = await queryUetsApi(beeslyBarcode);
    const summary = summarizeUetsResult(json);
    await saveResult(beeslyBarcode, summary, json);
    beeslyBanner("Tebligat başarıyla getirildi!", true);
    return; // API tuttuysa formu doldurmaya gerek yok
  } catch (e) {
    // 401/token yoksa bile forma düş (sayfa kendi session'ı ile çözebilir);
    // ara kayıt sessizdir, sekme kapanmaz
    await saveResult(beeslyBarcode, { ok: false, text: String(e.message || e) }, null, false);
  }

  // 2) Form doldurma + sayfadan sonuç okuma (site oturumu yedeği)
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (autoFillUets(beeslyBarcode) || tries > 20) clearInterval(timer);
  }, 1000);
  const found = await scrapeUetsPage(35000);
  clearInterval(timer);
  if (found) {
    await saveResult(beeslyBarcode, found.summary, null, true);
    beeslyBanner("Tebligat başarıyla getirildi!", true);
  } else {
    await saveResult(
      beeslyBarcode,
      { ok: false, text: "Sayfada sonuç okunamadı. Sekmeyi açıp giriş durumunu kontrol edin." },
      null,
      true
    );
  }
}

// Oturum köprüsü her UETS sayfasında çalışır (giriş bayrağı yazılmaz;
// rozetin tek kaynağı eklenti jetonudur).
(async () => {
  try {
    await bridgeSiteSession();
  } catch (_) {}
})();

handleStoredBarcode();
