// content-whatsapp-udf.js - web.whatsapp.com üzerinde çalışır
// Tek iş: WhatsApp'ın oluşturduğu <a download="x.udf.zip"> elemanlarındaki
// sondaki .zip'i atıp "x.udf" yapmak. Baytlara dokunulmaz, dosya adı ASLA
// baştan yazılmaz: metin okuma yok, tıklama takibi yok, kuyruk yok.
(function () {
  'use strict';

  function fixAnchor(a) {
    try {
      var cur = a.getAttribute('download') || '';
      if (cur.toLowerCase().endsWith('.udf.zip')) {
        a.setAttribute('download', cur.slice(0, -4));
      }
    } catch (_) {}
  }

  function sweep(root) {
    try {
      if (!root || !root.querySelectorAll) return;
      var list = root.querySelectorAll('a[download]');
      for (var i = 0; i < list.length; i++) fixAnchor(list[i]);
    } catch (_) {}
  }

  // Sayfa açılışında zaten duran düğmeler + sonradan eklenenler
  sweep(document);

  var observer = new MutationObserver(function (mutations) {
    for (var mi = 0; mi < mutations.length; mi++) {
      var nodes = mutations[mi].addedNodes;
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        if (!(node instanceof HTMLElement)) continue;
        if (node.tagName === 'A' && node.hasAttribute('download')) {
          fixAnchor(node);
        } else {
          sweep(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
