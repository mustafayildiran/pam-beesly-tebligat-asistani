# E-Duruşma Yardımcısı (tek başına kurulum)

Beesly'yi kurmadan, yalnızca e-duruşma takip penceresi (+ EYP önizleme) için:

1. GitHub **Releases** sayfasını açın (deponun sağ tarafı).
2. En üstteki sürümde `edurusma-yardimcisi-v*.zip` dosyasını indirip bir klasöre çıkarın.
3. Chrome'da `chrome://extensions` → sağ üst **Geliştirici modu** açık olsun.
4. **Paketlenmemiş öğe yükle** → çıkardığınız klasörü seçin.
5. `avukat.uyap.gov.tr` üzerinde duruşma-sorgulama sayfasını açın, sağ alttaki
   ◎ **Takip** butonuna basın.

Hepsi bu — komut satırı, betik, teknik bilgi gerekmez.

---

*Bu eklenti **Beesly Desk** ailesindendir (Tebligat Asistanı · EYP Görüntüleyici ·
E-Duruşma Yardımcısı · WhatsApp UDF Düzeltici). Tüm eklentiler için
[Releases sayfasına](https://github.com/mustafayildiran/pam-beesly-tebligat-asistani/releases) bakın.*

---

*Geliştiriciler için: bu paket `build-edurusma-paket.ps1` ile Beesly kaynağından
üretilir (`dist/`). Sürüm numarası `build/edurusma-paket/manifest.json` içindedir.*
