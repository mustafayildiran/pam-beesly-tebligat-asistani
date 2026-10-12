# WhatsApp UDF Düzeltici (tek başına kurulum)

Beesly'yi kurmadan, yalnızca WhatsApp Web'den gelen `.udf` dosyalarını
`.zip` yerine orijinal `.udf` adıyla indirmek için:

1. GitHub **Releases** sayfasını açın (deponun sağ tarafı).
2. En üstteki sürümde `udf-duzeltici-v*.zip` dosyasını indirip bir klasöre çıkarın.
3. Chrome'da `chrome://extensions` → sağ üst **Geliştirici modu** açık olsun.
4. **Paketlenmemiş öğe yükle** → çıkardığınız klasörü seçin.
5. `web.whatsapp.com` sekmesini yenileyin, bir `.udf` dosyasının indir
   düğmesine basın; dosya `.udf` olarak inmeli.
6. Gerçek bir `.zip` indirip adının değişmediğini doğrulayın (değişmemeli).

Eklenti dosya içeriğine dokunmaz; `.udf` adı aynen bırakılır, `.udf.zip` ise `.udf` yapılır. Ad baştan yazılmaz, bu yüzden "bozulma" yapmaz.

---

*Bu eklenti **Beesly Desk** ailesindendir (Tebligat Asistanı · EYP Görüntüleyici ·
E-Duruşma Yardımcısı · WhatsApp UDF Düzeltici). Tüm eklentiler için
[Releases sayfasına](https://github.com/mustafayildiran/pam-beesly-tebligat-asistani/releases) bakın.*

*Geliştiriciler için: bu paket `build-udf-paket.ps1` ile Beesly kaynağından
üretilir (`dist/`). Sürüm numarası `build/udf-paket/manifest.json` içindedir.*
