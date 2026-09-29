// content-ptt-view.js — "PTT'de aç" ile açılan GÖRÜNÜR sekmede çalışır.
// Tek seferlik anahtarı (beeslyViewBarcode) okuyup formu doldurur + SORGULA'ya basar.
// Kalıcı gizli sekme etkilenmez (görünür sekme kontrolü + anahtar tek kullanımlık).

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fillAndSubmit(barcode) {
  const input = Array.from(
    document.querySelectorAll('input[placeholder*="takip" i], input[name="value"], input[aria-label*="takip" i]')
  ).find((el) => el.offsetParent !== null);
  if (!input) return false;
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, barcode);
  else input.value = barcode;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  setTimeout(() => {
    const btn =
      document.querySelector('button[aria-label="SORGULA"]') ||
      Array.from(document.querySelectorAll("button")).find((b) => /sorgula/i.test(b.textContent || ""));
    if (btn) btn.click();
  }, 600);
  return true;
}

(async () => {
  try {
    // Yalnızca kullanıcının gördüğü sekmede çalış (kalıcı gizli sekmeye dokunma)
    if (document.visibilityState !== "visible") return;
    const data = await chrome.storage.local.get("beeslyViewBarcode");
    const v = data.beeslyViewBarcode;
    if (!v?.code || !v?.at || Date.now() - v.at > 2 * 60 * 1000) return;
    // Anahtarı hemen tüket (tek kullanımlık)
    await chrome.storage.local.remove("beeslyViewBarcode");
    if (document.visibilityState !== "visible") return;
    for (let i = 0; i < 15; i++) {
      if (fillAndSubmit(v.code)) break;
      await sleep(1000);
    }
  } catch (_) {}
})();
