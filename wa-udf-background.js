// ===== WhatsApp UDF Düzeltici (Beesly ile birleşik) =====
// Amaç: WhatsApp Web'den gelen .udf dosyalarının .zip dayatmasıyla inmesini
// engellemek. Baytlara dokunulmaz, dosya adı ASLA baştan yazılmaz:
//   x.udf      -> aynen bırakılır (Chrome'un .zip eklemesi engellenir)
//   x.udf.zip  -> x.udf yapılır (sondaki .zip atılır)
//   x.zip ve diğerleri -> dokunulmaz (gerçek zip'ler güvende)
// Kuyruk/bellek tutulmaz; tıklama takibi yok, metin okuma yok.
(function () {
  function cleanBase(n) {
    var raw = String(n || '');
    var base = raw.split('/').pop().split('\\').pop().split('?')[0].split('#')[0];
    return base || raw;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'UDF_PING') {
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  chrome.downloads.onDeterminingFilename.addListener(function (item, suggest) {
    try {
      var fromWhatsapp =
        (item.referrer && item.referrer.indexOf('web.whatsapp.com') !== -1) ||
        (item.url && item.url.indexOf('blob:https://web.whatsapp.com') === 0);

      if (!fromWhatsapp) return; // başka sitelere (UYAP/PTT dahil) dokunma

      var current = cleanBase(item.filename);
      var lower = current.toLowerCase();

      // 1) Zaten doğru iniyorsa ellemeden onayla
      if (lower.endsWith('.udf') && !lower.endsWith('.udf.zip')) {
        suggest({ filename: current, conflictAction: 'uniquify' });
        return;
      }

      // 2) "dosya.udf.zip" geldiyse sondaki .zip'i at, gerisine dokunma
      if (lower.endsWith('.udf.zip')) {
        suggest({ filename: current.slice(0, -4), conflictAction: 'uniquify' });
        return;
      }

      // 3) Saf .zip ve diğerleri: dokunma. Ad baştan yazılmaz.
    } catch (e) {
      try { console.warn('[wa-udf] onDeterminingFilename hatası:', e); } catch (_) {}
    }
  });
})();
