/* UYAP EYP Görüntüleyici - ortak parser
 * Desteklenen girdiler:
 *  - Gerçek EYP paketi (.eyp, aslında ZIP): UstYazi/ustyazi.pdf + Ustveri + Ekler + imzalar
 *  - UYAP evrak paketi (evrak_*.zip): ana_evrak.pdf + ekler (içinde .eyp olabilir)
 *  - UDF (.udf, aslında ZIP): content.xml + sign.sgn
 * JSZip global olarak yüklü olmalı (jszip.min.js).
 */
(function (global) {
  'use strict';

  async function getZipImpl() {
    if (global.JSZip) return global.JSZip;
    throw new Error('JSZip yüklenemedi (jszip.min.js eksik).');
  }

  function isZipMagic(buf) {
    if (!buf || buf.byteLength < 4) return false;
    const b = new Uint8Array(buf.slice(0, 4));
    return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
  }

  function baseName(path) {
    const p = String(path || '').split('/').pop();
    return p;
  }

  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : '';
  }

  // Namespace'den bağımsız XML alan okuma (e-Yazışma şemaları ns7:, ns2: kullanır)
  function xmlField(xmlText, localName) {
    if (!xmlText) return '';
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('xml parse');
      const all = doc.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const ln = all[i].localName || all[i].nodeName.split(':').pop();
        if (ln === localName) return (all[i].textContent || '').trim();
      }
    } catch (e) { /* yoksay, regex fallback */ }
    try {
      const re = new RegExp('<(?:\\w+:)?' + localName + '(?:\\s[^>]*)?>([^<]*)<', 'i');
      const m = String(xmlText).match(re);
      if (m) return m[1].trim();
    } catch (e) {}
    return '';
  }

  function parseUstveri(xmlText) {
    if (!xmlText) return null;
    return {
      belgeId: xmlField(xmlText, 'BelgeId'),
      konu: xmlField(xmlText, 'Konu'),
      mime: xmlField(xmlText, 'MimeTuru'),
      guvenlik: xmlField(xmlText, 'GuvenlikKodu'),
      olusturanAdi: xmlField(xmlText, 'Adi'),
      olusturanKKK: xmlField(xmlText, 'KKK'),
      tarih: xmlField(xmlText, 'Tarih') || xmlField(xmlText, 'OlusturmaTarihi') || xmlField(xmlText, 'BelgeTarihi'),
      belgeNo: xmlField(xmlText, 'BelgeNo'),
      ozId: xmlField(xmlText, 'OzId')
    };
  }

  function parseCoreProps(xmlText) {
    if (!xmlText) return null;
    return {
      title: xmlField(xmlText, 'title'),
      subject: xmlField(xmlText, 'subject'),
      creator: xmlField(xmlText, 'creator'),
      created: xmlField(xmlText, 'created'),
      version: xmlField(xmlText, 'version'),
      category: xmlField(xmlText, 'category')
    };
  }

  async function zipEntries(zip) {
    const out = [];
    zip.forEach((relPath, file) => {
      out.push({ path: relPath, dir: file.dir, name: baseName(relPath), size: 0 });
    });
    return out;
  }

  async function readAsArrayBuffer(zipFile) {
    return await zipFile.async('arraybuffer');
  }

  async function readAsText(zipFile) {
    return await zipFile.async('string');
  }

  // Ana fonksiyon: herhangi bir ArrayBuffer -> yapısal sonuç
  async function parsePackage(buffer, fileName) {
    const JSZip = await getZipImpl();
    const name = fileName || 'belge.eyp';
    if (!isZipMagic(buffer)) {
      // ZIP değilse (örn. doğrudan PDF indirilmişse) ham dosya olarak döndür
      return {
        kind: 'raw',
        fileName: name,
        buffer,
        ext: extOf(name),
        message: 'Bu dosya ZIP/EYP formatında değil, doğrudan görüntüleniyor.'
      };
    }
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);

    const hasUstveri = paths.some(p => /ustveri\/ustveri\.xml$/i.test(p));
    const hasPaketOzeti = paths.some(p => /paketozeti\/paketozeti\.xml$/i.test(p));
    const hasUstYazi = paths.some(p => /ustyazi\//i.test(p));
    const isEyp = hasUstveri || hasPaketOzeti || hasUstYazi;

    if (isEyp) return await parseEyp(zip, name);

    const hasAnaEvrak = paths.some(p => /(^|\/)ana_evrak\.pdf$/i.test(p));
    const hasContentXml = paths.some(p => /(^|\/)content\.xml$/i.test(p));
    if (hasContentXml && paths.some(p => /sign\.sgn$/i.test(p))) {
      return await parseUdf(zip, name);
    }
    if (hasAnaEvrak) {
      return await parseUyapEvrakPaketi(zip, name);
    }
    // Genel ZIP (bilinmeyen ama listelenebilir)
    return await parseGenericZip(zip, name);
  }

  async function collectFiles(zip, filterFn) {
    const out = [];
    const jobs = [];
    zip.forEach((relPath, file) => {
      if (file.dir) return;
      if (filterFn && !filterFn(relPath)) return;
      jobs.push((async () => {
        const buf = await file.async('arraybuffer');
        out.push({ path: relPath, name: baseName(relPath), ext: extOf(relPath), size: buf.byteLength, buffer: buf });
      })());
    });
    await Promise.all(jobs);
    // yol sırasına göre diz
    out.sort((a, b) => a.path.localeCompare(b.path, 'tr'));
    return out;
  }

  async function tryReadText(zip, pattern) {
    const key = Object.keys(zip.files).find(p => pattern.test(p));
    if (!key || zip.files[key].dir) return '';
    try { return await zip.files[key].async('string'); } catch (e) { return ''; }
  }

  async function parseEyp(zip, fileName) {
    const ustveriXml = await tryReadText(zip, /ustveri\/ustveri\.xml$/i);
    const nihaiUstveriXml = await tryReadText(zip, /nihaiustveri\/nihaiustveri\.xml$/i);
    const coreXml = await tryReadText(zip, /docprops\/core\.xml$/i);
    const paketOzetiXml = await tryReadText(zip, /paketozeti\/paketozeti\.xml$/i);

    const ustveri = parseUstveri(ustveriXml || nihaiUstveriXml);
    const core = parseCoreProps(coreXml);

    const ustYaziFiles = await collectFiles(zip, p => /ustyazi\//i.test(p) && !/rels$/i.test(p));
    const ekFiles = await collectFiles(zip, p => /^ekler\//i.test(p) && !/_rels/i.test(p) && !/\.rels$/i.test(p));
    const imzaFiles = await collectFiles(zip, p => /^(imzalar|muhur|paraf)/i.test(p));
    const metaFiles = await collectFiles(zip, p => /(\.xml|\.rels|\[content_types\])/i.test(p) && !/ustyazi/i.test(p) && !/^ekler\//i.test(p));

    // Üst yazı içinde PDF yoksa (nadir) ilk görüntülenebilir dosyayı üst yazı say
    let ustYazi = ustYaziFiles.find(f => f.ext === 'pdf') || ustYaziFiles[0] || null;

    return {
      kind: 'eyp',
      fileName,
      version: core && core.version ? core.version : (/NihaiUstveri/i.test(Object.keys(zip.files).join(',')) ? '2.0' : '1.x/2.0'),
      konu: (ustveri && ustveri.konu) || (core && (core.title || core.subject)) || '',
      ustveri, core,
      ustYazi,
      ustYaziFiles,
      ekler: ekFiles,
      imzalar: imzaFiles.map(f => ({ path: f.path, name: f.name, size: f.size })),
      meta: metaFiles.map(f => ({ path: f.path, name: f.name, size: f.size })),
      allPaths: Object.keys(zip.files),
      // ham erişim için zip'i kapatmadan buffer'ları zaten topladık
      _zip: null
    };
  }

  async function parseUyapEvrakPaketi(zip, fileName) {
    const files = await collectFiles(zip, null);
    const ana = files.find(f => /(^|\/)ana_evrak\.pdf$/i.test(f.path)) || null;
    const ekler = files.filter(f => f !== ana);
    return { kind: 'uyap-evrak', fileName, anaEvrak: ana, ekler, allPaths: Object.keys(zip.files) };
  }

  async function parseUdf(zip, fileName) {
    const contentXml = await tryReadText(zip, /(^|\/)content\.xml$/i);
    const propsXml = await tryReadText(zip, /(^|\/)documentproperties\.xml$/i);
    const files = await collectFiles(zip, null);
    return { kind: 'udf', fileName, contentXml, propsXml, files, allPaths: Object.keys(zip.files) };
  }

  async function parseGenericZip(zip, fileName) {
    const files = await collectFiles(zip, null);
    return { kind: 'zip', fileName, files, allPaths: Object.keys(zip.files) };
  }

  function formatSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // Önizleme/indirilen Blob'lara doğru MIME türü vermek şart:
  // türsüz Blob'u Chrome metin sanıp PDF'i ham metin döker.
  function mimeForExt(ext) {
    switch (String(ext || '').toLowerCase()) {
      case 'pdf': return 'application/pdf';
      case 'png': return 'image/png';
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'bmp': return 'image/bmp';
      case 'tif': case 'tiff': return 'image/tiff';
      case 'xml': case 'rels': case 'imz': return 'application/xml';
      case 'html': case 'htm': return 'text/html';
      case 'txt': return 'text/plain';
      case 'zip': case 'eyp': case 'udf': return 'application/zip';
      default: return 'application/octet-stream';
    }
  }

  global.EypParser = { parsePackage, formatSize, isZipMagic, xmlField, mimeForExt };
})(typeof window !== 'undefined' ? window : globalThis);
