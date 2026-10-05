document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('container');
  const toast = document.getElementById('toast');
  try { chrome.action.setBadgeText({ text: '' }); } catch (_) {} // rozeti temizle

  function showToast(text) {
    toast.textContent = text;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 1500);
  }

  function copyBarcode(barcode) {
    navigator.clipboard.writeText(barcode).then(() => showToast('Barkod Panoya Kopyalandı!'));
  }

  // PTT motorunu önceden ısıt (gizli sekme + Turnstile token hazır olsun)
  try { chrome.runtime.sendMessage({ type: 'PTT_WARM' }); } catch (_) {}

  // --- Dunder Mifflin tema: GIF'ler yerelde aranır, yoksa emoji yedeği ---
  // Uzak GIF kullanmak istersen örn: "https://media.giphy.com/media/XXXX/giphy.gif"
  const GIF_CANDIDATES = {
    success: ['assets/pam-success.gif'],
    notFound: ['assets/michael-panic.gif', 'assets/micheal-panic.gif'],
    error: ['assets/michael-no.gif', 'assets/micheal-no.gif'],
    empty: ['assets/steve-carell.gif', 'assets/steve carell.gif'],
    jim: ['assets/jim-wrong-tab.gif', 'assets/Yanlış Sekme.gif', 'assets/yanlış sekme.gif', 'assets/yanlis-sekme.gif'],
    party: ['assets/applause-clap.gif', 'assets/hell-yeah.gif']
  };
  const GIF_FALLBACK_EMOJI = { success: '🎨', notFound: '😱', error: '📢', empty: '😐', jim: '😒', party: '🥳' };

  function mediaHtml(kind) {
    const list = GIF_CANDIDATES[kind] || [];
    const img = document.createElement('img');
    img.className = 'result-media';
    img.alt = kind;
    let i = 0;
    const tryNext = () => {
      if (i < list.length) {
        img.src = list[i++];
      } else {
        const fb = document.createElement('div');
        fb.className = 'result-emoji';
        fb.textContent = GIF_FALLBACK_EMOJI[kind] || '📄';
        img.replaceWith(fb);
      }
    };
    img.onerror = tryNext;
    tryNext();
    return img;
  }

  // UETS bağlantı durumu: content-uets.js UETS sayfaları her açıldığında
  // oturum varsa beeslyUets={connected:true} yazar.
  const uetsStatus = document.getElementById('uetsStatus');
  const uetsForm = document.getElementById('uetsForm');
  const uetsFormBtn = document.getElementById('uetsFormBtn');
  const uetsCheckBtn = document.getElementById('uetsCheckBtn');
  async function refreshUetsStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'BEESLY_UETS_STATUS' });
      const connected = !!resp?.status?.connected;
      if (connected) {
        let ageTxt = '';
        try {
          const at = resp.status.at || 0;
          if (at) {
            const m = Math.round((Date.now() - at) / 60000);
            if (m >= 60) ageTxt = ' · ' + Math.floor(m / 60) + 'sa' + (m % 60 ? ' ' + (m % 60) + 'dk' : '');
            else if (m > 0) ageTxt = ' · ' + m + 'dk';
          }
        } catch (_) {}
        uetsStatus.textContent = '● UETS: bağlı ✓' + ageTxt;
        uetsStatus.className = 'dot on';
        // Bağlıyken giriş düğmesi gizlenir, rozet + kontrol kalır
        uetsFormBtn.style.display = 'none';
        uetsCheckBtn.style.display = '';
        uetsForm.style.display = 'none';
      } else {
        uetsStatus.textContent = '● UETS: giriş gerekli';
        uetsStatus.className = 'dot off';
        uetsFormBtn.style.display = '';
        uetsCheckBtn.style.display = 'none';
      }
    } catch (_) {}
  }
  refreshUetsStatus();
  // Popup açıkken oturumu periyodik yokla: düşmüşse giriş formu gelsin, bağlıysa öyle kalsın
  setInterval(refreshUetsStatus, 30000);

  // Yoklama barkodu: ilk kurulumda bir kez sorulur, yalnızca cihazda saklanır
  const canarySetup = document.getElementById('canarySetup');
  const canaryInput = document.getElementById('canaryInput');
  const canaryMsg = document.getElementById('canaryMsg');
  async function ensureCanary() {
    try {
      const d = await chrome.storage.local.get('beeslyCanary');
      const has = !!d?.beeslyCanary;
      canarySetup.style.display = has ? 'none' : 'block';
      return has;
    } catch (_) {
      return true;
    }
  }
  ensureCanary();
  document.getElementById('canarySaveBtn').addEventListener('click', async () => {
    const code = (canaryInput.value || '').replace(/[\s.-]/g, '');
    if (!/^5\d{12}$/.test(code)) {
      canaryMsg.style.display = 'block';
      canaryMsg.className = 'result err';
      canaryMsg.textContent = '5 ile başlayan 13 haneli kendi barkodunuzu girin.';
      return;
    }
    await chrome.storage.local.set({ beeslyCanary: code });
    canaryMsg.style.display = 'block';
    canaryMsg.className = 'result ok';
    canaryMsg.textContent = 'Kaydedildi ✓ — bir daha sorulmayacak.';
    setTimeout(() => { canarySetup.style.display = 'none'; }, 1200);
  });

  uetsCheckBtn.addEventListener('click', async () => {
    uetsStatus.textContent = '● UETS: kontrol ediliyor...';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'BEESLY_UETS_TOKENINFO' });
      if (!r?.present) {
        refreshUetsStatus();
        return;
      }
      if (r.needsCanary) {
        // Yoklama barkodu henüz kaydedilmemiş: kartı göster
        canarySetup.style.display = 'block';
        uetsStatus.textContent = '● UETS: yoklama barkodu gerekli';
        uetsStatus.className = 'dot off';
        return;
      }
      if (r.expired || r.live === false) {
        // Jeton ölü (süre dolmuş ya da sunucu reddetmiş): giriş formu gelsin
        uetsStatus.textContent = '● UETS: bağlantı doğrulanamadı';
        uetsStatus.className = 'dot off';
        uetsFormBtn.style.display = '';
        uetsCheckBtn.style.display = 'none';
        uetsForm.style.display = 'block';
        return;
      }
      if (r.live === true) {
        uetsStatus.textContent = '● UETS: bağlı ✓ · canlı doğrulandı';
        uetsStatus.className = 'dot on';
        return;
      }
      // live null: geçici arıza, süre bilgisine düş
      if (r.expInMin !== null && r.expInMin !== undefined) {
        const h = Math.floor(r.expInMin / 60);
        const m = r.expInMin % 60;
        uetsStatus.textContent = '● UETS: bağlı ✓ · jeton ' + (h > 0 ? h + 'sa ' + m + 'dk' : m + 'dk') + ' geçerli';
      } else {
        uetsStatus.textContent = '● UETS: bağlı ✓ · jeton mevcut (süre okunamadı)';
      }
      uetsStatus.className = 'dot on';
    } catch (_) {
      refreshUetsStatus();
    }
  });

  // Gömülü giriş formu (UETS şifresi + güvenlik kodu, sitenin akışıyla birebir)
  const uetsExtId = document.getElementById('uetsExtId');
  const uetsPass = document.getElementById('uetsPass');
  const uetsCaptchaImg = document.getElementById('uetsCaptchaImg');
  const uetsCaptchaCode = document.getElementById('uetsCaptchaCode');
  const uetsFormMsg = document.getElementById('uetsFormMsg');
  let captchaKey = '';
  let captchaLoadedAt = 0;
  function formMsg(text, ok) {
    uetsFormMsg.style.display = 'block';
    uetsFormMsg.className = 'result ' + (ok ? 'ok' : 'err');
    uetsFormMsg.textContent = text;
  }
  async function loadCaptcha() {
    try {
      uetsCaptchaImg.alt = 'Yükleniyor...';
      const resp = await chrome.runtime.sendMessage({ type: 'BEESLY_UETS_CAPTCHA' });
      if (resp?.ok) {
        captchaKey = resp.captchaKey || '';
        captchaLoadedAt = Date.now();
        uetsCaptchaImg.src = resp.image;
      } else {
        formMsg(resp?.error || 'Güvenlik kodu alınamadı.', false);
      }
    } catch (e) {
      formMsg('Güvenlik kodu alınamadı.', false);
    }
  }
  uetsFormBtn.addEventListener('click', () => {
    const open = uetsForm.style.display === 'none';
    uetsForm.style.display = open ? 'block' : 'none';
    uetsFormBtn.innerText = open ? 'Kapat' : 'Giriş Yap';
    if (open) loadCaptcha();
  });
  document.getElementById('uetsCaptchaBtn').addEventListener('click', loadCaptcha);
  document.getElementById('uetsLoginBtn').addEventListener('click', async () => {
    // Güvenlik kodu tek kullanımlık/süreli: bayatsa önce yenile, eski kodla deneme
    if (!captchaKey || Date.now() - captchaLoadedAt > 90000) {
      formMsg('Güvenlik kodu yenilendi, yeni kodu girip tekrar deneyin.', false);
      loadCaptcha();
      return;
    }
    formMsg('Giriş yapılıyor...', false);
    const resp = await chrome.runtime.sendMessage({
      type: 'BEESLY_UETS_LOGIN',
      extId: uetsExtId.value,
      password: uetsPass.value,
      captchaCode: uetsCaptchaCode.value,
      captchaKey
    });
    if (resp?.ok) {
      loginDone();
    } else if (resp?.needCode) {
      // 1. adım tamam, sunucu SMS/e-posta kodu gönderdi -> 2. adım ekranı
      pendingExtra = resp.extra || {};
      document.getElementById('uetsStep1').style.display = 'none';
      document.getElementById('uetsStep2').style.display = 'block';
      document.getElementById('uetsVerifyInfo').textContent =
        (resp.message || 'Doğrulama kodu gönderildi.') + ' Kodu aşağıya girin.';
      formMsg('Doğrulama kodu bekleniyor.', false);
    } else {
      formMsg(resp?.error || 'Giriş başarısız.', false);
      loadCaptcha(); // kod tek kullanımlık olabilir, yenile
    }
  });
  function loginDone() {
    uetsPass.value = ''; // şifre bellekte tutulmaz
    uetsCaptchaCode.value = '';
    document.getElementById('uetsValidationCode').value = '';
    document.getElementById('uetsStep2').style.display = 'none';
    document.getElementById('uetsStep1').style.display = 'block';
    pendingExtra = null;
    uetsFormMsg.style.display = 'block';
    uetsFormMsg.className = 'result ok';
    uetsFormMsg.innerHTML = '';
    uetsFormMsg.appendChild(mediaHtml('party'));
    const t = document.createElement('div');
    t.className = 'ux-title';
    t.textContent = 'Giriş başarılı ✓ — Pam seni içeri aldı.';
    uetsFormMsg.appendChild(t);
    refreshUetsStatus();
  }
  let pendingExtra = null;
  document.getElementById('uetsVerifyBtn').addEventListener('click', async () => {
    formMsg('Doğrulanıyor...', false);
    const resp = await chrome.runtime.sendMessage({
      type: 'BEESLY_UETS_VERIFY',
      extId: uetsExtId.value,
      password: uetsPass.value,
      captchaCode: uetsCaptchaCode.value,
      captchaKey,
      extra: pendingExtra,
      validationCode: document.getElementById('uetsValidationCode').value
    });
    if (resp?.ok) {
      loginDone();
    } else if (resp?.needCode) {
      pendingExtra = resp.extra || pendingExtra;
      formMsg((resp.message || 'Yeni kod gönderildi.') + ' Kodu girin.', false);
    } else {
      formMsg(resp?.error || 'Doğrulama başarısız.', false);
    }
  });
  document.getElementById('uetsResendBtn').addEventListener('click', async () => {
    formMsg('Kod tekrar gönderiliyor...', false);
    const resp = await chrome.runtime.sendMessage({
      type: 'BEESLY_UETS_LOGIN',
      extId: uetsExtId.value,
      password: uetsPass.value,
      captchaCode: uetsCaptchaCode.value,
      captchaKey
    });
    if (resp?.needCode) {
      pendingExtra = resp.extra || pendingExtra;
      formMsg(resp.message || 'Kod tekrar gönderildi.', false);
    } else if (resp?.ok) {
      loginDone();
    } else {
      formMsg(resp?.error || 'Kod gönderilemedi.', false);
      loadCaptcha();
    }
  });
  document.getElementById('uetsLogoutBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'BEESLY_UETS_LOGOUT' });
    document.getElementById('uetsStep2').style.display = 'none';
    document.getElementById('uetsStep1').style.display = 'block';
    pendingExtra = null;
    formMsg('Çıkış yapıldı.', false);
    refreshUetsStatus();
    loadCaptcha();
  });
  document.getElementById('uetsTestBtn').addEventListener('click', async () => {
    formMsg('Bağlantı test ediliyor...', false);
    try {
      const r = await chrome.runtime.sendMessage({ type: 'BEESLY_UETS_TEST' });
      const parts = [
        'Token: ' + (r?.hasToken ? 'var' : 'yok'),
        'Refresh: ' + (r?.hasRefresh ? 'var' : 'yok'),
        r?.refreshOk === null ? '' : 'Yenileme: ' + (r.refreshOk ? 'başarılı ✓' : 'BAŞARISIZ')
      ].filter(Boolean);
      formMsg(parts.join(' • '), !!r?.refreshOk);
      refreshUetsStatus();
    } catch (_) {
      formMsg('Test çalıştırılamadı.', false);
    }
  });

  // ---- Paylaşılan sonuç kutusu yardımcıları (kartlar + manuel sekme) ----
  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Tüm kanıt/hareket listesi: kabul / teslim / okunma / kanunen tebliğ dahil hepsi
  function detailsHtml(result, barcode) {
    const raw = result?.raw;
    const evs = raw?.evidences;
    if (Array.isArray(evs) && evs.length) {
      const rows = evs.map((e) => {
        const t = e.type_text || e.event || e.type || '-';
        const time = e.time || e.tarih || e.date || '';
        return `<div style="padding:2px 0;border-top:1px solid #e0e0e0">✓ <b>${esc(t)}</b>${time ? ' <span style="color:#555">| ' + esc(time) + '</span>' : ''}</div>`;
      }).join('');
      return `<div style="margin-top:4px"><b>Tüm kayıtlar (${evs.length}):</b>${rows}</div>`;
    }
    const moves = result?.summary?.moves;
    if (Array.isArray(moves) && moves.length) {
      // Kompakt görünüm: sadece son durum (başlıkta) + gönderi hareketleri
      const rows = moves.map((m) => {
        const meta = [m.tarih, m.saat].filter(Boolean).join(' ') + (m.isyeri ? ' · ' + m.isyeri : '');
        return `<div style="padding:2px 0;border-top:1px solid #e0e0e0">• ${esc(m.aciklama)}${m.islemDetay ? ' — ' + esc(m.islemDetay) : ''}${meta ? ' <span style="color:#555">| ' + esc(meta) + '</span>' : ''}</div>`;
      }).join('');
      return `<div style="margin-top:4px"><b>Gönderi hareketleri (${moves.length}):</b>${rows}</div>`
        + (barcode ? `<div style="margin-top:6px"><button class="btn btn-secondary" data-view-ptt="${esc(barcode)}">PTT'de aç</button></div>` : '');
    }
    return '';
  }

  function boxLoading(box) {
    box.style.display = 'block';
    box.className = 'result';
    box.innerHTML = '';
    const sp = document.createElement('div');
    sp.className = 'spinner';
    const t = document.createElement('div');
    t.className = 'ux-title';
    t.textContent = 'Pam şu an evrakları dosyalıyor, lütfen bekleyin...';
    box.append(sp, t);
  }

  function boxSuccess(box, text, details) {
    box.style.display = 'block';
    box.className = 'result ok';
    box.innerHTML = '';
    box.appendChild(mediaHtml('success'));
    const t = document.createElement('div');
    t.className = 'ux-title';
    t.textContent = 'Tebligat başarıyla getirildi!';
    const sub = document.createElement('div');
    sub.className = 'ux-sub';
    sub.textContent = text || '';
    box.append(t, sub);
    if (details) {
      const d = document.createElement('div');
      d.className = 'result-details';
      d.innerHTML = details;
      box.appendChild(d);
    }
  }

  function boxNotFound(box, detail) {
    box.style.display = 'block';
    box.className = 'result err';
    box.innerHTML = '';
    box.appendChild(mediaHtml('notFound'));
    const t = document.createElement('div');
    t.className = 'ux-title';
    t.textContent = 'Sistemde böyle bir tebligat bulunamadı!';
    const sub = document.createElement('div');
    sub.className = 'ux-sub';
    sub.textContent = 'Michael panikledi ama evrak gerçekten yok.';
    box.append(t, sub);
    if (detail) {
      const d = document.createElement('div');
      d.style.cssText = 'margin-top:4px;color:#777;font-size:11px';
      d.textContent = detail;
      box.appendChild(d);
    }
  }

  function boxError(box, detail) {
    box.style.display = 'block';
    box.className = 'result err';
    box.innerHTML = '';
    box.appendChild(mediaHtml('error'));
    const t = document.createElement('div');
    t.className = 'ux-title';
    t.textContent = 'Dunder Mifflin sunucularına ulaşılamıyor. Dwight yine kabloları kesmiş olabilir!';
    box.appendChild(t);
    if (detail) {
      const sub = document.createElement('div');
      sub.className = 'ux-sub';
      sub.textContent = detail;
      box.appendChild(sub);
    }
  }

  function appendDebug(box, barcode) {
    chrome.runtime.sendMessage({ type: 'BEESLY_GET_DEBUG', barcode }).then((d) => {
      const dbg = d?.debug;
      if (!dbg) return;
      const dir = dbg.direct || '';
      const fb = dbg.fallback || '';
      // Ulaşım tamamsa (main-world/ok) ve yedek çalışmadıysa iz gürültüdür, gösterme
      const showDir = dir && dir !== 'main-world' && dir !== 'ok';
      if (!showDir && !fb) return;
      const line = document.createElement('div');
      line.style.cssText = 'margin-top:4px;color:#777;font-size:11px';
      line.textContent = `İz:${showDir ? ' direkt=' + dir : ''}${fb ? ' yedek=' + fb : ''}`;
      box.appendChild(line);
    });
  }

  function paintResult(box, text, ok, result, barcode) {
    // "Başarıyla getirildi" paketinde KAYIT YOK yazıyorsa panik moduna al
    if (ok && /KAYIT YOK|BULUNAMADI/i.test(text)) ok = false;
    if (ok) {
      boxSuccess(box, text, result ? detailsHtml(result, barcode) : '');
      return;
    }
    // Türkçe-İ tuzağı: /i bayrağı büyük I ile eşleşmez, önce büyütüp düz kalıpla bak
    const upper = String(text || '').toLocaleUpperCase('tr-TR');
    if (/KAYIT YOK|BULUNAMADI|BOŞ YANIT|BULUNMADI/.test(upper)) boxNotFound(box, text);
    else boxError(box, text);
    if (barcode) appendDebug(box, barcode);
  }

  // ---- Manuel sorgu kaldırıldı (0.13.6): tek panel, sayfa taraması ----

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    // Pencere-yedeğiyle açıldıysak (?srcTab=): kaynak UYAP sekmesini kullan
    let activeTab = tabs[0];
    try {
      const srcId = parseInt(new URLSearchParams(location.search).get("srcTab"), 10);
      if (Number.isFinite(srcId)) {
        try { activeTab = await chrome.tabs.get(srcId); } catch (_) {}
      }
    } catch (_) {}
    const tabUrl = (activeTab?.url || activeTab?.pendingUrl || '').toLowerCase();

    // Kapsam: yalnızca UYAP. Başka sekmede Jim uyarısı çıkar.
    const isUyap = !!tabUrl.includes('uyap');
    if (!activeTab || !isUyap) {
      let host = '';
      try { host = new URL(activeTab?.url || '').hostname; } catch (_) {}
      container.innerHTML = '';
      const warn = document.createElement('div');
      warn.className = 'result err';
      warn.appendChild(mediaHtml('jim'));
      const wt = document.createElement('div');
      wt.className = 'ux-title';
      wt.textContent = 'Jim, yanlış sekmedesin!';
      const wsub = document.createElement('div');
      wsub.className = 'ux-sub';
      wsub.textContent = 'Beesly ancak UYAP Avukat Portal açıkken çalışır. Dwight not ediyor.';
      warn.append(wt, wsub);
      if (host) {
        const h = document.createElement('div');
        h.style.cssText = 'margin-top:4px;color:#777;font-size:11px';
        h.textContent = 'Şu an açık: ' + host;
        warn.appendChild(h);
      }
      container.appendChild(warn);
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: activeTab.id, allFrames: true },
        func: () => {
          const findBarcodes = (text) => {
            const out = new Set();
            const t = String(text);
            (t.match(/\b([45]\d{12})\b/g) || []).forEach((b) => out.add(b));
            (t.match(/\bTB\d{8,13}\b/gi) || []).forEach((b) => out.add(b.toUpperCase()));
            // UYAP bazen aralıklı yazar ("4xxx xxx xxx"): boşlukları temizleyip dene
            (t.match(/[45][\d\s]{12,24}/g) || []).forEach((s) => {
              const d = s.replace(/\D/g, "");
              if (/^[45]\d{12}$/.test(d)) out.add(d);
            });
            (t.match(/TB[\d\s]{8,18}/gi) || []).forEach((s) => {
              const d = s.replace(/\s/g, "").toUpperCase();
              if (/^TB\d{8,13}$/.test(d)) out.add(d);
            });
            return [...out];
          };
          let sel = '';
          try { sel = window.getSelection ? window.getSelection().toString() : ''; } catch (_) {}
          let allText = document.body.innerText || '';
          document.querySelectorAll('td, span, div').forEach((el) => {
            if (el.innerText) allText += ' ' + el.innerText;
          });
          const normSel = findBarcodes(sel)[0] || null;
          return { found: findBarcodes(allText), sel: normSel };
        }
      },
      (results) => {
        if (chrome.runtime.lastError || !results) {
          container.innerHTML = `<div class="msg" style="color: #c62828;">Sayfa okunurken hata oluştu.</div>`;
          return;
        }

        let allBarcodes = [];
        let selCode = null;
        results.forEach((frame) => {
          if (frame && frame.result) {
            if (Array.isArray(frame.result.found)) allBarcodes.push(...frame.result.found);
            if (frame.result.sel && !selCode) selCode = frame.result.sel;
          }
        });
        allBarcodes = [...new Set(allBarcodes)];
        // Seçili barkod varsa başa al (Ctrl+Shift+B akışı da buraya düşer)
        if (selCode) allBarcodes = [selCode, ...allBarcodes.filter((b) => b !== selCode)];

        if (allBarcodes.length === 0) {
          container.innerHTML = '';
          const empty = document.createElement('div');
          empty.className = 'result err';
          empty.appendChild(mediaHtml('empty'));
          const t = document.createElement('div');
          t.className = 'ux-title';
          t.textContent = 'Dosyalanacak evrak yok!';
          const sub = document.createElement('div');
          sub.className = 'ux-sub';
          sub.textContent = 'Bu sayfada sorgulanabilir barkod bulunamadı. Pam beklemeye geçti.';
          empty.append(t, sub);
          container.appendChild(empty);
          return;
        }

        container.innerHTML = '';
        allBarcodes.forEach((barcode) => {
          const isUets = /^5\d{12}$/.test(barcode);

          const item = document.createElement('div');
          item.className = 'barcode-item';

          const row = document.createElement('div');
          row.className = 'row';

          const infoDiv = document.createElement('div');
          infoDiv.className = 'info';
          infoDiv.innerHTML = `
            <span class="badge ${isUets ? 'badge-uets' : 'badge-ptt'}">${isUets ? 'UETS (5)' : 'PTT (4)'}</span><br>
            <b>${barcode}</b>
          `;

          const btnWrap = document.createElement('div');

          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn btn-secondary';
          copyBtn.innerText = 'Kopyala';
          copyBtn.addEventListener('click', () => copyBarcode(barcode));

          const queryBtn = document.createElement('button');
          queryBtn.className = 'btn';
          queryBtn.innerText = isUets ? 'UETS Sorgula' : 'PTT Sorgula';

          const resultDiv = document.createElement('div');
          resultDiv.className = 'result';
          resultDiv.style.display = 'none';
          resultDiv.id = 'result-container';
          // "PTT'de aç" gibi iç butonlar için temsilci tıklama
          resultDiv.addEventListener('click', (e) => {
            const barcode = e.target?.dataset?.viewPtt;
            if (barcode) chrome.runtime.sendMessage({ type: 'BEESLY_OPEN_PTT_PAGE', barcode });
          });

          // Kart, üst paylaşımlı boyacıları kullanır (istenen show* API'si korunur)
          function showLoading() { boxLoading(resultDiv); }
          function showSuccess(data) { boxSuccess(resultDiv, data?.text, data?.detailsHtml); }
          function showNotFoundError() { boxNotFound(resultDiv); }
          function showConnectionError(detail) { boxError(resultDiv, detail); }
          function setResult(text, ok, result) { paintResult(resultDiv, text, ok, result, barcode); }

          async function pollResult(label, tries = 18) {
            for (let i = 0; i < tries; i++) {
              await new Promise((r) => setTimeout(r, 2000));
              const resp = await chrome.runtime.sendMessage({ type: 'BEESLY_GET_RESULT', barcode });
              if (resp?.result?.summary) {
                const s = resp.result.summary;
                setResult(
                  s.ok
                    ? `Son durum: ${s.text}${s.kabulTarih ? ' | Kabul: ' + s.kabulTarih : ''}`
                    : `Sorgu: ${s.text}`,
                  s.ok,
                  resp.result
                );
                // Hata mesajı "giriş gerekli" değilse dur; giriş gerekliyse beklemeye devam etme
                if (s.ok || !/giriş/i.test(s.text)) {
                  queryBtn.disabled = false;
                  queryBtn.innerText = label;
                  return;
                }
              }
            }
            setResult('Sayfa açıldı, sonuç bekleniyor. Sayfadaki sonuca bakın.', false);
            queryBtn.disabled = false;
            queryBtn.innerText = label;
          }

          queryBtn.addEventListener('click', async () => {
            copyBarcode(barcode);
            showLoading(); // Pam dosyalıyor...
            if (isUets) {
              // 5xx: UETS Gönderi Sorgulama: GET api.etebligat.gov.tr/v1/messages/evidences/{barkod}
              // Content script önce API'yi dener, olmazsa formu doldurur. Giriş şart.
              queryBtn.disabled = true;
              queryBtn.innerText = 'Sorgulanıyor...';
              await chrome.runtime.sendMessage({ type: 'BEESLY_OPEN_UETS', barcode });
              pollResult('UETS Sorgula');
            } else {
              // 4xx/TB: kalıcı gizli sekmede MAIN-world sorgu (token ısıtmalı)
              queryBtn.disabled = true;
              queryBtn.innerText = 'Sorgulanıyor...';
              await chrome.runtime.sendMessage({ type: 'BEESLY_OPEN_PTT', barcode });
              pollResult('PTT Sorgula');
            }
          });

          btnWrap.appendChild(copyBtn);
          btnWrap.appendChild(queryBtn);
          row.appendChild(infoDiv);
          row.appendChild(btnWrap);
          item.appendChild(row);
          item.appendChild(resultDiv);
          container.appendChild(item);

          // Popup açıldığında daha önce alınmış sonuç varsa göster (saatiyle: eski hata tanınsın)
          // 1 saatten eski sonuç gösterilmez — dünün verisi bugünün kararı olmasın
          chrome.runtime.sendMessage({ type: 'BEESLY_GET_RESULT', barcode }).then((resp) => {
            if (resp?.result?.summary) {
              const age = resp.result.at ? Date.now() - resp.result.at : Infinity;
              if (age > 60 * 60 * 1000) return;
              const s = resp.result.summary;
              let when = '';
              try {
                if (resp.result.at) {
                  when = ' · ' + new Date(resp.result.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                }
              } catch (_) {}
              setResult((s.ok ? `Son durum: ${s.text}` : `Sorgu: ${s.text}`) + when, s.ok, resp.result);
            }
          });
          // Not: oto-sorgu kapalı — kullanıcı Sorgula'ya basar (selCode sadece öne alınır).
        });
      }
    );
  });
});
