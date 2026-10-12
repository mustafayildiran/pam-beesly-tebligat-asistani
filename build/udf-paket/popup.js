// WhatsApp UDF Düzeltici (bağımsız paket) — durum + Beesly ailesi bağlantısı.
(function () {
  chrome.runtime.sendMessage({ type: 'UDF_PING' }, function (res) {
    var el = document.getElementById('durum');
    if (!el) return;
    if (chrome.runtime.lastError || !res || !res.ok) {
      el.textContent = 'Arka plan çalışmıyor. Eklentiyi kapatıp açın.';
      return;
    }
    el.innerHTML = '';
    var ok = document.createElement('span');
    ok.className = 'ok';
    ok.textContent = '● Aktif. ';
    el.appendChild(ok);
    el.appendChild(document.createTextNode('web.whatsapp.com sekmesinde çalışır.'));
  });
  var all = document.getElementById('all');
  if (all) {
    all.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        chrome.tabs.create({ url: 'https://github.com/mustafayildiran/pam-beesly-tebligat-asistani/releases' });
      } catch (_) {}
    });
  }
})();
