// UYAP EYP Görüntüleyici (bağımsız paket) + Beesly ailesi bağlantısı.
(function () {
  var open = document.getElementById('open');
  if (open) {
    open.addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('eyp-viewer.html') });
    });
  }
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
