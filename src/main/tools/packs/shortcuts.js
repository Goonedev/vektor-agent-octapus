'use strict';

/*
 * Named keyboard shortcuts. Each row is a combo per platform; null means the platform has no
 * equivalent. Linux falls back to the Windows combo for ordinary app shortcuts (ctrl+...), but
 * not for win+... system shortcuts unless a GNOME equivalent is given.
 */

const { isWin, isMac, unsupported } = require('./kit');

const SHORTCUTS = [
  /* editing */
  { name: 'key_copy', title: 'Kopyala', description: 'Seçili metni ya da öğeyi panoya kopyalar (Ctrl+C).', win: 'ctrl+c', mac: 'cmd+c' },
  { name: 'key_paste', title: 'Yapıştır', description: 'Panodakini imlecin olduğu yere yapıştırır (Ctrl+V).', win: 'ctrl+v', mac: 'cmd+v' },
  { name: 'key_cut', title: 'Kes', description: 'Seçili metni ya da öğeyi keser (Ctrl+X).', win: 'ctrl+x', mac: 'cmd+x' },
  { name: 'key_undo', title: 'Geri al', description: 'Son işlemi geri alır (Ctrl+Z).', win: 'ctrl+z', mac: 'cmd+z', repeat: true },
  { name: 'key_redo', title: 'Yinele', description: 'Geri alınan işlemi yineler (Ctrl+Y).', win: 'ctrl+y', mac: 'cmd+shift+z', linux: 'ctrl+shift+z', repeat: true },
  { name: 'key_select_all', title: 'Tümünü seç', description: 'Etkin penceredeki tüm metni ya da öğeleri seçer (Ctrl+A).', win: 'ctrl+a', mac: 'cmd+a' },
  { name: 'key_save', title: 'Kaydet', description: 'Etkin belgeyi kaydeder (Ctrl+S).', win: 'ctrl+s', mac: 'cmd+s' },
  { name: 'key_save_as', title: 'Farklı kaydet', description: 'Etkin belge için "Farklı kaydet" penceresini açar (Ctrl+Shift+S).', win: 'ctrl+shift+s', mac: 'cmd+shift+s' },
  { name: 'key_print', title: 'Yazdır', description: 'Etkin belge ya da sayfa için yazdırma penceresini açar (Ctrl+P).', win: 'ctrl+p', mac: 'cmd+p' },
  { name: 'key_find', title: 'Sayfada bul', description: 'Etkin pencerede arama çubuğunu açar (Ctrl+F).', win: 'ctrl+f', mac: 'cmd+f' },

  /* browser */
  { name: 'key_new_tab', title: 'Yeni sekme', description: 'Tarayıcıda yeni sekme açar (Ctrl+T).', win: 'ctrl+t', mac: 'cmd+t', repeat: true },
  { name: 'key_close_tab', title: 'Sekmeyi kapat', description: 'Etkin sekmeyi kapatır (Ctrl+W).', win: 'ctrl+w', mac: 'cmd+w', repeat: true },
  { name: 'key_reopen_tab', title: 'Kapanan sekmeyi aç', description: 'Tarayıcıda son kapatılan sekmeyi geri açar (Ctrl+Shift+T).', win: 'ctrl+shift+t', mac: 'cmd+shift+t', repeat: true },
  { name: 'key_next_tab', title: 'Sonraki sekme', description: 'Sağdaki sekmeye geçer (Ctrl+Tab).', win: 'ctrl+tab', mac: 'ctrl+tab', repeat: true },
  { name: 'key_prev_tab', title: 'Önceki sekme', description: 'Soldaki sekmeye geçer (Ctrl+Shift+Tab).', win: 'ctrl+shift+tab', mac: 'ctrl+shift+tab', repeat: true },
  { name: 'key_reload', title: 'Yenile', description: 'Sayfayı yeniler (F5).', win: 'f5', mac: 'cmd+r' },
  { name: 'key_hard_reload', title: 'Önbelleksiz yenile', description: 'Sayfayı önbelleği atlayarak yeniden yükler (Ctrl+F5).', win: 'ctrl+f5', mac: 'cmd+shift+r', linux: 'ctrl+shift+r' },
  { name: 'key_back', title: 'Geri git', description: 'Tarayıcıda ya da dosya gezgininde bir önceki sayfaya döner (Alt+Sol).', win: 'alt+left', mac: 'cmd+[', repeat: true },
  { name: 'key_forward', title: 'İleri git', description: 'Tarayıcıda bir sonraki sayfaya gider (Alt+Sağ).', win: 'alt+right', mac: 'cmd+]', repeat: true },
  { name: 'key_zoom_in', title: 'Yakınlaştır', description: 'Sayfayı ya da belgeyi yakınlaştırır (Ctrl++).', win: 'ctrl+plus', mac: 'cmd+=', repeat: true },
  { name: 'key_zoom_out', title: 'Uzaklaştır', description: 'Sayfayı ya da belgeyi uzaklaştırır (Ctrl+-).', win: 'ctrl+minus', mac: 'cmd+-', repeat: true },
  { name: 'key_zoom_reset', title: 'Yakınlaştırmayı sıfırla', description: 'Yakınlaştırmayı %100\'e döndürür (Ctrl+0).', win: 'ctrl+0', mac: 'cmd+0' },
  { name: 'key_fullscreen', title: 'Tam ekran', description: 'Etkin pencereyi ya da tarayıcıyı tam ekran yapar / tam ekrandan çıkar (F11).', win: 'f11', mac: 'ctrl+cmd+f' },
  { name: 'key_incognito', title: 'Gizli pencere', description: 'Tarayıcıda gizli (InPrivate) pencere açar (Ctrl+Shift+N; Firefox\'ta Ctrl+Shift+P).', win: 'ctrl+shift+n', mac: 'cmd+shift+n' },
  { name: 'key_address_bar', title: 'Adres çubuğu', description: 'Tarayıcının adres çubuğuna odaklanır; ardından yazı yazılabilir (Ctrl+L).', win: 'ctrl+l', mac: 'cmd+l' },
  { name: 'key_bookmark', title: 'Yer imi ekle', description: 'Açık sayfayı yer imlerine ekler (Ctrl+D).', win: 'ctrl+d', mac: 'cmd+d' },
  { name: 'key_downloads', title: 'Tarayıcı indirmeleri', description: 'Tarayıcının indirilenler sayfasını açar (Ctrl+J).', win: 'ctrl+j', mac: 'cmd+shift+j' },
  { name: 'key_history', title: 'Tarayıcı geçmişi', description: 'Tarayıcı geçmişini açar (Ctrl+H).', win: 'ctrl+h', mac: 'cmd+y' },
  { name: 'key_devtools', title: 'Geliştirici araçları', description: 'Tarayıcının geliştirici araçlarını açar / kapatır (F12).', win: 'f12', mac: 'cmd+alt+i' },

  /* windows & desktops */
  { name: 'key_close_window', title: 'Pencereyi kapat', description: 'Etkin pencereyi kapatır (Alt+F4). Kaydedilmemiş çalışma kaybolabilir.', win: 'alt+f4', mac: 'cmd+w', danger: true },
  { name: 'key_snap_left', title: 'Sola yasla', description: 'Etkin pencereyi ekranın sol yarısına yaslar (Win+Sol).', win: 'win+left', mac: null, linux: 'win+left' },
  { name: 'key_snap_right', title: 'Sağa yasla', description: 'Etkin pencereyi ekranın sağ yarısına yaslar (Win+Sağ).', win: 'win+right', mac: null, linux: 'win+right' },
  { name: 'key_switch_app', title: 'Uygulama değiştir', description: 'Bir önceki uygulamaya geçer (Alt+Tab).', win: 'alt+tab', mac: 'cmd+tab' },
  { name: 'key_task_view', title: 'Görev görünümü', description: 'Tüm açık pencereleri ve sanal masaüstlerini gösterir (Win+Tab; macOS\'ta Mission Control).', win: 'win+tab', mac: 'ctrl+up', linux: 'win' },
  { name: 'key_new_desktop', title: 'Yeni sanal masaüstü', description: 'Yeni bir sanal masaüstü oluşturup ona geçer (Win+Ctrl+D).', win: 'win+ctrl+d', mac: null },
  { name: 'key_next_desktop', title: 'Sonraki masaüstü', description: 'Sağdaki sanal masaüstüne geçer (Win+Ctrl+Sağ).', win: 'win+ctrl+right', mac: 'ctrl+right', linux: 'ctrl+alt+right', repeat: true },
  { name: 'key_prev_desktop', title: 'Önceki masaüstü', description: 'Soldaki sanal masaüstüne geçer (Win+Ctrl+Sol).', win: 'win+ctrl+left', mac: 'ctrl+left', linux: 'ctrl+alt+left', repeat: true },
  { name: 'key_close_desktop', title: 'Sanal masaüstünü kapat', description: 'Etkin sanal masaüstünü kapatır; pencereleri yandaki masaüstüne taşınır (Win+Ctrl+F4).', win: 'win+ctrl+f4', mac: null },
  { name: 'key_minimize_all', title: 'Tümünü küçült', description: 'Tüm pencereleri küçültür (Win+M; macOS\'ta masaüstünü göster).', win: 'win+m', mac: 'f11', linux: 'win+d' },

  /* Windows system panels */
  { name: 'key_emoji', title: 'Emoji paneli', description: 'Emoji ve sembol panelini açar; seçilen emoji imlecin olduğu yere eklenir (Win+.).', win: 'win+period', mac: 'ctrl+cmd+space', linux: 'ctrl+period' },
  { name: 'key_clipboard_history', title: 'Pano geçmişi', description: 'Windows pano geçmişi panelini açar (Win+V).', win: 'win+v', mac: null },
  { name: 'key_snip', title: 'Ekran alıntısı', description: 'Ekranın bir bölümünü seçip alıntı almak için Ekran Alıntısı Aracını açar (Win+Shift+S).', win: 'win+shift+s', mac: 'cmd+shift+4', linux: 'printscreen' },
  { name: 'key_record_screen', title: 'Ekran kaydı (Game Bar)', description: 'Xbox Game Bar ile etkin pencerenin kaydını başlatır / durdurur (Win+Alt+R). macOS\'ta ekran kaydı araç çubuğunu açar.', win: 'win+alt+r', mac: 'cmd+shift+5' },
  { name: 'key_notifications', title: 'Bildirim merkezi', description: 'Bildirim merkezini ve takvimi açar (Win+N).', win: 'win+n', mac: null, linux: 'win+v' },
  { name: 'key_quick_settings', title: 'Hızlı ayarlar', description: 'Wi-Fi, Bluetooth, ses ve parlaklık için hızlı ayarlar panelini açar (Win+A).', win: 'win+a', mac: null },
  { name: 'key_run_dialog', title: 'Çalıştır penceresi', description: 'Windows "Çalıştır" penceresini açar (Win+R).', win: 'win+r', mac: null, linux: 'alt+f2' },
  { name: 'key_file_explorer', title: 'Dosya gezgini', description: 'Yeni bir Dosya Gezgini penceresi açar (Win+E; macOS\'ta Finder arama penceresi).', win: 'win+e', mac: 'cmd+alt+space', linux: 'win+e' },
  { name: 'key_search', title: 'Windows arama', description: 'Sistem aramasını açar (Win+S; macOS\'ta Spotlight).', win: 'win+s', mac: 'cmd+space', linux: 'win' },
  { name: 'key_dictation', title: 'Sesle yazma', description: 'Windows sesle yazmayı başlatır; konuşulanlar imlecin olduğu yere yazılır (Win+H).', win: 'win+h', mac: null },
  { name: 'key_project', title: 'Ekran yansıtma', description: 'İkinci ekran / projektör seçeneklerini (Yalnızca bilgisayar, Çoğalt, Genişlet) açar (Win+P).', win: 'win+p', mac: null, linux: 'win+p' }
];

function comboFor(s) {
  if (isWin) return s.win;
  if (isMac) return s.mac;
  if (s.linux !== undefined) return s.linux;
  return /(^|\+)win(\+|$)/.test(s.win) ? null : s.win;
}

function make(s) {
  const tool = {
    name: s.name,
    category: 'shortcuts',
    title: s.title,
    description: s.description,
    params: s.repeat ? { repeat: { type: 'integer', description: 'Kaç kez basılsın (1–20). Varsayılan 1.' } } : {},
    run: async (a, ctx) => {
      const combo = comboFor(s);
      if (!combo) throw unsupported(s.title);
      const times = s.repeat ? Math.max(1, Math.min(20, Math.round(Number(a?.repeat) || 1))) : 1;
      await ctx?.yieldFocus?.();
      const { pressCombo } = require('../desktop');
      let sent = combo;
      for (let i = 0; i < times; i++) sent = await pressCombo(combo);
      return {
        summary: `${s.title}: ${sent}${times > 1 ? ` × ${times}` : ''} gönderildi.`,
        display: { type: 'keys', combo: sent, repeat: times },
        data: { combo: sent, repeat: times }
      };
    }
  };
  if (s.danger) tool.danger = true;
  return tool;
}

module.exports = SHORTCUTS.map(make);
module.exports.SHORTCUTS = SHORTCUTS;
module.exports.comboFor = comboFor;
