'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isWin, isMac, ToolError, norm, run, launch, ps, psJson, psStr, osa, osaStr, hasBin, resolvePath, bytes, dirFor
} = require('./util');

/* Common names people say → what each platform needs to launch it. */
const KNOWN = {
  chrome: { win: 'chrome', mac: 'Google Chrome', linux: ['google-chrome', 'chromium', 'chromium-browser'], words: ['chrome', 'google chrome', 'krom'] },
  edge: { win: 'msedge', mac: 'Microsoft Edge', linux: ['microsoft-edge'], words: ['edge', 'microsoft edge'] },
  firefox: { win: 'firefox', mac: 'Firefox', linux: ['firefox'], words: ['firefox'] },
  safari: { mac: 'Safari', words: ['safari'] },
  spotify: { win: 'spotify:', mac: 'Spotify', linux: ['spotify'], words: ['spotify'] },
  discord: { win: 'discord:', mac: 'Discord', linux: ['discord'], words: ['discord'] },
  whatsapp: { win: 'whatsapp:', mac: 'WhatsApp', linux: ['whatsapp-for-linux'], words: ['whatsapp', 'vatsap'] },
  vscode: { win: 'code', mac: 'Visual Studio Code', linux: ['code'], words: ['vs code', 'vscode', 'visual studio code', 'kod editörü'] },
  notepad: { win: 'notepad', mac: 'TextEdit', linux: ['gedit', 'gnome-text-editor', 'kate', 'mousepad'], words: ['not defteri', 'notepad', 'textedit', 'metin editörü'] },
  calculator: { win: 'calc', mac: 'Calculator', linux: ['gnome-calculator', 'kcalc', 'galculator'], words: ['hesap makinesi', 'calculator', 'hesap makinası'] },
  paint: { win: 'mspaint', mac: 'Preview', linux: ['pinta', 'kolourpaint'], words: ['paint', 'boya'] },
  explorer: { win: 'explorer', mac: 'Finder', linux: ['nautilus', 'dolphin', 'thunar', 'xdg-open'], words: ['dosya gezgini', 'explorer', 'finder', 'dosyalar'] },
  word: { win: 'winword', mac: 'Microsoft Word', linux: ['libreoffice --writer'], words: ['word', 'microsoft word'] },
  excel: { win: 'excel', mac: 'Microsoft Excel', linux: ['libreoffice --calc'], words: ['excel', 'microsoft excel'] },
  powerpoint: { win: 'powerpnt', mac: 'Microsoft PowerPoint', linux: ['libreoffice --impress'], words: ['powerpoint', 'sunum'] },
  outlook: { win: 'outlook', mac: 'Microsoft Outlook', words: ['outlook'] },
  teams: { win: 'msteams:', mac: 'Microsoft Teams', words: ['teams'] },
  steam: { win: 'steam:', mac: 'Steam', linux: ['steam'], words: ['steam'] },
  vlc: { win: 'vlc', mac: 'VLC', linux: ['vlc'], words: ['vlc'] },
  obs: { win: 'obs64', mac: 'OBS', linux: ['obs'], words: ['obs', 'obs studio'] },
  telegram: { win: 'tg:', mac: 'Telegram', linux: ['telegram-desktop'], words: ['telegram'] },
  slack: { win: 'slack:', mac: 'Slack', linux: ['slack'], words: ['slack'] },
  terminal: { win: 'wt', mac: 'Terminal', linux: ['gnome-terminal', 'konsole', 'x-terminal-emulator'], words: ['terminal', 'komut istemi', 'cmd', 'powershell'] },
  settings: { win: 'ms-settings:', mac: 'System Settings', linux: ['gnome-control-center'], words: ['ayarlar', 'settings', 'sistem ayarları'] },
  store: { win: 'ms-windows-store:', mac: 'App Store', linux: ['gnome-software'], words: ['mağaza', 'store', 'app store'] },
  camera: { win: 'microsoft.windows.camera:', mac: 'Photo Booth', linux: ['cheese'], words: ['kamera', 'camera'] },
  mail: { win: 'outlookmail:', mac: 'Mail', linux: ['thunderbird', 'evolution'], words: ['posta', 'mail', 'e-posta'] },
  photos: { win: 'ms-photos:', mac: 'Photos', linux: ['eog', 'shotwell'], words: ['fotoğraflar', 'photos'] },
  music: { win: 'mswindowsmusic:', mac: 'Music', linux: ['rhythmbox'], words: ['müzik', 'music', 'apple music'] }
};

function known(name) {
  const n = norm(name);
  return Object.values(KNOWN).find((k) => k.words.some((w) => norm(w) === n));
}

async function openWindows(name, ctx) {
  const k = known(name);
  if (k?.win) {
    if (k.win.endsWith(':')) {
      await ctx.electron.shell.openExternal(k.win);
      return k.win;
    }
    try {
      await ps(`Start-Process ${psStr(k.win)}`, { timeout: 10000 });
      return k.win;
    } catch { /* fall through to the Start menu search */ }
  }
  // Every app in the Start menu (Win32 and Store apps alike) has an AppID we can launch.
  const app = await psJson(
    `Get-StartApps | Where-Object { $_.Name -like ${psStr('*' + name + '*')} } | Sort-Object { $_.Name.Length } | Select-Object -First 1 Name, AppID`
  );
  if (app?.AppID) {
    await launch('explorer.exe', [`shell:AppsFolder\\${app.AppID}`]);
    return app.Name;
  }
  try {
    await ps(`Start-Process ${psStr(name)}`, { timeout: 10000 });
    return name;
  } catch {
    throw new ToolError(`“${name}” adında bir uygulama bulunamadı.`);
  }
}

async function openMac(name) {
  const target = known(name)?.mac || name;
  try {
    await run('open', ['-a', target]);
    return target;
  } catch {
    const found = (await run('mdfind', [`kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '*${name.replace(/'/g, '')}*'cd`]).catch(() => '')).split('\n').filter(Boolean)[0];
    if (!found) throw new ToolError(`“${name}” adında bir uygulama bulunamadı.`);
    await run('open', [found]);
    return path.basename(found, '.app');
  }
}

function desktopEntries() {
  const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(os.homedir(), '.local/share/applications'), '/var/lib/snapd/desktop/applications', '/var/lib/flatpak/exports/share/applications'];
  const out = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      try {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        const nameMatch = text.match(/^Name(?:\[tr\])?=(.+)$/m);
        if (nameMatch && !/^NoDisplay=true/m.test(text)) out.push({ id: f.replace(/\.desktop$/, ''), name: nameMatch[1].trim() });
      } catch { /* unreadable entry */ }
    }
  }
  return out;
}

async function openLinux(name) {
  const k = known(name);
  for (const cmd of k?.linux || []) {
    const [bin, ...args] = cmd.split(' ');
    if (await hasBin(bin)) { await launch(bin, args); return bin; }
  }
  const n = norm(name);
  const entry = desktopEntries().find((e) => norm(e.name).includes(n) || norm(e.id).includes(n));
  if (entry && await hasBin('gtk-launch')) { await launch('gtk-launch', [entry.id]); return entry.name; }
  if (await hasBin(name)) { await launch(name); return name; }
  throw new ToolError(`“${name}” adında bir uygulama bulunamadı.`);
}

async function processes() {
  if (isWin) {
    const list = await psJson('Get-Process | Select-Object Id, ProcessName, MainWindowTitle, @{n="Mem";e={$_.WorkingSet64}}, @{n="Cpu";e={[math]::Round($_.CPU,1)}}');
    return (Array.isArray(list) ? list : [list]).map((p) => ({ pid: p.Id, name: p.ProcessName, title: p.MainWindowTitle || '', mem: p.Mem, cpu: p.Cpu }));
  }
  const out = await run('ps', ['-axo', 'pid=,pcpu=,rss=,comm=']);
  return out.split('\n').filter(Boolean).map((line) => {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) return null;
    return { pid: Number(m[1]), cpu: Number(m[2]), mem: Number(m[3]) * 1024, name: path.basename(m[4]), title: '' };
  }).filter(Boolean);
}

const SETTINGS = {
  display: { win: 'display', mac: 'com.apple.Displays-Settings.extension', linux: 'display', words: ['ekran', 'display', 'görüntü'] },
  sound: { win: 'sound', mac: 'com.apple.Sound-Settings.extension', linux: 'sound', words: ['ses', 'sound'] },
  network: { win: 'network', mac: 'com.apple.Network-Settings.extension', linux: 'network', words: ['ağ', 'network', 'internet'] },
  wifi: { win: 'network-wifi', mac: 'com.apple.wifi-settings-extension', linux: 'wifi', words: ['wifi', 'wi-fi', 'kablosuz'] },
  bluetooth: { win: 'bluetooth', mac: 'com.apple.BluetoothSettings', linux: 'bluetooth', words: ['bluetooth'] },
  power: { win: 'powersleep', mac: 'com.apple.Battery-Settings.extension', linux: 'power', words: ['güç', 'pil', 'batarya', 'power', 'battery'] },
  privacy: { win: 'privacy', mac: 'com.apple.settings.PrivacySecurity.extension', linux: 'privacy', words: ['gizlilik', 'güvenlik', 'privacy'] },
  apps: { win: 'appsfeatures', mac: 'com.apple.LoginItems-Settings.extension', linux: 'applications', words: ['uygulamalar', 'apps'] },
  update: { win: 'windowsupdate', mac: 'com.apple.Software-Update-Settings.extension', linux: 'info-overview', words: ['güncelleme', 'update'] },
  notifications: { win: 'notifications', mac: 'com.apple.Notifications-Settings.extension', linux: 'notifications', words: ['bildirim', 'bildirimler', 'notifications'] },
  storage: { win: 'storagesense', mac: 'com.apple.settings.Storage', linux: 'info-overview', words: ['depolama', 'disk', 'storage'] },
  wallpaper: { win: 'personalization-background', mac: 'com.apple.Wallpaper-Settings.extension', linux: 'background', words: ['duvar kağıdı', 'arka plan', 'wallpaper', 'kişiselleştirme'] },
  keyboard: { win: 'keyboard', mac: 'com.apple.Keyboard-Settings.extension', linux: 'keyboard', words: ['klavye', 'keyboard'] },
  mouse: { win: 'mousetouchpad', mac: 'com.apple.Trackpad-Settings.extension', linux: 'mouse', words: ['fare', 'mouse', 'touchpad', 'trackpad'] },
  datetime: { win: 'dateandtime', mac: 'com.apple.Date-Time-Settings.extension', linux: 'datetime', words: ['tarih', 'saat', 'datetime'] },
  accounts: { win: 'yourinfo', mac: 'com.apple.Users-Groups-Settings.extension', linux: 'user-accounts', words: ['hesap', 'hesaplar', 'kullanıcı', 'accounts'] }
};

module.exports = [
  {
    name: 'open_app',
    category: 'apps',
    title: 'Uygulama aç',
    description: 'Bilgisayardaki bir uygulamayı adıyla başlatır (Chrome, Spotify, Word, Hesap Makinesi, Discord...).',
    params: { name: { type: 'string', description: 'Uygulamanın adı.', required: true } },
    run: async (a, ctx) => {
      const opened = isWin ? await openWindows(a.name, ctx) : isMac ? await openMac(a.name) : await openLinux(a.name);
      return { summary: `${a.name} açıldı.`, display: { type: 'app', name: a.name, detail: opened } };
    }
  },
  {
    name: 'close_app',
    category: 'apps',
    title: 'Uygulamayı kapat',
    description: 'Çalışan bir uygulamayı nazikçe kapatır (kaydedilmemiş iş varsa uygulama sorar).',
    params: { name: { type: 'string', description: 'Kapatılacak uygulamanın adı.', required: true } },
    run: async (a) => {
      if (isWin) {
        const n = await ps(
          `$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like ${psStr('*' + a.name + '*')} -or $_.MainWindowTitle -like ${psStr('*' + a.name + '*')}) };` +
          `$p | ForEach-Object { [void]$_.CloseMainWindow() }; ($p | Measure-Object).Count`
        );
        if (!Number(n.trim())) throw new ToolError(`“${a.name}” açık görünmüyor.`);
      } else if (isMac) {
        await osa(`tell application ${osaStr(known(a.name)?.mac || a.name)} to quit`);
      } else {
        await run('pkill', ['-i', a.name]).catch(() => { throw new ToolError(`“${a.name}” açık görünmüyor.`); });
      }
      return { summary: `${a.name} kapatıldı.`, display: { type: 'app', name: a.name, detail: 'Kapatıldı', state: 'closed' } };
    }
  },
  {
    name: 'list_running_apps',
    category: 'apps',
    title: 'Çalışan uygulamalar',
    description: 'Şu an çalışan uygulamaları en çok bellek kullananlardan başlayarak listeler.',
    params: { limit: { type: 'integer', description: 'Kaç uygulama listelensin. Varsayılan 12.' } },
    run: async (a) => {
      const all = await processes();
      const merged = new Map();
      for (const p of all) {
        const key = p.name.toLowerCase();
        const m = merged.get(key) || { name: p.name, mem: 0, cpu: 0, count: 0, title: '' };
        m.mem += p.mem || 0; m.cpu += p.cpu || 0; m.count++; m.title = m.title || p.title;
        merged.set(key, m);
      }
      const top = [...merged.values()].sort((x, y) => y.mem - x.mem).slice(0, a.limit || 12);
      return {
        summary: `En çok bellek kullanan: ${top.slice(0, 3).map((t) => t.name).join(', ')}.`,
        display: { type: 'list', items: top.map((t) => ({ title: t.name, subtitle: t.title || `${t.count} işlem`, meta: bytes(t.mem) })) },
        data: top.map((t) => ({ name: t.name, memory: bytes(t.mem), processes: t.count }))
      };
    }
  },
  {
    name: 'kill_process',
    category: 'apps',
    title: 'İşlemi sonlandır',
    description: 'Yanıt vermeyen bir işlemi PID ya da adıyla zorla sonlandırır. Kaydedilmemiş veriler kaybolabilir.',
    danger: true,
    params: {
      name: { type: 'string', description: 'İşlem adı (ör. chrome).' },
      pid: { type: 'integer', description: 'İşlem numarası.' }
    },
    run: async (a) => {
      if (a.pid) {
        try { process.kill(a.pid, 'SIGKILL'); } catch (e) { throw new ToolError(`PID ${a.pid} sonlandırılamadı: ${e.code}`); }
        return { summary: `PID ${a.pid} sonlandırıldı.` };
      }
      if (!a.name) throw new ToolError('Bir işlem adı ya da PID vermelisin.');
      if (isWin) await run('taskkill', ['/F', '/T', '/IM', a.name.endsWith('.exe') ? a.name : a.name + '.exe']);
      else await run('pkill', ['-9', '-i', a.name]);
      return { summary: `${a.name} sonlandırıldı.`, display: { type: 'app', name: a.name, detail: 'Zorla sonlandırıldı', state: 'closed' } };
    }
  },
  {
    name: 'open_system_settings',
    category: 'apps',
    title: 'Sistem ayarları',
    description: 'İşletim sisteminin ayarlar uygulamasını belirli bir bölümde açar.',
    params: {
      section: { type: 'string', enum: Object.keys(SETTINGS), description: 'Açılacak bölüm.' }
    },
    run: async (a, ctx) => {
      const key = SETTINGS[a.section] ? a.section : Object.keys(SETTINGS).find((k) => SETTINGS[k].words.some((w) => norm(w) === norm(a.section)));
      const s = SETTINGS[key];
      if (isWin) await ctx.electron.shell.openExternal(`ms-settings:${s?.win || ''}`);
      else if (isMac) await run('open', [s ? `x-apple.systempreferences:${s.mac}` : '-a', ...(s ? [] : ['System Settings'])]);
      else await launch('gnome-control-center', s ? [s.linux] : []);
      return { summary: `Ayarlar${key ? ` › ${key}` : ''} açıldı.`, display: { type: 'app', name: 'Sistem Ayarları', detail: key || 'Genel' } };
    }
  },
  {
    name: 'open_terminal',
    category: 'apps',
    title: 'Terminal aç',
    description: 'Belirtilen klasörde bir terminal penceresi açar.',
    params: { path: { type: 'string', description: 'Terminalin açılacağı klasör. Varsayılan ev klasörü.' } },
    run: async (a) => {
      const cwd = a.path ? resolvePath(a.path) : dirFor('home');
      if (!fs.existsSync(cwd)) throw new ToolError(`${cwd} bulunamadı.`);
      if (isWin) {
        try { await launch('wt.exe', ['-d', cwd]); } catch { await launch('cmd.exe', ['/c', 'start', 'powershell.exe'], { cwd }); }
      } else if (isMac) {
        await run('open', ['-a', 'Terminal', cwd]);
      } else {
        for (const [bin, args] of [['gnome-terminal', [`--working-directory=${cwd}`]], ['konsole', ['--workdir', cwd]], ['xfce4-terminal', [`--working-directory=${cwd}`]], ['x-terminal-emulator', []]]) {
          if (await hasBin(bin)) { await launch(bin, args, { cwd }); break; }
        }
      }
      return { summary: `Terminal ${cwd} konumunda açıldı.`, display: { type: 'app', name: 'Terminal', detail: cwd } };
    }
  },
  {
    name: 'open_task_manager',
    category: 'apps',
    title: 'Görev yöneticisi',
    description: 'Görev Yöneticisi / Etkinlik Monitörü\'nü açar.',
    params: {},
    run: async () => {
      if (isWin) await launch('taskmgr.exe');
      else if (isMac) await run('open', ['-a', 'Activity Monitor']);
      else {
        for (const bin of ['gnome-system-monitor', 'plasma-systemmonitor', 'ksysguard', 'xfce4-taskmanager']) {
          if (await hasBin(bin)) { await launch(bin); break; }
        }
      }
      return { summary: 'Görev yöneticisi açıldı.', display: { type: 'app', name: isMac ? 'Etkinlik Monitörü' : 'Görev Yöneticisi' } };
    }
  }
];
