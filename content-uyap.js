// content-uyap.js — UYAP sayfalarında barkod gözcüsü.
// Sayfada 4/5 ile başlayan barkod varsa araç çubuğu ikonunda sayı rozeti belirir.
// Chrome, eklentinin kendi penceresini otomatik açmasına izin vermez;
// rozet + tek tık, platforma izin verilen en yakın akıştır.

function countBarcodes() {
  try {
    const text = document.body ? document.body.innerText || "" : "";
    const out = new Set();
    (text.match(/\b([45]\d{12})\b/g) || []).forEach((b) => out.add(b));
    (text.match(/\bTB\d{8,13}\b/gi) || []).forEach((b) => out.add(b.toUpperCase()));
    (text.match(/[45][\d\s]{12,24}/g) || []).forEach((s) => {
      const d = s.replace(/\D/g, "");
      if (/^[45]\d{12}$/.test(d)) out.add(d);
    });
    return out.size;
  } catch (_) {
    return 0;
  }
}

let lastSent = -1;
function report() {
  const n = countBarcodes();
  if (n === lastSent) return;
  lastSent = n;
  try {
    chrome.runtime.sendMessage({ type: "BEESLY_UYAP_COUNT", count: n });
  } catch (_) {}
}

let timer = null;
function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(report, 1500);
}

report();
setTimeout(report, 3000); // geç yüklenen içerik için ikinci tur

try {
  const obs = new MutationObserver(schedule);
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      try {
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (_) {}
      report();
    });
  }
} catch (_) {}
