# EYP Görüntüleyici (bağımsız paket)

Beesly ile aynı kaynaktan üretilir. Tek başına `chrome://extensions` sayfasından
geliştirici modunda yüklenebilir.

## Üretim

Repo kökünde:

```powershell
.\build-eyp-paket.ps1
```

Çıktı: `dist/eyp-goruntuleyici-vX.Y.Z.zip` (sürüm, bu klasördeki `manifest.json`dan okunur).

## İçindekiler

Beesly kökündeki `eyp-*` dosyaları birebir kopyalanır (`eyp-background.js` arka plan
olarak kullanılır); `manifest.json` ve `popup.html` bu klasördeki kalıplardır.

## Sürümleme

Bağımsız paket sürümü (`manifest.json` → `version`) Beesly sürümünden bağımsız
ilerler. EYP tarafı değişince buradaki sürümü de artırın.
