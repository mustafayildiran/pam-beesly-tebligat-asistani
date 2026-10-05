/* Standalone viewer (viewer.html) — content.js'teki modal mantığının sade hali */
(function () {
  'use strict';
  const stack = [];
  const $ = (id) => document.getElementById(id);

  function fmt(n) { return window.EypParser ? EypParser.formatSize(n) : n + ' B'; }

  async function openBuffer(buffer, fileName) {
    const parsed = await EypParser.parsePackage(buffer, fileName);
    stack.push({ parsed, buffer, fileName });
    if (stack.length > 8) stack.shift();
    render();
  }

  function download(buffer, name) {
    const type = window.EypParser ? EypParser.mimeForExt((name || '').split('.').pop()) : 'application/octet-stream';
    const url = URL.createObjectURL(new Blob([buffer], { type: type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function preview(f) {
    const bar = $('eyp-preview-bar'), prev = $('eyp-preview');
    bar.innerHTML = ''; prev.innerHTML = '';
    const t = document.createElement('span');
    t.style.fontWeight = '600';
    t.textContent = f.name + ' (' + fmt(f.size || f.buffer.byteLength) + ')';
    bar.appendChild(t);
    const sp = document.createElement('span'); sp.style.flex = '1'; bar.appendChild(sp);
    const ext = (f.ext || '').toLowerCase();
    if (ext === 'eyp' && EypParser.isZipMagic(f.buffer)) {
      const b = document.createElement('button');
      b.textContent = '📦 İçini aç';
      b.onclick = () => openBuffer(f.buffer, f.name);
      bar.appendChild(b);
    }
    const dl = document.createElement('button');
    dl.textContent = '⬇ İndir';
    dl.onclick = () => download(f.buffer, f.name);
    bar.appendChild(dl);

    const url = URL.createObjectURL(new Blob([f.buffer], { type: window.EypParser ? EypParser.mimeForExt(ext) : 'application/octet-stream' }));
    if (ext === 'pdf') {
      const fr = document.createElement('iframe'); fr.src = url; prev.appendChild(fr);
    } else if (['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) {
      const img = document.createElement('img'); img.src = url;
      img.style.objectFit = 'contain'; img.style.background = '#fff';
      prev.appendChild(img);
    } else if (['xml','html','htm','txt','rels','imz'].includes(ext) || f.name === '[Content_Types].xml') {
      fetch(url).then(r => r.text()).then(tx => {
        const pre = document.createElement('pre'); pre.textContent = tx.slice(0, 200000);
        prev.appendChild(pre);
      });
    } else if (ext === 'udf' && EypParser.isZipMagic(f.buffer)) {
      prev.innerHTML = '<div class="eyp-empty">UDF paketi — listeden content.xml önizlenebilir.</div>';
    } else if (f.buffer && f.buffer.byteLength > 5 && new Uint8Array(f.buffer.slice(0, 5)).join(',') === '37,80,68,70,45') {
      // .eyp adıyla gelen ham PDF: uzantıya değil içeriğe (%PDF-) bak
      const pdfUrl = URL.createObjectURL(new Blob([f.buffer], { type: 'application/pdf' }));
      const fr = document.createElement('iframe'); fr.src = pdfUrl; prev.appendChild(fr);
    } else {
      prev.innerHTML = '<div class="eyp-empty">Önizleme yok (' + ext.toUpperCase() + '). İndirip açın.</div>';
    }
  }

  function entry(list, f, nested) {
    const b = document.createElement('button');
    b.className = 'eyp-file';
    b.innerHTML = '<span class="eyp-ext' + (nested ? ' eyp-nested' : '') + '">' + (f.ext || '?').toUpperCase() + '</span>';
    const nm = document.createElement('span'); nm.className = 'eyp-fname'; nm.textContent = f.name; nm.title = f.path || f.name;
    const sz = document.createElement('span'); sz.className = 'eyp-fsize'; sz.textContent = fmt(f.size || f.buffer.byteLength);
    b.appendChild(nm); b.appendChild(sz);
    b.onclick = () => { list.querySelectorAll('.eyp-file').forEach(x => x.classList.remove('active')); b.classList.add('active'); preview(f); };
    list.appendChild(b);
    return b;
  }

  function render() {
    const top = stack[stack.length - 1];
    if (!top) return;
    $('app').hidden = false;
    $('eyp-back').hidden = stack.length <= 1;
    const p = top.parsed;
    $('eyp-title').textContent = (p.konu ? p.konu + ' — ' : '') + top.fileName;
    const meta = $('eyp-meta'), list = $('eyp-list'), prev = $('eyp-preview'), bar = $('eyp-preview-bar');
    meta.innerHTML = ''; list.innerHTML = ''; bar.innerHTML = ''; prev.innerHTML = '';
    const mi = (k, v) => { if (!v && v !== 0) return; const s = document.createElement('span'); s.innerHTML = '<b>' + k + ':</b> ' + String(v).replace(/</g,'&lt;'); meta.appendChild(s); };

    if (p.kind === 'eyp') {
      mi('Konu', p.konu); mi('Sürüm', p.version);
      if (p.ustveri) { mi('Gönderen', p.ustveri.olusturanAdi); mi('Belge No', p.ustveri.belgeNo); mi('Tarih', p.ustveri.tarih); }
      mi('Ek', (p.ekler || []).length);
      const h1 = document.createElement('h4'); h1.textContent = 'Üst yazı'; list.appendChild(h1);
      let first = null;
      (p.ustYaziFiles || []).forEach((f, i) => { const b = entry(list, f); if (i === 0) first = b; });
      if ((p.ekler || []).length) {
        const h2 = document.createElement('h4'); h2.textContent = 'Ekler'; list.appendChild(h2);
        p.ekler.forEach(f => entry(list, f, true));
      }
      if (p.ustYazi) preview(p.ustYazi);
      else if (first) first.click();
    } else if (p.kind === 'uyap-evrak') {
      mi('Tür', 'UYAP evrak paketi'); mi('Dosya', top.fileName);
      const h1 = document.createElement('h4'); h1.textContent = 'Ana evrak'; list.appendChild(h1);
      if (p.anaEvrak) entry(list, p.anaEvrak);
      const h2 = document.createElement('h4'); h2.textContent = 'Ekler'; list.appendChild(h2);
      (p.ekler || []).forEach(f => entry(list, f, /\.eyp$/i.test(f.name)));
      if (p.anaEvrak) preview(p.anaEvrak);
    } else if (p.kind === 'zip') {
      mi('Tür', 'ZIP'); const h = document.createElement('h4'); h.textContent = 'Dosyalar'; list.appendChild(h);
      (p.files || []).forEach(f => entry(list, f));
      prev.innerHTML = '<div class="eyp-empty">Soldan seçin</div>';
    } else if (p.kind === 'udf') {
      mi('Tür', 'UDF');
      const h = document.createElement('h4'); h.textContent = 'İçerik'; list.appendChild(h);
      (p.files || []).forEach(f => entry(list, f));
      prev.innerHTML = '<div class="eyp-empty">Soldan seçin</div>';
    } else {
      preview({ name: p.fileName, ext: p.ext, buffer: p.buffer, size: p.buffer.byteLength });
    }
    document.getElementById('app').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('eyp-back').onclick = () => { if (stack.length > 1) { stack.pop(); render(); } };
  const drop = $('drop'), fi = $('file');
  drop.onclick = () => fi.click();
  fi.onchange = async () => { const f = fi.files[0]; if (f) await openBuffer(await f.arrayBuffer(), f.name); };
  ['dragover','dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.style.borderColor = '#fff'; }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.style.borderColor = '#64748b'; }));
  drop.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files[0];
    if (f) await openBuffer(await f.arrayBuffer(), f.name);
  });
})();
