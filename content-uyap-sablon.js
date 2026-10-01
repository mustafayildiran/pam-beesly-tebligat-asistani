(() => {
/**
 * Beesly Dilekçe - Content Script (Sürüm 2.0)
 * 
 * Bu script, UYAP Avukat Portal sayfasını dinamik olarak izler (MutationObserver).
 * "Pencere Görünümü" modalı açıldığında, modalın sağ üst köşesine
 * "Şablon İndir" butonunu ekler.
 * 
 * Sürüm 2.0 Yenilikleri:
 * - DOCX formatı tamamen kaldırıldı. Çıktı artık UDF (UYAP Döküman Formatı).
 * - UDF Builder Engine: Segment bazlı kümülatif offset hesaplama ile
 *   content.xml sıfırdan üretilir. Harici şablon dosyasına bağımlılık sıfır.
 * - docxtemplater kütüphanesi kaldırıldı (178KB tasarruf).
 * - Türkçe büyük harf dönüşümü (toLocaleUpperCase('tr-TR')).
 * - Kalın/altı çizili/hizalama biçimlendirmeleri ekran görüntüsüne birebir uyumlu.
 * - Tab karakterleri ile tutarlı kolon hizalaması sağlanır.
 */

// --- 1. YAPILANDIRMA (KOLAY DÜZENLENEBİLİR ALAN) ---
const CONFIG = {
  // Detay Modalı (Popup) Başlık Seçicisi
  POPUP_TITLE_CONTAINER: 'div.dx-popup-title',
  
  // Modaldaki Kapat Butonu Seçicisi
  POPUP_CLOSE_BUTTON: 'div.dx-popup-title div[aria-label="Kapat"], div.dx-popup-title div[title="Kapat"]',
  
  // Modal başlığındaki bilgileri barındıran alan (Standart, Sık Kullanılanlar ve Duruşma Sorgulama için çoklu seçici)
  POPUP_HEADER_TEXT_DIV: 'div.dx-popup-title div.d-flex.align-items-center[title], div.dx-popup-title h4.m-0, div.dx-popup-title .dx-toolbar-label .dx-item-content > div',
  
  // Giriş yapan avukatın adını barındıran profil seçicisi
  LOGGED_IN_USER_SELECTOR: 'div.dropdown-toggle.nav-link.text-white, .dropdown-toggle',
  
  // Taraf tablosundaki satırlar
  PARTY_ROW_SELECTOR: 'tr.dx-data-row',

  // Font: sabit Times New Roman, 12 punto
  FONT_SIZE: 12,
  FONT_DEFAULT: 'Times New Roman'
};

// --- 2. POPUP-İZOLE CACHE VE OBSERVER SİSTEMİ ---
const popupCache = new WeakMap();
const activeObservers = new WeakMap();

// Global Tooltip referansı
let globalTooltipElement = null;

// --- 3. YARDIMCI FONKSİYONLAR ---

/**
 * Türkçe karakterleri normalize eder (eşleştirme kolaylığı için)
 * @param {string} text 
 * @returns {string}
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/[\[\]]/g, '')
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

/**
 * İsim eşleştirme için adı token'lara ayırır (Av. öneki temizlenir).
 * @param {string} name
 * @returns {string[]}
 */
function normalizeNameTokens(name) {
  return normalizeText(name)
    .replace(/^av\.?\s+/, '')
    .replace(/\s+av\.?$/, '')
    .split(/[\s\-.]+/)
    .map(t => t.replace(/[^a-z]/g, ''))
    .filter(t => t.length > 1);
}

/**
 * Vekil hücresi ile giriş yapan avukatı karşılaştırır.
 * "Av." öneki, büyük/küçük harf ve ad-soyad sırası farklarına dayanıklıdır.
 * Soyad + en az bir ad tokeni tutmalı.
 * @param {string} attorneyName
 * @param {string} vekilText
 * @returns {boolean}
 */
function isAttorneyMatch(attorneyName, vekilText) {
  const aToks = normalizeNameTokens(attorneyName);
  const vToks = normalizeNameTokens(vekilText);
  if (aToks.length === 0 || vToks.length === 0) return false;
  const aSurname = aToks[aToks.length - 1];
  if (!vToks.includes(aSurname)) return false;
  const common = aToks.filter(t => vToks.includes(t));
  return common.length >= 2 || aToks.length === 1;
}

/**
 * Müdafi rollerini tanır (normalize edilmiş metinde arar).
 * SANIK / ŞÜPHELİ / SUÇA SÜRÜKLENEN ÇOCUK -> müdafi.
 */
function isMudafiRole(normRol) {
  if (normRol.includes('sanik') || normRol.includes('supheli') || normRol.includes('suruklenen')) return true;
  if (normRol.includes('suc') && normRol.includes('cocuk')) return true;
  return false;
}

/**
 * İmza unvanını rol sütununa göre belirler.
 * SANIK / ŞÜPHELİ / SUÇA SÜRÜKLENEN ÇOCUK varsa -> "MÜDAFİ",
 * gerisindeki tüm roller -> "... VEKİLİ".
 * Önce eşleşen müvekkilin rolüne bakılır; eşleşme yoksa dosyadaki
 * tüm tarafların rollerine bakılır (tek sanıklı dosya gibi).
 */
function decideUnvan(muvekkiller, taraflar, bosVarsayilan) {
  const mRoller = Array.from(new Set(
    (muvekkiller || []).map(m => turkishUpper(m.rol)).filter(Boolean)
  ));
  if (mRoller.length > 0) {
    if (mRoller.some(r => isMudafiRole(normalizeText(r)))) {
      return 'MÜDAFİ';
    }
    return mRoller.join(', ') + ' VEKİLİ';
  }
  const tRoller = Array.from(new Set(
    (taraflar || []).map(t => turkishUpper(typeof t === 'string' ? t : t.rol)).filter(Boolean)
  ));
  if (tRoller.length > 0) {
    if (tRoller.some(r => isMudafiRole(normalizeText(r)))) {
      return 'MÜDAFİ';
    }
    return tRoller.join(', ') + ' VEKİLİ';
  }
  return bosVarsayilan || 'MÜDAFİ';
}

/**
 * Giriş yapan avukatın adını profil alanından çeker
 * @returns {string}
 */
function getLoggedInAttorney() {
  const userEl = document.querySelector(CONFIG.LOGGED_IN_USER_SELECTOR);
  if (userEl) {
    return userEl.innerText.trim();
  }
  return '';
}

/**
 * Türkçe büyük harf dönüşümü (ı→I, i→İ, ö→Ö, ü→Ü, ş→Ş, ç→Ç, ğ→Ğ)
 * JavaScript'in standart toLocaleUpperCase('tr-TR') ile Türkçe kurallarına uygun dönüşüm.
 * @param {string} str
 * @returns {string}
 */
function turkishUpper(str) {
  if (!str) return '';
  return str.toLocaleUpperCase('tr-TR');
}

/**
 * Dilekçe fontu: sabit Times New Roman, her zaman 12 punto.
 * @returns {Promise<string>}
 */
async function getSelectedFontFamily() {
  return 'Times New Roman';
}

/**
 * Etiket uzunluğuna göre tab sayısını belirler.
 * Hedef: tüm iki noktaların aynı yatay tab pozisyonunda hizalanması.
 * - 8 karakterden kısa etiketler → 2 tab (8→16 tab stop)
 * - 8+ karakter etiketler → 1 tab (→16 tab stop)
 * @param {number} labelLength Etiket karakter uzunluğu
 * @returns {string} Tab karakterleri
 */
function getTabPadding(labelLength) {
  return labelLength <= 9 ? '\t\t' : '\t';
}

// --- 4. GLOBAL TOOLTIP YÖNETİMİ ---

function initGlobalTooltip() {
  if (document.getElementById('uyap-eklenti-tooltip')) {
    globalTooltipElement = document.getElementById('uyap-eklenti-tooltip');
    return;
  }
  
  const tooltip = document.createElement('div');
  tooltip.id = 'uyap-eklenti-tooltip';
  tooltip.className = 'uyap-tooltip-hidden';
  
  const content = document.createElement('div');
  content.className = 'uyap-tooltip-content';
  tooltip.appendChild(content);
  
  const arrow = document.createElement('div');
  arrow.className = 'uyap-tooltip-arrow';
  tooltip.appendChild(arrow);
  
  document.body.appendChild(tooltip);
  globalTooltipElement = tooltip;
}

function showTooltip(targetButton, text) {
  if (!globalTooltipElement) initGlobalTooltip();
  
  const content = globalTooltipElement.querySelector('.uyap-tooltip-content');
  if (content) {
    content.innerText = text;
  }
  
  const rect = targetButton.getBoundingClientRect();
  globalTooltipElement.className = 'uyap-tooltip-visible';
  
  const tooltipWidth = globalTooltipElement.offsetWidth;
  const tooltipHeight = globalTooltipElement.offsetHeight;
  
  let top = rect.top - tooltipHeight - 8;
  let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
  
  const padding = 10;
  const viewportWidth = window.innerWidth;
  
  if (left < padding) {
    left = padding;
  } else if (left + tooltipWidth > viewportWidth - padding) {
    left = viewportWidth - tooltipWidth - padding;
  }
  
  if (top < padding) {
    top = rect.bottom + 8;
    globalTooltipElement.querySelector('.uyap-tooltip-arrow').style.display = 'none';
  } else {
    globalTooltipElement.querySelector('.uyap-tooltip-arrow').style.display = 'block';
  }
  
  globalTooltipElement.style.top = `${top}px`;
  globalTooltipElement.style.left = `${left}px`;
}

function hideTooltip() {
  if (globalTooltipElement) {
    globalTooltipElement.className = 'uyap-tooltip-hidden';
  }
}

// --- 5. ARAYÜZ ELEMANI OLUŞTURMA ---

function createDownloadButton() {
  const button = document.createElement('button');
  button.className = 'uyap-sablon-indir-btn not-ready';
  button.setAttribute('aria-label', 'Şablon Doldur ve İndir - Taraf bilgisi bekleniyor');
  button.type = 'button';
  
  const svgMarkup = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>';
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svgElement = svgDoc.documentElement;
  
  button.appendChild(svgElement);
  
  button.addEventListener('mouseenter', () => {
    let tooltipText = 'Taraf Bilgileri Sekmesini Açın';
    if (button.classList.contains('loading')) {
      tooltipText = 'Dilekçe Dolduruluyor...';
    } else if (button.classList.contains('ready')) {
      tooltipText = 'Şablonu İndir';
    }
    showTooltip(button, tooltipText);
  });
  
  button.addEventListener('mouseleave', () => {
    hideTooltip();
  });
  
  return button;
}

function setButtonReady(button) {
  button.classList.remove('not-ready');
  button.classList.add('ready');
  button.setAttribute('aria-label', 'Şablon Doldur ve İndir - Hazır');
}

function setButtonLoading(button) {
  button.classList.add('loading');
}

function clearButtonLoading(button) {
  button.classList.remove('loading');
}

// --- 6. VERİ ÇEKME VE MÜVEKKİL TESPİT MANTIĞI ---

function extractPartiesAndRoles(attorneyName, searchScope) {
  const result = {
    muvekkiller: [], // Array of {rol, adi}
    karsi_taraflar: [], // Array of {rol, adi}
    taraflar: []
  };

  const normalizedAttorney = normalizeText(attorneyName);
  const rows = searchScope.querySelectorAll(CONFIG.PARTY_ROW_SELECTOR);

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length === 4) {
      const rol = cells[0].innerText.trim();
      const tipi = cells[1].innerText.trim();
      const adi = cells[2].innerText.trim();
      const vekil = cells[3].innerText.trim();
      
      if (rol && adi) {
        const taraf = { rol, tipi, adi, vekil };
        result.taraflar.push(taraf);

        if (normalizedAttorney && isAttorneyMatch(attorneyName, vekil)) {
          result.muvekkiller.push({ rol, adi });
        } else {
          result.karsi_taraflar.push({ rol, adi });
        }
      }
    }
  });

  return result;
}

function parseCaseHeader(titleContainer) {
  const textDiv = titleContainer.querySelector(CONFIG.POPUP_HEADER_TEXT_DIV);
  let mahkeme = 'Tespit Edilemedi';
  let dosyaNo = 'Tespit Edilemedi';
  let dosyaTuru = 'Dava Dosyası';
  
  if (textDiv) {
    let titleText = textDiv.getAttribute('title') || textDiv.innerText.trim();
    titleText = titleText.replace(/\s+/g, ' '); // Fazla boşlukları temizle
    
    const match1 = titleText.match(/^([\d]+\/[\d]+)\s+(.+?)(?:\s*-\s*(.+))?$/);
    const match2 = titleText.match(/^(.+?)\s+([\d]+\/[\d]+)$/);
    
    if (match1) {
      dosyaNo = match1[1].trim();
      mahkeme = match1[2].trim();
      if (match1[3]) dosyaTuru = match1[3].trim();
    } else if (match2) {
      mahkeme = match2[1].trim();
      dosyaNo = match2[2].trim();
    } else {
      mahkeme = titleText;
    }
  }

  const attorneyName = getLoggedInAttorney();
  const bugun = new Date();
  const gun = String(bugun.getDate()).padStart(2, '0');
  const ay = String(bugun.getMonth() + 1).padStart(2, '0');
  const yil = bugun.getFullYear();
  const formatliBugun = `${gun}.${ay}.${yil}`;
  
  return {
    mahkeme,
    dosya_no: dosyaNo,
    dosya_turu: dosyaTuru,
    tarih: formatliBugun,
    avukat_adi: attorneyName
  };
}

function isPartyTableRendered(popupScope) {
  const rows = popupScope.querySelectorAll(CONFIG.PARTY_ROW_SELECTOR);
  return Array.from(rows).some(row => row.querySelectorAll('td').length === 4);
}

function findPopupContainer(titleContainer) {
  let current = titleContainer;
  while (current && current !== document.body) {
    if (current.classList && (
      current.classList.contains('dx-popup-wrapper') ||
      current.classList.contains('dx-overlay-wrapper')
    )) {
      return current;
    }
    current = current.parentElement;
  }
  return titleContainer.parentElement || titleContainer;
}

// --- 7. PASİF TARAF BİLGİSİ İZLEYİCİ ---

function startPassivePartyObserver(titleContainer, popupScope) {
  if (activeObservers.has(titleContainer)) {
    return;
  }

  if (isPartyTableRendered(popupScope)) {
    handlePartyDataFound(titleContainer, popupScope);
    return;
  }

  const observer = new MutationObserver(() => {
    if (isPartyTableRendered(popupScope)) {
      observer.disconnect();
      activeObservers.delete(titleContainer);
      handlePartyDataFound(titleContainer, popupScope);
    }
  });

  observer.observe(popupScope, {
    childList: true,
    subtree: true
  });

  activeObservers.set(titleContainer, observer);
}

function handlePartyDataFound(titleContainer, popupScope) {
  const attorneyName = getLoggedInAttorney();
  const partyData = extractPartiesAndRoles(attorneyName, popupScope);
  
  const cacheEntry = popupCache.get(titleContainer);
  if (cacheEntry) {
    cacheEntry.partyData = partyData;
    if (cacheEntry.button) {
      setButtonReady(cacheEntry.button);
      if (cacheEntry.button.matches(':hover')) {
        showTooltip(cacheEntry.button, 'Şablonu İndir');
      }
    }
    console.log("Beesly Dilekçe: Taraf verileri okundu ve buton aktifleştirildi.", {
      avukat: attorneyName,
      muvekkiller: partyData.muvekkiller,
      karsi: partyData.karsi_taraflar
    });
  }
}

// --- 8. UDF BUILDER ENGINE (UYAP Döküman Formatı Üretici) ---

/**
 * UDF Belge Üretici Motoru (Builder Pattern)
 * 
 * UDF formatı: ZIP arşivi içinde content.xml dosyası.
 * content.xml yapısı:
 *   <template format_id="1.8">
 *     <content><![CDATA[düz metin (tab ve newline dahil)]]></content>
 *     <properties>sayfa ayarları</properties>
 *     <elements>biçimlendirme bilgileri (offset tabanlı)</elements>
 *     <styles>font tanımları</styles>
 *   </template>
 * 
 * Bu motor, metin segmentlerini kümülatif offset ile birleştirerek
 * hem CDATA metnini hem de <elements> XML'ini eşzamanlı üretir.
 * Değişken uzunluklu veriler hiçbir sorun yaratmaz çünkü offset'ler
 * metin oluştukça kümülatif olarak hesaplanır.
 */
class UdfDocumentBuilder {
  constructor(fontFamily) {
    this.text = '';           // CDATA düz metin içeriği
    this.offset = 0;          // Kümülatif karakter offset
    this.paragraphsXml = '';  // <elements> içindeki XML paragrafları
    this.fontFamily = fontFamily || CONFIG.FONT_DEFAULT;
    this.fontSize = CONFIG.FONT_SIZE; // her zaman 12
  }
  
  /**
   * Belgeye bir satır (paragraf) ekler.
   * Son segmentin sonuna otomatik olarak newline eklenir.
   * 
   * @param {number|null} alignment 1=ortalı, 2=sağa yaslı, null=sola (varsayılan)
   * @param {Array} segments Metin segmentleri: [{text, bold, underline}, ...]
   */
  addLine(alignment, segments) {
    let paraAttr = alignment ? ` Alignment="${alignment}"` : '';
    this.paragraphsXml += `<paragraph${paraAttr}>`;
    
    if (segments.length === 0) {
      // Boş satır — sadece newline karakteri
      this.paragraphsXml += `<content size="${this.fontSize}" startOffset="${this.offset}" length="1" />`;
      this.text += '\n';
      this.offset += 1;
    } else {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        let segText = seg.text;
        
        // Son segmente newline ekle
        if (i === segments.length - 1) {
          segText += '\n';
        }
        
        let attrs = '';
        if (seg.bold) attrs += ' bold="true"';
        if (seg.underline) attrs += ' underline="true"';
        attrs += ` size="${this.fontSize}"`;
        attrs += ` startOffset="${this.offset}" length="${segText.length}"`;
        
        this.paragraphsXml += `<content${attrs} />`;
        this.text += segText;
        this.offset += segText.length;
      }
    }
    
    this.paragraphsXml += '</paragraph>';
  }
  
  /**
   * Boş satır ekler
   * @param {number|null} alignment
   */
  addEmptyLine(alignment) {
    this.addLine(alignment || null, []);
  }
  
  /**
   * Birden fazla boş satır ekler
   * @param {number} count
   * @param {number|null} alignment
   */
  addEmptyLines(count, alignment) {
    for (let i = 0; i < count; i++) {
      this.addEmptyLine(alignment || null);
    }
  }
  
  /**
   * Eksiksiz UDF content.xml metnini üretir.
   * @returns {string} content.xml XML metni
   */
  buildXml() {
    return '<?xml version="1.0" encoding="UTF-8" ?> \n\n' +
      '<template format_id="1.8" >\n' +
      '<content><![CDATA[' + this.text + ']]></content>' +
      '<properties>' +
        '<pageFormat mediaSizeName="1" ' +
          'leftMargin="42.525000000000006" rightMargin="42.525000000000006" ' +
          'topMargin="42.525000000000006" bottomMargin="42.52500000000006" ' +
          'paperOrientation="1" headerFOffset="20.0" footerFOffset="20.0" />' +
      '</properties>\n' +
      '<elements resolver="hvl-default" >\n' +
        this.paragraphsXml + '\n' +
      '</elements>\n' +
      '<styles>' +
        `<style name="default" description="Geçerli" family="${this.fontFamily}" size="${this.fontSize}" ` +
          'bold="false" italic="false" ' +
          `FONT_ATTRIBUTE_KEY="javax.swing.plaf.FontUIResource[family=${this.fontFamily},name=${this.fontFamily},style=plain,size=${this.fontSize}]" ` +
          'foreground="-14277082" />' +
        `<style name="hvl-default" family="${this.fontFamily}" size="${this.fontSize}" description="Gövde" />` +
      '</styles>\n' +
      '</template>\n';
  }
}

// --- 9. UDF DOSYA OLUŞTURMA VE İNDİRME ---

/**
 * Uzun etiketleri (label) sekme hizasını bozmaması için kelime bazlı satırlara böler.
 */
function wrapLabel(label, maxLength = 17) {
  if (!label) return [''];
  const words = label.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxLength) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Dava verilerinden UDF dilekçe dosyası oluşturur ve indirir.
 * 
 * Biçimlendirme kuralları:
 *   - MAHKEME_ADI: BÜYÜK HARF, kalın, ortalı
 *   - DOSYA_NO: Normal font (kalın değil)
 *   - MUVEKKIL_ADI: BÜYÜK HARF, normal font (kalın değil)
 *   - MUVEKKIL_TURU: BÜYÜK HARF, altı çizili, kalın
 *   - AVUKAT_ADI: BÜYÜK HARF, normal font (kalın değil)
 *   - KARSITARAF_TURU: BÜYÜK HARF, altı çizili, kalın
 *   - KARSITARAF_ADI: BÜYÜK HARF, normal font (kalın değil)
 *   - Etiketler: Tab ile hizalama, altı çizili + kalın
 * 
 * @param {Object} data Dava verileri
 */
async function generateCbsUdfDocument(data) {
  try {
    const mahkeme = turkishUpper(data.mahkeme);
    const dosyaNo = data.dosya_no;
    const avukatAdi = turkishUpper(data.avukat_adi);
    
    // Şehir ismini bul (İlk kelime)
    const sehir = mahkeme.split(' ')[0];

    const fontFamily = await getSelectedFontFamily();
    const builder = new UdfDocumentBuilder(fontFamily);

    // CBS imza unvanı: rol sütununa göre otomatik (SANIK/ŞÜPHELİ/SSÇ -> MÜDAFİ).
    const imzaUnvani = decideUnvan(data.muvekkiller, data.taraflar, 'MÜDAFİ');
    console.log('UYAP CBS imza:', imzaUnvani, '| muvekkiller:', data.muvekkiller, '| taraflar:', data.taraflar);
    
    // ═══════════════════════════════════════════
    // BAŞLIK BLOĞU (Ortalı, Kalın)
    // ═══════════════════════════════════════════
    builder.addLine(1, [
      { text: sehir, bold: true }
    ]);
    builder.addLine(1, [
      { text: mahkeme, bold: true }
    ]);
    
    // ═══════════════════════════════════════════
    // BİLGİ SATIRLARI (Sola Yaslı) - başlık arası boşluk yok (kullanıcı isteği)
    // ═══════════════════════════════════════════
    const dosyaNoLabel = 'DOSYA NO';
    const tabsForDosyaNo = getTabPadding(dosyaNoLabel.length);
    builder.addLine(null, [
      { text: dosyaNoLabel + tabsForDosyaNo + ':', bold: true, underline: false },
      { text: ' ' + dosyaNo }
    ]);
    
    // ═══════════════════════════════════════════
    // GÖVDE METNİ KALDIRILDI (kullanıcı isteği)
    // ═══════════════════════════════════════════

    // İmza öncesi boş satır (kullanıcı isteği: 1 satır)
    builder.addEmptyLines(1);
    
    // ═══════════════════════════════════════════
    // İMZA BLOĞU (Sağa Yaslı, Kalın) - CBS: role göre MÜDAFİ / VEKİLİ
    // ═══════════════════════════════════════════
    builder.addLine(2, [
      { text: imzaUnvani, bold: true }
    ]);
    builder.addLine(2, [
      { text: 'Av. ' + avukatAdi }
    ]);
    
    builder.addEmptyLines(2);
    
    const xml = builder.buildXml();
    const zip = new window.PizZip();
    zip.file('content.xml', xml);
    
    const outputBlob = zip.generate({
      type: 'blob',
      mimeType: 'application/octet-stream',
      compression: 'DEFLATE'
    });
    
    const temizDosyaNo = dosyaNo.replace(/\//g, '-');
    const dosyaAdi = `${temizDosyaNo}_CBS_Dilekce.udf`;
    
    window.saveAs(outputBlob, dosyaAdi);
    console.log(`CBS Dilekçesi başarıyla oluşturuldu: ${dosyaAdi}`);
    
  } catch (error) {
    console.error("CBS UDF dilekçe oluşturulurken hata:", error);
    alert("CBS Dilekçesi oluşturulurken hata oluştu.\nHata: " + error.message);
  }
}

async function generateUdfDocument(data) {
  try {
    // 1. Türkçe büyük harf dönüşümleri
    const mahkeme = turkishUpper(data.mahkeme);
    const dosyaNo = data.dosya_no;
    const avukatAdi = turkishUpper(data.avukat_adi);
    
    // İmza / vekil unvanı: rol sütununa göre, her dosya tipinde aynı kural.
    // SANIK / ŞÜPHELİ / SSÇ -> MÜDAFİ, gerisi -> VEKİLİ.
    const imzaUnvani = decideUnvan(data.muvekkiller, data.taraflar, 'MÜVEKKİL VEKİLİ');
    console.log('UYAP dava imza:', imzaUnvani, '| muvekkiller:', data.muvekkiller, '| taraflar:', data.taraflar);

    // 2. UDF belgesini satır satır oluştur
    const fontFamily = await getSelectedFontFamily();
    const builder = new UdfDocumentBuilder(fontFamily);

    // ═══════════════════════════════════════════
    // YARDIMCI FONKSİYONLAR
    // ═══════════════════════════════════════════
    function addFieldBlock(labelStr, valueStr) {
      const labelLines = wrapLabel(labelStr, 17);
      for (let i = 0; i < labelLines.length - 1; i++) {
        builder.addLine(null, [
          { text: labelLines[i], bold: true, underline: false }
        ]);
      }
      const lastLabel = labelLines[labelLines.length - 1];
      const tabsForLabel = getTabPadding(lastLabel.length);
      
      builder.addLine(null, [
        { text: lastLabel + tabsForLabel + ':', bold: true, underline: false },
        { text: ' ' + valueStr }
      ]);
    }

    function addPartyBlock(partiesArray) {
      if (!partiesArray || partiesArray.length === 0) {
        return;
      }

      // 1. Rollerine göre grupla
      const roleMap = new Map();
      for (const p of partiesArray) {
        const r = turkishUpper(p.rol);
        if (!roleMap.has(r)) {
          roleMap.set(r, []);
        }
        roleMap.get(r).push(turkishUpper(p.adi));
      }
      
      // 2. Her rolü kendi içinde yazdır
      const rolesArray = Array.from(roleMap.entries());
      for (let rIndex = 0; rIndex < rolesArray.length; rIndex++) {
        const [role, names] = rolesArray[rIndex];
        const labelLines = wrapLabel(role, 17);
        const lastLabel = labelLines[labelLines.length - 1];
        const tabsForLabel = getTabPadding(lastLabel.length);
        
        // Önceki kırpılmış etiket parçalarını (varsa) yazdır
        for (let j = 0; j < labelLines.length - 1; j++) {
          builder.addLine(null, [
            { text: labelLines[j], bold: true, underline: false }
          ]);
        }

        if (names.length === 1) {
          // Tek kişi varsa numarasız
          builder.addLine(null, [
            { text: lastLabel + tabsForLabel + ':', bold: true, underline: false },
            { text: ' ' + names[0] }
          ]);
        } else {
          // Birden fazla kişi varsa numaralandırarak alt alta
          for (let i = 0; i < names.length; i++) {
            if (i === 0) {
              builder.addLine(null, [
                { text: lastLabel + tabsForLabel + ':', bold: true, underline: false },
                { text: ` ${i + 1}- ` + names[i] }
              ]);
            } else {
              builder.addLine(null, [
                { text: getTabPadding(0) + ':', bold: true, underline: false },
                { text: ` ${i + 1}- ` + names[i] }
              ]);
            }
          }
        }
        
        // Eğer bu rol son rol değilse, araya boşluk koyma (kullanıcı isteği: bitişik)
      }
    }

    // ═══════════════════════════════════════════
    // BAŞLIK BLOĞU (Ortalı, Kalın)
    // ═══════════════════════════════════════════
    builder.addLine(1, [
      { text: 'T.C.', bold: true }
    ]);
    builder.addLine(1, [
      { text: mahkeme, bold: true }
    ]);
    
    // ═══════════════════════════════════════════
    // BİLGİ SATIRLARI (Sola Yaslı) - başlık arası boşluk yok (kullanıcı isteği)
    // ═══════════════════════════════════════════
    addFieldBlock('DOSYA NO', dosyaNo);
    addPartyBlock(data.muvekkiller);
    addFieldBlock(imzaUnvani === 'MÜDAFİ' ? 'MÜDAFİ' : 'VEKİLİ', 'Av. ' + avukatAdi);
    addPartyBlock(data.karsi_taraflar);
    addFieldBlock('KONU:', '');
    addFieldBlock('AÇIKLAMALAR', '');
    
    // İmza öncesi boş satır (kullanıcı isteği: 1 satır)
    builder.addEmptyLines(1);
    
    // ═══════════════════════════════════════════
    // İMZA BLOĞU (Sağa Yaslı, Kalın) - role göre MÜDAFİ / VEKİLİ
    // ═══════════════════════════════════════════
    builder.addLine(2, [
      { text: imzaUnvani, bold: true }
    ]);
    builder.addLine(2, [
      { text: 'Av. ' + avukatAdi, bold: true }
    ]);
    
    // 3. content.xml üret (EKLER bölümü kullanıcı isteğiyle kaldırıldı)
    const xml = builder.buildXml();
    
    // 4. PizZip ile UDF (ZIP) dosyası oluştur
    const zip = new window.PizZip();
    zip.file('content.xml', xml);
    
    const outputBlob = zip.generate({
      type: 'blob',
      mimeType: 'application/octet-stream',
      compression: 'DEFLATE'
    });
    
    // 5. İndir
    const temizDosyaNo = dosyaNo.replace(/\//g, '-');
    const dosyaAdi = `${temizDosyaNo}_Dilekce.udf`;
    
    window.saveAs(outputBlob, dosyaAdi);
    console.log(`Dilekçe başarıyla UDF olarak oluşturuldu: ${dosyaAdi}`);
    
  } catch (error) {
    console.error("UDF dilekçe oluşturulurken bir hata oluştu:", error);
    alert("Dilekçe oluşturulurken bir hata oluştu. Detaylar tarayıcı konsolunda (F12) yazmaktadır.\nHata: " + error.message);
  }
}

// --- 10. DOM ENJEKSİYONU VE DİNAMİK STİL EŞİTLEME ---

function matchCloseButtonStyle(targetButton, sourceButton) {
  if (!sourceButton || !targetButton) return;
  
  const style = window.getComputedStyle(sourceButton);
  
  targetButton.style.width = style.width;
  targetButton.style.height = style.height;
  targetButton.style.borderRadius = style.borderRadius;
  targetButton.style.padding = style.padding;
  
  targetButton.style.display = 'inline-flex';
  targetButton.style.alignItems = 'center';
  targetButton.style.justifyContent = 'center';
  targetButton.style.boxSizing = 'border-box';
  targetButton.style.marginRight = '8px'; // Yeni modallarda bitişik durmasını önler
}

function checkAndInjectPopup() {
  const popupTitles = document.querySelectorAll(CONFIG.POPUP_TITLE_CONTAINER);
  
  popupTitles.forEach(titleContainer => {
    const textDiv = titleContainer.querySelector(CONFIG.POPUP_HEADER_TEXT_DIV);
    if (!textDiv) return;
    
    const closeBtn = titleContainer.querySelector(CONFIG.POPUP_CLOSE_BUTTON);
    if (!closeBtn) return;
    
    if (titleContainer.getAttribute('data-uyap-sablon-button-added') === 'true') {
      return;
    }
    
    const popupScope = findPopupContainer(titleContainer);
    const downloadBtn = createDownloadButton();
    
    matchCloseButtonStyle(downloadBtn, closeBtn);
    
    const titleText = textDiv.getAttribute('title') || textDiv.innerText.trim();
    const isCBS = titleText.toLowerCase().includes('cbs') && (titleText.toLowerCase().includes('soruşturma') || titleText.toLowerCase().includes('sorusturma'));
    
    popupCache.set(titleContainer, {
      partyData: isCBS ? { muvekkiller: [], karsi_taraflar: [], isCBS: true } : null,
      button: downloadBtn
    });

    if (isCBS) {
      setButtonReady(downloadBtn);
    }
    
    // Tıklama olayı dinleyicisi
    downloadBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      
      if (!downloadBtn.classList.contains('ready')) {
        if (isPartyTableRendered(popupScope)) {
          handlePartyDataFound(titleContainer, popupScope);
        } else {
          return;
        }
      }
      
      const updatedCache = popupCache.get(titleContainer);
      if (!updatedCache || !updatedCache.partyData) {
        return;
      }
      
      setButtonLoading(downloadBtn);
      if (downloadBtn.matches(':hover')) {
        showTooltip(downloadBtn, 'Dilekçe Dolduruluyor...');
      }
      
      try {
        const headerData = parseCaseHeader(titleContainer);
        const fullData = { ...headerData, ...updatedCache.partyData };
        if (fullData.isCBS) {
          await generateCbsUdfDocument(fullData);
        } else {
          await generateUdfDocument(fullData);
        }
      } catch (err) {
        console.error("İşlem sırasında hata:", err);
      } finally {
        clearButtonLoading(downloadBtn);
        if (downloadBtn.matches(':hover')) {
          showTooltip(downloadBtn, 'Şablonu İndir');
        }
      }
    });
    
    closeBtn.parentNode.insertBefore(downloadBtn, closeBtn);
    
    titleContainer.setAttribute('data-uyap-sablon-button-added', 'true');
    console.log("Beesly Dilekçe: Buton başarıyla enjekte edildi.");
    
    startPassivePartyObserver(titleContainer, popupScope);
  });
}

// --- 11. MUTATION OBSERVER VE OLAY DİNLEYİCİLERİ ---

const observer = new MutationObserver(() => {
  window.requestAnimationFrame(() => {
    checkAndInjectPopup();
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

document.addEventListener('mousemove', (e) => {
  if (!globalTooltipElement || globalTooltipElement.className === 'uyap-tooltip-hidden') {
    return;
  }
  const hoveredBtn = document.querySelector('.uyap-sablon-indir-btn:hover');
  if (!hoveredBtn) {
    hideTooltip();
  }
});

window.addEventListener('scroll', () => {
  hideTooltip();
}, true);

initGlobalTooltip();
checkAndInjectPopup();
console.log("Beesly Dilekçe v2.0: UDF formatı ile başlatıldı.");

})();
