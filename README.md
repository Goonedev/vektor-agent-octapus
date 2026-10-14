# Vektör

Vektör, bilgisayarında yaşayan sesli bir yapay zekâ asistanı. Konuşursun, **Gemini Live** seni gerçek zamanlı duyar, cevabını sesli verir ve bilgisayarını gerçekten yönetir: uygulama açar, dosya düzenler, sesi kısar, ekranına bakar, zamanlayıcı kurar, hava durumunu getirir. Yaptığı her iş, arayüzde canlı bir bileşen olarak belirir.

**İndir:** [goonedev.github.io/vektor-agent-octapus](https://goonedev.github.io/vektor-agent-octapus/)

![Vektör asistan ekranı](docs/asistan.png)

## Neler var

- **Sesli, canlı arayüz.** Ortadaki cam küre dinlerken maviye, seni duyarken turkuaza, düşünürken mora, araç çalıştırırken turuncuya döner; kenarı ve halkaları sesin şiddetiyle nefes alır. Konuşmanın yazılı dökümü altta akar.
- **Canlı bileşenler.** Her araç çağrısı sağ panelde bir kart olarak açılır ve sonucuna göre şekil alır: hava durumu kartı, CPU/bellek halkaları, dosya listeleri, ekran görüntüsü önizlemesi, geri sayan zamanlayıcılar, klavye kısayolu tuşları, terminal çıktısı.
- **Mini ada.** Ekranın en üstünde, Dynamic Island tarzı küçük bir çubuk. Her zaman üstte durur, Vektör'ün o anki durumunu, konuşmanın altyazısını ve çalışan aracı gösterir. Üzerine gelince mikrofon ve "aç" düğmeleri çıkar; geri kalan alana tıklamalar arkadaki pencerelere geçer.
- **569 işlevsel araç.** 113 ana araç ve 456 araçlık bir kütüphane: Windows ayar sayfaları ve sistem araçları, 100 site ve site içi arama, kısayollar, metin ve hesap araçları, bilgi servisleri, sistem bilgisi, geliştirici ve dosya araçları. Hepsi bilgisayarda gerçekten bir şey yapar. Tam liste aşağıda.
- **"Yapamam" yerine yol arar.** Doğrudan bir aracı yoksa kütüphanede arar (find_tools), bulamazsa işin nasıl yapıldığını web'de araştırıp araçlarla uygulanabilir bir plana çevirir (find_a_way) ve uygular. Reddettiğin bir işi başka yoldan zorlamaz.
- **İşi sonuna kadar götürür.** Açılan "Yükle", "İndir", "Kaydet", "Tamam" gibi düğmelere her uygulamada kendisi basar (click_button).
- "Şarkı aç" dersen YouTube'da bulup videoyu oynatır; "Steam'den X'i indir" dersen kurulumu başlatıp "Yükle"ye basar; "şu projede şunu düzelt" dersen Claude Code'u o klasörde çalıştırıp sonucu özetler.
- **Web araştırması.** Tarayıcı açmadan web'de arayıp kaynak sayfaları okuyarak soruları yanıtlar (deep_research), kaynaklarıyla birlikte. Bir dosyayı araştırıp bulur ve onayınla indirir (find_download_link + download_from_web).
- **Çok adımlı işler.** Birden fazla aracı, gerekirse aynısını birkaç kez, sırayla çalıştırır; adımları önceden biliyorsa run_steps ile tek planda yapar (aç → bekle → bas → bildir). Bir adım başarısız olursa ya da reddedilirse orada durur ve nedenini söyler.
- **Onay her yerde.** Riskli işlerde onay ana pencerede ve mini adada çıkar; ekranın üstünden "İzin ver / Reddet" dersin.
- **Güvenlik.** Silme, kapatma, komut çalıştırma gibi riskli araçlar çalışmadan önce bir onay penceresi açılır (Enter = izin ver, Esc = reddet, 45 saniyede otomatik ret).
- **Glassmorphism + Apple paleti.** Renkler, gri tonları, ikon çizgisi ve tipografi, "Cupertino Docs" tasarım sisteminden geliyor: Apple sistem renkleri, SF Pro, 20×20 ızgarada 1.5px çizgili ikonlar. Koyu ve açık tema.

| Canlı kartlar | Araç kütüphanesi |
| --- | --- |
| ![Canlı kartlar](docs/canli-kartlar.png) | ![Araçlar](docs/araclar.png) |

| Onay penceresi | Mini ada |
| --- | --- |
| ![Onay](docs/onay.png) | ![Mini ada](docs/mini-ada.png) |

## Kurulum

Gereken: [Node.js](https://nodejs.org) 20 veya üstü ve bir [Gemini API anahtarı](https://aistudio.google.com/apikey) (ücretsiz alınabilir).

```bash
git clone https://github.com/goonedev/vektor-agent-octapus.git
cd vektor-agent-octapus
npm install
npm start
```

İlk açılışta **Ayarlar**'a API anahtarını yapıştır ve kaydet. İstersen anahtarı ortam değişkeniyle de verebilirsin: `GEMINI_API_KEY=... npm start`.

Kullanmak için ortadaki küreye dokun ya da her yerden **Ctrl+Shift+Space** (macOS'ta ⌘⇧Space) kısayoluna bas ve konuş. Yazarak da sorabilirsin.

### Hazır kurulum dosyası (Windows)

Node.js'e gerek yok: [indirme sitesinden](https://goonedev.github.io/vektor-agent-octapus/) ya da [Releases](https://github.com/Goonedev/vektor-agent-octapus/releases/latest) sayfasından **`Vektor-Setup-x.y.z.exe`** dosyasını indirip çalıştır. Kurulum, masaüstüne ve Başlat menüsüne kısayol ekler. Kod imzalı olmadığı için Windows "bilgisayarınızı korudu" uyarısı verebilir; **Ek bilgi › Yine de çalıştır** ile devam et.

### Uygulama içi güncelleme

Kurulum dosyasıyla kurulan Vektör, açılışta ve dört saatte bir GitHub Releases'ı denetler. Yeni sürüm varsa arka planda indirir; **Ayarlar › Güncellemeler**'de ve bildirimde **"Yeniden başlat ve güncelle"** düğmesi çıkar. Düğmeye basmasan da güncelleme bir sonraki kapanışta kurulur. Tepsi menüsünde "Güncellemeleri denetle" de var.

### Yeni sürüm yayınlamak

1. `package.json` içindeki `"version"` alanını artır (ör. `0.1.0` → `0.1.1`). Bunun için `npm version patch --no-git-tag-version` de kullanabilirsin.
2. Değişikliği `main` dalına gönder (doğrudan push ya da pull request birleştirme).

`main`'e gelen her push'ta `.github/workflows/release.yml` çalışır. O sürüm için henüz bir Release yoksa testleri koşar, Windows sunucusunda kurulum dosyasını derler ve `v0.1.1` adıyla bir GitHub Release yayınlar. Sürüm değişmediyse hiçbir şey yayınlamaz. Kurulu tüm Vektör'ler birkaç saat içinde, ya da "Güncellemeleri denetle" ile hemen, yeni sürüme geçer. İstersen `v0.1.1` gibi bir etiket göndererek de yayın başlatabilirsin.

### İndirme sitesi

`site/` klasörü, [goonedev.github.io/vektor-agent-octapus](https://goonedev.github.io/vektor-agent-octapus/) adresindeki indirme sayfasıdır. Sayfa en son sürümü GitHub'dan canlı okur; yeni sürüm çıktığında "Windows için indir" düğmesi kendiliğinden yeni kurulum dosyasını gösterir. `site/` ya da ekran görüntüleri değişip `main`'e gönderildiğinde `.github/workflows/pages.yml` siteyi yeniden yayınlar.

İlk kez açmak için bir kerelik: repo **Settings › Pages › Build and deployment › Source** alanını **GitHub Actions** yap.

Yerelde kurulum dosyası üretmek istersen (yayınlamadan):

```bash
npm run dist:win     # Windows .exe kurulum dosyası (Windows'ta çalıştır)
npm run dist:mac     # macOS .dmg (macOS'ta çalıştır)
npm run dist:linux   # Linux AppImage
```

Çıktılar `release/` klasörüne düşer.

### İzinler

- **macOS:** Klavye/fare ve pencere araçları için *Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik*, ekran görüntüsü için *Ekran Kaydı* izni gerekir. Parlaklık için `brew install brightness`.
- **Linux:** Klavye/fare ve pencere araçları `xdotool` ve `wmctrl`, ses `pactl` (PulseAudio/PipeWire), medya `playerctl`, parlaklık `brightnessctl` kullanır. Eksikse araç hangi paketin gerektiğini söyler.
- **Windows:** Ek bir şey gerekmez. Ses, klavye, fare ve pencere işlemleri ilk kullanımda bir kez derlenip önbelleğe alınan küçük bir yerel yardımcıyla (`src/main/native/VektorNative.cs`) yapılır.

## Model

Varsayılan model `gemini-3.1-flash-live-preview` (yerel ses, düşük gecikme). Ayarlar'dan `gemini-2.5-flash-native-audio-latest` ya da istediğin başka bir Live modeline geçebilir, sesi (Kore, Puck, Charon...) ve asistanın kişiliğini değiştirebilirsin. Bağlantı koparsa Vektör oturumu kaldığı yerden sürdürmeyi dener.

## Mimari

```
src/
  main/                 Electron ana süreci
    main.js             pencereler, mini ada, tepsi, kısayol, onay akışı, IPC
    preload.js          arayüze açılan güvenli köprü (window.vektor)
    tools/              ana araçlar — kategori başına bir dosya
      index.js          kayıt, Gemini şeması, çalıştırma, onay
      meta.js           find_tools, use_tool, find_a_way
      packs/            kütüphane: ayarlar, siteler, kısayollar, medya, metin, hesap, bilgi, sistem, geliştirici, dosya
      util.js           platform yardımcıları (PowerShell, AppleScript, xdotool...)
    native/             Windows yerel yardımcısı (C#)
    store.js            ayarlar, notlar, görevler (JSON, atomik yazma)
    scheduler.js        zamanlayıcı, alarm, hatırlatıcı
    smoke.js            uçtan uca duman testi
    updater.js          GitHub Releases üzerinden uygulama içi güncelleme
    claudecode.js       Claude Code'u bir proje klasöründe tek seferlik çalıştırır
  renderer/             ana pencere
    live.js             Gemini Live oturumu: mikrofon akışı, ses, araç çağrıları
    audio.js            16 kHz PCM yakalama (AudioWorklet), 24 kHz kesintisiz oynatma
    orb.js              canlı küre (canvas)
    cards.js            araç sonuçlarını canlı bileşenlere çeviren kartlar
    app.js              arayüz mantığı
  mini/                 ekranın üstündeki mini ada
```

Akış: mikrofon → `AudioWorklet` (16 kHz PCM) → Gemini Live WebSocket → model bir araç çağırırsa `live.js` onu IPC ile ana sürece gönderir → `tools/index.js` gerekirse onay ister, aracı çalıştırır → sonucun **yalnızca metin kısmı** modele döner, görsel kısmı (kart, resim) arayüzde kalır. Ekran görüntüsü aracında `look=true` verilirse görüntü modele ayrıca gönderilir; böylece "ekranımda ne var?" sorusunu yanıtlayabilir.

## Geliştirme

```bash
npm test          # birim testleri (araç kaydı, hesap makinesi, eşleştirme, zamanlayıcı...)
npm run smoke     # gerçek uygulamayı açar, güvenli 45 aracı çalıştırır, pencerelerin görüntüsünü out/smoke'a kaydeder
npm run dev       # geliştirici araçlarıyla başlatır
```

Yeni bir araç eklemek için ilgili kategori dosyasına `{ name, category, title, description, params, run }` biçiminde bir nesne eklemen yeterli; Gemini şeması, araç kütüphanesi ve kartlar otomatik oluşur. Sonucun arayüzde nasıl görüneceğini `display.type` belirler (`stats`, `list`, `weather`, `image`, `timer`, `kv`, `value`...).

## 569 araç

Ana araçlar (113) Gemini'ye doğrudan tanımlıdır. Kütüphanedeki araçlar (456) sistem talimatında adlarıyla listelenir ve `use_tool` ile çalışır; böylece canlı oturum hızlı kalır, onay kuralları aynen geçerlidir.


*onaylı* işaretli araçlar çalışmadan önce izin ister.

### Web (14)

| Araç | Ne yapar |
| --- | --- |
| `open_url` | Varsayılan tarayıcıda bir web sitesi açar. "youtube.com" gibi alan adları da kabul edilir. |
| `web_search` | Tarayıcıda bir arama motorunda arama yapar. |
| `youtube_search` | YouTube'da video arar ve sonuç sayfasını açar. |
| `open_maps` | Google Haritalar'da bir yeri gösterir ya da iki nokta arasında yol tarifi açar. |
| `translate_text` | Metni Google Çeviri'de açar. Kısa çevirileri kendin yapabilirsin; bu araç kullanıcı çeviriyi ekranda görmek isterse kullanılır. |
| `compose_email` | Varsayılan e-posta uygulamasında alıcı, konu ve gövdesi dolu yeni bir e-posta taslağı açar. Göndermez. |
| `wikipedia_summary` | Vikipedi'den bir konunun kısa özetini getirir. Bilgiyi kullanıcıya sesli özetle. |
| `read_webpage` | Bir web sayfasının metnini indirir, böylece içeriğini özetleyebilir ya da soruları yanıtlayabilirsin. |
| `check_website` | Bir web sitesinin açık olup olmadığını ve yanıt süresini kontrol eder. |
| `download_file` | Bir adresteki dosyayı İndirilenler klasörüne kaydeder. |
| `deep_research` | Bir soruyu web'de araştırır: arama yapar, kaynak sayfaları okur ve kaynaklı bir cevap verir. Tarayıcı açmaz. Güncel, çok kaynaklı ya da derinlemesine bilgi gerektiren sorularda (fiyat, karşılaştırma, "en iyi X", haber, teknik detay) bunu kullan; sonucu kullanıcıya sesli özetle. |
| `find_download_link` | Bir dosyanın (program, belge, sürücü, PDF...) nereden indirilebileceğini araştırır ve doğrudan indirme bağlantıları önerir. Resmi kaynakları tercih eder. Bulduktan sonra kullanıcı onaylarsa download_from_web ile indir. |
| `download_from_web` · *onaylı* | Verilen bir adresteki dosyayı İndirilenler klasörüne indirir. Genelde find_download_link ile bulunan bir adresle kullanılır. İsteğe bağlı olarak indirince açar. |
| `find_a_way` | Hazır bir araçla yapılamayan bir işin nasıl yapılacağını web'de araştırır ve Vektör'ün araçlarıyla uygulanabilir adımlara çevirir. |

### Uygulamalar (9)

| Araç | Ne yapar |
| --- | --- |
| `open_app` | Bilgisayardaki bir uygulamayı adıyla başlatır (Chrome, Spotify, Word, Hesap Makinesi, Discord...). |
| `close_app` | Çalışan bir uygulamayı nazikçe kapatır (kaydedilmemiş iş varsa uygulama sorar). |
| `list_running_apps` | Şu an çalışan uygulamaları en çok bellek kullananlardan başlayarak listeler. |
| `kill_process` · *onaylı* | Yanıt vermeyen bir işlemi PID ya da adıyla zorla sonlandırır. Kaydedilmemiş veriler kaybolabilir. |
| `open_system_settings` | İşletim sisteminin ayarlar uygulamasını belirli bir bölümde açar. |
| `open_terminal` | Belirtilen klasörde bir terminal penceresi açar. |
| `open_task_manager` | Görev Yöneticisi / Etkinlik Monitörü'nü açar. |
| `steam_install` · *onaylı* | Bir oyunu Steam mağazasında bulur, Steam'de kurulumu başlatır ve Steam'in Yükle penceresini onaylayarak indirmeyi başlatır (Windows). Ücretli oyunlarda satın alma gerekir. |
| `steam_launch` | Steam'de kurulu bir oyunu adıyla başlatır. |

### Dosyalar (16)

| Araç | Ne yapar |
| --- | --- |
| `list_directory` | Bir klasörün içeriğini listeler. "masaüstü", "indirilenler", "belgeler" gibi takma adları anlar. |
| `read_text_file` | Bir metin dosyasının içeriğini okur (txt, md, kod, csv, json...). |
| `write_text_file` · *onaylı* | Yeni bir metin dosyası oluşturur. Var olan bir dosyanın üstüne yazmak kullanıcı onayı ister. |
| `append_text_file` | Bir metin dosyasının sonuna satır ekler; dosya yoksa oluşturur. |
| `create_folder` | Yeni bir klasör oluşturur (ara klasörlerle birlikte). |
| `move_to_trash` · *onaylı* | Bir dosya ya da klasörü çöp kutusuna taşır (kalıcı silmez, geri alınabilir). |
| `move_path` | Bir dosya ya da klasörü başka yere taşır veya yeniden adlandırır. Hedef bir klasörse içine taşınır. |
| `copy_path` | Bir dosya ya da klasörü başka bir yere kopyalar. |
| `search_files` | Bir klasör ve alt klasörlerinde adına göre dosya arar. "*.pdf" gibi kalıplar ya da ad parçası kabul eder. |
| `recent_files` | Bir klasördeki (varsayılan İndirilenler) en son değişen dosyaları gösterir. |
| `file_info` | Bir dosya ya da klasörün boyutunu, tarihlerini ve türünü gösterir. Klasörler için toplam boyutu hesaplar. |
| `open_path` | Bir dosyayı varsayılan uygulamasıyla ya da bir klasörü dosya yöneticisinde açar. |
| `reveal_in_folder` | Dosyayı bulunduğu klasörde seçili olarak gösterir. |
| `compress_zip` | Bir dosya ya da klasörü ZIP arşivi olarak sıkıştırır. |
| `extract_zip` | Bir ZIP arşivini bir klasöre çıkarır. |
| `organize_folder` · *onaylı* | Bir klasördeki dosyaları türlerine göre alt klasörlere (Resimler, Belgeler, Videolar, Arşivler...) taşır. İndirilenler/Masaüstü temizliği için idealdir. |

### Sistem bilgisi (9)

| Araç | Ne yapar |
| --- | --- |
| `system_overview` | İşletim sistemi, işlemci, bellek, açık kalma süresi ve kullanıcı bilgisini gösterir. |
| `cpu_usage` | Anlık işlemci kullanımını ve yükü ölçer. |
| `memory_usage` | RAM kullanımını gösterir. |
| `battery_status` | Pil yüzdesini, şarj durumunu ve kalan süreyi gösterir. |
| `disk_space` | Disklerin dolu ve boş alanını gösterir. |
| `network_info` | Yerel IP adreslerini ve ağ bağdaştırıcılarını listeler. |
| `public_ip` | İnternete çıkan genel IP adresini ve yaklaşık konumu (şehir, ülke, servis sağlayıcı) gösterir. |
| `list_displays` | Bağlı monitörleri, çözünürlüklerini ve ölçeklemeyi listeler. |
| `current_datetime` | Şu anki tarih, saat, gün ve saat dilimini verir. |

### Sistem kontrolü (12)

| Araç | Ne yapar |
| --- | --- |
| `get_volume` | Sistem ses düzeyini ve sessiz durumunu okur. |
| `set_volume` | Sistem ses düzeyini ayarlar. Ya mutlak düzey (0–100) ya da göreli değişim (ör. +10, -20) ver. |
| `set_mute` | Sistem sesini kapatır ya da açar. |
| `set_brightness` | Ekran parlaklığını 0–100 arası ayarlar (dizüstü ekranlarda çalışır). |
| `lock_screen` | Bilgisayarı kilitler. |
| `sleep_computer` · *onaylı* | Bilgisayarı uyku moduna alır; isteğe bağlı olarak birkaç dakika sonra. |
| `shutdown_computer` · *onaylı* | Bilgisayarı kapatır; isteğe bağlı olarak belirli dakika sonra (zamanlayıcı cancel_shutdown ile iptal edilebilir). |
| `restart_computer` · *onaylı* | Bilgisayarı yeniden başlatır; isteğe bağlı olarak belirli dakika sonra. |
| `cancel_shutdown` | Zamanlanmış kapatma, yeniden başlatma ya da uykuyu iptal eder. |
| `empty_trash` · *onaylı* | Geri dönüşüm kutusunu / çöp kutusunu kalıcı olarak boşaltır. |
| `set_dark_mode` | İşletim sisteminin karanlık / aydınlık temasını değiştirir. |
| `set_wallpaper` | Masaüstü duvar kağıdını bir resim dosyasıyla değiştirir. |

### Medya (7)

| Araç | Ne yapar |
| --- | --- |
| `media_play_pause` | Çalan müziği ya da videoyu duraklatır veya devam ettirir (Spotify, YouTube, Apple Music...). |
| `media_next` | Sonraki şarkıya / videoya geçer. |
| `media_previous` | Önceki şarkıya / videoya döner. |
| `take_screenshot` | Ekran görüntüsü alır ve Resimler/Vektör klasörüne kaydeder. Kullanıcı "ekranımda ne var", "şuna bak" derse look=true ver; görüntü sana gönderilir ve yorumlayabilirsin. |
| `screenshot_to_clipboard` | Ekran görüntüsü alıp doğrudan panoya kopyalar, yapıştırmaya hazır. |
| `open_camera` | Kamera uygulamasını açar. |
| `play_youtube` | Bir şarkıyı ya da videoyu YouTube'da bulur ve doğrudan oynatır (arama sayfasında bırakmaz). "Şarkı aç", "şu videoyu aç", "biraz müzik çal" gibi isteklerde bunu kullan. |

### Pano (4)

| Araç | Ne yapar |
| --- | --- |
| `clipboard_read` | Panodaki metni okur. Kullanıcı "kopyaladığım şeyi özetle/çevir" derse kullan. |
| `clipboard_write` | Verilen metni panoya kopyalar; kullanıcı istediği yere yapıştırabilir. |
| `clipboard_clear` | Panoyu ve Vektör'ün pano geçmişini temizler (ör. bir şifre kopyaladıktan sonra). |
| `clipboard_history` | Vektör açıkken panoya kopyalanan son metinleri listeler. |

### Klavye ve fare (8)

| Araç | Ne yapar |
| --- | --- |
| `type_text` | Odaktaki pencereye klavyeden yazıyormuş gibi metin yazar (Türkçe karakterler dahil). |
| `press_keys` | Bir tuş ya da kısayol gönderir: "ctrl+c", "alt+tab", "win+d", "cmd+space", "enter", "f5", "ctrl+shift+esc". |
| `mouse_move` | Fare imlecini ekran koordinatına (piksel) taşır. |
| `mouse_click` | Fareyle tıklar. Koordinat verilirse önce oraya gider. |
| `mouse_scroll` | Fare tekerleğiyle kaydırır. Pozitif = yukarı, negatif = aşağı. |
| `show_desktop` | Tüm pencereleri küçültüp masaüstünü gösterir. |
| `click_button` | Öndeki uygulamada üstünde yazan metne göre bir düğmeye, bağlantıya ya da menü öğesine basar: "Yükle", "İndir", "Kaydet", "Tamam", "Evet", "İleri" gibi. Bir işlemi bitirmek için açılan pencerelerdeki düğmeyi tamamlamak için bunu kullan; ekranı tahmin edip koordinat tıklamana gerek kalmaz. |
| `list_buttons` | Öndeki penceredeki basılabilir düğme, bağlantı ve menü öğelerinin adlarını listeler. "Ekranda hangi düğmeler var?" ya da bir işlemi bitirmeden önce doğru düğmenin adını öğrenmek için kullan. |

### Pencereler (4)

| Araç | Ne yapar |
| --- | --- |
| `list_windows` | Ekrandaki açık pencereleri uygulama adlarıyla listeler. |
| `focus_window` | Başlığı ya da uygulama adı eşleşen pencereyi öne getirir. |
| `maximize_window` | Etkin pencereyi ekranı kaplayacak şekilde büyütür. |
| `minimize_window` | Etkin pencereyi simge durumuna küçültür. |

### Verimlilik (12)

| Araç | Ne yapar |
| --- | --- |
| `set_timer` | Geri sayım zamanlayıcısı kurar; süre dolunca bildirim ve ses verir, sen de kullanıcıya haber verirsin. |
| `set_alarm` | Belirli bir saate alarm kurar (ör. "07:30"). Saat geçmişse yarına kurulur. |
| `set_reminder` | Bir şeyi hatırlatmak için hatırlatıcı kurar. Ya dakika sonra ya da belirli zamanda. |
| `list_timers` | Aktif zamanlayıcıları, alarmları ve hatırlatıcıları listeler. |
| `cancel_timer` | Bir zamanlayıcı, alarm ya da hatırlatıcıyı adıyla ya da kimliğiyle iptal eder. "hepsi" hepsini iptal eder. |
| `show_notification` | Masaüstünde bir sistem bildirimi gösterir. |
| `add_note` | Vektör not defterine bir not kaydeder. |
| `list_notes` | Kayıtlı notları listeler; isteğe bağlı olarak içinde arama yapar. |
| `delete_note` | Bir notu kimliğiyle ya da başlığındaki bir kelimeyle siler. |
| `add_todo` | Yapılacaklar listesine bir görev ekler. |
| `list_todos` | Yapılacaklar listesini gösterir. |
| `complete_todo` | Bir görevi tamamlandı olarak işaretler. |

### Araçlar (11)

| Araç | Ne yapar |
| --- | --- |
| `calculate` | Matematik ifadesini kesin olarak hesaplar: + - * / ^ %, parantez, sqrt, sin (derece), log, ln, fact, pi. Yüzde: "1500 * 18%" ya da "200 + 10%". Sayısal sonuçları her zaman bununla hesapla, tahmin etme. |
| `convert_units` | Uzunluk, ağırlık, hacim, sıcaklık (c/f/k), hız, veri boyutu, süre, alan, enerji ve basınç birimleri arasında çevirir. Birimleri kısaltmayla ver: km, mi, kg, lb, l, gal, c, f, mb, gb, km/h, mph, m2, kwh... |
| `convert_currency` | Güncel kurlarla para birimi çevirir (USD, EUR, TRY, GBP, JPY...). |
| `get_weather` | Bir şehrin anlık hava durumunu ve 5 günlük tahminini getirir. Şehir verilmezse kullanıcının konumu kullanılır. |
| `get_news` | Google Haberler'den güncel manşetleri ya da bir konudaki haberleri getirir. |
| `world_clock` | Bir ya da birden fazla şehirde şu an saatin kaç olduğunu gösterir. |
| `generate_password` | Güçlü, rastgele bir şifre üretir ve panoya kopyalar. Şifreyi sesli okuma; sadece panoda olduğunu söyle. |
| `random_pick` | Yazı tura atar, zar atar, aralıkta rastgele sayı üretir ya da bir listeden seçim yapar. |
| `run_steps` | Birden fazla aracı tek bir planda, sırayla çalıştırır. Kullanıcının isteği birkaç adım gerektiriyorsa (aç → bul → bas → bildir gibi) bunu kullan; aynı aracı birden fazla kez de koyabilirsin. Her adımda tool = araç adı, args_json = parametreleri JSON metni olarak, wait_ms = o adımdan sonra beklenecek süre (pencere açılması gibi). Bir adım başarısız olursa ya da kullanıcı reddederse plan orada durur. |
| `find_tools` | Kütüphanede bir iş için uygun araçları arar ve parametrelerini verir. |
| `use_tool` | Kütüphanedeki bir aracı adıyla çalıştırır; onay gerektirenler yine onay ister. |

### Ağ (3)

| Araç | Ne yapar |
| --- | --- |
| `ping_host` | Bir sunucuya ping atarak gecikmeyi ve paket kaybını ölçer. İnternet bağlantısını test etmek için 8.8.8.8 kullan. |
| `dns_lookup` | Bir alan adının IP adreslerini ve kayıtlarını sorgular. |
| `check_port` | Bir sunucuda TCP portunun açık olup olmadığını kontrol eder (ör. localhost 3000). |

### Geliştirici (4)

| Araç | Ne yapar |
| --- | --- |
| `run_command` · *onaylı* | Terminal komutu çalıştırır ve çıktısını döndürür (Windows'ta PowerShell, diğerlerinde sh). Başka araç işi görmüyorsa kullan; her çalıştırma kullanıcı onayı ister. |
| `git_status` | Bir proje klasörünün git dalını, değişen dosyalarını ve son commitlerini gösterir. |
| `open_in_vscode` | Bir dosya ya da klasörü Visual Studio Code'da açar. |
| `ask_claude_code` · *onaylı* | Kullanıcı bir projede kod işi istediğinde Claude Code'u o proje klasöründe bir kez çalıştırır (kod yazma, analiz, hata düzeltme). Claude yalnızca o klasördeki dosyaları düzenler. "Devam et" denirse continue=true ile aynı oturumdan sürdür. Cevabı kullanıcıya kısaca özetle. |

## Kütüphane (456 araç)

### Dosyalar (15)

| Araç | Ne yapar |
| --- | --- |
| `files_folder_size` | Klasör boyutu — Bir klasörün toplam boyutunu ve dosya sayısını hesaplar, en çok yer kaplayan alt klasörleri gösterir. |
| `files_find_large` | Büyük dosyaları bul — Bir klasörde (alt klasörler dahil) belirli bir boyuttan büyük dosyaları en büyükten başlayarak listeler; yer açmak için kullan. |
| `files_find_duplicates` | Yinelenen dosyaları bul — Bir klasörde içeriği birebir aynı olan dosyaları bulur (boyut + SHA-1). |
| `files_count_by_type` | Türe göre dosya sayısı — Bir klasördeki dosyaları uzantıya göre sayar ve her türün toplam boyutunu gösterir. |
| `files_bulk_rename` | Toplu yeniden adlandır *(onaylı)* — Bir klasördeki dosya adlarında bul-değiştir yapar. |
| `files_find_replace` | Dosyada bul-değiştir *(onaylı)* — Bir metin dosyasının içinde geçen ifadeyi değiştirir ve kaç yerde değiştiğini söyler. |
| `files_hash` | Dosya hash — Bir dosyanın MD5, SHA-1 ya da SHA-256 özetini hesaplar; beklenen değer verilirse karşılaştırır (indirme doğrulama). |
| `files_compare` | İki dosyayı karşılaştır — İki dosyanın aynı olup olmadığını boyut ve SHA-256 ile kontrol eder; metin dosyalarında ilk farklı satırı gösterir. |
| `files_tree` | Klasör ağacı — Bir klasörün yapısını ağaç biçiminde gösterir (derinlik sınırlı). |
| `files_merge_text` | Metin dosyalarını birleştir *(onaylı)* — Birden çok metin dosyasını sırayla tek bir dosyada birleştirir. |
| `files_image_info` | Resim bilgisi — Bir resmin biçimini, piksel boyutunu, en-boy oranını ve dosya boyutunu gösterir. |
| `files_resize_image` | Resmi yeniden boyutlandır — Bir resmi oranını koruyarak yeniden boyutlandırır ve "-GENİŞLİKxYÜKSEKLİK" ekli yeni bir dosyaya kaydeder; aslına dokunmaz. |
| `files_convert_image` | Resim formatını çevir — Bir resmi PNG ↔ JPG arasında çevirir ve yeni bir dosya olarak kaydeder; aslına dokunmaz. |
| `files_copy_path` | Yolu panoya kopyala — Bir dosya ya da klasörün tam yolunu (ya da yalnızca adını, üst klasörünü veya file:// adresini) panoya kopyalar. |
| `files_find_empty_dirs` | Boş klasörleri bul — Bir klasörün altındaki boş klasörleri (yalnızca desktop.ini/Thumbs.db gibi sistem dosyası içerenler dahil) listeler. |

### Sistem bilgisi (42)

| Araç | Ne yapar |
| --- | --- |
| `sys_installed_programs` | Kurulu programlar — Bilgisayarda kurulu programları sürümleriyle listeler. |
| `sys_startup_programs` | Başlangıç programları — Bilgisayar açılırken otomatik başlayan programları listeler. |
| `sys_services` | Hizmetler — Sistem hizmetlerini (servisleri) durumlarıyla listeler; ada göre filtrelenebilir. |
| `sys_service_status` | Hizmet durumu — Tek bir hizmetin çalışıp çalışmadığını, başlangıç türünü ve bağımlılıklarını gösterir. |
| `sys_restart_service` | Hizmeti yeniden başlat *(onaylı)* — Bir Windows hizmetini durdurup yeniden başlatır (ör. |
| `sys_top_cpu` | En çok CPU kullanan işlemler — İşlemciyi en çok yoran programları gösterir; bilgisayar yavaşladığında ya da fan çalıştığında kullan. |
| `sys_top_memory` | En çok RAM kullanan işlemler — Belleği (RAM) en çok kullanan programları gösterir; aynı programın işlemleri birleştirilir. |
| `sys_uptime` | Çalışma süresi — Bilgisayarın ne zamandır açık olduğunu ve en son ne zaman başlatıldığını söyler. |
| `sys_os_version` | İşletim sistemi sürümü — Windows/macOS/Linux sürümünü, derleme numarasını ve mimariyi gösterir. |
| `sys_gpu_info` | Ekran kartı — Ekran kartlarını, video belleğini ve sürücü sürümünü gösterir. |
| `sys_cpu_details` | İşlemci detayı — İşlemci modelini, çekirdek/iş parçacığı sayısını, hızını ve önbellek boyutlarını gösterir. |
| `sys_ram_modules` | RAM modülleri — Takılı bellek modüllerini (kapasite, hız, tür, üretici, yuva) listeler; RAM yükseltmesi planlarken işe yarar. |
| `sys_motherboard_bios` | Anakart ve BIOS — Anakart üreticisini/modelini ve BIOS sürümüyle tarihini gösterir. |
| `sys_usb_devices` | USB aygıtları — Takılı USB aygıtlarını ve denetleyicilerini listeler. |
| `sys_audio_devices` | Ses aygıtları — Ses kartlarını ve ses aygıtlarını listeler. |
| `sys_printers` | Yazıcılar — Kurulu yazıcıları, durumlarını ve varsayılan yazıcıyı gösterir. |
| `sys_set_default_printer` | Varsayılan yazıcıyı ayarla *(onaylı)* — Seçilen yazıcıyı varsayılan yazıcı yapar. |
| `sys_wifi_networks` | Yakındaki Wi-Fi ağları — Çevredeki kablosuz ağları sinyal gücü ve güvenlik türüyle listeler. |
| `sys_wifi_profiles` | Kayıtlı Wi-Fi profilleri — Bilgisayarın daha önce bağlandığı ve kaydettiği Wi-Fi ağlarının adlarını listeler (şifreleri göstermez). |
| `sys_wifi_status` | Wi-Fi bağlantı durumu — Bağlı olunan Wi-Fi ağını, sinyal gücünü ve bağlantı hızını gösterir. |
| `sys_bluetooth_devices` | Bluetooth aygıtları — Eşleştirilmiş Bluetooth aygıtlarını ve bağlantı durumlarını listeler. |
| `sys_ip_config` | IP yapılandırması — Etkin ağ bağdaştırıcılarının IP adresini, ağ geçidini, DNS sunucularını ve MAC adresini gösterir. |
| `sys_flush_dns` | DNS önbelleğini temizle *(onaylı)* — DNS çözümleyici önbelleğini temizler; site açılmıyor ya da eski adrese gidiyorsa işe yarar. |
| `sys_listening_ports` | Dinlenen portlar — Bağlantı bekleyen (dinlenen) TCP portlarını ve bunları açan programları listeler. |
| `sys_firewall_status` | Güvenlik duvarı durumu — Güvenlik duvarı profillerinin (etki alanı, özel, ortak) açık ya da kapalı olduğunu gösterir. |
| `sys_monitor_info` | Monitör bilgisi — Bağlı monitörlerin adını, çözünürlüğünü, yenileme hızını ve ölçeklemesini gösterir. |
| `sys_battery_report` | Pil raporu oluştur — Windows pil sağlığı raporunu (tasarım kapasitesi, tam şarj kapasitesi, kullanım geçmişi) Belgeler klasörüne kaydedip açar. |
| `sys_disk_health` | Disk sağlığı — Fiziksel disklerin modelini, türünü (SSD/HDD), boyutunu ve sağlık durumunu gösterir. |
| `sys_temp_size` | Geçici dosya boyutu — Geçici dosyalar klasörünün (temp) ne kadar yer kapladığını hesaplar. |
| `sys_clean_temp` | Geçici dosyaları temizle *(onaylı)* — Geçici dosyalar klasöründeki 1 günden eski dosyaları siler; kullanımda olan dosyaları atlar ve ne kadar yer açıldığını söyler. |
| `sys_power_plan` | Güç planı — Etkin güç planını ve kullanılabilir planları gösterir. |
| `sys_set_power_plan` | Güç planını değiştir *(onaylı)* — Güç planını Dengeli, Yüksek performans ya da Güç tasarrufu olarak değiştirir. |
| `sys_restart_explorer` | Dosya Gezgini'ni yeniden başlat *(onaylı)* — Görev çubuğu ya da masaüstü donduğunda Windows Gezgini'ni (explorer.exe) kapatıp yeniden açar. |
| `sys_winget_search` | winget ile program ara — Windows Paket Yöneticisi (winget) deposunda program arar; kurmadan önce doğru kimliği (Id) bulmak için kullan. |
| `sys_winget_install` | winget ile program kur *(onaylı)* — Bir programı winget ile kimliğine (Id) göre kurar. |
| `sys_winget_upgrades` | Güncellenebilir programlar — winget ile güncellemesi bulunan programları mevcut ve yeni sürümleriyle listeler. |
| `sys_winget_upgrade` | Programı güncelle *(onaylı)* — Bir programı winget ile günceller ya da all=true ile güncellemesi olan tüm programları günceller. |
| `sys_env_vars` | Ortam değişkenleri — Ortam değişkenlerini (PATH, TEMP...) listeler. |
| `sys_hosts_file` | Hosts dosyasını göster — Sistemin hosts dosyasını (alan adı yönlendirmeleri) salt okunur olarak gösterir. |
| `sys_fonts` | Yüklü yazı tipleri — Bilgisayarda yüklü yazı tipi ailelerini listeler; bir yazı tipinin kurulu olup olmadığını öğrenmek için filtre ver. |
| `sys_drivers` | Sürücüler — Yüklü aygıt sürücülerini sürüm ve tarihleriyle listeler (en yeni 50). |
| `sys_event_errors` | Sistem olay günlüğü hataları — Son 24 saatte sistem olay günlüğüne düşen hataları (en son 15) gösterir; çökme ya da donma sebebini ararken kullan. |

### Medya (12)

| Araç | Ne yapar |
| --- | --- |
| `media_volume_up` | Sesi artır — Sistem sesini belirtilen yüzde kadar artırır (varsayılan 10). |
| `media_volume_down` | Sesi azalt — Sistem sesini belirtilen yüzde kadar azaltır (varsayılan 10). |
| `media_stop` | Medyayı durdur — Çalan müziği ya da videoyu durdurur (medya "durdur" tuşu). |
| `media_spotify_search` | Spotify'da ara — Spotify'da şarkı, sanatçı, albüm ya da çalma listesi arar. |
| `media_spotify_play` | Spotify'da çal — Spotify'da şarkı ya da sanatçıyı arayıp sonuçları açar. |
| `media_radio` | Radyo aç — Bir Türk radyo istasyonunun resmi canlı yayın sitesini tarayıcıda açar; ya da 7/24 lofi yayını. |
| `media_podcast_search` | Podcast ara — Spotify ya da Apple Podcasts'te podcast arar. |
| `media_speak` | Metni sesli oku — Verilen metni bilgisayarın kendi konuşma sentezleyicisiyle sesli okur (kuruluysa Türkçe ses). |
| `media_white_noise` | Beyaz gürültü — Uyku ya da odak için uzun bir beyaz / pembe / kahverengi gürültü ya da yağmur sesi videosunu YouTube'da açar. |
| `media_focus_music` | Odak müziği — Çalışırken dinlemek için canlı lofi / odak müziği yayınını YouTube'da açar. |
| `media_now_playing` | Çalan şarkı — Spotify'da (macOS'ta Müzik'te de) ya da tarayıcıdaki YouTube sekmesinde şu an ne çaldığını söyler. |
| `media_sleep_timer` | Uyku zamanlayıcısı — Belirtilen dakika sonra çalan müziği / videoyu durdurur. |

### Araçlar (42)

| Araç | Ne yapar |
| --- | --- |
| `calc_percent` | Yüzde hesapla — Bir sayının yüzdesini (200'ün %15'i) ya da bir sayının diğerinin yüzde kaçı olduğunu (30, 200'ün yüzde kaçı) hesaplar. |
| `calc_percent_change` | Yüzde değişim — İki değer arasındaki yüzde artışı ya da azalışı hesaplar (eski fiyat → yeni fiyat). |
| `calc_vat` | KDV hesapla — Bir tutara KDV ekler ya da KDV dahil tutardan KDV'yi ayırır. |
| `calc_discount` | İndirim hesapla — İndirimli fiyatı ve kazancı hesaplar. |
| `calc_split_bill` | Hesap bölme — Hesabı bahşişle birlikte kişi başına böler. |
| `calc_loan` | Kredi taksiti — Aylık kredi taksitini, toplam geri ödemeyi ve toplam faizi hesaplar. |
| `calc_compound_interest` | Bileşik faiz — Bileşik faizle bir birikimin zamanla ne kadar olacağını hesaplar; isteğe bağlı aylık ek yatırım. |
| `calc_deposit` | Mevduat getirisi — Vadeli mevduatın brüt ve stopaj sonrası net getirisini hesaplar. |
| `calc_bmi` | Vücut kitle indeksi — Boy ve kiloya göre VKİ'yi ve sınıfını hesaplar. |
| `calc_calories` | Günlük kalori ihtiyacı — Mifflin-St Jeor formülüyle bazal metabolizmayı ve hareket düzeyine göre günlük kalori ihtiyacını hesaplar. |
| `calc_water` | Su ihtiyacı — Kiloya göre günlük su ihtiyacını hesaplar (kg başına ~33 ml). |
| `calc_ideal_weight` | İdeal kilo — Devine formülüyle boya göre ideal kiloyu ve sağlıklı VKİ aralığını verir. |
| `calc_age` | Yaş hesapla — Doğum tarihinden yaşı yıl, ay ve gün olarak; bir sonraki doğum gününe kalan günü hesaplar. |
| `calc_date_diff` | İki tarih arası — İki tarih arasındaki gün, hafta ve ay farkını hesaplar. |
| `calc_add_days` | Tarihe gün ekle — Bir tarihe gün ekler ya da çıkarır (eksi değer). |
| `calc_weekday` | Haftanın günü — Bir tarihin haftanın hangi gününe denk geldiğini söyler. |
| `calc_countdown` | Tarihe kalan süre — Bir tarihe (isteğe bağlı saatle) ne kadar kaldığını hesaplar. |
| `calc_unix_time` | Unix zaman damgası — Unix zaman damgasını tarihe ya da tarihi zaman damgasına çevirir. |
| `calc_timezone` | Saat dilimi çevir — Bir şehirdeki saati başka bir şehrin saatine çevirir (İstanbul 14:30 → New York). |
| `calc_sleep` | Uyku döngüsü — 90 dakikalık uyku döngülerine göre ne zaman yatman ya da kalkman gerektiğini hesaplar (uykuya dalma ~15 dk). |
| `calc_stats` | İstatistik — Bir sayı listesinin toplamını, ortalamasını, medyanını, modunu, en küçük/büyük değerini ve standart sapmasını hesaplar. |
| `calc_gcd_lcm` | EBOB ve EKOK — Tam sayıların en büyük ortak bölenini ve en küçük ortak katını bulur. |
| `calc_is_prime` | Asal mı — Bir sayının asal olup olmadığını söyler; değilse en küçük böleni ve en yakın asalları verir. |
| `calc_prime_factors` | Asal çarpanlar — Bir sayıyı asal çarpanlarına ayırır (360 = 2³ × 3² × 5). |
| `calc_factorial` | Faktöriyel — n! değerini tam olarak hesaplar (büyük sayılar dahil). |
| `calc_fibonacci` | Fibonacci — n'inci Fibonacci sayısını ve ilk sayıları verir. |
| `calc_base_convert` | Sayı tabanı çevir — Bir sayıyı tabanlar arasında çevirir (ikilik, sekizlik, onluk, onaltılık... |
| `calc_roman` | Roma rakamı — Sayıyı Roma rakamına ya da Roma rakamını sayıya çevirir (1-3999). |
| `calc_number_words` | Sayıyı yazıyla — Bir sayıyı Türkçe yazıya çevirir (çek, fatura için): 1250,50 → bin iki yüz elli virgül elli. |
| `calc_quadratic` | İkinci derece denklem — ax² + bx + c = 0 denkleminin köklerini (gerçek ya da karmaşık) bulur. |
| `calc_area` | Alan hesapla — Kare, dikdörtgen, daire, üçgen ya da yamuğun alanını (ve çevresini) hesaplar. |
| `calc_volume` | Hacim hesapla — Küp, dikdörtgen prizma, silindir, küre ya da koninin hacmini hesaplar. |
| `calc_speed` | Hız, yol, zaman — Hız (km/sa), yol (km) ve süreden (saat) ikisi verilince üçüncüsünü hesaplar. |
| `calc_fuel_cost` | Yakıt maliyeti — Bir yolculuğun yakıt tüketimini ve maliyetini hesaplar. |
| `calc_grade_average` | Not ortalaması — Notların ortalamasını hesaplar; kredi verilirse ağırlıklı ortalama (AGNO) ve harf notu. |
| `calc_color` | Renk çevir — Bir rengi HEX, RGB ve HSL biçimleri arasında çevirir. |
| `calc_random` | Rastgele sayı — Belirli aralıkta bir ya da birden fazla rastgele tam sayı üretir (kriptografik). |
| `calc_dice` | Zar at — Bir ya da birden fazla zar atar. |
| `calc_coin` | Yazı tura — Para atar. |
| `calc_month_calendar` | Ay takvimi — Bir ayın takvimini gösterir (Pazartesi başlangıçlı; bugün işaretli). |
| `calc_week_number` | Hafta numarası — Bir tarihin ISO hafta numarasını verir. |
| `calc_workdays` | İş günü say — İki tarih arasındaki iş günlerini sayar (hafta sonları hariç; istenirse sabit resmi tatiller de hariç). |

### Geliştirici (15)

| Araç | Ne yapar |
| --- | --- |
| `dev_git_log` | Git geçmişi — Bir git deposunun son commitlerini (hash, yazar, zaman, mesaj) listeler. |
| `dev_git_diff` | Git değişiklik özeti — Bir depodaki commitlenmemiş değişikliklerin özetini verir: hangi dosyada kaç satır eklendi/silindi, kaç yeni dosya var. |
| `dev_git_branches` | Git dalları — Bir depodaki yerel ve uzak dalları, aktif dalı ve uzakla farkını (ahead/behind) son güncellenme sırasına göre listeler. |
| `dev_git_pull` | Git pull *(onaylı)* — Bir depoda uzak daldaki değişiklikleri çeker ve birleştirir (git pull). |
| `dev_git_commit` | Git commit *(onaylı)* — Sahnelenmiş değişiklikleri verilen mesajla commitler. |
| `dev_npm_scripts` | npm scriptleri — Bir projenin package.json dosyasındaki scriptleri (build, dev, test...) ve komutlarını listeler. |
| `dev_npm_run` | npm script çalıştır *(onaylı)* — Bir projede package.json'daki bir scripti (npm run <script>) çalıştırır ve çıktının sonunu gösterir. |
| `dev_http_request` | HTTP isteği *(onaylı)* — Bir adrese GET, POST, PUT, DELETE ya da HEAD isteği atar; durum kodunu, başlıkları ve yanıt gövdesini gösterir. |
| `dev_fetch_json` | URL'den JSON — Bir adresten JSON indirir ve okunaklı biçimde gösterir. |
| `dev_port_process` | Portu kullanan süreç — Bir yerel portu (ör. |
| `dev_free_port` | Portu boşalt *(onaylı)* — Bir yerel portu dinleyen süreci sonlandırarak portu boşaltır (ör. |
| `dev_versions` | Geliştirici araç sürümleri — Bilgisayarda kurulu geliştirici araçlarının sürümlerini gösterir: Node, npm, Python, Git, Java, Docker, .NET, Go, Rust. |
| `dev_docker_ps` | Docker konteynerleri — Çalışan Docker konteynerlerini (all=true ise durmuş olanları da) imaj, durum ve portlarıyla listeler. |
| `dev_gitignore` | .gitignore oluştur *(onaylı)* — Bir proje klasörüne şablonlardan (ör. |
| `dev_cron_explain` | Cron açıkla — 5 alanlı bir cron ifadesini (ör. |

### Windows ayarları (104)

| Araç | Ne yapar |
| --- | --- |
| `settings_display` | Ekran ayarları — Ayarlar uygulamasında "Ekran" sayfasını açar (çözünürlük, ölçek, yenileme hızı ve çoklu ekran). |
| `settings_night_light` | Gece ışığı ayarları — Ayarlar uygulamasında "Gece ışığı" sayfasını açar (mavi ışık filtresi ve zamanlaması). |
| `settings_sound` | Ses ayarları — Ayarlar uygulamasında "Ses" sayfasını açar (çıkış/giriş aygıtı ve ses düzeyi). |
| `settings_volume_mixer` | Ses karıştırıcı ayarları — Ayarlar uygulamasında "Ses karıştırıcı" sayfasını açar (uygulama başına ses düzeyi ve aygıt seçimi). |
| `settings_notifications` | Bildirimler ayarları — Ayarlar uygulamasında "Bildirimler" sayfasını açar (uygulama bildirimlerini açma/kapatma). |
| `settings_focus` | Odak / Rahatsız etmeyin ayarları — Ayarlar uygulamasında "Odak / Rahatsız etmeyin" sayfasını açar (odak yardımı ve rahatsız etmeyin kuralları). |
| `settings_power` | Güç ve pil ayarları — Ayarlar uygulamasında "Güç ve pil" sayfasını açar (ekran kapanma, uyku ve pil tasarrufu). |
| `settings_storage` | Depolama ayarları — Ayarlar uygulamasında "Depolama" sayfasını açar (disk kullanımı ve geçici dosyalar). |
| `settings_storage_sense` | Depolama algısı ayarları — Ayarlar uygulamasında "Depolama algısı" sayfasını açar (otomatik disk temizleme kuralları). |
| `settings_multitasking` | Çoklu görev ayarları — Ayarlar uygulamasında "Çoklu görev" sayfasını açar (pencere yaslama ve sanal masaüstleri). |
| `settings_clipboard` | Pano ayarları — Ayarlar uygulamasında "Pano" sayfasını açar (pano geçmişi ve cihazlar arası eşitleme). |
| `settings_remote_desktop` | Uzak masaüstü ayarları — Ayarlar uygulamasında "Uzak masaüstü" sayfasını açar (uzak bağlantılara izin verme). |
| `settings_about` | Hakkında ayarları — Ayarlar uygulamasında "Hakkında" sayfasını açar (cihaz adı, işlemci, bellek ve Windows sürümü). |
| `settings_activation` | Etkinleştirme ayarları — Ayarlar uygulamasında "Etkinleştirme" sayfasını açar (Windows lisans ve etkinleştirme durumu). |
| `settings_troubleshoot` | Sorun giderme ayarları — Ayarlar uygulamasında "Sorun giderme" sayfasını açar (yerleşik sorun gidericiler). |
| `settings_recovery` | Kurtarma ayarları — Ayarlar uygulamasında "Kurtarma" sayfasını açar (bilgisayarı sıfırlama ve gelişmiş başlangıç). |
| `settings_bluetooth` | Bluetooth ve cihazlar ayarları — Ayarlar uygulamasında "Bluetooth ve cihazlar" sayfasını açar (Bluetooth cihaz eşleme). |
| `settings_printers` | Yazıcılar ve tarayıcılar ayarları — Ayarlar uygulamasında "Yazıcılar ve tarayıcılar" sayfasını açar (yazıcı ekleme ve varsayılan yazıcı). |
| `settings_mouse` | Fare ayarları — Ayarlar uygulamasında "Fare" sayfasını açar (imleç hızı, birincil düğme ve kaydırma). |
| `settings_touchpad` | Dokunmatik yüzey ayarları — Ayarlar uygulamasında "Dokunmatik yüzey" sayfasını açar (dokunmatik yüzey hareketleri ve hassasiyet). |
| `settings_pen` | Kalem ve Windows Ink ayarları — Ayarlar uygulamasında "Kalem ve Windows Ink" sayfasını açar (kalem düğmeleri ve el yazısı). |
| `settings_autoplay` | Otomatik kullan ayarları — Ayarlar uygulamasında "Otomatik kullan" sayfasını açar (USB/DVD takılınca ne yapılacağı). |
| `settings_usb` | USB ayarları — Ayarlar uygulamasında "USB" sayfasını açar (USB bağlantı bildirimleri ve güç tasarrufu). |
| `settings_wifi` | Wi-Fi ayarları — Ayarlar uygulamasında "Wi-Fi" sayfasını açar (kablosuz ağlar ve bilinen ağlar). |
| `settings_ethernet` | Ethernet ayarları — Ayarlar uygulamasında "Ethernet" sayfasını açar (kablolu ağ, IP ve DNS). |
| `settings_vpn` | VPN ayarları — Ayarlar uygulamasında "VPN" sayfasını açar (VPN bağlantısı ekleme ve yönetme). |
| `settings_hotspot` | Mobil etkin nokta ayarları — Ayarlar uygulamasında "Mobil etkin nokta" sayfasını açar (internet bağlantısını paylaşma). |
| `settings_airplane_mode` | Uçak modu ayarları — Ayarlar uygulamasında "Uçak modu" sayfasını açar (tüm kablosuz iletişimi kapatma). |
| `settings_proxy` | Proxy ayarları — Ayarlar uygulamasında "Proxy" sayfasını açar (ara sunucu ayarları). |
| `settings_data_usage` | Veri kullanımı ayarları — Ayarlar uygulamasında "Veri kullanımı" sayfasını açar (ağ başına veri kullanımı ve sınırlar). |
| `settings_background` | Arka plan ayarları — Ayarlar uygulamasında "Arka plan" sayfasını açar (masaüstü duvar kağıdı ve slayt gösterisi). |
| `settings_colors` | Renkler ayarları — Ayarlar uygulamasında "Renkler" sayfasını açar (açık/koyu mod ve vurgu rengi). |
| `settings_themes` | Temalar ayarları — Ayarlar uygulamasında "Temalar" sayfasını açar (tema, imleç ve masaüstü simgeleri). |
| `settings_lock_screen` | Kilit ekranı ayarları — Ayarlar uygulamasında "Kilit ekranı" sayfasını açar (kilit ekranı resmi ve durum bilgileri). |
| `settings_start_menu` | Başlat menüsü ayarları — Ayarlar uygulamasında "Başlat menüsü" sayfasını açar (sabitlenenler, öneriler ve klasörler). |
| `settings_taskbar` | Görev çubuğu ayarları — Ayarlar uygulamasında "Görev çubuğu" sayfasını açar (görev çubuğu öğeleri, hizalama ve gizleme). |
| `settings_fonts` | Yazı tipleri ayarları — Ayarlar uygulamasında "Yazı tipleri" sayfasını açar (yüklü yazı tipleri ve yazı tipi ekleme). |
| `settings_installed_apps` | Yüklü uygulamalar ayarları — Ayarlar uygulamasında "Yüklü uygulamalar" sayfasını açar (uygulama kaldırma, onarma ve boyutlar). |
| `settings_default_apps` | Varsayılan uygulamalar ayarları — Ayarlar uygulamasında "Varsayılan uygulamalar" sayfasını açar (varsayılan tarayıcı ve dosya ilişkilendirmeleri). |
| `settings_startup_apps` | Başlangıç uygulamaları ayarları — Ayarlar uygulamasında "Başlangıç uygulamaları" sayfasını açar (oturum açılınca başlayan uygulamalar). |
| `settings_offline_maps` | Çevrimdışı haritalar ayarları — Ayarlar uygulamasında "Çevrimdışı haritalar" sayfasını açar (harita indirme ve güncelleme). |
| `settings_video_playback` | Video oynatma ayarları — Ayarlar uygulamasında "Video oynatma" sayfasını açar (HDR video ve pil için video ayarları). |
| `settings_your_info` | Hesap bilgileri ayarları — Ayarlar uygulamasında "Hesap bilgileri" sayfasını açar (Microsoft hesabı ve profil resmi). |
| `settings_signin_options` | Oturum açma seçenekleri ayarları — Ayarlar uygulamasında "Oturum açma seçenekleri" sayfasını açar (PIN, Windows Hello ve parola). |
| `settings_email_accounts` | E-posta ve hesaplar ayarları — Ayarlar uygulamasında "E-posta ve hesaplar" sayfasını açar (uygulamaların kullandığı hesaplar). |
| `settings_family` | Aile ayarları — Ayarlar uygulamasında "Aile" sayfasını açar (aile üyeleri ve ebeveyn denetimi). |
| `settings_date_time` | Tarih ve saat ayarları — Ayarlar uygulamasında "Tarih ve saat" sayfasını açar (saat dilimi ve saat eşitleme). |
| `settings_region` | Bölge ayarları — Ayarlar uygulamasında "Bölge" sayfasını açar (ülke ve bölgesel biçimler). |
| `settings_language` | Dil ayarları — Ayarlar uygulamasında "Dil" sayfasını açar (Windows görüntüleme dili ve dil paketleri). |
| `settings_typing` | Yazma ve klavye ayarları — Ayarlar uygulamasında "Yazma ve klavye" sayfasını açar (otomatik düzeltme, öneriler ve dokunmatik klavye). |
| `settings_speech` | Konuşma ayarları — Ayarlar uygulamasında "Konuşma" sayfasını açar (konuşma dili ve sesler). |
| `settings_game_mode` | Oyun modu ayarları — Ayarlar uygulamasında "Oyun modu" sayfasını açar (oyunlar için performans modu). |
| `settings_game_bar` | Xbox Game Bar ayarları — Ayarlar uygulamasında "Xbox Game Bar" sayfasını açar (Game Bar kısayolu ve denetleyici düğmesi). |
| `settings_captures` | Yakalamalar ayarları — Ayarlar uygulamasında "Yakalamalar" sayfasını açar (oyun kaydı ve ekran görüntüsü konumu). |
| `settings_text_size` | Metin boyutu ayarları — Ayarlar uygulamasında "Metin boyutu" sayfasını açar (metni büyütme ve görsel efektler). |
| `settings_magnifier` | Büyüteç ayarları — Ayarlar uygulamasında "Büyüteç" sayfasını açar (ekran büyüteci). |
| `settings_color_filters` | Renk filtreleri ayarları — Ayarlar uygulamasında "Renk filtreleri" sayfasını açar (renk körlüğü filtreleri). |
| `settings_contrast_themes` | Karşıtlık temaları ayarları — Ayarlar uygulamasında "Karşıtlık temaları" sayfasını açar (yüksek karşıtlık temaları). |
| `settings_narrator` | Ekran Okuyucusu ayarları — Ayarlar uygulamasında "Ekran Okuyucusu" sayfasını açar (ekranı sesli okuma). |
| `settings_captions` | Altyazılar ayarları — Ayarlar uygulamasında "Altyazılar" sayfasını açar (altyazı stili ve canlı altyazılar). |
| `settings_location_privacy` | Konum izinleri ayarları — Ayarlar uygulamasında "Konum izinleri" sayfasını açar (konum hizmeti ve uygulama izinleri). |
| `settings_camera_privacy` | Kamera izinleri ayarları — Ayarlar uygulamasında "Kamera izinleri" sayfasını açar (kameraya erişebilen uygulamalar). |
| `settings_microphone_privacy` | Mikrofon izinleri ayarları — Ayarlar uygulamasında "Mikrofon izinleri" sayfasını açar (mikrofona erişebilen uygulamalar). |
| `settings_windows_update` | Windows Update ayarları — Ayarlar uygulamasında "Windows Update" sayfasını açar (güncellemeleri denetleme ve yükleme). |
| `settings_update_history` | Güncelleme geçmişi ayarları — Ayarlar uygulamasında "Güncelleme geçmişi" sayfasını açar (yüklenen güncellemeler ve kaldırma). |
| `settings_windows_security` | Windows Güvenliği ayarları — Ayarlar uygulamasında "Windows Güvenliği" sayfasını açar (virüs koruması, güvenlik duvarı ve cihaz güvenliği). |
| `settings_developers` | Geliştirici seçenekleri ayarları — Ayarlar uygulamasında "Geliştirici seçenekleri" sayfasını açar (geliştirici modu ve terminal ayarları). |
| `settings_backup` | Yedekleme ayarları — Ayarlar uygulamasında "Yedekleme" sayfasını açar (dosya yedekleme ve OneDrive klasör yedeği). |
| `settings_graphics` | Grafik ayarları ayarları — Ayarlar uygulamasında "Grafik ayarları" sayfasını açar (uygulama başına GPU tercihi ve HAGS). |
| `settings_sound_devices` | Ses aygıtları ve mikrofon ayarları — Ayarlar uygulamasında "Ses aygıtları ve mikrofon" sayfasını açar (tüm giriş/çıkış aygıtları ve mikrofon düzeyi). |
| `win_control_panel` | Denetim Masası — Windows'un klasik "Denetim Masası" aracını açar (klasik ayarların tamamı). |
| `win_programs` | Program Ekle/Kaldır — Windows'un klasik "Program Ekle/Kaldır" aracını açar (klasik "Programlar ve Özellikler" listesi). |
| `win_network_connections` | Ağ Bağlantıları — Windows'un klasik "Ağ Bağlantıları" aracını açar (ağ bağdaştırıcıları, IP ve DNS ayarı). |
| `win_power_options` | Güç Seçenekleri — Windows'un klasik "Güç Seçenekleri" aracını açar (güç planları ve kapak/düğme davranışı). |
| `win_sound_panel` | Ses (klasik) — Windows'un klasik "Ses (klasik)" aracını açar (kayıt/kayıttan yürütme aygıtları ve gelişmiş ses ayarları). |
| `win_system_properties` | Sistem Özellikleri — Windows'un klasik "Sistem Özellikleri" aracını açar (bilgisayar adı, sistem koruması, sanal bellek). |
| `win_environment_variables` | Ortam Değişkenleri — Windows'un klasik "Ortam Değişkenleri" aracını açar (kullanıcı ortam değişkenleri ve PATH). |
| `win_device_manager` | Aygıt Yöneticisi — Windows'un klasik "Aygıt Yöneticisi" aracını açar (donanım ve sürücüler). |
| `win_disk_management` | Disk Yönetimi — Windows'un klasik "Disk Yönetimi" aracını açar (bölümler, sürücü harfleri ve biçimlendirme). |
| `win_services` | Hizmetler — Windows'un klasik "Hizmetler" aracını açar (Windows hizmetlerini başlatma/durdurma). |
| `win_event_viewer` | Olay Görüntüleyicisi — Windows'un klasik "Olay Görüntüleyicisi" aracını açar (sistem ve uygulama günlükleri). |
| `win_task_scheduler` | Görev Zamanlayıcı — Windows'un klasik "Görev Zamanlayıcı" aracını açar (zamanlanmış görevler). |
| `win_computer_management` | Bilgisayar Yönetimi — Windows'un klasik "Bilgisayar Yönetimi" aracını açar (yönetim araçlarının birleşik konsolu). |
| `win_registry_editor` | Kayıt Defteri Düzenleyicisi — Windows'un klasik "Kayıt Defteri Düzenleyicisi" aracını açar (Windows kayıt defteri). |
| `win_resource_monitor` | Kaynak İzleyicisi — Windows'un klasik "Kaynak İzleyicisi" aracını açar (işlemci, disk, ağ ve bellek kullanımı ayrıntısı). |
| `win_performance_monitor` | Performans İzleyicisi — Windows'un klasik "Performans İzleyicisi" aracını açar (performans sayaçları ve raporlar). |
| `win_system_information` | Sistem Bilgisi — Windows'un klasik "Sistem Bilgisi" aracını açar (donanım ve yazılım envanteri). |
| `win_disk_cleanup` | Disk Temizleme — Windows'un klasik "Disk Temizleme" aracını açar (gereksiz dosyaları temizleme aracı). |
| `win_defragment` | Sürücüleri İyileştir — Windows'un klasik "Sürücüleri İyileştir" aracını açar (birleştirme ve TRIM optimizasyonu). |
| `win_firewall` | Güvenlik Duvarı — Windows'un klasik "Güvenlik Duvarı" aracını açar (Windows Defender Güvenlik Duvarı). |
| `win_credential_manager` | Kimlik Bilgisi Yöneticisi — Windows'un klasik "Kimlik Bilgisi Yöneticisi" aracını açar (kayıtlı web ve Windows kimlik bilgileri). |
| `win_dxdiag` | DirectX Tanılama — Windows'un klasik "DirectX Tanılama" aracını açar (ekran kartı, ses ve DirectX bilgisi). |
| `win_character_map` | Karakter Eşlem — Windows'un klasik "Karakter Eşlem" aracını açar (özel karakter bulma ve kopyalama). |
| `win_on_screen_keyboard` | Ekran Klavyesi — Windows'un klasik "Ekran Klavyesi" aracını açar (ekranda tıklanabilir klavye). |
| `folder_startup` | Başlangıç klasörü — "Başlangıç" özel klasörünü dosya gezgininde açar (oturum açılınca çalışan kısayollar). |
| `folder_fonts` | Yazı tipleri klasörü — "Yazı tipleri" özel klasörünü dosya gezgininde açar (yüklü yazı tipleri). |
| `folder_recycle_bin` | Geri Dönüşüm Kutusu klasörü — "Geri Dönüşüm Kutusu" özel klasörünü dosya gezgininde açar (silinen dosyalar). |
| `folder_this_pc` | Bu Bilgisayar klasörü — "Bu Bilgisayar" özel klasörünü dosya gezgininde açar (sürücüler ve aygıtlar). |
| `folder_network` | Ağ klasörü — "Ağ" özel klasörünü dosya gezgininde açar (ağdaki bilgisayarlar ve paylaşımlar). |
| `folder_all_apps` | Tüm uygulamalar klasörü — "Tüm uygulamalar" özel klasörünü dosya gezgininde açar (yüklü tüm uygulamalar). |
| `folder_temp` | Temp klasörü — "Temp" özel klasörünü dosya gezgininde açar (geçici dosyalar). |
| `folder_appdata` | AppData klasörü — "AppData" özel klasörünü dosya gezgininde açar (uygulama ayar ve verileri). |
| `folder_program_files` | Program Files klasörü — "Program Files" özel klasörünü dosya gezgininde açar (kurulu programların klasörü). |
| `folder_recent` | Son kullanılanlar klasörü — "Son kullanılanlar" özel klasörünü dosya gezgininde açar (son açılan dosyalar). |

### Siteler (100)

| Araç | Ne yapar |
| --- | --- |
| `site_gmail` | Gmail aç — Gmail sitesini (Google e-posta) varsayılan tarayıcıda açar. |
| `site_google_drive` | Google Drive aç — Google Drive sitesini (bulut dosyaları) varsayılan tarayıcıda açar. |
| `site_google_calendar` | Google Takvim aç — Google Takvim sitesini (takvim ve etkinlikler) varsayılan tarayıcıda açar. |
| `site_google_photos` | Google Fotoğraflar aç — Google Fotoğraflar sitesini (fotoğraf arşivi) varsayılan tarayıcıda açar. |
| `site_google_translate` | Google Çeviri aç — Google Çeviri sitesini (çeviri) varsayılan tarayıcıda açar. |
| `site_outlook` | Outlook aç — Outlook sitesini (Microsoft e-posta) varsayılan tarayıcıda açar. |
| `site_onedrive` | OneDrive aç — OneDrive sitesini (Microsoft bulut dosyaları) varsayılan tarayıcıda açar. |
| `site_icloud` | iCloud aç — iCloud sitesini (Apple bulut hizmetleri) varsayılan tarayıcıda açar. |
| `site_instagram` | Instagram aç — Instagram sitesini (sosyal medya) varsayılan tarayıcıda açar. |
| `site_x` | X aç — X sitesini (sosyal medya (eski adıyla Twitter)) varsayılan tarayıcıda açar. |
| `site_facebook` | Facebook aç — Facebook sitesini (sosyal medya) varsayılan tarayıcıda açar. |
| `site_linkedin` | LinkedIn aç — LinkedIn sitesini (profesyonel ağ) varsayılan tarayıcıda açar. |
| `site_reddit` | Reddit aç — Reddit sitesini (topluluk forumları) varsayılan tarayıcıda açar. |
| `site_tiktok` | TikTok aç — TikTok sitesini (kısa videolar) varsayılan tarayıcıda açar. |
| `site_twitch` | Twitch aç — Twitch sitesini (canlı yayınlar) varsayılan tarayıcıda açar. |
| `site_kick` | Kick aç — Kick sitesini (canlı yayınlar) varsayılan tarayıcıda açar. |
| `site_netflix` | Netflix aç — Netflix sitesini (dizi ve film) varsayılan tarayıcıda açar. |
| `site_disney_plus` | Disney+ aç — Disney+ sitesini (dizi ve film) varsayılan tarayıcıda açar. |
| `site_prime_video` | Prime Video aç — Prime Video sitesini (dizi ve film) varsayılan tarayıcıda açar. |
| `site_spotify` | Spotify Web aç — Spotify Web sitesini (müzik ve podcast (web oynatıcı)) varsayılan tarayıcıda açar. |
| `site_youtube_music` | YouTube Music aç — YouTube Music sitesini (müzik) varsayılan tarayıcıda açar. |
| `site_soundcloud` | SoundCloud aç — SoundCloud sitesini (müzik ve ses) varsayılan tarayıcıda açar. |
| `site_chatgpt` | ChatGPT aç — ChatGPT sitesini (OpenAI sohbet asistanı) varsayılan tarayıcıda açar. |
| `site_claude` | Claude aç — Claude sitesini (Anthropic yapay zekâ asistanı) varsayılan tarayıcıda açar. |
| `site_gemini` | Gemini aç — Gemini sitesini (Google yapay zekâ asistanı) varsayılan tarayıcıda açar. |
| `site_github` | GitHub aç — GitHub sitesini (kod depoları) varsayılan tarayıcıda açar. |
| `site_stackoverflow` | Stack Overflow aç — Stack Overflow sitesini (yazılım soru-cevap) varsayılan tarayıcıda açar. |
| `site_notion` | Notion aç — Notion sitesini (notlar ve çalışma alanı) varsayılan tarayıcıda açar. |
| `site_trello` | Trello aç — Trello sitesini (görev panoları) varsayılan tarayıcıda açar. |
| `site_figma` | Figma aç — Figma sitesini (arayüz tasarımı) varsayılan tarayıcıda açar. |
| `site_canva` | Canva aç — Canva sitesini (grafik tasarım) varsayılan tarayıcıda açar. |
| `site_discord` | Discord aç — Discord sitesini (sohbet sunucuları (web)) varsayılan tarayıcıda açar. |
| `site_whatsapp` | WhatsApp Web aç — WhatsApp Web sitesini (mesajlaşma (web)) varsayılan tarayıcıda açar. |
| `site_telegram` | Telegram Web aç — Telegram Web sitesini (mesajlaşma (web)) varsayılan tarayıcıda açar. |
| `site_trendyol` | Trendyol aç — Trendyol sitesini (alışveriş) varsayılan tarayıcıda açar. |
| `site_hepsiburada` | Hepsiburada aç — Hepsiburada sitesini (alışveriş) varsayılan tarayıcıda açar. |
| `site_amazon` | Amazon Türkiye aç — Amazon Türkiye sitesini (alışveriş) varsayılan tarayıcıda açar. |
| `site_n11` | n11 aç — n11 sitesini (alışveriş) varsayılan tarayıcıda açar. |
| `site_sahibinden` | Sahibinden aç — Sahibinden sitesini (ilan sitesi (emlak, vasıta, ikinci el)) varsayılan tarayıcıda açar. |
| `site_yemeksepeti` | Yemeksepeti aç — Yemeksepeti sitesini (yemek siparişi) varsayılan tarayıcıda açar. |
| `site_getir` | Getir aç — Getir sitesini (hızlı market ve yemek siparişi) varsayılan tarayıcıda açar. |
| `site_edevlet` | e-Devlet aç — e-Devlet sitesini (kamu hizmetleri kapısı) varsayılan tarayıcıda açar. |
| `site_mhrs` | MHRS aç — MHRS sitesini (hastane randevusu) varsayılan tarayıcıda açar. |
| `site_vikipedi` | Vikipedi aç — Vikipedi sitesini (Türkçe ansiklopedi) varsayılan tarayıcıda açar. |
| `site_eksisozluk` | Ekşi Sözlük aç — Ekşi Sözlük sitesini (kolektif sözlük) varsayılan tarayıcıda açar. |
| `site_google_news` | Google Haberler aç — Google Haberler sitesini (güncel haberler) varsayılan tarayıcıda açar. |
| `site_speedtest` | Speedtest aç — Speedtest sitesini (internet hız testi) varsayılan tarayıcıda açar. |
| `site_epic_games` | Epic Games Store aç — Epic Games Store sitesini (oyun mağazası) varsayılan tarayıcıda açar. |
| `site_steam_store` | Steam Mağaza aç — Steam Mağaza sitesini (oyun mağazası) varsayılan tarayıcıda açar. |
| `site_pinterest` | Pinterest aç — Pinterest sitesini (görsel fikir panoları) varsayılan tarayıcıda açar. |
| `search_google_images` | Google Görseller araması — Google Görseller üzerinde arama yapar ve sonuçları tarayıcıda açar (görseller). |
| `search_google_news` | Google Haberler araması — Google Haberler üzerinde arama yapar ve sonuçları tarayıcıda açar (haberler). |
| `search_google_scholar` | Google Akademik araması — Google Akademik üzerinde arama yapar ve sonuçları tarayıcıda açar (akademik makaleler). |
| `search_directions` | Yol tarifi — Google Haritalar'da iki yer arasında yol tarifini açar. |
| `search_youtube_music` | YouTube Music araması — YouTube Music üzerinde arama yapar ve sonuçları tarayıcıda açar (şarkı, sanatçı ve albümler). |
| `search_spotify` | Spotify araması — Spotify üzerinde arama yapar ve sonuçları tarayıcıda açar (şarkı, sanatçı, podcast). |
| `search_vikipedi` | Vikipedi araması — Vikipedi üzerinde arama yapar ve sonuçları tarayıcıda açar (Türkçe Vikipedi maddeleri). |
| `search_eksisozluk` | Ekşi Sözlük araması — Ekşi Sözlük üzerinde arama yapar ve sonuçları tarayıcıda açar (başlıklar). |
| `search_reddit` | Reddit araması — Reddit üzerinde arama yapar ve sonuçları tarayıcıda açar (gönderi ve topluluklar). |
| `search_x` | X araması — X üzerinde arama yapar ve sonuçları tarayıcıda açar (gönderiler). |
| `search_tiktok` | TikTok araması — TikTok üzerinde arama yapar ve sonuçları tarayıcıda açar (videolar). |
| `search_instagram_tag` | Instagram etiketi — Instagram'da bir hashtag sayfasını açar (# ve boşluklar otomatik temizlenir). |
| `search_twitch` | Twitch araması — Twitch üzerinde arama yapar ve sonuçları tarayıcıda açar (yayıncı ve kategoriler). |
| `search_github_repos` | GitHub depoları araması — GitHub depoları üzerinde arama yapar ve sonuçları tarayıcıda açar (depolar). |
| `search_github_code` | GitHub kodu araması — GitHub kodu üzerinde arama yapar ve sonuçları tarayıcıda açar (kod). |
| `search_stackoverflow` | Stack Overflow araması — Stack Overflow üzerinde arama yapar ve sonuçları tarayıcıda açar (sorular). |
| `search_npm` | npm araması — npm üzerinde arama yapar ve sonuçları tarayıcıda açar (JavaScript paketleri). |
| `search_pypi` | PyPI araması — PyPI üzerinde arama yapar ve sonuçları tarayıcıda açar (Python paketleri). |
| `search_mdn` | MDN araması — MDN üzerinde arama yapar ve sonuçları tarayıcıda açar (web geliştirme belgeleri). |
| `search_docker_hub` | Docker Hub araması — Docker Hub üzerinde arama yapar ve sonuçları tarayıcıda açar (konteyner imajları). |
| `search_amazon` | Amazon Türkiye araması — Amazon Türkiye üzerinde arama yapar ve sonuçları tarayıcıda açar (ürünler). |
| `search_trendyol` | Trendyol araması — Trendyol üzerinde arama yapar ve sonuçları tarayıcıda açar (ürünler). |
| `search_hepsiburada` | Hepsiburada araması — Hepsiburada üzerinde arama yapar ve sonuçları tarayıcıda açar (ürünler). |
| `search_n11` | n11 araması — n11 üzerinde arama yapar ve sonuçları tarayıcıda açar (ürünler). |
| `search_sahibinden` | Sahibinden araması — Sahibinden üzerinde arama yapar ve sonuçları tarayıcıda açar (ilanlar). |
| `search_akakce` | Akakçe araması — Akakçe üzerinde arama yapar ve sonuçları tarayıcıda açar (fiyat karşılaştırma). |
| `search_cimri` | Cimri araması — Cimri üzerinde arama yapar ve sonuçları tarayıcıda açar (fiyat karşılaştırma). |
| `search_ebay` | eBay araması — eBay üzerinde arama yapar ve sonuçları tarayıcıda açar (ürünler). |
| `search_aliexpress` | AliExpress araması — AliExpress üzerinde arama yapar ve sonuçları tarayıcıda açar (ürünler). |
| `search_imdb` | IMDb araması — IMDb üzerinde arama yapar ve sonuçları tarayıcıda açar (film, dizi ve oyuncular). |
| `search_steam` | Steam araması — Steam üzerinde arama yapar ve sonuçları tarayıcıda açar (oyunlar). |
| `search_netflix` | Netflix araması — Netflix üzerinde arama yapar ve sonuçları tarayıcıda açar (dizi ve filmler). |
| `search_google_play` | Google Play araması — Google Play üzerinde arama yapar ve sonuçları tarayıcıda açar (Android uygulamaları). |
| `search_microsoft_store` | Microsoft Store araması — Microsoft Store üzerinde arama yapar ve sonuçları tarayıcıda açar (Windows uygulamaları). |
| `search_udemy` | Udemy araması — Udemy üzerinde arama yapar ve sonuçları tarayıcıda açar (kurslar). |
| `search_coursera` | Coursera araması — Coursera üzerinde arama yapar ve sonuçları tarayıcıda açar (kurslar). |
| `search_yemeksepeti` | Yemeksepeti araması — Yemeksepeti üzerinde arama yapar ve sonuçları tarayıcıda açar (restoran ve yemekler (Google üzerinden)). |
| `search_booking` | Booking.com araması — Booking.com üzerinde arama yapar ve sonuçları tarayıcıda açar (oteller ve konaklama). |
| `search_airbnb` | Airbnb araması — Airbnb üzerinde arama yapar ve sonuçları tarayıcıda açar (konaklama yerleri). |
| `search_skyscanner` | Skyscanner araması — Skyscanner üzerinde arama yapar ve sonuçları tarayıcıda açar (uçuşlar ("IST AMS" gibi havalimanı kodlarıyla doğrudan)). |
| `search_tdk` | TDK Güncel Türkçe Sözlük araması — TDK Güncel Türkçe Sözlük üzerinde arama yapar ve sonuçları tarayıcıda açar (kelime anlamları). |
| `search_tureng` | Tureng araması — Tureng üzerinde arama yapar ve sonuçları tarayıcıda açar (Türkçe-İngilizce çeviri). |
| `search_cambridge` | Cambridge Dictionary araması — Cambridge Dictionary üzerinde arama yapar ve sonuçları tarayıcıda açar (İngilizce kelimeler). |
| `search_genius` | Genius araması — Genius üzerinde arama yapar ve sonuçları tarayıcıda açar (şarkı sözleri). |
| `search_google_books` | Google Kitaplar araması — Google Kitaplar üzerinde arama yapar ve sonuçları tarayıcıda açar (kitaplar). |
| `search_pinterest` | Pinterest araması — Pinterest üzerinde arama yapar ve sonuçları tarayıcıda açar (görsel fikirler). |
| `search_unsplash` | Unsplash araması — Unsplash üzerinde arama yapar ve sonuçları tarayıcıda açar (ücretsiz fotoğraflar). |
| `search_internet_archive` | Internet Archive araması — Internet Archive üzerinde arama yapar ve sonuçları tarayıcıda açar (arşivlenmiş kitap, video ve yazılımlar). |
| `search_letterboxd` | Letterboxd araması — Letterboxd üzerinde arama yapar ve sonuçları tarayıcıda açar (filmler). |
| `search_wolfram_alpha` | Wolfram Alpha araması — Wolfram Alpha üzerinde arama yapar ve sonuçları tarayıcıda açar (hesaplama ve bilgi). |

### Kısayollar (50)

| Araç | Ne yapar |
| --- | --- |
| `key_copy` | Kopyala — Seçili metni ya da öğeyi panoya kopyalar (Ctrl+C). |
| `key_paste` | Yapıştır — Panodakini imlecin olduğu yere yapıştırır (Ctrl+V). |
| `key_cut` | Kes — Seçili metni ya da öğeyi keser (Ctrl+X). |
| `key_undo` | Geri al — Son işlemi geri alır (Ctrl+Z). |
| `key_redo` | Yinele — Geri alınan işlemi yineler (Ctrl+Y). |
| `key_select_all` | Tümünü seç — Etkin penceredeki tüm metni ya da öğeleri seçer (Ctrl+A). |
| `key_save` | Kaydet — Etkin belgeyi kaydeder (Ctrl+S). |
| `key_save_as` | Farklı kaydet — Etkin belge için "Farklı kaydet" penceresini açar (Ctrl+Shift+S). |
| `key_print` | Yazdır — Etkin belge ya da sayfa için yazdırma penceresini açar (Ctrl+P). |
| `key_find` | Sayfada bul — Etkin pencerede arama çubuğunu açar (Ctrl+F). |
| `key_new_tab` | Yeni sekme — Tarayıcıda yeni sekme açar (Ctrl+T). |
| `key_close_tab` | Sekmeyi kapat — Etkin sekmeyi kapatır (Ctrl+W). |
| `key_reopen_tab` | Kapanan sekmeyi aç — Tarayıcıda son kapatılan sekmeyi geri açar (Ctrl+Shift+T). |
| `key_next_tab` | Sonraki sekme — Sağdaki sekmeye geçer (Ctrl+Tab). |
| `key_prev_tab` | Önceki sekme — Soldaki sekmeye geçer (Ctrl+Shift+Tab). |
| `key_reload` | Yenile — Sayfayı yeniler (F5). |
| `key_hard_reload` | Önbelleksiz yenile — Sayfayı önbelleği atlayarak yeniden yükler (Ctrl+F5). |
| `key_back` | Geri git — Tarayıcıda ya da dosya gezgininde bir önceki sayfaya döner (Alt+Sol). |
| `key_forward` | İleri git — Tarayıcıda bir sonraki sayfaya gider (Alt+Sağ). |
| `key_zoom_in` | Yakınlaştır — Sayfayı ya da belgeyi yakınlaştırır (Ctrl++). |
| `key_zoom_out` | Uzaklaştır — Sayfayı ya da belgeyi uzaklaştırır (Ctrl+-). |
| `key_zoom_reset` | Yakınlaştırmayı sıfırla — Yakınlaştırmayı %100'e döndürür (Ctrl+0). |
| `key_fullscreen` | Tam ekran — Etkin pencereyi ya da tarayıcıyı tam ekran yapar / tam ekrandan çıkar (F11). |
| `key_incognito` | Gizli pencere — Tarayıcıda gizli (InPrivate) pencere açar (Ctrl+Shift+N; Firefox'ta Ctrl+Shift+P). |
| `key_address_bar` | Adres çubuğu — Tarayıcının adres çubuğuna odaklanır; ardından yazı yazılabilir (Ctrl+L). |
| `key_bookmark` | Yer imi ekle — Açık sayfayı yer imlerine ekler (Ctrl+D). |
| `key_downloads` | Tarayıcı indirmeleri — Tarayıcının indirilenler sayfasını açar (Ctrl+J). |
| `key_history` | Tarayıcı geçmişi — Tarayıcı geçmişini açar (Ctrl+H). |
| `key_devtools` | Geliştirici araçları — Tarayıcının geliştirici araçlarını açar / kapatır (F12). |
| `key_close_window` | Pencereyi kapat *(onaylı)* — Etkin pencereyi kapatır (Alt+F4). |
| `key_snap_left` | Sola yasla — Etkin pencereyi ekranın sol yarısına yaslar (Win+Sol). |
| `key_snap_right` | Sağa yasla — Etkin pencereyi ekranın sağ yarısına yaslar (Win+Sağ). |
| `key_switch_app` | Uygulama değiştir — Bir önceki uygulamaya geçer (Alt+Tab). |
| `key_task_view` | Görev görünümü — Tüm açık pencereleri ve sanal masaüstlerini gösterir (Win+Tab; macOS'ta Mission Control). |
| `key_new_desktop` | Yeni sanal masaüstü — Yeni bir sanal masaüstü oluşturup ona geçer (Win+Ctrl+D). |
| `key_next_desktop` | Sonraki masaüstü — Sağdaki sanal masaüstüne geçer (Win+Ctrl+Sağ). |
| `key_prev_desktop` | Önceki masaüstü — Soldaki sanal masaüstüne geçer (Win+Ctrl+Sol). |
| `key_close_desktop` | Sanal masaüstünü kapat — Etkin sanal masaüstünü kapatır; pencereleri yandaki masaüstüne taşınır (Win+Ctrl+F4). |
| `key_minimize_all` | Tümünü küçült — Tüm pencereleri küçültür (Win+M; macOS'ta masaüstünü göster). |
| `key_emoji` | Emoji paneli — Emoji ve sembol panelini açar; seçilen emoji imlecin olduğu yere eklenir (Win+.). |
| `key_clipboard_history` | Pano geçmişi — Windows pano geçmişi panelini açar (Win+V). |
| `key_snip` | Ekran alıntısı — Ekranın bir bölümünü seçip alıntı almak için Ekran Alıntısı Aracını açar (Win+Shift+S). |
| `key_record_screen` | Ekran kaydı (Game Bar) — Xbox Game Bar ile etkin pencerenin kaydını başlatır / durdurur (Win+Alt+R). |
| `key_notifications` | Bildirim merkezi — Bildirim merkezini ve takvimi açar (Win+N). |
| `key_quick_settings` | Hızlı ayarlar — Wi-Fi, Bluetooth, ses ve parlaklık için hızlı ayarlar panelini açar (Win+A). |
| `key_run_dialog` | Çalıştır penceresi — Windows "Çalıştır" penceresini açar (Win+R). |
| `key_file_explorer` | Dosya gezgini — Yeni bir Dosya Gezgini penceresi açar (Win+E; macOS'ta Finder arama penceresi). |
| `key_search` | Windows arama — Sistem aramasını açar (Win+S; macOS'ta Spotlight). |
| `key_dictation` | Sesle yazma — Windows sesle yazmayı başlatır; konuşulanlar imlecin olduğu yere yazılır (Win+H). |
| `key_project` | Ekran yansıtma — İkinci ekran / projektör seçeneklerini (Yalnızca bilgisayar, Çoğalt, Genişlet) açar (Win+P). |

### Metin (46)

| Araç | Ne yapar |
| --- | --- |
| `text_upper` | Büyük harf — Metni Türkçe kurallarla BÜYÜK HARFE çevirir (i→İ, ı→I). |
| `text_lower` | Küçük harf — Metni Türkçe kurallarla küçük harfe çevirir (İ→i, I→ı). |
| `text_title_case` | Başlık düzeni — Her kelimenin ilk harfini büyük, kalanını küçük yapar (Türkçe uyumlu; "istanbul'da" → "İstanbul'da"). |
| `text_sentence_case` | Cümle düzeni — Metni küçük harfe çevirip her cümlenin ilk harfini büyütür. |
| `text_reverse` | Metni ters çevir — Metni karakter karakter tersine çevirir (emoji ve birleşik harfleri bozmadan). |
| `text_word_count` | Kelime say — Metindeki kelime, cümle ve paragraf sayısını verir. |
| `text_char_count` | Karakter say — Metindeki karakter sayısını boşluklu ve boşluksuz olarak verir; harf ve rakamları da sayar. |
| `text_line_count` | Satır say — Metindeki toplam, dolu ve boş satır sayısını verir. |
| `text_reading_time` | Okuma süresi — Metnin tahmini sessiz okuma (dakikada 200 kelime) ve sesli konuşma (dakikada 130 kelime) süresini hesaplar. |
| `text_slug` | Slug oluştur — Metni URL dostu kısa ada (slug) çevirir: Türkçe harfleri sadeleştirir, küçük harf ve tire kullanır. |
| `text_clean_spaces` | Boşlukları temizle — Satır başı/sonu boşluklarını siler, art arda boşlukları teke indirir, fazla boş satırları kaldırır. |
| `text_sort_lines` | Satırları sırala — Satırları Türkçe alfabeye göre sıralar (boş satırları atar). |
| `text_dedupe_lines` | Tekrarları kaldır — Tekrarlanan satırları siler, ilk geçenleri sırasıyla tutar. |
| `text_shuffle_lines` | Satırları karıştır — Satırların sırasını rastgele karıştırır (boş satırları atar). |
| `text_number_lines` | Satırları numarala — Her satırın başına sıra numarası ekler. |
| `text_replace` | Bul ve değiştir — Metinde bir ifadeyi bulup başka bir ifadeyle değiştirir; regex ve büyük/küçük harf duyarsız mod desteklenir. |
| `text_regex_test` | Regex dene — Bir düzenli ifadeyi metinde dener; eşleşmeleri, konumlarını ve yakalanan grupları listeler. |
| `text_extract_emails` | E-posta ayıkla — Metindeki tüm e-posta adreslerini bulur ve tekrarsız listeler. |
| `text_extract_urls` | URL ayıkla — Metindeki tüm web adreslerini (http, https, www) bulur ve tekrarsız listeler. |
| `text_extract_numbers` | Sayı ayıkla — Metindeki sayıları bulur (Türkçe 1.234,56 ve İngilizce 1,234.56 biçimlerini anlar); toplam ve ortalamayı da verir. |
| `text_extract_phones` | Telefon ayıkla — Metindeki Türkiye telefon numaralarını (+90 5xx…, 05xx…, (0212)…) bulur ve +90 biçiminde listeler. |
| `text_base64_encode` | Base64 kodla — Metni UTF-8 olarak Base64'e kodlar. |
| `text_base64_decode` | Base64 çöz — Base64 (ya da base64url) metni UTF-8 metne çözer. |
| `text_url_encode` | URL kodla — Metni URL'de güvenle kullanılacak biçimde yüzde kodlamasıyla kodlar (ş → %C5%9F). |
| `text_url_decode` | URL çöz — Yüzde kodlu (%C5%9F) metni normal metne çevirir; + işaretlerini boşluk yapar. |
| `text_html_escape` | HTML kaçış — Metindeki & < > " ' karakterlerini HTML varlıklarına çevirir. |
| `text_html_unescape` | HTML kaçışını çöz — HTML varlıklarını (&amp;, &lt;, &#351;, &ccedil; …) normal karakterlere çevirir. |
| `text_md5` | MD5 özeti — Metnin MD5 özetini (hash) UTF-8 olarak hesaplar ve onaltılık (hex) verir. |
| `text_sha1` | SHA-1 özeti — Metnin SHA-1 özetini (hash) UTF-8 olarak hesaplar ve onaltılık (hex) verir. |
| `text_sha256` | SHA-256 özeti — Metnin SHA-256 özetini (hash) UTF-8 olarak hesaplar ve onaltılık (hex) verir. |
| `text_sha512` | SHA-512 özeti — Metnin SHA-512 özetini (hash) UTF-8 olarak hesaplar ve onaltılık (hex) verir. |
| `text_uuid` | UUID üret — Rastgele UUID (v4) üretir; count ile 1-20 tane. |
| `text_json_format` | JSON güzelleştir — JSON metnini girintili ve okunur biçime getirir; hatalıysa hatanın yerini söyler. |
| `text_json_minify` | JSON küçült — JSON metnindeki tüm gereksiz boşlukları atarak tek satıra indirir. |
| `text_json_validate` | JSON doğrula — Metnin geçerli JSON olup olmadığını denetler; hatalıysa satır ve sütununu, sebebini gösterir. |
| `text_csv_to_json` | CSV → JSON — CSV metnini JSON nesne dizisine çevirir. |
| `text_json_to_csv` | JSON → CSV — JSON nesne dizisini CSV tablosuna çevirir (sütunlar tüm anahtarlardan oluşur). |
| `text_lorem` | Lorem ipsum — Tasarım ve deneme için lorem ipsum yer tutucu metin üretir. |
| `text_remove_turkish` | Türkçe karakterleri kaldır — Türkçe harfleri Latin karşılıklarına çevirir: ç→c, ğ→g, ı→i, İ→I, ö→o, ş→s, ü→u. |
| `text_morse_encode` | Mors kodla — Metni Mors alfabesine çevirir (harfler boşlukla, kelimeler " / " ile ayrılır). |
| `text_morse_decode` | Mors çöz — Mors kodunu metne çevirir. |
| `text_rot13` | ROT13 — Metne ROT13 şifrelemesi uygular (Latin harfleri 13 kaydırır); aynı işlem geri de çevirir. |
| `text_to_binary` | Metni ikiliye çevir — Metnin UTF-8 baytlarını 8 bitlik ikili (0/1) gruplara çevirir. |
| `text_from_binary` | İkiliden metne çevir — Boşlukla ayrılmış ya da bitişik 8 bitlik ikili (0/1) kodu UTF-8 metne çevirir. |
| `text_compare` | İki metni karşılaştır — İki metni satır satır karşılaştırır (tek satırlıysa kelime kelime); eklenenleri +, silinenleri - ile gösterir ve benzerlik yüzdesini verir. |
| `text_jwt_decode` | JWT çöz — Bir JWT'nin başlık ve içerik (payload) bölümlerini çözer, exp/iat/nbf sürelerini tarih olarak gösterir. |

### Bilgi (30)

| Araç | Ne yapar |
| --- | --- |
| `info_crypto_price` | Kripto fiyatı — Bir kripto paranın güncel TL ve dolar fiyatını ve 24 saatlik değişimini getirir (CoinGecko). |
| `info_crypto_top` | Kripto ilk 10 — Piyasa değerine göre en büyük 10 kripto parayı fiyat ve 24 saatlik değişimiyle listeler. |
| `info_earthquakes` | Son depremler — Türkiye ve çevresinde (ya da dünyada) son depremleri büyüklük, yer ve zamanla listeler (USGS verisi). |
| `info_prayer_times` | Namaz vakitleri — Bir şehrin bugünkü namaz vakitlerini (Diyanet hesaplama yöntemi) ve bir sonraki vakte kalan süreyi gösterir. |
| `info_sun_times` | Gün doğumu ve batımı — Bir şehirde güneşin doğuş ve batış saatlerini ve gün uzunluğunu gösterir (bugün ve sonraki günler). |
| `info_air_quality` | Hava kalitesi — Bir şehrin anlık hava kalitesini (Avrupa AQI), PM2.5 ve PM10 değerlerini ve sağlık önerisini gösterir. |
| `info_uv_index` | UV indeksi — Bir şehirde şu anki ve bugünün en yüksek UV indeksini, risk düzeyini ve korunma önerisini gösterir. |
| `info_rain_check` | Yağmur yağacak mı — Önümüzdeki saatlerde yağmur bekleniyor mu, hangi saatlerde ve ne olasılıkla, söyler. |
| `info_moon_phase` | Ay evresi — Bugünün (ya da verilen tarihin) ay evresini, aydınlanma yüzdesini ve sıradaki dolunay/yeni ay tarihlerini hesaplar. |
| `info_holidays` | Resmi tatiller — Yaklaşan resmi tatilleri ve kaç gün kaldığını listeler. |
| `info_country` | Ülke bilgisi — Bir ülkenin başkenti, nüfusu, yüzölçümü, dilleri, para birimi, saat dilimi ve telefon kodu gibi temel bilgilerini getirir. |
| `info_ip_location` | IP konumu — Bir IP adresinin (ya da alan adının) yaklaşık konumunu, servis sağlayıcısını ve saat dilimini gösterir. |
| `info_dictionary` | İngilizce sözlük — İngilizce bir kelimenin okunuşunu, türünü, tanımlarını, örnek cümlelerini ve eş anlamlılarını getirir. |
| `info_on_this_day` | Tarihte bugün — Tarihte bugün (ya da verilen günde) yaşanan olayları, doğumları veya ölümleri Vikipedi'den getirir. |
| `info_random_wiki` | Rastgele Vikipedi — Vikipedi'den rastgele bir maddenin özetini getirir. |
| `info_wiki_search` | Vikipedi arama — Vikipedi'de anahtar kelimeyle madde arar ve eşleşen maddeleri kısa alıntılarıyla listeler. |
| `info_github_repo` | GitHub deposu — Bir GitHub deposunun yıldız, fork, açık issue sayısını, dilini, lisansını ve son güncellemesini gösterir. |
| `info_github_user` | GitHub kullanıcısı — Bir GitHub kullanıcısının ya da kuruluşunun profilini, takipçi sayısını ve en çok yıldız alan depolarını gösterir. |
| `info_npm_package` | npm paketi — Bir npm paketinin son sürümünü, açıklamasını, lisansını, bağımlılık sayısını ve haftalık indirme sayısını gösterir. |
| `info_pypi_package` | PyPI paketi — Bir Python (PyPI) paketinin son sürümünü, özetini, lisansını, gereken Python sürümünü ve yayın tarihini gösterir. |
| `info_hacker_news` | Hacker News — Hacker News'teki en popüler (ya da en yeni / en iyi) teknoloji haberlerini puan ve yorum sayısıyla listeler. |
| `info_reddit` | Reddit popüler — Bir subreddit'in (varsayılan r/popular) şu anki popüler gönderilerini listeler. |
| `info_short_link` | Kısa link — Uzun bir adresi is.gd ile kısaltır ve kısa linki panoya kopyalar. |
| `info_qr_code` | QR kod — Bir metin ya da adres için QR kod üretir ve gösterir; istenirse İndirilenler klasörüne PNG olarak kaydeder. |
| `info_domain_whois` | Alan adı kaydı — Bir alan adının kayıt şirketini, kayıt ve bitiş tarihlerini, durumunu ve isim sunucularını (RDAP/whois) gösterir. |
| `info_ssl_cert` | SSL sertifikası — Bir sitenin SSL/TLS sertifikasını kontrol eder: kime ve kim tarafından verildiği, geçerlilik tarihleri ve bitişe kalan gün. |
| `info_http_headers` | HTTP başlıkları — Bir adrese istek atıp durum kodunu, yönlendirmeyi, sunucu ve önbellek başlıklarını ve eksik güvenlik başlıklarını gösterir. |
| `info_speed_test` | İnternet hız testi — Cloudflare sunucularıyla indirme ve yükleme hızını (Mbps) ve gecikmeyi ölçer. |
| `info_currency_history` | Döviz geçmişi — Bir döviz kurunun son günlerdeki seyrini gösterir: en düşük, en yüksek ve yüzde değişim (Avrupa Merkez Bankası verisi). |
| `info_book_search` | Kitap ara — Open Library'de kitap arar; yazar, ilk yayın yılı, baskı sayısı ve sayfa sayısıyla listeler. |


## Lisans

Apache 2.0 — ayrıntılar için [LICENSE](LICENSE).
