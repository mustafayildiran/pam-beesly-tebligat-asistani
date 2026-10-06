# EYP Görüntüleyici (tek başına kurulum)

Beesly'yi kurmadan, yalnızca EYP okumak için:

1. GitHub **Releases** sayfasını açın (deponun sağ tarafı).
2. En üstteki sürümde `eyp-goruntuleyici-v*.zip` dosyasını indirip bir klasöre çıkarın.
3. Chrome'da `chrome://extensions` → sağ üst **Geliştirici modu** açık olsun.
4. **Paketlenmemiş öğe yükle** → çıkardığınız klasörü seçin.
5. UYAP'ta bir `.eyp` dosyasının yanındaki 👁 **Görüntüle** düğmesine basın.

Hepsi bu — komut satırı, betik, teknik bilgi gerekmez.

---

*Geliştiriciler için: bu paket `build-eyp-paket.ps1` ile Beesly kaynağından
üretilir (`dist/`). Sürüm numarası `build/eyp-paket/manifest.json` içindedir.*
