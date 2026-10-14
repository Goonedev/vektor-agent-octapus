'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isWin, isMac, ToolError, run, launch, ps, psStr, winNative, osa, osaStr, jxa, linuxFirst, hasBin, dirFor, bytes, truncate } = require('./util');

/* ------------------------------------------------------------ key maps */

const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, option: 0x12, win: 0x5B, windows: 0x5B, cmd: 0x5B, command: 0x5B, super: 0x5B, meta: 0x5B,
  enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20, backspace: 0x08, delete: 0x2E, del: 0x2E, insert: 0x2D,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  printscreen: 0x2C, capslock: 0x14, volumeup: 0xAF, volumedown: 0xAE, volumemute: 0xAD,
  playpause: 0xB3, nexttrack: 0xB0, prevtrack: 0xB1, stop: 0xB2,
  plus: 0xBB, minus: 0xBD, comma: 0xBC, period: 0xBE
};
for (let i = 1; i <= 12; i++) VK['f' + i] = 0x6F + i;

const MAC_CODE = {
  enter: 36, return: 36, tab: 48, space: 49, backspace: 51, delete: 117, del: 117, esc: 53, escape: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111
};
const MAC_MOD = { ctrl: 'control down', control: 'control down', shift: 'shift down', alt: 'option down', option: 'option down', cmd: 'command down', command: 'command down', win: 'command down', super: 'command down', meta: 'command down' };

const XDO = {
  ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', win: 'super', super: 'super', cmd: 'super', command: 'super', meta: 'super',
  enter: 'Return', return: 'Return', tab: 'Tab', esc: 'Escape', escape: 'Escape', space: 'space', backspace: 'BackSpace', delete: 'Delete', del: 'Delete',
  home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', left: 'Left', right: 'Right', up: 'Up', down: 'Down',
  playpause: 'XF86AudioPlay', nexttrack: 'XF86AudioNext', prevtrack: 'XF86AudioPrev', printscreen: 'Print'
};

function parseCombo(combo) {
  const keys = String(combo).toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
  if (!keys.length) throw new ToolError('Bir tuş kombinasyonu belirtmelisin, ör. "ctrl+c".');
  return keys;
}

async function pressCombo(combo) {
  const keys = parseCombo(combo);
  if (isWin) {
    const vks = keys.map((k) => {
      if (VK[k] != null) return VK[k];
      if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
      throw new ToolError(`Bilinmeyen tuş: ${k}`);
    });
    await winNative(`[Vektor.Input]::Combo(${psStr(vks.join(','))})`);
  } else if (isMac) {
    const mods = keys.filter((k) => MAC_MOD[k]).map((k) => MAC_MOD[k]);
    const main = keys.filter((k) => !MAC_MOD[k]);
    if (main.length !== 1) throw new ToolError('macOS\'ta tek bir ana tuş ve isteğe bağlı değiştiriciler gönderebilirsin.');
    const k = main[0];
    const using = mods.length ? ` using {${mods.join(', ')}}` : '';
    if (MAC_CODE[k] != null) await osa(`tell application "System Events" to key code ${MAC_CODE[k]}${using}`);
    else await osa(`tell application "System Events" to keystroke ${osaStr(k)}${using}`);
  } else {
    await linuxFirst([['xdotool', ['key', keys.map((k) => XDO[k] || k).join('+')]]]);
  }
  return keys.join('+');
}

/* macOS media keys are "system defined" events, not ordinary key codes. */
const MAC_MEDIA = { playpause: 16, nexttrack: 17, prevtrack: 18 };
async function mediaKey(kind) {
  if (isWin) return winNative(`[Vektor.Input]::Combo('${VK[kind]}')`);
  if (isMac) {
    return jxa(`ObjC.import('Cocoa');
      for (const down of [true, false]) {
        const ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
          14, $.NSMakePoint(0, 0), down ? 0xa00 : 0xb00, 0, 0, $(), 8, (${MAC_MEDIA[kind]} << 16) | ((down ? 0xa : 0xb) << 8), -1);
        $.CGEventPost(0, ev.CGEvent);
      }`);
  }
  if (await hasBin('playerctl')) return run('playerctl', [{ playpause: 'play-pause', nexttrack: 'next', prevtrack: 'previous' }[kind]]);
  return linuxFirst([['xdotool', ['key', XDO[kind]]]]);
}

/* ------------------------------------------------------------- mouse */

async function mouse(action, opts = {}) {
  const { x, y, button = 'left', count = 1, amount = 0, horizontal = false } = opts;
  if (isWin) {
    const parts = [];
    if (x != null && y != null) parts.push(`[Vektor.Input]::Move(${Math.round(x)}, ${Math.round(y)})`);
    if (action === 'click') parts.push(`Start-Sleep -Milliseconds 40; [Vektor.Input]::Click(${psStr(button)}, ${count})`);
    if (action === 'scroll') parts.push(`[Vektor.Input]::Scroll(${Math.round(amount)}, $${horizontal})`);
    parts.push('[Vektor.Input]::Position()');
    return (await winNative(parts.join(';'))).trim();
  }
  if (isMac) {
    const btn = { left: ['kCGEventLeftMouseDown', 'kCGEventLeftMouseUp', 'kCGMouseButtonLeft'], right: ['kCGEventRightMouseDown', 'kCGEventRightMouseUp', 'kCGMouseButtonRight'], middle: ['kCGEventOtherMouseDown', 'kCGEventOtherMouseUp', 'kCGMouseButtonCenter'] }[button] || [];
    return (await jxa(`ObjC.import('CoreGraphics');
      let p = $.CGEventGetLocation($.CGEventCreate(null));
      ${x != null && y != null ? `p = $.CGPointMake(${x}, ${y}); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft)); delay(0.04);` : ''}
      ${action === 'click' ? `for (let i = 1; i <= ${count}; i++) {
        for (const t of [$.${btn[0]}, $.${btn[1]}]) { const e = $.CGEventCreateMouseEvent(null, t, p, $.${btn[2]}); $.CGEventSetIntegerValueField(e, $.kCGMouseEventClickState, i); $.CGEventPost($.kCGHIDEventTap, e); }
      }` : ''}
      ${action === 'scroll' ? `$.CGEventPost($.kCGHIDEventTap, $.CGEventCreateScrollWheelEvent2(null, 1, 2, ${horizontal ? 0 : Math.round(amount)}, ${horizontal ? Math.round(amount) : 0}, 0));` : ''}
      Math.round(p.x) + ',' + Math.round(p.y);`)).trim();
  }
  const args = [];
  if (x != null && y != null) args.push('mousemove', String(Math.round(x)), String(Math.round(y)));
  if (action === 'click') args.push('click', '--repeat', String(count), { left: '1', middle: '2', right: '3' }[button] || '1');
  if (action === 'scroll') {
    const b = horizontal ? (amount > 0 ? '6' : '7') : (amount > 0 ? '4' : '5');
    args.push('click', '--repeat', String(Math.abs(Math.round(amount)) || 1), b);
  }
  if (args.length) await linuxFirst([['xdotool', args]]);
  const loc = await run('xdotool', ['getmouselocation', '--shell']).catch(() => '');
  const mx = loc.match(/X=(\d+)/), my = loc.match(/Y=(\d+)/);
  return mx && my ? `${mx[1]},${my[1]}` : '';
}

/* ----------------------------------------------------------- windows */

async function listWindows() {
  if (isWin) {
    const out = await winNative('[Vektor.Windows]::List()');
    return out.split('\n').map((l) => l.replace(/\r$/, '').split('\t')).filter((p) => p.length >= 3 && p[2]).map(([pid, app, title]) => ({ pid: Number(pid), app, title }));
  }
  if (isMac) {
    const out = await jxa(`const se = Application('System Events'); const out = [];
      se.processes.whose({ backgroundOnly: false })().forEach((p) => { try { const n = p.name(); p.windows().forEach((w) => out.push(n + '\\t' + (w.name() || ''))); } catch (e) {} });
      out.join('\\n');`);
    return out.split('\n').filter(Boolean).map((l) => { const [app, title] = l.split('\t'); return { app, title: title || app }; });
  }
  const out = await linuxFirst([['wmctrl', ['-l', '-p']]]);
  return out.split('\n').filter(Boolean).map((l) => {
    const m = l.match(/^(\S+)\s+(-?\d+)\s+(\d+)\s+\S+\s+(.*)$/);
    return m ? { id: m[1], pid: Number(m[3]), app: '', title: m[4] } : null;
  }).filter((w) => w && w.title);
}

async function activeWindowState(state) {
  if (isWin) return (await winNative(`[Vektor.Windows]::Active(${state === 'max' ? 3 : 6})`)).trim();
  if (isMac) {
    const attr = state === 'max'
      ? 'click (first button of window 1 whose subrole is "AXZoomButton")'
      : 'set value of attribute "AXMinimized" of window 1 to true';
    return (await osa(`tell application "System Events" to tell (first process whose frontmost is true)\n${attr}\nreturn name\nend tell`)).trim();
  }
  if (state === 'max') await linuxFirst([['wmctrl', ['-r', ':ACTIVE:', '-b', 'add,maximized_vert,maximized_horz']]]);
  else await linuxFirst([['xdotool', ['getactivewindow', 'windowminimize']]]);
  return '';
}

/* ---------------------------------------------------------- screenshots */

async function captureScreen(ctx, index = 0) {
  const { desktopCapturer, screen } = ctx.electron;
  const displays = screen.getAllDisplays();
  const d = displays[Math.min(index, displays.length - 1)] || screen.getPrimaryDisplay();
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[index] || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new ToolError('Ekran görüntüsü alınamadı. macOS\'ta Ekran Kaydı iznini kontrol et.');
  return src.thumbnail;
}

function previewOf(image, width = 560) {
  return image.resize({ width, quality: 'good' }).toDataURL();
}

/* -------------------------------------------------------------- tools */

module.exports = [
  /* media */
  {
    name: 'media_play_pause',
    category: 'media',
    title: 'Oynat / duraklat',
    description: 'Çalan müziği ya da videoyu duraklatır veya devam ettirir (Spotify, YouTube, Apple Music...).',
    params: {},
    run: async () => { await mediaKey('playpause'); return { summary: 'Oynat/duraklat gönderildi.', display: { type: 'media', action: 'playpause' } }; }
  },
  {
    name: 'media_next',
    category: 'media',
    title: 'Sonraki parça',
    description: 'Sonraki şarkıya / videoya geçer.',
    params: {},
    run: async () => { await mediaKey('nexttrack'); return { summary: 'Sonraki parçaya geçildi.', display: { type: 'media', action: 'next' } }; }
  },
  {
    name: 'media_previous',
    category: 'media',
    title: 'Önceki parça',
    description: 'Önceki şarkıya / videoya döner.',
    params: {},
    run: async () => { await mediaKey('prevtrack'); return { summary: 'Önceki parçaya dönüldü.', display: { type: 'media', action: 'previous' } }; }
  },
  {
    name: 'take_screenshot',
    category: 'media',
    title: 'Ekran görüntüsü',
    description: 'Ekran görüntüsü alır ve Resimler/Vektör klasörüne kaydeder. Kullanıcı "ekranımda ne var", "şuna bak" derse look=true ver; görüntü sana gönderilir ve yorumlayabilirsin.',
    params: {
      look: { type: 'boolean', description: 'true ise görüntü analiz için sana da gönderilir.' },
      display: { type: 'integer', description: 'Birden fazla ekran varsa ekran sırası (0 = birincil).' }
    },
    run: async (a, ctx) => {
      const img = await captureScreen(ctx, a.display || 0);
      const dir = path.join(dirFor('pictures'), 'Vektör');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const file = path.join(dir, `Ekran görüntüsü ${stamp}.png`);
      const png = img.toPNG();
      fs.writeFileSync(file, png);
      const result = {
        summary: `Ekran görüntüsü kaydedildi: ${path.basename(file)}.`,
        display: { type: 'image', src: previewOf(img), path: file, caption: `${img.getSize().width}×${img.getSize().height} · ${bytes(png.length)}` },
        data: { path: file }
      };
      if (a.look) {
        const forModel = img.getSize().width > 1600 ? img.resize({ width: 1600, quality: 'good' }) : img;
        result.vision = { mimeType: 'image/jpeg', data: forModel.toJPEG(80).toString('base64') };
        result.summary += ' Görüntü sana gönderildi; ekranda gördüklerini anlat.';
      }
      return result;
    }
  },
  {
    name: 'screenshot_to_clipboard',
    category: 'media',
    title: 'Ekranı panoya kopyala',
    description: 'Ekran görüntüsü alıp doğrudan panoya kopyalar, yapıştırmaya hazır.',
    params: {},
    run: async (a, ctx) => {
      const img = await captureScreen(ctx);
      await ctx.clip.writeImage(img);
      return { summary: 'Ekran görüntüsü panoya kopyalandı.', display: { type: 'image', src: previewOf(img), caption: 'Panoda' } };
    }
  },
  {
    name: 'open_camera',
    category: 'media',
    title: 'Kamera aç',
    description: 'Kamera uygulamasını açar.',
    params: {},
    run: async (a, ctx) => {
      if (isWin) await ctx.electron.shell.openExternal('microsoft.windows.camera:');
      else if (isMac) await run('open', ['-a', 'Photo Booth']);
      else await launch('cheese');
      return { summary: 'Kamera açıldı.', display: { type: 'app', name: 'Kamera' } };
    }
  },

  /* clipboard */
  {
    name: 'clipboard_read',
    category: 'clipboard',
    title: 'Panoyu oku',
    description: 'Panodaki metni okur. Kullanıcı "kopyaladığım şeyi özetle/çevir" derse kullan.',
    params: {},
    run: async (a, ctx) => {
      const text = await ctx.clip.readText();
      if (!text) {
        const img = await ctx.clip.readImage();
        if (!img.isEmpty()) return { summary: 'Panoda bir resim var.', display: { type: 'image', src: previewOf(img, 400), caption: 'Panodaki resim' } };
        return { summary: 'Pano boş.', display: { type: 'kv', rows: [['Pano', 'Boş']] } };
      }
      return { summary: `Panoda ${text.length} karakter metin var.`, display: { type: 'code', title: 'Pano', text: truncate(text, 1500) }, data: { text: truncate(text, 8000) } };
    }
  },
  {
    name: 'clipboard_write',
    category: 'clipboard',
    title: 'Panoya kopyala',
    description: 'Verilen metni panoya kopyalar; kullanıcı istediği yere yapıştırabilir.',
    params: { text: { type: 'string', description: 'Kopyalanacak metin.', required: true } },
    run: async (a, ctx) => {
      await ctx.clip.writeText(a.text);
      return { summary: 'Metin panoya kopyalandı.', display: { type: 'code', title: 'Panoya kopyalandı', text: truncate(a.text, 800) } };
    }
  },
  {
    name: 'clipboard_clear',
    category: 'clipboard',
    title: 'Panoyu temizle',
    description: 'Panoyu ve Vektör\'ün pano geçmişini temizler (ör. bir şifre kopyaladıktan sonra).',
    params: {},
    run: async (a, ctx) => {
      await ctx.clip.clear();
      ctx.clipboardHistory?.clear();
      return { summary: 'Pano temizlendi.', display: { type: 'kv', rows: [['Pano', 'Temizlendi']] } };
    }
  },
  {
    name: 'clipboard_history',
    category: 'clipboard',
    title: 'Pano geçmişi',
    description: 'Vektör açıkken panoya kopyalanan son metinleri listeler.',
    params: { limit: { type: 'integer', description: 'Kaç öğe. Varsayılan 10.' } },
    run: async (a, ctx) => {
      const list = (ctx.clipboardHistory?.list() || []).slice(0, a.limit || 10);
      return {
        summary: list.length ? `${list.length} pano kaydı var.` : 'Pano geçmişi boş.',
        display: { type: 'list', items: list.map((e) => ({ title: truncate(e.text.replace(/\s+/g, ' '), 90), subtitle: new Date(e.at).toLocaleTimeString('tr-TR'), icon: 'clipboard' })) },
        data: list.map((e) => truncate(e.text, 300))
      };
    }
  },

  /* keyboard & mouse */
  {
    name: 'type_text',
    category: 'input',
    title: 'Yazı yaz',
    description: 'Odaktaki pencereye klavyeden yazıyormuş gibi metin yazar (Türkçe karakterler dahil).',
    params: {
      text: { type: 'string', description: 'Yazılacak metin.', required: true },
      press_enter: { type: 'boolean', description: 'Sonunda Enter\'a basılsın mı.' }
    },
    run: async (a, ctx) => {
      await ctx.yieldFocus?.();
      const text = a.text + (a.press_enter ? '\n' : '');
      if (isWin) await winNative(`[Vektor.Input]::Type(${psStr(text)})`, { timeout: 60000 });
      else if (isMac) {
        // keystroke cannot send non-ASCII reliably, so the text goes through the clipboard.
        const prev = await ctx.clip.readText();
        await ctx.clip.writeText(a.text);
        await osa('tell application "System Events" to keystroke "v" using {command down}');
        if (a.press_enter) await osa('tell application "System Events" to key code 36');
        setTimeout(() => ctx.clip.writeText(prev), 800);
      } else await linuxFirst([['xdotool', ['type', '--delay', '6', '--', text]]]);
      return { summary: `${a.text.length} karakter yazıldı.`, display: { type: 'keys', text: truncate(a.text, 200) } };
    }
  },
  {
    name: 'press_keys',
    category: 'input',
    title: 'Kısayol tuşu',
    description: 'Bir tuş ya da kısayol gönderir: "ctrl+c", "alt+tab", "win+d", "cmd+space", "enter", "f5", "ctrl+shift+esc".',
    params: {
      keys: { type: 'string', description: 'Tuş kombinasyonu, + ile ayrılmış.', required: true },
      repeat: { type: 'integer', description: 'Kaç kez basılsın. Varsayılan 1.' }
    },
    run: async (a, ctx) => {
      await ctx.yieldFocus?.();
      let sent = '';
      for (let i = 0; i < Math.min(a.repeat || 1, 50); i++) sent = await pressCombo(a.keys);
      return { summary: `${sent} gönderildi.`, display: { type: 'keys', combo: sent, repeat: a.repeat || 1 } };
    }
  },
  {
    name: 'mouse_move',
    category: 'input',
    title: 'Fareyi taşı',
    description: 'Fare imlecini ekran koordinatına (piksel) taşır.',
    params: {
      x: { type: 'integer', description: 'Yatay konum.', required: true },
      y: { type: 'integer', description: 'Dikey konum.', required: true }
    },
    run: async (a) => {
      const pos = await mouse('move', { x: a.x, y: a.y });
      return { summary: `İmleç ${pos || `${a.x},${a.y}`} konumunda.`, display: { type: 'pointer', x: a.x, y: a.y, action: 'move' } };
    }
  },
  {
    name: 'mouse_click',
    category: 'input',
    title: 'Tıkla',
    description: 'Fareyle tıklar. Koordinat verilirse önce oraya gider.',
    params: {
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Fare tuşu. Varsayılan left.' },
      double: { type: 'boolean', description: 'Çift tıklama.' },
      x: { type: 'integer', description: 'İsteğe bağlı yatay konum.' },
      y: { type: 'integer', description: 'İsteğe bağlı dikey konum.' }
    },
    run: async (a) => {
      const pos = await mouse('click', { x: a.x, y: a.y, button: a.button || 'left', count: a.double ? 2 : 1 });
      return { summary: `${a.double ? 'Çift ' : ''}${{ left: 'sol', right: 'sağ', middle: 'orta' }[a.button || 'left']} tık${pos ? ` (${pos})` : ''}.`, display: { type: 'pointer', action: 'click', x: a.x, y: a.y } };
    }
  },
  {
    name: 'mouse_scroll',
    category: 'input',
    title: 'Kaydır',
    description: 'Fare tekerleğiyle kaydırır. Pozitif = yukarı, negatif = aşağı.',
    params: {
      amount: { type: 'integer', description: 'Tık sayısı; ör. -5 aşağı, 5 yukarı.', required: true },
      horizontal: { type: 'boolean', description: 'Yatay kaydırma.' }
    },
    run: async (a) => {
      await mouse('scroll', { amount: a.amount, horizontal: !!a.horizontal });
      return { summary: `${Math.abs(a.amount)} adım ${a.amount > 0 ? 'yukarı' : 'aşağı'} kaydırıldı.`, display: { type: 'pointer', action: 'scroll', amount: a.amount } };
    }
  },
  {
    name: 'show_desktop',
    category: 'input',
    title: 'Masaüstünü göster',
    description: 'Tüm pencereleri küçültüp masaüstünü gösterir.',
    params: {},
    run: async () => {
      if (isWin) await ps('(New-Object -ComObject Shell.Application).ToggleDesktop()');
      else if (isMac) await osa('tell application "System Events" to set visible of every process whose visible is true and name is not "Finder" to false');
      else await linuxFirst([['xdotool', ['key', 'super+d']], ['wmctrl', ['-k', 'on']]]);
      return { summary: 'Masaüstü gösteriliyor.', display: { type: 'power', action: 'desktop', label: 'Masaüstü' } };
    }
  },

  /* windows */
  {
    name: 'list_windows',
    category: 'windows',
    title: 'Açık pencereler',
    description: 'Ekrandaki açık pencereleri uygulama adlarıyla listeler.',
    params: {},
    run: async () => {
      const list = await listWindows();
      return {
        summary: `${list.length} açık pencere var.`,
        display: { type: 'list', items: list.slice(0, 40).map((w) => ({ title: w.title, subtitle: w.app, icon: 'window' })) },
        data: list.slice(0, 40).map((w) => `${w.app ? w.app + ': ' : ''}${w.title}`)
      };
    }
  },
  {
    name: 'focus_window',
    category: 'windows',
    title: 'Pencereye geç',
    description: 'Başlığı ya da uygulama adı eşleşen pencereyi öne getirir.',
    params: { query: { type: 'string', description: 'Pencere başlığı ya da uygulama adı parçası.', required: true } },
    run: async (a) => {
      let hit = '';
      if (isWin) hit = (await winNative(`[Vektor.Windows]::Focus(${psStr(a.query)})`)).trim();
      else if (isMac) {
        const w = (await listWindows()).find((x) => `${x.app} ${x.title}`.toLowerCase().includes(a.query.toLowerCase()));
        if (w) { await osa(`tell application ${osaStr(w.app)} to activate`); hit = `${w.app}\t${w.title}`; }
      } else {
        await linuxFirst([['wmctrl', ['-a', a.query]]]).then(() => { hit = a.query; }).catch(() => {});
      }
      if (!hit) throw new ToolError(`“${a.query}” ile eşleşen pencere yok.`);
      const [app, title] = hit.split('\t');
      return { summary: `${title || app} öne getirildi.`, display: { type: 'app', name: app, detail: title } };
    }
  },
  {
    name: 'maximize_window',
    category: 'windows',
    title: 'Pencereyi büyüt',
    description: 'Etkin pencereyi ekranı kaplayacak şekilde büyütür.',
    params: {},
    run: async (a, ctx) => {
      await ctx.yieldFocus?.();
      const t = await activeWindowState('max');
      return { summary: `${t || 'Pencere'} büyütüldü.`, display: { type: 'app', name: t || 'Etkin pencere', detail: 'Büyütüldü' } };
    }
  },
  {
    name: 'minimize_window',
    category: 'windows',
    title: 'Pencereyi küçült',
    description: 'Etkin pencereyi simge durumuna küçültür.',
    params: {},
    run: async (a, ctx) => {
      await ctx.yieldFocus?.();
      const t = await activeWindowState('min');
      return { summary: `${t || 'Pencere'} küçültüldü.`, display: { type: 'app', name: t || 'Etkin pencere', detail: 'Küçültüldü' } };
    }
  }
];

module.exports.parseCombo = parseCombo;
