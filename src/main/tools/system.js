'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isWin, isMac, isLinux, ToolError, run, ps, psJson, psStr, winNative, osa, osaStr, hasBin, linuxFirst,
  resolvePath, bytes, duration, fetchJson
} = require('./util');

/* ------------------------------------------------------------ sampling */

function cpuTimes() {
  return os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

async function cpuPercent(ms = 600) {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, ms));
  const b = cpuTimes();
  let idle = 0, total = 0;
  b.forEach((x, i) => { idle += x.idle - a[i].idle; total += x.total - a[i].total; });
  return total ? Math.round(100 * (1 - idle / total)) : 0;
}

function memory() {
  const total = os.totalmem();
  let free = os.freemem();
  if (isLinux) {
    // MemAvailable counts reclaimable cache, which matches what people expect "free" to mean.
    try {
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
      if (m) free = Number(m[1]) * 1024;
    } catch { /* fall back to os.freemem */ }
  }
  return { total, used: total - free, free, percent: Math.round(100 * (total - free) / total) };
}

async function battery() {
  if (isWin) {
    const b = await psJson('Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime');
    if (!b) return null;
    return { percent: b.EstimatedChargeRemaining, charging: [2, 6, 7, 8, 9].includes(b.BatteryStatus), minutesLeft: b.EstimatedRunTime > 0 && b.EstimatedRunTime < 71582 ? b.EstimatedRunTime : null };
  }
  if (isMac) {
    const out = await run('pmset', ['-g', 'batt']);
    const m = out.match(/(\d+)%;\s*([a-zA-Z ]+);\s*(\d+:\d+)?/);
    if (!m) return null;
    const [h, mm] = (m[3] || '').split(':').map(Number);
    return { percent: Number(m[1]), charging: /charg(ing|ed)|AC attached/i.test(m[2]) && !/discharging/i.test(m[2]), minutesLeft: m[3] ? h * 60 + mm : null };
  }
  const base = '/sys/class/power_supply';
  let dirs = [];
  try { dirs = fs.readdirSync(base).filter((d) => d.startsWith('BAT')); } catch { return null; }
  if (!dirs.length) return null;
  const read = (f) => { try { return fs.readFileSync(path.join(base, dirs[0], f), 'utf8').trim(); } catch { return null; } };
  return { percent: Number(read('capacity')), charging: read('status') !== 'Discharging', minutesLeft: null };
}

async function disks() {
  if (isWin) {
    const list = await psJson('Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | Select-Object Name, Used, Free');
    return (Array.isArray(list) ? list : [list]).filter(Boolean).map((d) => ({ name: `${d.Name}:`, used: d.Used, total: d.Used + d.Free }));
  }
  const out = await run('df', ['-kP']);
  return out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6)
    .map((c) => ({ name: c.slice(5).join(' '), total: Number(c[1]) * 1024, used: Number(c[2]) * 1024, fs: c[0] }))
    .filter((d) => d.total > 1e9 && (d.name === '/' || /^\/(home|Volumes|mnt|media|System\/Volumes\/Data)/.test(d.name)) && !/^(tmpfs|devfs|overlay)/.test(d.fs))
    .filter((d, i, arr) => arr.findIndex((x) => x.total === d.total && x.used === d.used) === i);
}

/* ------------------------------------------------------------- volume */

async function getVolume() {
  if (isWin) {
    const [v, m] = (await winNative('"$([Vektor.Audio]::GetVolume()),$([Vektor.Audio]::GetMute())"')).trim().split(',');
    return { level: Number(v), muted: m === 'True' };
  }
  if (isMac) {
    const out = await osa('set s to get volume settings\nreturn (output volume of s as text) & "," & (output muted of s as text)');
    const [v, m] = out.trim().split(',');
    return { level: Number(v), muted: m === 'true' };
  }
  if (await hasBin('pactl')) {
    const v = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    const m = await run('pactl', ['get-sink-mute', '@DEFAULT_SINK@']);
    return { level: Number((v.match(/(\d+)%/) || [])[1] || 0), muted: /yes/.test(m) };
  }
  const out = await linuxFirst([['amixer', ['get', 'Master']]]);
  return { level: Number((out.match(/\[(\d+)%\]/) || [])[1] || 0), muted: /\[off\]/.test(out) };
}

async function setVolume(level) {
  level = Math.max(0, Math.min(100, Math.round(level)));
  if (isWin) await winNative(`[Vektor.Audio]::SetVolume(${level}); if (${level} -gt 0) { [Vektor.Audio]::SetMute($false) }`);
  else if (isMac) await osa(`set volume output volume ${level}${level > 0 ? '\nset volume without output muted' : ''}`);
  else await linuxFirst([['pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${level}%`]], ['amixer', ['-q', 'sset', 'Master', `${level}%`, 'unmute']]]);
  return level;
}

async function setMute(muted) {
  if (isWin) await winNative(`[Vektor.Audio]::SetMute($${muted})`);
  else if (isMac) await osa(`set volume ${muted ? 'with' : 'without'} output muted`);
  else await linuxFirst([['pactl', ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']], ['amixer', ['-q', 'sset', 'Master', muted ? 'mute' : 'unmute']]]);
}

/* -------------------------------------------------------------- power */

const POWER = {
  shutdown: { label: 'Kapatma', win: ['shutdown', ['/s', '/t', '0']], mac: 'tell application "System Events" to shut down', linux: ['systemctl', ['poweroff']] },
  restart: { label: 'Yeniden başlatma', win: ['shutdown', ['/r', '/t', '0']], mac: 'tell application "System Events" to restart', linux: ['systemctl', ['reboot']] },
  sleep: { label: 'Uyku', win: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']], mac: null, linux: ['systemctl', ['suspend']] }
};

let pendingPower = null;

async function doPower(kind) {
  const p = POWER[kind];
  if (isWin) return run(...p.win);
  if (isMac) return kind === 'sleep' ? run('pmset', ['sleepnow']) : osa(p.mac);
  return run(...p.linux);
}

function schedulePower(kind, minutes, ctx) {
  if (pendingPower) clearTimeout(pendingPower.timer);
  if (!minutes || minutes <= 0) {
    pendingPower = null;
    // Give the assistant a moment to finish its sentence before the machine goes away.
    setTimeout(() => doPower(kind).catch((e) => ctx.log?.('power', e.message)), 2500);
    return { summary: `${POWER[kind].label} birkaç saniye içinde başlıyor.`, display: { type: 'power', action: kind, label: POWER[kind].label } };
  }
  const at = Date.now() + minutes * 60000;
  pendingPower = { kind, at, timer: setTimeout(() => { pendingPower = null; doPower(kind).catch(() => {}); }, minutes * 60000) };
  ctx.emit?.('timer', { id: 'power', label: POWER[kind].label, endsAt: at, kind: 'power' });
  return {
    summary: `${POWER[kind].label} ${minutes} dakika sonra (${new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}).`,
    display: { type: 'timer', id: 'power', label: POWER[kind].label, endsAt: at, total: minutes * 60000 }
  };
}

const powerParams = { delay_minutes: { type: 'number', description: 'Kaç dakika sonra. 0 ya da boş = hemen.' } };

/* ---------------------------------------------------------------- tools */

module.exports = [
  {
    name: 'system_overview',
    category: 'system',
    title: 'Sistem özeti',
    description: 'İşletim sistemi, işlemci, bellek, açık kalma süresi ve kullanıcı bilgisini gösterir.',
    params: {},
    run: async () => {
      const cpus = os.cpus();
      const mem = memory();
      const rows = [
        ['Bilgisayar', os.hostname()],
        ['Sistem', `${isWin ? 'Windows' : isMac ? 'macOS' : 'Linux'} ${os.release()} (${os.arch()})`],
        ['İşlemci', `${cpus[0]?.model?.trim() || '—'} · ${cpus.length} çekirdek`],
        ['Bellek', `${bytes(mem.used)} / ${bytes(mem.total)}`],
        ['Açık kalma', duration(os.uptime())],
        ['Kullanıcı', os.userInfo().username]
      ];
      return { summary: rows.map((r) => `${r[0]}: ${r[1]}`).join('; '), display: { type: 'kv', title: 'Sistem', rows }, data: Object.fromEntries(rows) };
    }
  },
  {
    name: 'cpu_usage',
    category: 'system',
    title: 'İşlemci kullanımı',
    description: 'Anlık işlemci kullanımını ve yükü ölçer.',
    params: {},
    run: async () => {
      const pct = await cpuPercent();
      const cpus = os.cpus();
      return {
        summary: `İşlemci kullanımı %${pct}.`,
        display: { type: 'stats', items: [{ label: 'İşlemci', value: pct, unit: '%', detail: `${cpus.length} çekirdek · ${(cpus[0]?.speed / 1000).toFixed(1)} GHz` }] },
        data: { percent: pct, cores: cpus.length }
      };
    }
  },
  {
    name: 'memory_usage',
    category: 'system',
    title: 'Bellek kullanımı',
    description: 'RAM kullanımını gösterir.',
    params: {},
    run: async () => {
      const m = memory();
      return {
        summary: `Bellek %${m.percent} dolu: ${bytes(m.used)} / ${bytes(m.total)}.`,
        display: { type: 'stats', items: [{ label: 'Bellek', value: m.percent, unit: '%', detail: `${bytes(m.used)} / ${bytes(m.total)}` }] },
        data: { percent: m.percent, used: bytes(m.used), total: bytes(m.total) }
      };
    }
  },
  {
    name: 'battery_status',
    category: 'system',
    title: 'Pil durumu',
    description: 'Pil yüzdesini, şarj durumunu ve kalan süreyi gösterir.',
    params: {},
    run: async () => {
      const b = await battery();
      if (!b) return { summary: 'Bu bilgisayarda pil bulunamadı; prize bağlı bir masaüstü olabilir.', display: { type: 'kv', rows: [['Pil', 'Yok']] } };
      const left = b.minutesLeft ? duration(b.minutesLeft * 60) : null;
      return {
        summary: `Pil %${b.percent}${b.charging ? ', şarj oluyor' : ''}${left ? `, yaklaşık ${left} kaldı` : ''}.`,
        display: { type: 'stats', items: [{ label: 'Pil', value: b.percent, unit: '%', detail: b.charging ? 'Şarj oluyor' : left ? `${left} kaldı` : 'Pilde', tone: b.percent < 20 && !b.charging ? 'danger' : 'success' }] },
        data: b
      };
    }
  },
  {
    name: 'disk_space',
    category: 'system',
    title: 'Disk alanı',
    description: 'Disklerin dolu ve boş alanını gösterir.',
    params: {},
    run: async () => {
      const list = await disks();
      return {
        summary: list.map((d) => `${d.name} ${bytes(d.total - d.used)} boş`).join(', '),
        display: { type: 'stats', items: list.map((d) => ({ label: d.name, value: Math.round(100 * d.used / d.total), unit: '%', detail: `${bytes(d.total - d.used)} boş / ${bytes(d.total)}`, tone: d.used / d.total > 0.9 ? 'danger' : undefined })) },
        data: list.map((d) => ({ disk: d.name, free: bytes(d.total - d.used), total: bytes(d.total) }))
      };
    }
  },
  {
    name: 'network_info',
    category: 'system',
    title: 'Ağ bilgisi',
    description: 'Yerel IP adreslerini ve ağ bağdaştırıcılarını listeler.',
    params: {},
    run: async () => {
      const items = [];
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
          if (a.internal || a.family !== 'IPv4') continue;
          items.push({ title: a.address, subtitle: name, meta: a.mac, icon: 'wifi' });
        }
      }
      return { summary: items.length ? `Yerel IP: ${items.map((i) => i.title).join(', ')}.` : 'Bağlı bir ağ bulunamadı.', display: { type: 'list', items }, data: items.map((i) => ({ ip: i.title, adapter: i.subtitle })) };
    }
  },
  {
    name: 'public_ip',
    category: 'system',
    title: 'Genel IP ve konum',
    description: 'İnternete çıkan genel IP adresini ve yaklaşık konumu (şehir, ülke, servis sağlayıcı) gösterir.',
    params: {},
    run: async () => {
      const d = await fetchJson('https://ipwho.is/?lang=tr');
      if (d.success === false) throw new ToolError(d.message || 'IP bilgisi alınamadı.');
      const rows = [['IP', d.ip], ['Konum', [d.city, d.region, d.country].filter(Boolean).join(', ')], ['Sağlayıcı', d.connection?.isp || '—'], ['Saat dilimi', d.timezone?.id || '—']];
      return { summary: `Genel IP ${d.ip}, ${d.city}, ${d.country}.`, display: { type: 'kv', rows }, data: Object.fromEntries(rows) };
    }
  },
  {
    name: 'list_displays',
    category: 'system',
    title: 'Ekranlar',
    description: 'Bağlı monitörleri, çözünürlüklerini ve ölçeklemeyi listeler.',
    params: {},
    run: async (a, ctx) => {
      const { screen } = ctx.electron;
      const primary = screen.getPrimaryDisplay().id;
      const items = screen.getAllDisplays().map((d, i) => ({
        title: `Ekran ${i + 1}${d.id === primary ? ' (birincil)' : ''}`,
        subtitle: `${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)} · %${Math.round(d.scaleFactor * 100)} ölçek`,
        meta: d.displayFrequency ? `${Math.round(d.displayFrequency)} Hz` : '',
        icon: 'display'
      }));
      return { summary: `${items.length} ekran bağlı.`, display: { type: 'list', items }, data: items };
    }
  },
  {
    name: 'current_datetime',
    category: 'system',
    title: 'Tarih ve saat',
    description: 'Şu anki tarih, saat, gün ve saat dilimini verir.',
    params: {},
    run: async () => {
      const now = new Date();
      const date = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { summary: `${date}, saat ${time} (${tz}).`, display: { type: 'value', value: time, label: date, detail: tz }, data: { iso: now.toISOString(), date, time, tz } };
    }
  },

  /* ---------------------------------------------------- system control */
  {
    name: 'get_volume',
    category: 'control',
    title: 'Ses düzeyi',
    description: 'Sistem ses düzeyini ve sessiz durumunu okur.',
    params: {},
    run: async () => {
      const v = await getVolume();
      return { summary: `Ses %${v.level}${v.muted ? ' (sessiz)' : ''}.`, display: { type: 'level', label: 'Ses', value: v.level, muted: v.muted, icon: 'volume' }, data: v };
    }
  },
  {
    name: 'set_volume',
    category: 'control',
    title: 'Sesi ayarla',
    description: 'Sistem ses düzeyini ayarlar. Ya mutlak düzey (0–100) ya da göreli değişim (ör. +10, -20) ver.',
    params: {
      level: { type: 'integer', description: 'Hedef ses düzeyi 0–100.' },
      change: { type: 'integer', description: 'Göreli değişim, ör. 10 ya da -10.' }
    },
    run: async (a) => {
      let target = a.level;
      if (target == null) {
        if (a.change == null) throw new ToolError('Bir düzey ya da değişim belirtmelisin.');
        target = (await getVolume()).level + a.change;
      }
      const level = await setVolume(target);
      return { summary: `Ses %${level} yapıldı.`, display: { type: 'level', label: 'Ses', value: level, icon: 'volume' }, data: { level } };
    }
  },
  {
    name: 'set_mute',
    category: 'control',
    title: 'Sessize al',
    description: 'Sistem sesini kapatır ya da açar.',
    params: { muted: { type: 'boolean', description: 'true = sessiz, false = sesi aç.', required: true } },
    run: async (a) => {
      await setMute(!!a.muted);
      return { summary: a.muted ? 'Ses kapatıldı.' : 'Ses açıldı.', display: { type: 'level', label: 'Ses', value: a.muted ? 0 : (await getVolume().catch(() => ({ level: 50 }))).level, muted: !!a.muted, icon: 'volume' } };
    }
  },
  {
    name: 'set_brightness',
    category: 'control',
    title: 'Parlaklık',
    description: 'Ekran parlaklığını 0–100 arası ayarlar (dizüstü ekranlarda çalışır).',
    params: { level: { type: 'integer', description: 'Parlaklık 0–100.', required: true } },
    run: async (a) => {
      const level = Math.max(5, Math.min(100, Math.round(a.level)));
      if (isWin) {
        await ps(`(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${level}} | Out-Null`)
          .catch(() => { throw new ToolError('Bu ekranın parlaklığı yazılımla değiştirilemiyor (harici monitörler genelde desteklemez).'); });
      } else if (isMac) {
        if (!(await hasBin('brightness'))) throw new ToolError('macOS\'ta parlaklık için "brightness" aracı gerekli.', 'brew install brightness');
        await run('brightness', [String(level / 100)]);
      } else {
        await linuxFirst([['brightnessctl', ['set', `${level}%`]], ['light', ['-S', String(level)]]]);
      }
      return { summary: `Parlaklık %${level}.`, display: { type: 'level', label: 'Parlaklık', value: level, icon: 'sun' }, data: { level } };
    }
  },
  {
    name: 'lock_screen',
    category: 'control',
    title: 'Ekranı kilitle',
    description: 'Bilgisayarı kilitler.',
    params: {},
    run: async () => {
      setTimeout(() => {
        const p = isWin ? run('rundll32.exe', ['user32.dll,LockWorkStation'])
          : isMac ? osa('tell application "System Events" to keystroke "q" using {control down, command down}')
            : linuxFirst([['loginctl', ['lock-session']], ['xdg-screensaver', ['lock']], ['gnome-screensaver-command', ['-l']]]);
        p.catch(() => {});
      }, 1500);
      return { summary: 'Ekran kilitleniyor.', display: { type: 'power', action: 'lock', label: 'Kilit' } };
    }
  },
  {
    name: 'sleep_computer',
    category: 'control',
    title: 'Uyku moduna al',
    description: 'Bilgisayarı uyku moduna alır; isteğe bağlı olarak birkaç dakika sonra.',
    danger: true,
    params: powerParams,
    run: (a, ctx) => schedulePower('sleep', a.delay_minutes, ctx)
  },
  {
    name: 'shutdown_computer',
    category: 'control',
    title: 'Bilgisayarı kapat',
    description: 'Bilgisayarı kapatır; isteğe bağlı olarak belirli dakika sonra (zamanlayıcı cancel_shutdown ile iptal edilebilir).',
    danger: true,
    params: powerParams,
    run: (a, ctx) => schedulePower('shutdown', a.delay_minutes, ctx)
  },
  {
    name: 'restart_computer',
    category: 'control',
    title: 'Yeniden başlat',
    description: 'Bilgisayarı yeniden başlatır; isteğe bağlı olarak belirli dakika sonra.',
    danger: true,
    params: powerParams,
    run: (a, ctx) => schedulePower('restart', a.delay_minutes, ctx)
  },
  {
    name: 'cancel_shutdown',
    category: 'control',
    title: 'Kapatmayı iptal et',
    description: 'Zamanlanmış kapatma, yeniden başlatma ya da uykuyu iptal eder.',
    params: {},
    run: async (a, ctx) => {
      const had = pendingPower;
      if (pendingPower) { clearTimeout(pendingPower.timer); pendingPower = null; }
      if (isWin) await run('shutdown', ['/a']).catch(() => {});
      ctx.emit?.('timer-cancel', { id: 'power' });
      return { summary: had ? `${POWER[had.kind].label} iptal edildi.` : 'Zamanlanmış bir güç işlemi yoktu.', display: { type: 'power', action: 'cancel', label: 'İptal edildi' } };
    }
  },
  {
    name: 'empty_trash',
    category: 'control',
    title: 'Çöpü boşalt',
    description: 'Geri dönüşüm kutusunu / çöp kutusunu kalıcı olarak boşaltır.',
    danger: true,
    params: {},
    run: async () => {
      if (isWin) await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
      else if (isMac) await osa('tell application "Finder" to empty trash');
      else await linuxFirst([['gio', ['trash', '--empty']], ['trash-empty', []]]);
      return { summary: 'Çöp kutusu boşaltıldı.', display: { type: 'power', action: 'trash', label: 'Çöp boşaltıldı' } };
    }
  },
  {
    name: 'set_dark_mode',
    category: 'control',
    title: 'Karanlık mod',
    description: 'İşletim sisteminin karanlık / aydınlık temasını değiştirir.',
    params: { enabled: { type: 'boolean', description: 'true = karanlık, false = aydınlık.', required: true } },
    run: async (a, ctx) => {
      const dark = !!a.enabled;
      if (isWin) {
        const v = dark ? 0 : 1;
        const key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
        await ps(`Set-ItemProperty -Path ${psStr(key)} -Name AppsUseLightTheme -Value ${v} -Type Dword; Set-ItemProperty -Path ${psStr(key)} -Name SystemUsesLightTheme -Value ${v} -Type Dword`);
      } else if (isMac) {
        await osa(`tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`);
      } else {
        await run('gsettings', ['set', 'org.gnome.desktop.interface', 'color-scheme', dark ? 'prefer-dark' : 'default']);
        await run('gsettings', ['set', 'org.gnome.desktop.interface', 'gtk-theme', dark ? 'Adwaita-dark' : 'Adwaita']).catch(() => {});
      }
      ctx.electron.nativeTheme.themeSource = 'system';
      return { summary: dark ? 'Karanlık mod açıldı.' : 'Aydınlık mod açıldı.', display: { type: 'power', action: dark ? 'dark' : 'light', label: dark ? 'Karanlık mod' : 'Aydınlık mod' } };
    }
  },
  {
    name: 'set_wallpaper',
    category: 'control',
    title: 'Duvar kağıdı',
    description: 'Masaüstü duvar kağıdını bir resim dosyasıyla değiştirir.',
    params: { path: { type: 'string', description: 'Resim dosyasının yolu.', required: true } },
    run: async (a) => {
      const p = resolvePath(a.path);
      if (!fs.existsSync(p)) throw new ToolError(`${p} bulunamadı.`);
      if (isWin) {
        const ok = (await winNative(`[Vektor.Windows]::SetWallpaper(${psStr(p)})`)).trim();
        if (ok !== 'True') throw new ToolError('Duvar kağıdı değiştirilemedi.');
      } else if (isMac) {
        await osa(`tell application "System Events" to tell every desktop to set picture to ${osaStr(p)}`);
      } else {
        const uri = 'file://' + p;
        await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', uri]);
        await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri]).catch(() => {});
      }
      return { summary: 'Duvar kağıdı değiştirildi.', display: { type: 'file', path: p, name: path.basename(p), meta: 'Duvar kağıdı', icon: 'photo', preview: p } };
    }
  }
];

module.exports.memory = memory;
module.exports.cpuPercent = cpuPercent;
