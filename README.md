<img src="icon128.png" width="96" alt="Beesly Desk - UYAP Asistanı">

# Beesly Desk - UYAP Asistanı

UYAP Avukat Portal için genel asistan: tebligat barkodlarını tek tıkla sorgulama (PTT + UETS), e-duruşma takip penceresi, EYP önizleme ve WhatsApp UDF düzeltme — tek Chrome eklentisinde.

| Durum | Görünüm |
|---|---|
| Sorgu başarılı | ![Pam](assets/pam-success.gif) |
| Kayıt bulunamadı | ![Michael](assets/michael-panic.gif) |
| Giriş başarılı | ![Alkış](assets/applause-clap.gif) |

## Özellikler

- **Otomatik barkod algılama:** UYAP sayfasındaki `4xx`, `TB…` ve `5xx` kodları (bitişik veya aralıklı yazım dahil) listelenir; araç çubuğu ikonunda sayı rozeti belirir
- **PTT sorgusu (4xx / TB):** son durum + tüm gönderi hareketleri (tarih, saat, işyeri)
- **UETS sorgusu (5xx):** tüm kanıtlar (kabul / teslim / okunma / kanuni tebliğ) ve zamanları
- **Hızlı erişim:** barkodu seç + sağ tık → *Beesly ile sorgula*, veya `Ctrl+Shift+Y` (değiştirilebilir)
- **Eklenti içi UETS girişi:** kullanıcı kodu + şifre + güvenlik kodu + SMS onayı; e-Devlet/e-İmza için siteye yönlendirme
- **Temiz çalışma:** sorgu sekmeleri iş bitince otomatik kapanır, UYAP odağı kaybolmaz, barkod tek tıkla panoya kopyalanır
- **The Office temalı arayüz** (Dunder Mifflin · UYAP Şubesi)
- **EYP görüntüleyici:** UYAP'ta `.eyp` dosyalarını indirmeden önizleme (sayfa içi 👁 Görüntüle düğmeleri)
- **E-Duruşma takip penceresi:** duruşma-sorgulama sayfasında sağ altta ◎ Takip butonu; `/durusma-takip` listesini sürüklenebilir, yeniden boyutlandırılabilir küçük panelde açar (otomatik yenileme: kapalı / 15 sn / 30 sn / 60 sn / 2 dk). Sekme değişmediği için e-duruşma bağlantısı açık kalır. Panel üstündeki **Bugün** şeridi günün duruşmalarını saat + sıra numarasıyla listeler, sıradakini işaretler; tıklayınca listede o satıra kaydırır.
- **WhatsApp UDF düzeltici:** WhatsApp Web'de `.udf` dosyasının `.udf.zip` olarak inmesini engeller
(`.udf` aynen bırakılır, `.udf.zip` ise `.udf` yapılır). Dosya adı asla baştan yazılmaz,
saf `.zip` dosyalarına dokunulmaz, baytlara dokunulmaz.

> Yalnızca EYP lazımsa: GitHub **Releases** sayfasından `eyp-goruntuleyici-v*.zip`
> dosyasını indirip zip'ten çıkarın, `chrome://extensions` → Geliştirici modu →
> Paketlenmemiş öğe yükle. Hepsi bu.
>
> Yalnızca E-Duruşma lazımsa: GitHub **Releases** sayfasından
> `edurusma-yardimcisi-v*.zip` dosyasını indirip aynı şekilde kurun
> (takip penceresi + EYP önizleme içerir, tebligat sorgusu içermez).
>
> Yalnızca WhatsApp UDF düzeltme lazımsa: GitHub **Releases** sayfasından
> `udf-duzeltici-v*.zip` dosyasını indirip aynı şekilde kurun.

## Nasıl çalışır?

| Kod | Kaynak | Yöntem |
|---|---|---|
| `4…` (13 hane), `TB…` | PTT | `ptt.gov.tr` altyapısı üzerinden resmi sorgu API'si (Cloudflare Turnstile doğrulamalı) |
| `5…` (13 hane) | UETS (e-Tebligat) | `api.etebligat.gov.tr` üzerinden oturumlu sorgu |
| — | E-Duruşma | `avukat.uyap.gov.tr/durusma-takip` sayfası gömülü panel (iframe) içinde açılır; ek API çağrısı yok |
| `.udf` | WhatsApp Web | İndirme anında dosya adı denetlenir: `.udf` aynen bırakılır, `.udf.zip` ise `.udf` yapılır; başka adlandırmaya dokunulmaz, baytlara dokunulmaz |

## Kurulum

1. `chrome://extensions` adresini açın, sağ üstten **Geliştirici modu**'nu etkinleştirin
2. **Paketlenmemiş öğe yükle** → eklenti klasörünü seçin
3. UYAP'ta barkodlu bir sayfayı açın; ikonda sayı rozeti belirecek
4. Kısayolu değiştirmek için: `chrome://extensions/shortcuts`
5. UETS sorgusu için popup'taki **Giriş Yap** formundan bir kez giriş yapın (SMS kodu gelebilir)
6. E-Duruşma için: `avukat.uyap.gov.tr` üzerinde duruşma-sorgulama sayfasını açın, sağ alttaki ◎ Takip butonuna basın; yenileme aralığını panel başlığından ayarlayın
7. WhatsApp UDF için: `web.whatsapp.com` sekmesinde bir `.udf` dosyasının indir düğmesine normal şekilde basın; dosya `.udf` olarak iner (ek ayar gerekmez)

## Veri Güvenliği ve Gizlilik

Bu bölüm özellikle meslektaşlarımız için ayrıntılı yazılmıştır. Özet: **eklenti kişisel veri toplamaz, izlemez, dışarıya veri göndermez.**

### Meslektaşlarımız için: hukuki çerçeve ve teknik doğrulama

**Hukuki çerçeve.** Avukatlık Kanunu m.36 uyarınca sır saklama yükümlülüğü bu eklentinin
tasarım ölçütüdür: eklenti, müvekkile ait bilgi ve belgeyi **okumaz, kopyalamaz, iletmez,
saklamaz**. KVKK m.4'teki ölçülülük ve amaçla sınırlılık ilkeleri gereği her modül yalnızca
işlevi için zorunlu asgari veriyi ve yalnızca kullanıcının kendi tarayıcısında işler:

- Tebligat sorgusu: yalnızca barkod numarası → yalnızca PTT/UETS resmî uçlarına.
- UETS girişi: kullanıcı kodu + şifre + güvenlik/SMS kodu giriş anında bellekte tutulur,
  işlem bitince silinir; diske yazılmaz.
- E-Duruşma / EYP / UDF: sayfa içeriği eklenti dışına çıkarılmaz; EYP'de dosya indirilmez,
  UDF'de baytlara dokunulmaz; WhatsApp sohbet metni okunmaz.

KVKK terminolojisiyle ifade edersek: eklenti geliştiricisi ne veri sorumlusu ne de veri
işleyendir — çünkü veri kullanıcının cihazından hiç çıkmaz. Veri toplayan sunucu, analitik
ve telemetri altyapısı teknik olarak mevcut değildir.

**Teknik doğrulama.** Kodun tamamı bu depoda açıktır; dilediğiniz uzmana inceletebilir
veya aşağıdaki üç adımla kendiniz doğrulayabilirsiniz:

1. **Ağ trafiği:** Geliştirici Araçları → Ağ sekmesini açıp bir sorgu yapın. İsteklerin
   yalnızca `api.ptt.gov.tr`, `api.etebligat.gov.tr`, `*.uyap.gov.tr` ve `web.whatsapp.com`
   adreslerine gittiğini göreceksiniz. Başka adres yoktur.
2. **İzinler:** `manifest.json` içindeki her iznin karşılığı aşağıdaki tablodadır, fazlası
   yoktur. MV3 içerik güvenlik politikası gereği eklenti uzaktan kod çalıştıramaz;
   çalışan kod yalnızca bu paketteki koddur.
3. **Depolama:** Uygulama → Depolama alanından bakılabilir. Saklananlar yalnızca oturum
   jetonu, yoklama barkodu, sonuç önbelleği ve panel ayarıdır (kapsam aşağıdaki
   tabloda); şifre asla saklanmaz, Çıkış ile jeton silinir.

### Trafik nereye gidiyor?

| İşlem | Hedef adres | Giden veri |
|---|---|---|
| PTT sorgusu | `api.ptt.gov.tr`, `www.ptt.gov.tr` | Yalnızca barkod numarası |
| UETS sorgusu | `api.etebligat.gov.tr`, `ptt.etebligat.gov.tr` | Barkod + oturum jetonu |
| UETS girişi | `api.etebligat.gov.tr` | Kullanıcı kodu + şifre + güvenlik/SMS kodu (yalnızca giriş anında) |
| Bağlantı yoklaması | `api.etebligat.gov.tr` | Kullanıcının ilk kurulumda bir kez girdiği kendi barkodu (normal sorgu olarak) |
| E-Duruşma paneli | `avukat.uyap.gov.tr` | UYAP'ın kendi takip sayfası iframe içinde açılır; eklenti ek veri göndermez |
| WhatsApp UDF düzeltmesi | `web.whatsapp.com` (sayfa içi) | Yalnızca indirilen dosyanın adı denetlenir (`.udf.zip` → `.udf`); içerik okunmaz, dışarıya veri gönderilmez |
| Başka hiçbir adrese istek yapılmaz | — | GIF'ler dahil tüm görseller eklenti paketinin içindedir |

### Cihazda ne saklanıyor?

| Veri | Nerede | Süre / amaç |
|---|---|---|
| UETS oturum jetonu | Tarayıcı oturum deposu (+ yeniden başlatmaya dayanıklı yedek) | Sorgular için; Çıkış ile silinir |
| UETS site girişi bayrağı | Cihaz içi önbellek | Sitede yapılan girişle sorgu başarılı olunca konur (12 saat geçerli); yalnızca "çalıştı" bilgisi, jeton/şifre içermez |
| Yoklama barkodu | Cihaz içi önbellek | İlk kurulumda bir kez sorulur; "Bağlı mıyım?" kontrolünde normal UETS sorgusu olarak kullanılır |
| Son sorgu sonuçları | Cihaz içi önbellek | Popup'ta hızlı gösterim için |
| Rozet/bağlantı bayrakları | Cihaz içi önbellek | Arayüz durumu için |
| E-Duruşma panel ayarı | Cihaz içi önbellek | Panel konumu/boyutu + otomatik yenileme aralığı; UYAP dışına iletilmez |

### Asla yapılmayanlar

- **Şifre saklanmaz:** giriş anında bellekte tutulur, işlem bitince silinir
- **UYAP içeriği saklanmaz/iletilmez:** sayfa yalnızca barkod deseni için taranır
- **İzleme yok:** analitik, telemetri, reklam, üçüncü taraf çerez yok
- **Uzak kod yok:** eklenti yalnızca paketteki kodu çalıştırır

### İzinler neden gerekli?

| İzin | Gerekçe |
|---|---|
| `activeTab`, `scripting`, `tabs`, `*.uyap.gov.tr` | Barkodları okumak ve seçimi almak için |
| `storage` | Oturum ve sonuç önbelleği için |
| `clipboardWrite` | Barkodu panoya kopyalamak için |
| `contextMenus` | Sağ-tık kısayolu için |
| `alarms` | Boşta kalan sorgu sekmesini kapatmak için |
| `downloads`, `webRequest` | EYP görüntüleyici: indirmeyi yakalayıp önizlemeye dönüştürmek için (dosya indirilmez); WhatsApp UDF: indirme anında dosya adını düzeltmek için (içerik değiştirilmez) |

Kodun tamamı bu depoda açıktır; tarayıcının Geliştirici Araçları → Ağ sekmesinden trafiği kendiniz de denetleyebilirsiniz.

> ⚖️ **Hukuki not:** Eklenti sonuçları bilgilendirme amaçlıdır. Tebligatın hukuki geçerliliği için PTT ve UETS'in resmi kayıtları esastır.

## Sık Sorulan Sorular

**Şifrem nereye gidiyor?**
Yalnızca UETS'in resmi giriş adresine, giriş anında. Eklentide, dosyada veya başka sunucuda saklanmaz.

**UYAP'taki müvekkil dosyalarım okunuyor mu?**
Hayır. Sayfa metni yalnızca `4/5/TB` barkod deseni için taranır; dosya içeriği kopyalanmaz, saklanmaz, iletilmez.

**Neden bu kadar izin istiyor?**
Tablodaki gerekçelere bakın; her izin tek bir işleve bağlıdır, fazlası yoktur.

**Sorgu çalışmazsa ne yapmalıyım?**
Sonuç kutusundaki `İz:` satırı hangi adımın takıldığını söyler. UETS için formdaki **Bağlantıyı Test Et** düğmesi oturumu denetler. Çoğu sorun eklentiyi `chrome://extensions` sayfasından yenileyince çözülür.

**e-Devlet ile giriş yapabilir miyim?**
Evet. Giriş formundaki **e-Devlet ile giriş (sitede)** düğmesi UETS giriş sayfasını açar;
e-Devlet/e-İmza/Mobil İmza ile sitede giriş yapın, sonra popup'tan Sorgula'ya basın.
Rozet ilk başta "giriş gerekli" göstermeye devam eder; ilk başarılı sorgudan sonra
**bağlı ✓ · site girişi** olur (12 saat geçerli; uzantı şifrenizi görmez ve saklamaz).

**WhatsApp'tan inen .udf dosyası bozuk mu çıkıyor?**
Hayır. Eklenti dosya içeriğine dokunmaz, yalnızca indirme anında dosya adını düzeltir (`.zip` dayatmasını kaldırır).
Uzantıyı elle `.zip` → `.udf` yapmak da baytları bozmaz. Bozulma hissinin gerçek sebepleri:
Windows'ta "uzantıları gizle" açıksa dosyanın aslında `dosya.udf.zip` olarak kalması veya
dosyanın WinRAR ile açılmaya çalışılmasıdır.

## Sürüm

v1.3.1 — PTT + UETS sorgulama, E-Duruşma takip penceresi + Bugün şeridi (+ bağımsız E-Duruşma paketi), EYP görüntüleyici (+ bağımsız EYP paketi), WhatsApp UDF düzeltici (+ bağımsız UDF paketi), rozet, sağ-tık/kısayol, eklenti içi giriş, Office teması.

## Destek

Hata ve öneriler için GitHub **Issues** sekmesini kullanın.

## Lisans

MIT — ayrıntılar için LICENSE dosyasına bakın.

