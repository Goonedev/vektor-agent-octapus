'use strict';

/*
 * Settings pack: Windows Settings pages (ms-settings: URIs, macOS System Settings panes where
 * an equivalent exists), classic Windows management tools and special shell folders.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isWin, isMac, ToolError, launch, run, unsupported, openUri, kvResult } = require('./kit');

/* ------------------------------------------------------------ settings pages */

const MAC = {
  display: 'com.apple.Displays-Settings.extension',
  sound: 'com.apple.Sound-Settings.extension',
  notifications: 'com.apple.Notifications-Settings.extension',
  focus: 'com.apple.Focus-Settings.extension',
  battery: 'com.apple.Battery-Settings.extension',
  storage: 'com.apple.settings.Storage',
  desktop: 'com.apple.Desktop-Settings.extension',
  sharing: 'com.apple.Sharing-Settings.extension',
  about: 'com.apple.SystemProfiler.AboutExtension',
  bluetooth: 'com.apple.BluetoothSettings',
  printers: 'com.apple.Print-Scan-Settings.extension',
  mouse: 'com.apple.Mouse-Settings.extension',
  trackpad: 'com.apple.Trackpad-Settings.extension',
  wifi: 'com.apple.wifi-settings-extension',
  network: 'com.apple.Network-Settings.extension',
  wallpaper: 'com.apple.Wallpaper-Settings.extension',
  appearance: 'com.apple.Appearance-Settings.extension',
  lock: 'com.apple.Lock-Screen-Settings.extension',
  login: 'com.apple.LoginItems-Settings.extension',
  users: 'com.apple.Users-Groups-Settings.extension',
  touchid: 'com.apple.Touch-ID-Settings.extension',
  accounts: 'com.apple.Internet-Accounts-Settings.extension',
  family: 'com.apple.Family-Settings.extension',
  datetime: 'com.apple.Date-Time-Settings.extension',
  language: 'com.apple.Localization-Settings.extension',
  keyboard: 'com.apple.Keyboard-Settings.extension',
  siri: 'com.apple.Siri-Settings.extension',
  a11y: 'com.apple.Accessibility-Settings.extension',
  privacy: 'com.apple.settings.PrivacySecurity.extension',
  update: 'com.apple.Software-Update-Settings.extension',
  timemachine: 'com.apple.Time-Machine-Settings.extension'
};

// [key, Turkish label, Windows URI, macOS pane (or null), description hint]
const PAGES = [
  ['display', 'Ekran', 'ms-settings:display', MAC.display, 'çözünürlük, ölçek, yenileme hızı ve çoklu ekran'],
  ['night_light', 'Gece ışığı', 'ms-settings:nightlight', MAC.display, 'mavi ışık filtresi ve zamanlaması'],
  ['sound', 'Ses', 'ms-settings:sound', MAC.sound, 'çıkış/giriş aygıtı ve ses düzeyi'],
  ['volume_mixer', 'Ses karıştırıcı', 'ms-settings:apps-volume', MAC.sound, 'uygulama başına ses düzeyi ve aygıt seçimi'],
  ['notifications', 'Bildirimler', 'ms-settings:notifications', MAC.notifications, 'uygulama bildirimlerini açma/kapatma'],
  ['focus', 'Odak / Rahatsız etmeyin', 'ms-settings:quiethours', MAC.focus, 'odak yardımı ve rahatsız etmeyin kuralları'],
  ['power', 'Güç ve pil', 'ms-settings:powersleep', MAC.battery, 'ekran kapanma, uyku ve pil tasarrufu'],
  ['storage', 'Depolama', 'ms-settings:storagesense', MAC.storage, 'disk kullanımı ve geçici dosyalar'],
  ['storage_sense', 'Depolama algısı', 'ms-settings:storagepolicies', MAC.storage, 'otomatik disk temizleme kuralları'],
  ['multitasking', 'Çoklu görev', 'ms-settings:multitasking', MAC.desktop, 'pencere yaslama ve sanal masaüstleri'],
  ['clipboard', 'Pano', 'ms-settings:clipboard', null, 'pano geçmişi ve cihazlar arası eşitleme'],
  ['remote_desktop', 'Uzak masaüstü', 'ms-settings:remotedesktop', MAC.sharing, 'uzak bağlantılara izin verme'],
  ['about', 'Hakkında', 'ms-settings:about', MAC.about, 'cihaz adı, işlemci, bellek ve Windows sürümü'],
  ['activation', 'Etkinleştirme', 'ms-settings:activation', null, 'Windows lisans ve etkinleştirme durumu'],
  ['troubleshoot', 'Sorun giderme', 'ms-settings:troubleshoot', null, 'yerleşik sorun gidericiler'],
  ['recovery', 'Kurtarma', 'ms-settings:recovery', null, 'bilgisayarı sıfırlama ve gelişmiş başlangıç'],
  ['bluetooth', 'Bluetooth ve cihazlar', 'ms-settings:bluetooth', MAC.bluetooth, 'Bluetooth cihaz eşleme'],
  ['printers', 'Yazıcılar ve tarayıcılar', 'ms-settings:printers', MAC.printers, 'yazıcı ekleme ve varsayılan yazıcı'],
  ['mouse', 'Fare', 'ms-settings:mousetouchpad', MAC.mouse, 'imleç hızı, birincil düğme ve kaydırma'],
  ['touchpad', 'Dokunmatik yüzey', 'ms-settings:devices-touchpad', MAC.trackpad, 'dokunmatik yüzey hareketleri ve hassasiyet'],
  ['pen', 'Kalem ve Windows Ink', 'ms-settings:pen', null, 'kalem düğmeleri ve el yazısı'],
  ['autoplay', 'Otomatik kullan', 'ms-settings:autoplay', null, 'USB/DVD takılınca ne yapılacağı'],
  ['usb', 'USB', 'ms-settings:usb', null, 'USB bağlantı bildirimleri ve güç tasarrufu'],
  ['wifi', 'Wi-Fi', 'ms-settings:network-wifi', MAC.wifi, 'kablosuz ağlar ve bilinen ağlar'],
  ['ethernet', 'Ethernet', 'ms-settings:network-ethernet', MAC.network, 'kablolu ağ, IP ve DNS'],
  ['vpn', 'VPN', 'ms-settings:network-vpn', MAC.network, 'VPN bağlantısı ekleme ve yönetme'],
  ['hotspot', 'Mobil etkin nokta', 'ms-settings:network-mobilehotspot', MAC.sharing, 'internet bağlantısını paylaşma'],
  ['airplane_mode', 'Uçak modu', 'ms-settings:network-airplanemode', null, 'tüm kablosuz iletişimi kapatma'],
  ['proxy', 'Proxy', 'ms-settings:network-proxy', MAC.network, 'ara sunucu ayarları'],
  ['data_usage', 'Veri kullanımı', 'ms-settings:datausage', null, 'ağ başına veri kullanımı ve sınırlar'],
  ['background', 'Arka plan', 'ms-settings:personalization-background', MAC.wallpaper, 'masaüstü duvar kağıdı ve slayt gösterisi'],
  ['colors', 'Renkler', 'ms-settings:colors', MAC.appearance, 'açık/koyu mod ve vurgu rengi'],
  ['themes', 'Temalar', 'ms-settings:themes', MAC.appearance, 'tema, imleç ve masaüstü simgeleri'],
  ['lock_screen', 'Kilit ekranı', 'ms-settings:lockscreen', MAC.lock, 'kilit ekranı resmi ve durum bilgileri'],
  ['start_menu', 'Başlat menüsü', 'ms-settings:personalization-start', null, 'sabitlenenler, öneriler ve klasörler'],
  ['taskbar', 'Görev çubuğu', 'ms-settings:taskbar', MAC.desktop, 'görev çubuğu öğeleri, hizalama ve gizleme'],
  ['fonts', 'Yazı tipleri', 'ms-settings:fonts', null, 'yüklü yazı tipleri ve yazı tipi ekleme'],
  ['installed_apps', 'Yüklü uygulamalar', 'ms-settings:appsfeatures', null, 'uygulama kaldırma, onarma ve boyutlar'],
  ['default_apps', 'Varsayılan uygulamalar', 'ms-settings:defaultapps', null, 'varsayılan tarayıcı ve dosya ilişkilendirmeleri'],
  ['startup_apps', 'Başlangıç uygulamaları', 'ms-settings:startupapps', MAC.login, 'oturum açılınca başlayan uygulamalar'],
  ['offline_maps', 'Çevrimdışı haritalar', 'ms-settings:maps', null, 'harita indirme ve güncelleme'],
  ['video_playback', 'Video oynatma', 'ms-settings:videoplayback', null, 'HDR video ve pil için video ayarları'],
  ['your_info', 'Hesap bilgileri', 'ms-settings:yourinfo', MAC.users, 'Microsoft hesabı ve profil resmi'],
  ['signin_options', 'Oturum açma seçenekleri', 'ms-settings:signinoptions', MAC.touchid, 'PIN, Windows Hello ve parola'],
  ['email_accounts', 'E-posta ve hesaplar', 'ms-settings:emailandaccounts', MAC.accounts, 'uygulamaların kullandığı hesaplar'],
  ['family', 'Aile', 'ms-settings:family-group', MAC.family, 'aile üyeleri ve ebeveyn denetimi'],
  ['date_time', 'Tarih ve saat', 'ms-settings:dateandtime', MAC.datetime, 'saat dilimi ve saat eşitleme'],
  ['region', 'Bölge', 'ms-settings:regionformatting', MAC.language, 'ülke ve bölgesel biçimler'],
  ['language', 'Dil', 'ms-settings:regionlanguage', MAC.language, 'Windows görüntüleme dili ve dil paketleri'],
  ['typing', 'Yazma ve klavye', 'ms-settings:typing', MAC.keyboard, 'otomatik düzeltme, öneriler ve dokunmatik klavye'],
  ['speech', 'Konuşma', 'ms-settings:speech', MAC.siri, 'konuşma dili ve sesler'],
  ['game_mode', 'Oyun modu', 'ms-settings:gaming-gamemode', null, 'oyunlar için performans modu'],
  ['game_bar', 'Xbox Game Bar', 'ms-settings:gaming-gamebar', null, 'Game Bar kısayolu ve denetleyici düğmesi'],
  ['captures', 'Yakalamalar', 'ms-settings:gaming-gamedvr', null, 'oyun kaydı ve ekran görüntüsü konumu'],
  ['text_size', 'Metin boyutu', 'ms-settings:easeofaccess-display', MAC.a11y, 'metni büyütme ve görsel efektler'],
  ['magnifier', 'Büyüteç', 'ms-settings:easeofaccess-magnifier', MAC.a11y, 'ekran büyüteci'],
  ['color_filters', 'Renk filtreleri', 'ms-settings:easeofaccess-colorfilter', MAC.a11y, 'renk körlüğü filtreleri'],
  ['contrast_themes', 'Karşıtlık temaları', 'ms-settings:easeofaccess-highcontrast', MAC.a11y, 'yüksek karşıtlık temaları'],
  ['narrator', 'Ekran Okuyucusu', 'ms-settings:easeofaccess-narrator', MAC.a11y, 'ekranı sesli okuma'],
  ['captions', 'Altyazılar', 'ms-settings:easeofaccess-closedcaptioning', MAC.a11y, 'altyazı stili ve canlı altyazılar'],
  ['location_privacy', 'Konum izinleri', 'ms-settings:privacy-location', `${MAC.privacy}?Privacy_LocationServices`, 'konum hizmeti ve uygulama izinleri'],
  ['camera_privacy', 'Kamera izinleri', 'ms-settings:privacy-webcam', `${MAC.privacy}?Privacy_Camera`, 'kameraya erişebilen uygulamalar'],
  ['microphone_privacy', 'Mikrofon izinleri', 'ms-settings:privacy-microphone', `${MAC.privacy}?Privacy_Microphone`, 'mikrofona erişebilen uygulamalar'],
  ['windows_update', 'Windows Update', 'ms-settings:windowsupdate', MAC.update, 'güncellemeleri denetleme ve yükleme'],
  ['update_history', 'Güncelleme geçmişi', 'ms-settings:windowsupdate-history', MAC.update, 'yüklenen güncellemeler ve kaldırma'],
  ['windows_security', 'Windows Güvenliği', 'windowsdefender:', MAC.privacy, 'virüs koruması, güvenlik duvarı ve cihaz güvenliği'],
  ['developers', 'Geliştirici seçenekleri', 'ms-settings:developers', null, 'geliştirici modu ve terminal ayarları'],
  ['backup', 'Yedekleme', 'ms-settings:backup', MAC.timemachine, 'dosya yedekleme ve OneDrive klasör yedeği'],
  ['graphics', 'Grafik ayarları', 'ms-settings:display-advancedgraphics', null, 'uygulama başına GPU tercihi ve HAGS'],
  ['sound_devices', 'Ses aygıtları ve mikrofon', 'ms-settings:sound-devices', MAC.sound, 'tüm giriş/çıkış aygıtları ve mikrofon düzeyi']
];

function pageTool([key, label, win, mac, hint]) {
  return {
    name: `settings_${key}`,
    category: 'settings',
    title: `${label} ayarları`,
    description: `Ayarlar uygulamasında "${label}" sayfasını açar (${hint}).`,
    run: async (a, ctx) => {
      let uri;
      if (isWin) uri = win;
      else if (isMac && mac) uri = `x-apple.systempreferences:${mac}`;
      else throw unsupported(`${label} ayar sayfası`);
      await openUri(ctx, uri);
      return kvResult(`Ayarlar › ${label} açıldı.`, [['Sayfa', label], ['Adres', uri]], { page: key, uri });
    }
  };
}

/* ------------------------------------------------------------ classic Windows tools */

// [key, label, how, target, hint]. how: 'control' → control.exe [args], 'start' → cmd start (ShellExecute,
// handles .msc and UAC-elevated tools like regedit), 'exe' → direct launch.
const WIN_TOOLS = [
  ['control_panel', 'Denetim Masası', 'exe', ['control.exe', []], 'klasik ayarların tamamı'],
  ['programs', 'Program Ekle/Kaldır', 'control', ['appwiz.cpl'], 'klasik "Programlar ve Özellikler" listesi'],
  ['network_connections', 'Ağ Bağlantıları', 'control', ['ncpa.cpl'], 'ağ bağdaştırıcıları, IP ve DNS ayarı'],
  ['power_options', 'Güç Seçenekleri', 'control', ['powercfg.cpl'], 'güç planları ve kapak/düğme davranışı'],
  ['sound_panel', 'Ses (klasik)', 'control', ['mmsys.cpl'], 'kayıt/kayıttan yürütme aygıtları ve gelişmiş ses ayarları'],
  ['system_properties', 'Sistem Özellikleri', 'control', ['sysdm.cpl'], 'bilgisayar adı, sistem koruması, sanal bellek'],
  ['environment_variables', 'Ortam Değişkenleri', 'exe', ['rundll32.exe', ['sysdm.cpl,EditEnvironmentVariables']], 'kullanıcı ortam değişkenleri ve PATH'],
  ['device_manager', 'Aygıt Yöneticisi', 'start', 'devmgmt.msc', 'donanım ve sürücüler'],
  ['disk_management', 'Disk Yönetimi', 'start', 'diskmgmt.msc', 'bölümler, sürücü harfleri ve biçimlendirme'],
  ['services', 'Hizmetler', 'start', 'services.msc', 'Windows hizmetlerini başlatma/durdurma'],
  ['event_viewer', 'Olay Görüntüleyicisi', 'start', 'eventvwr.msc', 'sistem ve uygulama günlükleri'],
  ['task_scheduler', 'Görev Zamanlayıcı', 'start', 'taskschd.msc', 'zamanlanmış görevler'],
  ['computer_management', 'Bilgisayar Yönetimi', 'start', 'compmgmt.msc', 'yönetim araçlarının birleşik konsolu'],
  ['registry_editor', 'Kayıt Defteri Düzenleyicisi', 'start', 'regedit.exe', 'Windows kayıt defteri'],
  ['resource_monitor', 'Kaynak İzleyicisi', 'start', 'resmon.exe', 'işlemci, disk, ağ ve bellek kullanımı ayrıntısı'],
  ['performance_monitor', 'Performans İzleyicisi', 'start', 'perfmon.exe', 'performans sayaçları ve raporlar'],
  ['system_information', 'Sistem Bilgisi', 'start', 'msinfo32.exe', 'donanım ve yazılım envanteri'],
  ['disk_cleanup', 'Disk Temizleme', 'start', 'cleanmgr.exe', 'gereksiz dosyaları temizleme aracı'],
  ['defragment', 'Sürücüleri İyileştir', 'start', 'dfrgui.exe', 'birleştirme ve TRIM optimizasyonu'],
  ['firewall', 'Güvenlik Duvarı', 'control', ['firewall.cpl'], 'Windows Defender Güvenlik Duvarı'],
  ['credential_manager', 'Kimlik Bilgisi Yöneticisi', 'control', ['/name', 'Microsoft.CredentialManager'], 'kayıtlı web ve Windows kimlik bilgileri'],
  ['dxdiag', 'DirectX Tanılama', 'start', 'dxdiag.exe', 'ekran kartı, ses ve DirectX bilgisi'],
  ['character_map', 'Karakter Eşlem', 'start', 'charmap.exe', 'özel karakter bulma ve kopyalama'],
  ['on_screen_keyboard', 'Ekran Klavyesi', 'start', 'osk.exe', 'ekranda tıklanabilir klavye']
];

async function openWinTool(how, target) {
  if (how === 'control') return launch('control.exe', target);
  if (how === 'exe') return launch(target[0], target[1]);
  // "start" goes through ShellExecute: opens .msc files with mmc and shows UAC when needed.
  await run('cmd.exe', ['/d', '/c', 'start', '', target]);
}

function winTool([key, label, how, target, hint]) {
  const shown = how === 'control' ? `control.exe ${target.join(' ')}` : how === 'exe' ? [target[0], ...target[1]].join(' ') : target;
  return {
    name: `win_${key}`,
    category: 'settings',
    title: label,
    description: `Windows'un klasik "${label}" aracını açar (${hint}).`,
    run: async () => {
      if (!isWin) throw unsupported(label);
      await openWinTool(how, target);
      return kvResult(`${label} açıldı.`, [['Araç', label], ['Komut', shown]], { tool: key, command: shown });
    }
  };
}

/* ------------------------------------------------------------ special folders */

const home = os.homedir();

// [key, label, win target (shell: or path fn), posix path fn (or null), hint]
const FOLDERS = [
  ['startup', 'Başlangıç', 'shell:startup', () => (isMac ? null : path.join(home, '.config', 'autostart')), 'oturum açılınca çalışan kısayollar'],
  ['fonts', 'Yazı tipleri', 'shell:fonts', () => (isMac ? path.join(home, 'Library', 'Fonts') : path.join(home, '.local', 'share', 'fonts')), 'yüklü yazı tipleri'],
  ['recycle_bin', 'Geri Dönüşüm Kutusu', 'shell:RecycleBinFolder', () => (isMac ? path.join(home, '.Trash') : path.join(home, '.local', 'share', 'Trash', 'files')), 'silinen dosyalar'],
  ['this_pc', 'Bu Bilgisayar', 'shell:MyComputerFolder', () => (isMac ? '/Volumes' : '/'), 'sürücüler ve aygıtlar'],
  ['network', 'Ağ', 'shell:NetworkPlacesFolder', null, 'ağdaki bilgisayarlar ve paylaşımlar'],
  ['all_apps', 'Tüm uygulamalar', 'shell:AppsFolder', () => (isMac ? '/Applications' : '/usr/share/applications'), 'yüklü tüm uygulamalar'],
  ['temp', 'Temp', () => os.tmpdir(), () => os.tmpdir(), 'geçici dosyalar'],
  ['appdata', 'AppData', () => process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    () => (isMac ? path.join(home, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(home, '.config')), 'uygulama ayar ve verileri'],
  ['program_files', 'Program Files', () => process.env.ProgramFiles || 'C:\\Program Files', () => (isMac ? '/Applications' : '/opt'), 'kurulu programların klasörü'],
  ['recent', 'Son kullanılanlar', 'shell:Recent', null, 'son açılan dosyalar']
];

async function openPosixPath(ctx, p) {
  if (ctx?.electron?.shell?.openPath) {
    const err = await ctx.electron.shell.openPath(p);
    if (err) throw new ToolError(`Açılamadı: ${p}`, err);
    return;
  }
  if (isMac) await run('open', [p]);
  else await launch('xdg-open', [p]);
}

function folderTool([key, label, win, posix, hint]) {
  return {
    name: `folder_${key}`,
    category: 'settings',
    title: `${label} klasörü`,
    description: `"${label}" özel klasörünü dosya gezgininde açar (${hint}).`,
    run: async (a, ctx) => {
      let target;
      if (isWin) {
        target = typeof win === 'function' ? win() : win;
        await launch('explorer.exe', [target]);
      } else {
        target = posix && posix();
        if (!target) throw unsupported(`${label} klasörü`);
        if (!fs.existsSync(target)) throw new ToolError(`${label} klasörü bu bilgisayarda yok: ${target}`);
        await openPosixPath(ctx, target);
      }
      return kvResult(`${label} klasörü açıldı.`, [['Klasör', label], ['Konum', target]], { folder: key, target });
    }
  };
}

module.exports = [...PAGES.map(pageTool), ...WIN_TOOLS.map(winTool), ...FOLDERS.map(folderTool)];
module.exports.PAGES = PAGES;
module.exports.WIN_TOOLS = WIN_TOOLS;
module.exports.FOLDERS = FOLDERS;
