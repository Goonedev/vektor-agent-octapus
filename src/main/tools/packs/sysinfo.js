'use strict';

/*
 * System information pack: installed software, hardware, devices, network, power plans,
 * winget and cleanup helpers. Windows goes through PowerShell; macOS/Linux get the easy equivalents.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { norm, hasBin, linuxFirst, dirFor, bytes, duration } = require('../util');
const {
  isWin, isMac, isLinux, ToolError, ps, psJson, psStr, run, unsupported, truncate,
  valueResult, kvResult, listResult, asArray
} = require('./kit');

/* ------------------------------------------------------------ helpers */

const matches = (filter, ...fields) => !filter || fields.some((f) => norm(f).includes(norm(filter)));
const winList = async (feature, script, opts) => {
  if (!isWin) throw unsupported(feature);
  return asArray(await psJson(script, opts));
};
const clampInt = (v, def, min, max) => Math.max(min, Math.min(max, Number.isFinite(v) ? Math.round(v) : def));
const C_ENV = { LC_ALL: 'C', LANG: 'C' };

/** Rejects names that would be read as command-line options. */
function safeName(s, label = 'Ad') {
  const v = String(s ?? '').trim();
  if (!v) throw new ToolError(`${label} boş olamaz.`);
  if (v.startsWith('-')) throw new ToolError(`${label} "-" ile başlayamaz.`);
  return v;
}

/* ------------------------------------------------------------ parsers */

/** Parses winget's fixed-width tables (search, upgrade). Column names are localized, so rows are positional. */
function parseWingetTable(text) {
  const lines = String(text ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n')
    .map((l) => l.replace(/\r$/, '').split('\r').pop().replace(/\s+$/, ''));
  const dash = lines.findIndex((l) => /^-{5,}$/.test(l.trim()));
  if (dash < 1) return [];
  const header = lines[dash - 1];
  const cols = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(header))) cols.push(m.index);
  if (cols.length < 2) return [];
  const rows = [];
  for (const l of lines.slice(dash + 1)) {
    if (!l.trim()) break;
    const v = cols.map((start, i) => l.slice(start, cols[i + 1]).trim());
    if (!v[0] || !/^\S+$/.test(v[1] || '')) continue;
    rows.push({ name: v[0], id: v[1], version: v[2] || '', extra: v.slice(3, -1), source: cols.length > 3 ? v[v.length - 1] : '' });
  }
  return rows;
}

/** `netsh wlan show networks mode=bssid` (English or Turkish) → [{ ssid, signal, auth, channel, bssids }]. */
function parseNetshNetworks(text) {
  const nets = [];
  let cur = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    let m = line.match(/^SSID\s+\d+\s*:\s*(.*)$/i);
    if (m) {
      cur = { ssid: m[1].trim() || '(gizli ağ)', signal: null, auth: '', channel: null, bssids: 0 };
      nets.push(cur);
      continue;
    }
    if (!cur || !(m = line.match(/^([^:]+?)\s*:\s*(.*)$/))) continue;
    const key = norm(m[1]), val = m[2].trim();
    if (/^bssid/.test(key)) cur.bssids++;
    else if (/^(signal|sinyal)/.test(key)) {
      const n = parseInt(val.replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && (cur.signal == null || n > cur.signal)) cur.signal = n;
    } else if (/^(authentication|kimlik)/.test(key)) cur.auth = val;
    else if (/^(channel|kanal)/.test(key) && cur.channel == null) cur.channel = val;
  }
  return nets.sort((a, b) => (b.signal ?? -1) - (a.signal ?? -1));
}

/** `netsh wlan show profiles` → profile names. */
function parseNetshProfiles(text) {
  const out = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    const m = l.match(/^\s+[^:]*profil[^:]*:\s*(.+?)\s*$/i);
    if (m && !/^<.*>$/.test(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** "Key : value" lines → [[key, value]] (first block only, used for `netsh wlan show interfaces`). */
function parseColonPairs(text) {
  const out = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    const m = l.match(/^\s+([^:]+?)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    if (out.some(([k]) => k === m[1])) break;
    out.push([m[1], m[2]]);
  }
  return out;
}

/** Picks the Wi-Fi fields out of `netsh wlan show interfaces`. */
function parseWlanInterface(text) {
  const pairs = parseColonPairs(text);
  const get = (re) => (pairs.find(([k]) => re.test(norm(k))) || [])[1] || '';
  const signal = parseInt(get(/^(signal|sinyal)/).replace(/\D/g, ''), 10);
  return {
    name: get(/^(name|ad)$/),
    state: get(/^(state|durum)$/),
    ssid: get(/^ssid$/),
    bssid: get(/^(ap )?bssid$/),
    signal: Number.isFinite(signal) ? signal : null,
    receive: get(/^(receive|alma)/),
    transmit: get(/^(transmit|iletim|gonderme)/),
    radio: get(/^(radio|radyo)/),
    channel: get(/^(channel|kanal)/),
    auth: get(/^(authentication|kimlik)/)
  };
}

/** `powercfg /list` → [{ guid, name, active }]. */
function parsePowerSchemes(text) {
  const out = [];
  const re = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(([^)]*)\)\s*(\*)?/gi;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push({ guid: m[1].toLowerCase(), name: m[2].trim(), active: !!m[3] });
  return out;
}

/** `ps -A -o pid=,pcpu=,rss=,comm=` → [{ pid, cpu, mem, name }]. */
function parsePs(text) {
  return String(text ?? '').split('\n').map((l) => l.trim().match(/^(\d+)\s+([\d.,]+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), cpu: parseFloat(m[2].replace(',', '.')), mem: Number(m[3]) * 1024, name: path.basename(m[4].trim()) }));
}

/** Folds processes with the same name (chrome ×24) into one row. */
function groupProcs(list) {
  const map = new Map();
  for (const p of list) {
    const key = String(p.name || '?').replace(/\.exe$/i, '');
    const g = map.get(key) || { name: key, cpu: 0, mem: 0, count: 0 };
    g.cpu += Number(p.cpu) || 0;
    g.mem += Number(p.mem) || 0;
    g.count++;
    map.set(key, g);
  }
  return [...map.values()].map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10 }));
}

/** `ss -ltnpH` → [{ address, port, process, pid }]. */
function parseSs(text) {
  const out = [];
  for (const l of String(text ?? '').split('\n')) {
    const c = l.trim().split(/\s+/);
    if (c.length < 5 || !/^\d+$/.test(c[1])) continue;
    const local = c[3], i = local.lastIndexOf(':');
    const pm = l.match(/\(\("([^"]+)",pid=(\d+)/);
    out.push({ address: local.slice(0, i).replace(/%.*$/, ''), port: Number(local.slice(i + 1)), process: pm ? pm[1] : '', pid: pm ? Number(pm[2]) : null });
  }
  return out;
}

/** `lpstat -p -d` (LC_ALL=C) → { printers: [{ name, status }], default }. */
function parseLpstat(text) {
  const printers = [];
  let def = null;
  for (const l of String(text ?? '').split('\n')) {
    let m = l.match(/^printer\s+(\S+)\s+(.*)$/);
    if (m) printers.push({ name: m[1], status: /disabled/.test(m[2]) ? 'Devre dışı' : /printing|now printing/.test(m[2]) ? 'Yazdırıyor' : 'Hazır' });
    else if ((m = l.match(/default destination:\s*(\S+)/))) def = m[1];
  }
  return { printers, default: def };
}

/** /etc/os-release → object. */
function parseOsRelease(text) {
  const out = {};
  for (const l of String(text ?? '').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** nmcli -t rows: ":" separates fields, "\:" is a literal colon. */
const splitNmcli = (line) => line.split(/(?<!\\):/).map((s) => s.replace(/\\:/g, ':'));

/* --------------------------------------------------------------- winget */

/** Runs winget without a shell; unlike util.run it keeps stdout on non-zero exit (winget reports there). */
function winget(args, timeout = 120000) {
  if (!isWin) return Promise.reject(unsupported('winget'));
  return new Promise((resolve, reject) => {
    execFile('winget', args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        return reject(new ToolError('winget bu bilgisayarda bulunamadı.', 'Microsoft Store\'dan "Uygulama Yükleyici" (App Installer) kurulunca winget gelir.'));
      }
      if (err && err.killed) return reject(new ToolError('winget zaman aşımına uğradı.'));
      resolve({ code: err ? err.code : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}

/** Last meaningful lines of winget output, without spinners and progress bars. */
function wingetTail(text, n = 8) {
  return String(text ?? '').split('\n').map((l) => l.replace(/\r$/, '').split('\r').pop().trim())
    .filter((l) => l && !/^[-\\|/]$/.test(l) && !/[█▒]/.test(l)).slice(-n).join('\n');
}

const WINGET_ACCEPT = ['--accept-source-agreements'];

/* ------------------------------------------------------------ temp walk */

const TEMP_KEEP = new Set(['vektor-native']);

/** Walks os.tmpdir() without following links. onFile(full, stat) may be async. */
async function walkTemp(root, onFile, { maxEntries = 60000, onDir } = {}) {
  const stack = [root];
  let seen = 0, truncated = false;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > maxEntries) { truncated = true; return { truncated }; }
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (dir === root && TEMP_KEEP.has(e.name)) continue;
        stack.push(full);
        await onDir?.(full);
      } else if (e.isFile()) {
        let st;
        try { st = await fsp.lstat(full); } catch { continue; }
        await onFile(full, st);
      }
    }
  }
  return { truncated };
}

/* --------------------------------------------------------- small tables */

const FIREWALL_NAMES = { Domain: 'Etki alanı', Private: 'Özel', Public: 'Ortak' };
const FIREWALL_ACTION = { Block: 'Engelle', Allow: 'İzin ver' };
// NotConfigured falls back to Windows defaults: block inbound, allow outbound.
const fwAction = (v, inbound) => FIREWALL_ACTION[v] || (v === 'NotConfigured' ? `Varsayılan (${inbound ? 'engelle' : 'izin ver'})` : v || '—');
const HEALTH = { Healthy: 'Sağlıklı', Warning: 'Uyarı', Unhealthy: 'Sağlıksız', Unknown: 'Bilinmiyor' };
const MEMORY_TYPE = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5' };
const SERVICE_STATE = { Running: 'Çalışıyor', Stopped: 'Durdu', Paused: 'Duraklatıldı', StartPending: 'Başlıyor', StopPending: 'Duruyor' };
const START_TYPE = { Automatic: 'Otomatik', Manual: 'El ile', Disabled: 'Devre dışı', Boot: 'Önyükleme', System: 'Sistem' };

const POWER_PLANS = {
  'dengeli': { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', linux: 'balanced', label: 'Dengeli' },
  'yüksek performans': { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', linux: 'performance', label: 'Yüksek performans' },
  'güç tasarrufu': { guid: 'a1841308-3541-4fab-bc81-f71556f20b4a', linux: 'power-saver', label: 'Güç tasarrufu' }
};

const SECRET_ENV = /(key|token|secret|pass|pwd|auth|cred|cookie|session|private)/i;

/* ---------------------------------------------------------------- tools */

const tools = [
  {
    name: 'sys_installed_programs',
    category: 'system',
    title: 'Kurulu programlar',
    description: 'Bilgisayarda kurulu programları sürümleriyle listeler. Belirli bir programın kurulu olup olmadığını öğrenmek için filtre ver.',
    params: { filter: { type: 'string', description: 'Program adında aranacak ifade, ör. "chrome" (isteğe bağlı).' } },
    timeout: 60000,
    run: async (a) => {
      let list;
      if (isWin) {
        list = asArray(await psJson(
          "$p='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';" +
          'Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | ' +
          'Select-Object DisplayName, DisplayVersion, Publisher, InstallDate, EstimatedSize | Sort-Object DisplayName -Unique', { timeout: 45000 }
        )).map((p) => ({ name: p.DisplayName, version: p.DisplayVersion || '', publisher: p.Publisher || '', size: p.EstimatedSize ? p.EstimatedSize * 1024 : null }));
      } else if (isMac) {
        const names = [];
        for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
          try { for (const n of await fsp.readdir(dir)) if (n.endsWith('.app')) names.push(n.slice(0, -4)); } catch { /* missing */ }
        }
        list = names.sort((x, y) => x.localeCompare(y, 'tr')).map((n) => ({ name: n, version: '', publisher: '' }));
      } else {
        const out = await hasBin('dpkg-query')
          ? await run('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\n'], { timeout: 30000 })
          : await linuxFirst([['rpm', ['-qa', '--qf', '%{NAME}\t%{VERSION}\n']], ['pacman', ['-Q']]]);
        list = out.split('\n').filter(Boolean).map((l) => { const [n, v] = l.split(/\t| /); return { name: n, version: v || '', publisher: '' }; });
      }
      const hits = list.filter((p) => matches(a.filter, p.name, p.publisher));
      if (!hits.length) return { summary: a.filter ? `"${a.filter}" ile eşleşen kurulu program bulunamadı.` : 'Kurulu program bulunamadı.', data: { count: 0 } };
      return listResult(
        a.filter ? `"${a.filter}" için ${hits.length} kurulu program bulundu: ${hits.slice(0, 5).map((p) => p.name).join(', ')}.` : `${hits.length} kurulu program var.`,
        `Kurulu programlar (${hits.length})`,
        hits.slice(0, 80).map((p) => ({ title: p.name, subtitle: [p.version && `Sürüm ${p.version}`, p.publisher].filter(Boolean).join(' · '), meta: p.size ? bytes(p.size) : '', icon: 'cube' })),
        { count: hits.length, programs: hits.slice(0, 60).map((p) => `${p.name}${p.version ? ` ${p.version}` : ''}`) }
      );
    }
  },
  {
    name: 'sys_startup_programs',
    category: 'system',
    title: 'Başlangıç programları',
    description: 'Bilgisayar açılırken otomatik başlayan programları listeler.',
    params: {},
    run: async () => {
      let items;
      if (isWin) {
        items = (await winList('Başlangıç programları', 'Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User'))
          .map((s) => ({ title: s.Name, subtitle: truncate(s.Command || '', 120), meta: /HKLM|Common/i.test(s.Location || '') ? 'Tüm kullanıcılar' : 'Bu kullanıcı', icon: 'bolt' }));
      } else if (isLinux) {
        items = [];
        for (const dir of [path.join(os.homedir(), '.config', 'autostart'), '/etc/xdg/autostart']) {
          let names = [];
          try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.desktop')); } catch { continue; }
          for (const n of names) {
            const t = await fsp.readFile(path.join(dir, n), 'utf8').catch(() => '');
            if (/^Hidden=true/m.test(t)) continue;
            items.push({ title: (t.match(/^Name=(.*)$/m) || [])[1] || n, subtitle: truncate((t.match(/^Exec=(.*)$/m) || [])[1] || '', 120), meta: dir.startsWith('/etc') ? 'Sistem' : 'Kullanıcı', icon: 'bolt' });
          }
        }
      } else throw unsupported('Başlangıç programları listesi');
      return listResult(items.length ? `${items.length} başlangıç programı var: ${items.slice(0, 6).map((i) => i.title).join(', ')}.` : 'Başlangıçta açılan program bulunamadı.', 'Başlangıç programları', items, items.map((i) => i.title));
    }
  },
  {
    name: 'sys_services',
    category: 'system',
    title: 'Hizmetler',
    description: 'Sistem hizmetlerini (servisleri) durumlarıyla listeler; ada göre filtrelenebilir.',
    params: {
      filter: { type: 'string', description: 'Hizmet adında aranacak ifade (isteğe bağlı).' },
      status: { type: 'string', enum: ['running', 'stopped', 'all'], description: 'running = çalışanlar, stopped = durmuşlar, all = hepsi (varsayılan).' }
    },
    timeout: 60000,
    run: async (a) => {
      let list;
      if (isWin) {
        list = asArray(await psJson("Get-Service | Select-Object Name, DisplayName, @{n='Status';e={[string]$_.Status}}, @{n='Start';e={[string]$_.StartType}}"))
          .map((s) => ({ name: s.Name, display: s.DisplayName, running: s.Status === 'Running', state: SERVICE_STATE[s.Status] || s.Status, start: START_TYPE[s.Start] || s.Start || '' }));
      } else if (isLinux) {
        const out = await run('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--plain', '--no-legend'], { env: C_ENV });
        list = out.split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4 && c[0].endsWith('.service'))
          .map((c) => ({ name: c[0].replace(/\.service$/, ''), display: c.slice(4).join(' '), running: c[3] === 'running', state: c[3] === 'running' ? 'Çalışıyor' : c[2] === 'failed' ? 'Hata' : 'Durdu', start: '' }));
      } else throw unsupported('Hizmet listesi');
      const st = a.status || 'all';
      const hits = list.filter((s) => (st === 'all' || (st === 'running') === s.running) && matches(a.filter, s.name, s.display));
      const running = hits.filter((s) => s.running).length;
      return listResult(
        `${hits.length} hizmet (${running} çalışıyor)${a.filter ? `, "${a.filter}" filtresiyle` : ''}.${hits.length && hits.length <= 5 ? ' ' + hits.map((s) => `${s.display || s.name}: ${s.state}`).join('; ') : ''}`,
        `Hizmetler (${hits.length})`,
        hits.slice(0, 80).map((s) => ({ title: s.display || s.name, subtitle: s.name, meta: [s.state, s.start].filter(Boolean).join(' · '), icon: s.running ? 'play' : 'pause' })),
        { count: hits.length, running, services: hits.slice(0, 50).map((s) => `${s.name}: ${s.state}`) }
      );
    }
  },
  {
    name: 'sys_service_status',
    category: 'system',
    title: 'Hizmet durumu',
    description: 'Tek bir hizmetin çalışıp çalışmadığını, başlangıç türünü ve bağımlılıklarını gösterir.',
    params: { name: { type: 'string', description: 'Hizmetin adı ya da görünen adı, ör. "Spooler" veya "Yazdırma Biriktiricisi".', required: true } },
    run: async (a) => {
      const name = safeName(a.name, 'Hizmet adı');
      if (isWin) {
        const s = asArray(await psJson(
          `$q=${psStr(name)}; $all=Get-Service; $s=$all | Where-Object { $_.Name -eq $q -or $_.DisplayName -eq $q } | Select-Object -First 1; ` +
          'if (-not $s) { $s=$all | Where-Object { $_.Name.IndexOf($q,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.DisplayName.IndexOf($q,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 }; ' +
          "$s | Select-Object Name, DisplayName, @{n='Status';e={[string]$_.Status}}, @{n='Start';e={[string]$_.StartType}}, @{n='Deps';e={($_.ServicesDependedOn | ForEach-Object { $_.Name }) -join ', '}}"
        ))[0];
        if (!s) throw new ToolError(`"${name}" adında bir hizmet bulunamadı.`, 'sys_services ile hizmet listesine bakabilirsin.');
        const state = SERVICE_STATE[s.Status] || s.Status;
        return kvResult(`${s.DisplayName} hizmeti: ${state}.`, [['Hizmet', s.DisplayName], ['Ad', s.Name], ['Durum', state], ['Başlangıç', START_TYPE[s.Start] || s.Start], ['Bağımlılıklar', s.Deps || 'Yok']]);
      }
      if (isLinux) {
        const unit = name.endsWith('.service') ? name : `${name}.service`;
        const out = await run('systemctl', ['show', unit, '--no-pager', '--property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID'], { env: C_ENV });
        const p = Object.fromEntries(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
        if (p.LoadState === 'not-found') throw new ToolError(`"${name}" adında bir hizmet bulunamadı.`);
        const state = p.SubState === 'running' ? 'Çalışıyor' : p.ActiveState === 'failed' ? 'Hata' : 'Durdu';
        return kvResult(`${p.Description || name} hizmeti: ${state}.`, [['Hizmet', p.Description], ['Ad', p.Id], ['Durum', `${state} (${p.ActiveState}/${p.SubState})`], ['Başlangıç', p.UnitFileState === 'enabled' ? 'Otomatik' : p.UnitFileState], ['PID', p.MainPID && p.MainPID !== '0' ? p.MainPID : '—']]);
      }
      throw unsupported('Hizmet durumu');
    }
  },
  {
    name: 'sys_restart_service',
    category: 'system',
    title: 'Hizmeti yeniden başlat',
    description: 'Bir Windows hizmetini durdurup yeniden başlatır (ör. yazdırma biriktiricisi takıldığında). Çoğu hizmet için yönetici izni gerekir.',
    danger: true,
    params: { name: { type: 'string', description: 'Hizmetin tam adı ya da görünen adı, ör. "Spooler".', required: true } },
    timeout: 90000,
    run: async (a) => {
      if (!isWin) throw unsupported('Hizmeti yeniden başlatma');
      const name = safeName(a.name, 'Hizmet adı');
      let out;
      try {
        out = await ps(
          `$q=${psStr(name)}; $s=Get-Service | Where-Object { $_.Name -eq $q -or $_.DisplayName -eq $q } | Select-Object -First 1; ` +
          "if (-not $s) { 'YOK' } else { Restart-Service -InputObject $s -Force -ErrorAction Stop; $s.Refresh(); $s.DisplayName + '|' + [string]$s.Status }",
          { timeout: 80000 }
        );
      } catch (e) {
        throw new ToolError(`Hizmet yeniden başlatılamadı: ${e.message}`, 'Bu işlem yönetici izni gerektirebilir; Vektör\'ü yönetici olarak çalıştırıp tekrar dene.');
      }
      const t = out.trim();
      if (t === 'YOK') throw new ToolError(`"${name}" adında bir hizmet bulunamadı.`, 'Tam adı sys_services ile bulabilirsin.');
      const [disp, status] = t.split('|');
      return { summary: `${disp} hizmeti yeniden başlatıldı; durum: ${SERVICE_STATE[status] || status}.`, display: { type: 'value', label: disp, value: SERVICE_STATE[status] || status, detail: 'Yeniden başlatıldı', icon: 'gear' } };
    }
  },
  ...['cpu', 'memory'].map((kind) => ({
    name: kind === 'cpu' ? 'sys_top_cpu' : 'sys_top_memory',
    category: 'system',
    title: kind === 'cpu' ? 'En çok CPU kullanan işlemler' : 'En çok RAM kullanan işlemler',
    description: kind === 'cpu'
      ? 'İşlemciyi en çok yoran programları gösterir; bilgisayar yavaşladığında ya da fan çalıştığında kullan.'
      : 'Belleği (RAM) en çok kullanan programları gösterir; aynı programın işlemleri birleştirilir.',
    params: { count: { type: 'integer', description: 'Kaç program gösterilsin (varsayılan 10, en çok 30).' } },
    timeout: 45000,
    run: async (a) => {
      const n = clampInt(a.count, 10, 1, 30);
      let procs;
      if (isWin) {
        procs = kind === 'cpu'
          ? asArray(await psJson(
            '$a=@{}; Get-Process | ForEach-Object { $a[$_.Id]=$_.CPU }; Start-Sleep -Milliseconds 1000; $n=[Environment]::ProcessorCount; ' +
            'Get-Process | ForEach-Object { $p=$a[$_.Id]; if ($p -ne $null -and $_.CPU -ne $null) { [pscustomobject]@{ name=$_.ProcessName; cpu=[math]::Round(($_.CPU-$p)*100/$n,1); mem=$_.WorkingSet64 } } }'
          ))
          : asArray(await psJson("Get-Process | Select-Object @{n='name';e={$_.ProcessName}}, @{n='cpu';e={0}}, @{n='mem';e={$_.WorkingSet64}}"));
      } else {
        procs = parsePs(await run('ps', ['-A', '-o', 'pid=,pcpu=,rss=,comm='], { env: C_ENV }));
      }
      const rows = groupProcs(procs).sort((x, y) => kind === 'cpu' ? y.cpu - x.cpu || y.mem - x.mem : y.mem - x.mem).slice(0, n);
      const total = os.totalmem();
      const items = rows.map((r) => ({
        label: `${r.name}${r.count > 1 ? ` ×${r.count}` : ''}`,
        value: kind === 'cpu' ? Math.min(100, Math.round(r.cpu)) : Math.round(100 * r.mem / total),
        unit: '%',
        detail: kind === 'cpu' ? `%${r.cpu} işlemci · ${bytes(r.mem)}` : bytes(r.mem)
      }));
      const top = rows.slice(0, 3).map((r) => kind === 'cpu' ? `${r.name} %${r.cpu}` : `${r.name} ${bytes(r.mem)}`).join(', ');
      return {
        summary: `${kind === 'cpu' ? 'İşlemciyi' : 'Belleği'} en çok kullananlar: ${top}.`,
        display: { type: 'stats', items },
        data: rows.map((r) => ({ name: r.name, processes: r.count, cpu: r.cpu, memory: bytes(r.mem) }))
      };
    }
  })),
  {
    name: 'sys_uptime',
    category: 'system',
    title: 'Çalışma süresi',
    description: 'Bilgisayarın ne zamandır açık olduğunu ve en son ne zaman başlatıldığını söyler.',
    params: {},
    run: async () => {
      const up = os.uptime();
      const boot = new Date(Date.now() - up * 1000);
      return valueResult('Açık kalma süresi', duration(up), {
        detail: `Son başlatma: ${boot.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}`,
        icon: 'timer',
        data: { seconds: Math.round(up), boot: boot.toISOString() }
      });
    }
  },
  {
    name: 'sys_os_version',
    category: 'system',
    title: 'İşletim sistemi sürümü',
    description: 'Windows/macOS/Linux sürümünü, derleme numarasını ve mimariyi gösterir.',
    params: {},
    run: async () => {
      let rows;
      if (isWin) {
        const o = await psJson(
          "$o=Get-CimInstance Win32_OperatingSystem; $r=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction SilentlyContinue; " +
          "[pscustomobject]@{ Caption=$o.Caption; Version=$o.Version; Build=$o.BuildNumber; Ubr=$r.UBR; Display=$r.DisplayVersion; Arch=$o.OSArchitecture; Installed=$o.InstallDate.ToString('yyyy-MM-dd'); Boot=$o.LastBootUpTime.ToString('yyyy-MM-dd HH:mm') }"
        );
        rows = [['Sistem', o.Caption], ['Sürüm', o.Display || '—'], ['Derleme', `${o.Build}${o.Ubr != null ? `.${o.Ubr}` : ''}`], ['Çekirdek sürümü', o.Version], ['Mimari', o.Arch], ['Kurulum tarihi', o.Installed], ['Son başlatma', o.Boot]];
      } else if (isMac) {
        const out = await run('sw_vers');
        const g = (k) => (out.match(new RegExp(`${k}:\\s*(.*)`)) || [])[1] || '—';
        rows = [['Sistem', g('ProductName')], ['Sürüm', g('ProductVersion')], ['Derleme', g('BuildVersion')], ['Çekirdek', os.release()], ['Mimari', os.arch()]];
      } else {
        const r = parseOsRelease(await fsp.readFile('/etc/os-release', 'utf8').catch(() => ''));
        rows = [['Sistem', r.PRETTY_NAME || r.NAME || 'Linux'], ['Sürüm', r.VERSION_ID || '—'], ['Çekirdek', os.release()], ['Mimari', os.arch()]];
      }
      return kvResult(`${rows[0][1]}, sürüm ${rows[1][1]}, derleme ${rows[2][1]}.`, rows);
    }
  },
  {
    name: 'sys_gpu_info',
    category: 'system',
    title: 'Ekran kartı',
    description: 'Ekran kartlarını, video belleğini ve sürücü sürümünü gösterir.',
    params: {},
    run: async () => {
      let items;
      if (isWin) {
        items = asArray(await psJson(
          "$reg=Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue; " +
          'Get-CimInstance Win32_VideoController | ForEach-Object { $n=$_.Name; $q=($reg | Where-Object { $_.DriverDesc -eq $n } | Select-Object -First 1).\'HardwareInformation.qwMemorySize\'; ' +
          '$ram=[int64]$_.AdapterRAM; if ($q) { $ram=[int64]$q }; $d=\'\'; if ($_.DriverDate) { $d=$_.DriverDate.ToString(\'yyyy-MM-dd\') }; ' +
          '[pscustomobject]@{ Name=$n; Driver=$_.DriverVersion; Date=$d; Ram=$ram; W=$_.CurrentHorizontalResolution; H=$_.CurrentVerticalResolution; Hz=$_.CurrentRefreshRate } }'
        )).map((g) => ({ title: g.Name, subtitle: `Sürücü ${g.Driver || '—'}${g.Date ? ` (${g.Date})` : ''}${g.W ? ` · ${g.W}×${g.H} ${g.Hz} Hz` : ''}`, meta: g.Ram > 0 ? bytes(g.Ram) : '', icon: 'display' }));
      } else if (isMac) {
        const out = await run('system_profiler', ['SPDisplaysDataType'], { timeout: 30000 });
        const names = [...out.matchAll(/Chipset Model:\s*(.*)/g)].map((m) => m[1].trim());
        const vram = [...out.matchAll(/VRAM[^:]*:\s*(.*)/g)].map((m) => m[1].trim());
        items = names.map((n, i) => ({ title: n, subtitle: vram[i] ? `Video belleği ${vram[i]}` : '', icon: 'display' }));
      } else {
        const out = await linuxFirst([['lspci', []]]);
        items = out.split('\n').filter((l) => /VGA|3D controller|Display controller/.test(l)).map((l) => ({ title: l.replace(/^\S+\s+[^:]+:\s*/, ''), subtitle: l.split(' ')[0], icon: 'display' }));
      }
      if (!items.length) return { summary: 'Ekran kartı bilgisi alınamadı.' };
      return listResult(`Ekran kartı: ${items.map((i) => `${i.title}${i.meta ? ` (${i.meta})` : ''}`).join(', ')}.`, 'Ekran kartları', items, items.map((i) => ({ name: i.title, detail: i.subtitle, memory: i.meta })));
    }
  },
  {
    name: 'sys_cpu_details',
    category: 'system',
    title: 'İşlemci detayı',
    description: 'İşlemci modelini, çekirdek/iş parçacığı sayısını, hızını ve önbellek boyutlarını gösterir.',
    params: {},
    run: async () => {
      let rows;
      if (isWin) {
        const c = (await winList('İşlemci detayı', 'Get-CimInstance Win32_Processor | Select-Object Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, L2CacheSize, L3CacheSize, SocketDesignation, VirtualizationFirmwareEnabled, LoadPercentage'))[0] || {};
        rows = [
          ['Model', (c.Name || '').trim()], ['Üretici', c.Manufacturer], ['Çekirdek', c.NumberOfCores], ['Mantıksal işlemci', c.NumberOfLogicalProcessors],
          ['En yüksek hız', c.MaxClockSpeed ? `${(c.MaxClockSpeed / 1000).toFixed(2)} GHz` : '—'], ['L2 önbellek', c.L2CacheSize ? bytes(c.L2CacheSize * 1024) : '—'],
          ['L3 önbellek', c.L3CacheSize ? bytes(c.L3CacheSize * 1024) : '—'], ['Soket', c.SocketDesignation], ['Sanallaştırma', c.VirtualizationFirmwareEnabled ? 'Açık' : 'Kapalı'],
          ['Anlık yük', c.LoadPercentage != null ? `%${c.LoadPercentage}` : '—']
        ];
      } else {
        const cpus = os.cpus();
        rows = [['Model', cpus[0]?.model?.trim() || '—'], ['Mantıksal işlemci', cpus.length], ['Hız', cpus[0]?.speed ? `${(cpus[0].speed / 1000).toFixed(2)} GHz` : '—'], ['Mimari', os.arch()]];
        if (isLinux) {
          const info = await fsp.readFile('/proc/cpuinfo', 'utf8').catch(() => '');
          const cores = (info.match(/cpu cores\s*:\s*(\d+)/) || [])[1];
          const cache = (info.match(/cache size\s*:\s*(.*)/) || [])[1];
          if (cores) rows.splice(1, 0, ['Çekirdek (soket başına)', cores]);
          if (cache) rows.push(['Önbellek', cache]);
        }
      }
      return kvResult(`İşlemci: ${rows[0][1]}, ${rows.find((r) => /Çekirdek/.test(r[0]))?.[1] ?? '?'} çekirdek, ${rows.find((r) => r[0] === 'Mantıksal işlemci')[1]} iş parçacığı.`, rows);
    }
  },
  {
    name: 'sys_ram_modules',
    category: 'system',
    title: 'RAM modülleri',
    description: 'Takılı bellek modüllerini (kapasite, hız, tür, üretici, yuva) listeler; RAM yükseltmesi planlarken işe yarar.',
    params: {},
    run: async () => {
      const mods = await winList('RAM modülleri', 'Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer, PartNumber, Capacity, Speed, ConfiguredClockSpeed, DeviceLocator, SMBIOSMemoryType');
      const slots = Number((await ps('(Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object -Property MemoryDevices -Sum).Sum').catch(() => '')).trim()) || null;
      const total = mods.reduce((s, m) => s + (Number(m.Capacity) || 0), 0);
      const items = mods.map((m) => ({
        title: `${bytes(Number(m.Capacity))} ${MEMORY_TYPE[m.SMBIOSMemoryType] || ''}`.trim(),
        subtitle: [String(m.Manufacturer || '').trim(), String(m.PartNumber || '').trim()].filter(Boolean).join(' · '),
        meta: `${m.ConfiguredClockSpeed || m.Speed || '?'} MT/s · ${m.DeviceLocator || ''}`,
        icon: 'cpu'
      }));
      return listResult(
        `Toplam ${bytes(total)} RAM, ${mods.length} modül${slots ? `, ${slots} yuvadan ${slots - mods.length} boş` : ''}.`,
        `RAM modülleri · ${bytes(total)}`,
        items,
        { total: bytes(total), slots, modules: items.map((i) => `${i.title} ${i.meta}`) }
      );
    }
  },
  {
    name: 'sys_motherboard_bios',
    category: 'system',
    title: 'Anakart ve BIOS',
    description: 'Anakart üreticisini/modelini ve BIOS sürümüyle tarihini gösterir.',
    params: {},
    run: async () => {
      let rows;
      if (isWin) {
        const r = await psJson(
          '$b=Get-CimInstance Win32_BaseBoard | Select-Object -First 1; $i=Get-CimInstance Win32_BIOS | Select-Object -First 1; $c=Get-CimInstance Win32_ComputerSystem; ' +
          "$d=''; if ($i.ReleaseDate) { $d=$i.ReleaseDate.ToString('yyyy-MM-dd') }; " +
          '[pscustomobject]@{ Maker=$c.Manufacturer; Model=$c.Model; Board=$b.Manufacturer; Product=$b.Product; BoardVer=$b.Version; Bios=$i.Manufacturer; BiosVer=$i.SMBIOSBIOSVersion; BiosDate=$d }'
        );
        rows = [['Bilgisayar', `${r.Maker || ''} ${r.Model || ''}`.trim()], ['Anakart', `${r.Board || ''} ${r.Product || ''}`.trim()], ['Anakart sürümü', r.BoardVer], ['BIOS', r.Bios], ['BIOS sürümü', r.BiosVer], ['BIOS tarihi', r.BiosDate]];
      } else if (isLinux) {
        const rd = (f) => { try { return fs.readFileSync(`/sys/class/dmi/id/${f}`, 'utf8').trim(); } catch { return '—'; } };
        rows = [['Bilgisayar', `${rd('sys_vendor')} ${rd('product_name')}`], ['Anakart', `${rd('board_vendor')} ${rd('board_name')}`], ['Anakart sürümü', rd('board_version')], ['BIOS', rd('bios_vendor')], ['BIOS sürümü', rd('bios_version')], ['BIOS tarihi', rd('bios_date')]];
      } else if (isMac) {
        const out = await run('system_profiler', ['SPHardwareDataType'], { timeout: 30000 });
        const g = (k) => (out.match(new RegExp(`${k}:\\s*(.*)`)) || [])[1] || '—';
        rows = [['Model', g('Model Name')], ['Model kimliği', g('Model Identifier')], ['Yonga/İşlemci', g('Chip') !== '—' ? g('Chip') : g('Processor Name')], ['Sistem yazılımı', g('System Firmware Version')]];
      } else throw unsupported('Anakart bilgisi');
      return kvResult(rows.map((r) => `${r[0]}: ${r[1]}`).slice(0, 5).join('; ') + '.', rows);
    }
  },
  {
    name: 'sys_usb_devices',
    category: 'system',
    title: 'USB aygıtları',
    description: 'Takılı USB aygıtlarını ve denetleyicilerini listeler.',
    params: {},
    run: async () => {
      let items;
      if (isWin) {
        items = (await winList('USB aygıtları', "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'USB' -or $_.InstanceId -like 'USB\\*' } | Select-Object FriendlyName, Class, Status"))
          .filter((d) => d.FriendlyName)
          .map((d) => ({ title: d.FriendlyName, subtitle: d.Class || '', meta: d.Status === 'OK' ? 'Çalışıyor' : d.Status || '', icon: 'plug' }));
      } else if (isLinux) {
        const out = await linuxFirst([['lsusb', []]]);
        items = out.split('\n').map((l) => l.match(/^Bus (\d+) Device (\d+): ID (\S+)\s*(.*)$/)).filter(Boolean)
          .map((m) => ({ title: m[4] || m[3], subtitle: `Veri yolu ${m[1]} · aygıt ${m[2]}`, meta: m[3], icon: 'plug' }));
      } else throw unsupported('USB aygıt listesi');
      items = items.filter((x, i, arr) => arr.findIndex((y) => y.title === x.title && y.subtitle === x.subtitle) === i);
      return listResult(`${items.length} USB aygıtı bulundu.`, 'USB aygıtları', items);
    }
  },
  {
    name: 'sys_audio_devices',
    category: 'system',
    title: 'Ses aygıtları',
    description: 'Ses kartlarını ve ses aygıtlarını listeler.',
    params: {},
    run: async () => {
      let items;
      if (isWin) {
        items = (await winList('Ses aygıtları', 'Get-CimInstance Win32_SoundDevice | Select-Object Name, Manufacturer, Status'))
          .map((d) => ({ title: d.Name, subtitle: d.Manufacturer || '', meta: d.Status === 'OK' ? 'Çalışıyor' : d.Status || '', icon: 'volume' }));
      } else if (isLinux) {
        const out = await fsp.readFile('/proc/asound/cards', 'utf8').catch(() => '');
        items = out.split('\n').map((l) => l.match(/^\s*(\d+)\s+\[([^\]]+)\]:\s*(.*)$/)).filter(Boolean)
          .map((m) => ({ title: m[3].trim(), subtitle: m[2].trim(), meta: `Kart ${m[1]}`, icon: 'volume' }));
      } else throw unsupported('Ses aygıtı listesi');
      return listResult(items.length ? `Ses aygıtları: ${items.map((i) => i.title).join(', ')}.` : 'Ses aygıtı bulunamadı.', 'Ses aygıtları', items);
    }
  },
  {
    name: 'sys_printers',
    category: 'system',
    title: 'Yazıcılar',
    description: 'Kurulu yazıcıları, durumlarını ve varsayılan yazıcıyı gösterir.',
    params: {},
    run: async () => {
      let list;
      if (isWin) {
        list = asArray(await psJson(
          "$d=(Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name; " +
          "Get-Printer | Select-Object Name, DriverName, PortName, @{n='Status';e={[string]$_.PrinterStatus}}, @{n='Default';e={$_.Name -eq $d}}"
        )).map((p) => ({ name: p.Name, detail: p.DriverName || '', status: p.Status === 'Normal' ? 'Hazır' : p.Status || '', isDefault: !!p.Default }));
      } else {
        const r = parseLpstat(await run('lpstat', ['-p', '-d'], { env: C_ENV }).catch((e) => { if (/bulunamadı/.test(e.message)) throw e; return ''; }));
        list = r.printers.map((p) => ({ name: p.name, detail: '', status: p.status, isDefault: p.name === r.default }));
      }
      const def = list.find((p) => p.isDefault);
      return listResult(
        list.length ? `${list.length} yazıcı var${def ? `; varsayılan: ${def.name}` : ''}.` : 'Kurulu yazıcı yok.',
        'Yazıcılar',
        list.map((p) => ({ title: p.name, subtitle: [p.isDefault && 'Varsayılan', p.detail].filter(Boolean).join(' · '), meta: p.status, icon: 'doc' })),
        { printers: list.map((p) => p.name), default: def?.name || null }
      );
    }
  },
  {
    name: 'sys_set_default_printer',
    category: 'system',
    title: 'Varsayılan yazıcıyı ayarla',
    description: 'Seçilen yazıcıyı varsayılan yazıcı yapar.',
    danger: true,
    params: { name: { type: 'string', description: 'Yazıcının adı ya da adının bir kısmı.', required: true } },
    run: async (a) => {
      const name = safeName(a.name, 'Yazıcı adı');
      if (isWin) {
        const out = (await ps(
          `$q=${psStr(name)}; $all=Get-CimInstance Win32_Printer; $p=$all | Where-Object { $_.Name -eq $q } | Select-Object -First 1; ` +
          'if (-not $p) { $p=$all | Where-Object { $_.Name.IndexOf($q,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 }; ' +
          "if (-not $p) { 'YOK' } else { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null; $p.Name }"
        )).trim();
        if (out === 'YOK') throw new ToolError(`"${name}" adında bir yazıcı bulunamadı.`, 'sys_printers ile yazıcı adlarına bakabilirsin.');
        return { summary: `Varsayılan yazıcı artık ${out}.`, display: { type: 'value', label: 'Varsayılan yazıcı', value: out, detail: 'Windows "varsayılan yazıcımı yönet" açıksa bunu tekrar değiştirebilir.', icon: 'doc' } };
      }
      const r = parseLpstat(await run('lpstat', ['-p'], { env: C_ENV }).catch(() => ''));
      const p = r.printers.find((x) => x.name === name) || r.printers.find((x) => norm(x.name).includes(norm(name)));
      if (!p) throw new ToolError(`"${name}" adında bir yazıcı bulunamadı.`);
      await run('lpoptions', ['-d', p.name]);
      return { summary: `Varsayılan yazıcı artık ${p.name}.`, display: { type: 'value', label: 'Varsayılan yazıcı', value: p.name, icon: 'doc' } };
    }
  },
  {
    name: 'sys_wifi_networks',
    category: 'system',
    title: 'Yakındaki Wi-Fi ağları',
    description: 'Çevredeki kablosuz ağları sinyal gücü ve güvenlik türüyle listeler.',
    params: {},
    run: async () => {
      let nets;
      if (isWin) {
        const out = await ps('netsh wlan show networks mode=bssid');
        nets = parseNetshNetworks(out);
        if (!nets.length && /location|konum/i.test(out)) {
          throw new ToolError('Wi-Fi ağlarını görmek için Windows konum izni gerekiyor.', 'Ayarlar > Gizlilik ve güvenlik > Konum bölümünden konum hizmetlerini aç.');
        }
      } else if (isLinux) {
        const out = await linuxFirst([['nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY,CHAN', 'dev', 'wifi', 'list']]]);
        nets = out.split('\n').filter(Boolean).map(splitNmcli).map(([ssid, sig, sec, ch]) => ({ ssid: ssid || '(gizli ağ)', signal: Number(sig) || 0, auth: sec || 'Açık', channel: ch || null }))
          .filter((n, i, arr) => arr.findIndex((m) => m.ssid === n.ssid) === i).sort((x, y) => y.signal - x.signal);
      } else throw unsupported('Wi-Fi ağ taraması');
      if (!nets.length) return { summary: 'Yakında Wi-Fi ağı bulunamadı; kablosuz bağdaştırıcı kapalı olabilir.' };
      return {
        summary: `${nets.length} Wi-Fi ağı görünüyor. En güçlüler: ${nets.slice(0, 3).map((n) => `${n.ssid} %${n.signal ?? '?'}`).join(', ')}.`,
        display: { type: 'stats', items: nets.slice(0, 20).map((n) => ({ label: n.ssid, value: n.signal ?? 0, unit: '%', detail: [n.auth, n.channel && `Kanal ${n.channel}`].filter(Boolean).join(' · '), tone: (n.signal ?? 0) < 30 ? 'danger' : undefined })) },
        data: nets.slice(0, 25).map((n) => ({ ssid: n.ssid, signal: n.signal, auth: n.auth }))
      };
    }
  },
  {
    name: 'sys_wifi_profiles',
    category: 'system',
    title: 'Kayıtlı Wi-Fi profilleri',
    description: 'Bilgisayarın daha önce bağlandığı ve kaydettiği Wi-Fi ağlarının adlarını listeler (şifreleri göstermez).',
    params: {},
    run: async () => {
      let names;
      if (isWin) names = parseNetshProfiles(await ps('netsh wlan show profiles'));
      else if (isLinux) {
        const out = await linuxFirst([['nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']]]);
        names = out.split('\n').filter(Boolean).map(splitNmcli).filter((c) => /wireless/.test(c[1] || '')).map((c) => c[0]);
      } else if (isMac) {
        const out = await run('networksetup', ['-listpreferredwirelessnetworks', 'en0']);
        names = out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
      } else throw unsupported('Wi-Fi profilleri');
      return listResult(names.length ? `${names.length} kayıtlı Wi-Fi ağı var: ${names.slice(0, 8).join(', ')}.` : 'Kayıtlı Wi-Fi ağı yok.', 'Kayıtlı Wi-Fi ağları', names.map((n) => ({ title: n, icon: 'wifi' })), names);
    }
  },
  {
    name: 'sys_wifi_status',
    category: 'system',
    title: 'Wi-Fi bağlantı durumu',
    description: 'Bağlı olunan Wi-Fi ağını, sinyal gücünü ve bağlantı hızını gösterir.',
    params: {},
    run: async () => {
      let w;
      if (isWin) w = parseWlanInterface(await ps('netsh wlan show interfaces'));
      else if (isLinux) {
        const out = await linuxFirst([['nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL,RATE,CHAN,SECURITY', 'dev', 'wifi']]]);
        const c = out.split('\n').map(splitNmcli).find((r) => r[0] === 'yes') || [];
        w = { ssid: c[1] || '', signal: c[2] ? Number(c[2]) : null, receive: (c[3] || '').replace(/\s*Mbit\/s$/i, ''), transmit: '', channel: c[4] || '', auth: c[5] || '', state: c[1] ? 'connected' : '' };
      } else if (isMac) {
        const out = await run('networksetup', ['-getairportnetwork', 'en0']).catch(() => '');
        const m = out.match(/Network:\s*(.+)$/m);
        w = { ssid: m ? m[1].trim() : '', signal: null, receive: '', transmit: '', channel: '', auth: '' };
      } else throw unsupported('Wi-Fi durumu');
      if (!w.ssid) return { summary: 'Şu an bir Wi-Fi ağına bağlı değilsin.', display: { type: 'value', label: 'Wi-Fi', value: 'Bağlı değil', icon: 'wifi' }, data: { connected: false } };
      const rows = [['Ağ', w.ssid], ['Sinyal', w.signal != null ? `%${w.signal}` : '—'], ['Alma hızı', w.receive ? `${w.receive} Mbps` : '—'], ['Gönderme hızı', w.transmit ? `${w.transmit} Mbps` : '—'], ['Kanal', w.channel || '—'], ['Güvenlik', w.auth || '—']];
      if (w.radio) rows.push(['Radyo türü', w.radio]);
      return kvResult(`${w.ssid} ağına bağlısın${w.signal != null ? `, sinyal %${w.signal}` : ''}${w.receive ? `, hız ${w.receive} Mbps` : ''}.`, rows, { connected: true, ssid: w.ssid, signal: w.signal, receiveMbps: w.receive, transmitMbps: w.transmit });
    }
  },
  {
    name: 'sys_bluetooth_devices',
    category: 'system',
    title: 'Bluetooth aygıtları',
    description: 'Eşleştirilmiş Bluetooth aygıtlarını ve bağlantı durumlarını listeler.',
    params: {},
    run: async () => {
      let items;
      if (isWin) {
        const noise = /enumerator|numaraland|generic attribute|generic access|service$|hizmeti$|rfcomm|protocol|protokol|\bavrcp\b|transport|aktarım|radio|adapter|bağdaştırıcı/i;
        items = (await winList('Bluetooth aygıtları', 'Get-PnpDevice -Class Bluetooth | Select-Object FriendlyName, Status, Present'))
          .filter((d) => d.FriendlyName && !noise.test(d.FriendlyName))
          .map((d) => ({ title: d.FriendlyName, meta: d.Present && d.Status === 'OK' ? 'Hazır' : 'Bağlı değil', icon: 'plug' }));
      } else if (isLinux) {
        const out = await linuxFirst([['bluetoothctl', ['devices']]]);
        items = out.split('\n').map((l) => l.match(/^Device\s+(\S+)\s+(.*)$/)).filter(Boolean).map((m) => ({ title: m[2], subtitle: m[1], icon: 'plug' }));
      } else throw unsupported('Bluetooth aygıt listesi');
      items = items.filter((x, i, arr) => arr.findIndex((y) => y.title === x.title) === i);
      return listResult(items.length ? `${items.length} Bluetooth aygıtı: ${items.slice(0, 8).map((i) => i.title).join(', ')}.` : 'Eşleştirilmiş Bluetooth aygıtı yok.', 'Bluetooth aygıtları', items);
    }
  },
  {
    name: 'sys_ip_config',
    category: 'system',
    title: 'IP yapılandırması',
    description: 'Etkin ağ bağdaştırıcılarının IP adresini, ağ geçidini, DNS sunucularını ve MAC adresini gösterir.',
    params: {},
    run: async () => {
      let list;
      if (isWin) {
        list = asArray(await psJson(
          "Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { [pscustomobject]@{ " +
          "Alias=$_.InterfaceAlias; Desc=$_.InterfaceDescription; IPv4=(@($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ', '); " +
          "IPv6=(@($_.IPv6Address | ForEach-Object { $_.IPAddress }) -join ', '); Gateway=(@($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ', '); " +
          "Dns=(@($_.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) -join ', '); Mac=$_.NetAdapter.MacAddress } }"
        )).map((n) => ({ name: n.Alias, desc: n.Desc, ipv4: n.IPv4, ipv6: n.IPv6, gateway: n.Gateway, dns: n.Dns, mac: n.Mac }));
      } else {
        let gateway = '';
        try {
          gateway = isMac
            ? ((await run('route', ['-n', 'get', 'default'])).match(/gateway:\s*(\S+)/) || [])[1] || ''
            : ((await run('ip', ['route', 'show', 'default'])).match(/default via (\S+)/) || [])[1] || '';
        } catch { /* no default route */ }
        const dns = ((await fsp.readFile('/etc/resolv.conf', 'utf8').catch(() => '')).match(/^nameserver\s+(\S+)/gm) || []).map((l) => l.split(/\s+/)[1]).join(', ');
        list = Object.entries(os.networkInterfaces()).map(([name, addrs]) => {
          const ext = (addrs || []).filter((x) => !x.internal);
          if (!ext.length) return null;
          return { name, desc: '', ipv4: ext.filter((x) => x.family === 'IPv4').map((x) => `${x.address}/${x.cidr?.split('/')[1] || ''}`).join(', '), ipv6: ext.filter((x) => x.family === 'IPv6').map((x) => x.address).join(', '), gateway, dns, mac: ext[0].mac };
        }).filter(Boolean);
      }
      if (!list.length) return { summary: 'Etkin bir ağ bağlantısı bulunamadı.' };
      const rows = [];
      for (const n of list) {
        rows.push([`— ${n.name}`, n.desc || ''], ['IPv4', n.ipv4 || '—'], ['Ağ geçidi', n.gateway || '—'], ['DNS', n.dns || '—'], ['MAC', n.mac || '—']);
        if (n.ipv6) rows.push(['IPv6', truncate(n.ipv6, 120)]);
      }
      return kvResult(list.map((n) => `${n.name}: IP ${n.ipv4 || '—'}, ağ geçidi ${n.gateway || '—'}, DNS ${n.dns || '—'}`).join('. ') + '.', rows, list);
    }
  },
  {
    name: 'sys_flush_dns',
    category: 'system',
    title: 'DNS önbelleğini temizle',
    description: 'DNS çözümleyici önbelleğini temizler; site açılmıyor ya da eski adrese gidiyorsa işe yarar.',
    danger: true,
    params: {},
    run: async () => {
      if (isWin) await ps('Clear-DnsClientCache');
      else if (isMac) await run('dscacheutil', ['-flushcache']);
      else await linuxFirst([['resolvectl', ['flush-caches']], ['systemd-resolve', ['--flush-caches']]]);
      return { summary: 'DNS önbelleği temizlendi.', display: { type: 'value', label: 'DNS önbelleği', value: 'Temizlendi', icon: 'globe' } };
    }
  },
  {
    name: 'sys_listening_ports',
    category: 'system',
    title: 'Dinlenen portlar',
    description: 'Bağlantı bekleyen (dinlenen) TCP portlarını ve bunları açan programları listeler.',
    params: { filter: { type: 'string', description: 'Port numarası ya da program adı (isteğe bağlı).' } },
    run: async (a) => {
      let list;
      if (isWin) {
        list = asArray(await psJson(
          '$n=@{}; Get-Process | ForEach-Object { $n[$_.Id]=$_.ProcessName }; ' +
          "Get-NetTCPConnection -State Listen | Sort-Object LocalPort, LocalAddress | Select-Object LocalAddress, LocalPort, OwningProcess, @{n='Proc';e={$n[[int]$_.OwningProcess]}}"
        )).map((c) => ({ address: c.LocalAddress, port: c.LocalPort, process: c.Proc || '', pid: c.OwningProcess }));
      } else if (isLinux) {
        list = parseSs(await linuxFirst([['ss', ['-ltnpH']]]));
      } else if (isMac) {
        const out = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']).catch(() => '');
        list = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 9)
          .map((c) => { const addr = c[8]; const i = addr.lastIndexOf(':'); return { address: addr.slice(0, i), port: Number(addr.slice(i + 1)), process: c[0], pid: Number(c[1]) }; });
      } else throw unsupported('Port listesi');
      const seen = new Set();
      list = list.filter((c) => { const k = `${c.port}|${c.process}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .filter((c) => !a.filter || String(c.port) === String(a.filter).trim() || matches(a.filter, c.process))
        .sort((x, y) => x.port - y.port);
      return listResult(
        list.length ? `${list.length} port dinleniyor: ${list.slice(0, 8).map((c) => `${c.port}${c.process ? ` (${c.process})` : ''}`).join(', ')}.` : 'Dinlenen port bulunamadı.',
        'Dinlenen portlar',
        list.slice(0, 80).map((c) => ({ title: `:${c.port}`, subtitle: c.process ? `${c.process}${c.pid ? ` · PID ${c.pid}` : ''}` : 'Bilinmeyen program', meta: c.address, icon: 'plug' })),
        list.slice(0, 60).map((c) => ({ port: c.port, process: c.process, address: c.address }))
      );
    }
  },
  {
    name: 'sys_firewall_status',
    category: 'system',
    title: 'Güvenlik duvarı durumu',
    description: 'Güvenlik duvarı profillerinin (etki alanı, özel, ortak) açık ya da kapalı olduğunu gösterir.',
    params: {},
    run: async () => {
      if (isMac) {
        const out = await run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']);
        const on = /enabled|State = [12]/i.test(out);
        return { summary: `Güvenlik duvarı ${on ? 'açık' : 'kapalı'}.`, display: { type: 'value', label: 'Güvenlik duvarı', value: on ? 'Açık' : 'Kapalı', icon: 'shield' }, data: { enabled: on } };
      }
      const list = (await winList('Güvenlik duvarı durumu', "Get-NetFirewallProfile | Select-Object Name, @{n='On';e={[string]$_.Enabled}}, @{n='In';e={[string]$_.DefaultInboundAction}}, @{n='Out';e={[string]$_.DefaultOutboundAction}}"))
        .map((p) => ({ name: FIREWALL_NAMES[p.Name] || p.Name, on: p.On === 'True', inbound: fwAction(p.In, true), outbound: fwAction(p.Out, false) }));
      const off = list.filter((p) => !p.on);
      return listResult(
        off.length ? `Dikkat: ${off.map((p) => p.name).join(', ')} profilinde güvenlik duvarı kapalı.` : 'Güvenlik duvarı tüm profillerde açık.',
        'Güvenlik duvarı',
        list.map((p) => ({ title: `${p.name} ağ`, subtitle: `Gelen: ${p.inbound} · Giden: ${p.outbound}`, meta: p.on ? 'Açık' : 'Kapalı', icon: p.on ? 'shield' : 'warning' })),
        list.map((p) => ({ profile: p.name, enabled: p.on }))
      );
    }
  },
  {
    name: 'sys_monitor_info',
    category: 'system',
    title: 'Monitör bilgisi',
    description: 'Bağlı monitörlerin adını, çözünürlüğünü, yenileme hızını ve ölçeklemesini gösterir.',
    params: {},
    run: async (_a, ctx) => {
      let win = { Controllers: [], Names: [] };
      if (isWin) {
        win = (await psJson(
          '$v=@(Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution } | ForEach-Object { [pscustomobject]@{ Gpu=$_.Name; W=$_.CurrentHorizontalResolution; H=$_.CurrentVerticalResolution; Hz=$_.CurrentRefreshRate; Bits=$_.CurrentBitsPerPixel } }); ' +
          "$n=@(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object { (($_.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '') }); " +
          '[pscustomobject]@{ Controllers=$v; Names=$n }'
        ).catch(() => null)) || win;
      }
      const names = asArray(win.Names).filter(Boolean);
      const screen = ctx?.electron?.screen;
      let items = [];
      if (screen?.getAllDisplays) {
        items = screen.getAllDisplays().map((d, i) => {
          const w = Math.round(d.size.width * d.scaleFactor), h = Math.round(d.size.height * d.scaleFactor);
          return { title: d.label || names[i] || `Ekran ${i + 1}`, subtitle: `${w}×${h}${d.displayFrequency ? ` · ${Math.round(d.displayFrequency)} Hz` : ''} · %${Math.round(d.scaleFactor * 100)} ölçek`, meta: d.internal ? 'Dahili' : '', icon: 'display' };
        });
      } else if (isWin) {
        items = asArray(win.Controllers).map((c, i) => ({ title: names[i] || `Ekran ${i + 1}`, subtitle: `${c.W}×${c.H} · ${c.Hz} Hz · ${c.Bits} bit renk`, meta: c.Gpu, icon: 'display' }));
      } else throw unsupported('Monitör bilgisi');
      if (!items.length) return { summary: 'Monitör bilgisi alınamadı.' };
      return listResult(`${items.length} monitör: ${items.map((i) => `${i.title} ${i.subtitle.split(' · ').slice(0, 2).join(' ')}`).join('; ')}.`, 'Monitörler', items, items.map((i) => `${i.title}: ${i.subtitle}`));
    }
  },
  {
    name: 'sys_battery_report',
    category: 'system',
    title: 'Pil raporu oluştur',
    description: 'Windows pil sağlığı raporunu (tasarım kapasitesi, tam şarj kapasitesi, kullanım geçmişi) Belgeler klasörüne kaydedip açar.',
    params: {},
    timeout: 90000,
    run: async (_a, ctx) => {
      if (!isWin) throw unsupported('Pil raporu');
      const out = path.join(dirFor('documents'), 'pil-raporu.html');
      await fsp.mkdir(path.dirname(out), { recursive: true });
      try {
        await run('powercfg', ['/batteryreport', '/output', out], { timeout: 80000 });
      } catch (e) {
        throw new ToolError('Pil raporu oluşturulamadı; bu bilgisayarda pil olmayabilir.', e.message);
      }
      if (!fs.existsSync(out)) throw new ToolError('Pil raporu oluşturulamadı.');
      const err = await ctx?.electron?.shell?.openPath?.(out);
      return {
        summary: `Pil raporu oluşturuldu${err ? '' : ' ve açıldı'}: ${out}.`,
        display: { type: 'file', path: out, name: path.basename(out), meta: bytes(fs.statSync(out).size) },
        data: { path: out }
      };
    }
  },
  {
    name: 'sys_disk_health',
    category: 'system',
    title: 'Disk sağlığı',
    description: 'Fiziksel disklerin modelini, türünü (SSD/HDD), boyutunu ve sağlık durumunu gösterir.',
    params: {},
    run: async () => {
      let list;
      if (isWin) {
        list = asArray(await psJson("Get-PhysicalDisk | Select-Object FriendlyName, @{n='Media';e={[string]$_.MediaType}}, @{n='Health';e={[string]$_.HealthStatus}}, @{n='Op';e={(@($_.OperationalStatus) | ForEach-Object { [string]$_ }) -join ', '}}, @{n='Bus';e={[string]$_.BusType}}, Size"))
          .map((d) => ({ name: d.FriendlyName, media: d.Media === 'Unspecified' ? 'Belirtilmemiş' : d.Media, health: HEALTH[d.Health] || d.Health || '—', ok: d.Health === 'Healthy', bus: d.Bus, size: d.Size, op: d.Op }));
      } else if (isLinux) {
        const j = JSON.parse(await linuxFirst([['lsblk', ['-J', '-b', '-d', '-o', 'NAME,MODEL,SIZE,ROTA,TYPE,TRAN']]]));
        list = (j.blockdevices || []).filter((d) => d.type === 'disk')
          .map((d) => ({ name: (d.model || d.name || '').trim(), media: d.rota === true || d.rota === '1' ? 'HDD' : 'SSD', health: 'Bilinmiyor', ok: true, bus: d.tran || '', size: Number(d.size), op: '' }));
      } else throw unsupported('Disk sağlığı');
      const bad = list.filter((d) => !d.ok);
      return listResult(
        bad.length ? `Dikkat: ${bad.map((d) => `${d.name} (${d.health})`).join(', ')}.` : `${list.length} disk: ${list.map((d) => `${d.name} ${d.health.toLowerCase()}`).join(', ')}.`,
        'Disk sağlığı',
        list.map((d) => ({ title: d.name, subtitle: [d.media, d.bus, d.op && d.op !== 'OK' ? d.op : ''].filter(Boolean).join(' · '), meta: `${bytes(Number(d.size))} · ${d.health}`, icon: d.ok ? 'layers' : 'warning' })),
        list.map((d) => ({ model: d.name, type: d.media, size: bytes(Number(d.size)), health: d.health }))
      );
    }
  },
  {
    name: 'sys_temp_size',
    category: 'system',
    title: 'Geçici dosya boyutu',
    description: 'Geçici dosyalar klasörünün (temp) ne kadar yer kapladığını hesaplar.',
    params: {},
    timeout: 120000,
    run: async () => {
      const root = os.tmpdir();
      let size = 0, count = 0, old = 0, oldSize = 0;
      const day = Date.now() - 86400000;
      const { truncated } = await walkTemp(root, (_f, st) => {
        size += st.size; count++;
        if (st.mtimeMs < day) { old++; oldSize += st.size; }
      });
      return valueResult('Geçici dosyalar', bytes(size), {
        detail: `${count}${truncated ? '+' : ''} dosya · ${bytes(oldSize)} kadarı 1 günden eski · ${root}`,
        icon: 'trash',
        data: { path: root, bytes: size, files: count, olderThanDay: bytes(oldSize), truncated }
      });
    }
  },
  {
    name: 'sys_clean_temp',
    category: 'system',
    title: 'Geçici dosyaları temizle',
    description: 'Geçici dosyalar klasöründeki 1 günden eski dosyaları siler; kullanımda olan dosyaları atlar ve ne kadar yer açıldığını söyler.',
    danger: true,
    params: {},
    timeout: 300000,
    run: async () => {
      const root = os.tmpdir();
      const cutoff = Date.now() - 86400000;
      let freed = 0, deleted = 0, skipped = 0;
      const dirs = [];
      await walkTemp(root, async (full, st) => {
        if (st.mtimeMs >= cutoff) return;
        try { await fsp.unlink(full); freed += st.size; deleted++; } catch { skipped++; }
      }, {
        maxEntries: 200000,
        // Folder age is taken before its files go, since deleting them bumps the folder's mtime.
        onDir: async (d) => { try { if ((await fsp.lstat(d)).mtimeMs < cutoff) dirs.push(d); } catch { /* gone */ } }
      });
      // Remove old folders left empty, deepest first; rmdir refuses non-empty ones.
      for (const d of dirs.sort((x, y) => y.length - x.length)) {
        try { await fsp.rmdir(d); } catch { /* in use or not empty */ }
      }
      return valueResult('Açılan alan', bytes(freed), {
        detail: `${deleted} dosya silindi${skipped ? `, ${skipped} kullanımda olduğu için atlandı` : ''}`,
        icon: 'trash',
        data: { freedBytes: freed, freed: bytes(freed), deleted, skipped }
      });
    }
  },
  {
    name: 'sys_power_plan',
    category: 'system',
    title: 'Güç planı',
    description: 'Etkin güç planını ve kullanılabilir planları gösterir.',
    params: {},
    run: async () => {
      if (isLinux && await hasBin('powerprofilesctl')) {
        const cur = (await run('powerprofilesctl', ['get'])).trim();
        const label = Object.values(POWER_PLANS).find((p) => p.linux === cur)?.label || cur;
        return valueResult('Güç planı', label, { icon: 'bolt', data: { active: cur } });
      }
      if (!isWin) throw unsupported('Güç planı');
      const active = parsePowerSchemes(await ps('powercfg /getactivescheme'))[0];
      const list = parsePowerSchemes(await ps('powercfg /list'));
      return listResult(
        `Etkin güç planı: ${active?.name || '—'}.`,
        'Güç planları',
        list.map((p) => ({ title: p.name, subtitle: p.guid, meta: p.guid === active?.guid ? 'Etkin' : '', icon: 'bolt' })),
        { active: active?.name, plans: list.map((p) => p.name) }
      );
    }
  },
  {
    name: 'sys_set_power_plan',
    category: 'system',
    title: 'Güç planını değiştir',
    description: 'Güç planını Dengeli, Yüksek performans ya da Güç tasarrufu olarak değiştirir.',
    danger: true,
    params: { plan: { type: 'string', enum: Object.keys(POWER_PLANS), description: 'Seçilecek güç planı.', required: true } },
    run: async (a) => {
      const p = POWER_PLANS[Object.keys(POWER_PLANS).find((k) => norm(k) === norm(a.plan))];
      if (!p) throw new ToolError('Geçerli planlar: dengeli, yüksek performans, güç tasarrufu.');
      if (isLinux && await hasBin('powerprofilesctl')) {
        await run('powerprofilesctl', ['set', p.linux]);
      } else if (isWin) {
        const list = parsePowerSchemes(await ps('powercfg /list'));
        if (!list.some((x) => x.guid === p.guid)) {
          throw new ToolError(`${p.label} planı bu bilgisayarda yok.`, 'Bazı dizüstülerde yalnızca Dengeli plan bulunur; performans ayarı Ayarlar > Sistem > Güç bölümündedir.');
        }
        await run('powercfg', ['/setactive', p.guid]);
      } else throw unsupported('Güç planı değiştirme');
      return { summary: `Güç planı ${p.label} olarak ayarlandı.`, display: { type: 'value', label: 'Güç planı', value: p.label, icon: 'bolt' } };
    }
  },
  {
    name: 'sys_restart_explorer',
    category: 'system',
    title: 'Dosya Gezgini\'ni yeniden başlat',
    description: 'Görev çubuğu ya da masaüstü donduğunda Windows Gezgini\'ni (explorer.exe) kapatıp yeniden açar. Açık Gezgin pencereleri kapanır.',
    danger: true,
    params: {},
    run: async () => {
      if (!isWin) throw unsupported('Dosya Gezgini\'ni yeniden başlatma');
      await ps('Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1500; if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }');
      return { summary: 'Dosya Gezgini yeniden başlatıldı.', display: { type: 'value', label: 'Dosya Gezgini', value: 'Yeniden başlatıldı', icon: 'folder' } };
    }
  },
  {
    name: 'sys_winget_search',
    category: 'system',
    title: 'winget ile program ara',
    description: 'Windows Paket Yöneticisi (winget) deposunda program arar; kurmadan önce doğru kimliği (Id) bulmak için kullan.',
    params: { query: { type: 'string', description: 'Program adı, ör. "vlc".', required: true } },
    timeout: 90000,
    run: async (a) => {
      const q = safeName(a.query, 'Arama ifadesi');
      const r = await winget(['search', q, ...WINGET_ACCEPT], 80000);
      const rows = parseWingetTable(r.out);
      if (!rows.length) return { summary: `winget'te "${q}" için sonuç bulunamadı.`, data: { results: [] } };
      return listResult(
        `"${q}" için ${rows.length} sonuç. İlkler: ${rows.slice(0, 4).map((x) => `${x.name} (${x.id})`).join(', ')}.`,
        `winget: ${q}`,
        rows.slice(0, 40).map((x) => ({ title: x.name, subtitle: x.id, meta: [x.version, x.source].filter(Boolean).join(' · '), icon: 'cube' })),
        rows.slice(0, 25).map((x) => ({ name: x.name, id: x.id, version: x.version, source: x.source }))
      );
    }
  },
  {
    name: 'sys_winget_install',
    category: 'system',
    title: 'winget ile program kur',
    description: 'Bir programı winget ile kimliğine (Id) göre kurar. Kimliği bilmiyorsan önce sys_winget_search ile ara.',
    danger: true,
    params: { id: { type: 'string', description: 'winget paket kimliği, ör. "VideoLAN.VLC".', required: true } },
    timeout: 15 * 60000,
    run: async (a) => {
      const id = safeName(a.id, 'Paket kimliği');
      const r = await winget(['install', '--id', id, '-e', '--accept-package-agreements', '--accept-source-agreements'], 15 * 60000 - 5000);
      const tail = wingetTail(r.out + '\n' + r.err);
      if (r.code !== 0) throw new ToolError(`${id} kurulamadı.`, tail || `winget çıkış kodu ${r.code}`);
      return { summary: `${id} kuruldu.`, display: { type: 'code', title: `winget install ${id}`, text: tail }, data: { id, output: truncate(tail, 1500) } };
    }
  },
  {
    name: 'sys_winget_upgrades',
    category: 'system',
    title: 'Güncellenebilir programlar',
    description: 'winget ile güncellemesi bulunan programları mevcut ve yeni sürümleriyle listeler.',
    params: {},
    timeout: 120000,
    run: async () => {
      const r = await winget(['upgrade', ...WINGET_ACCEPT], 110000);
      const rows = parseWingetTable(r.out);
      if (!rows.length) return { summary: 'Güncellenecek program yok; hepsi güncel görünüyor.', display: { type: 'value', label: 'Güncellemeler', value: 'Hepsi güncel', icon: 'sparkles' }, data: { count: 0 } };
      return listResult(
        `${rows.length} program güncellenebilir: ${rows.slice(0, 6).map((x) => x.name).join(', ')}.`,
        `Güncellemeler (${rows.length})`,
        rows.map((x) => ({ title: x.name, subtitle: x.id, meta: `${x.version} → ${x.extra[0] || '?'}`, icon: 'arrows' })),
        rows.slice(0, 40).map((x) => ({ name: x.name, id: x.id, current: x.version, available: x.extra[0] || '' }))
      );
    }
  },
  {
    name: 'sys_winget_upgrade',
    category: 'system',
    title: 'Programı güncelle',
    description: 'Bir programı winget ile günceller ya da all=true ile güncellemesi olan tüm programları günceller.',
    danger: true,
    params: {
      id: { type: 'string', description: 'Güncellenecek paketin winget kimliği, ör. "Mozilla.Firefox".' },
      all: { type: 'boolean', description: 'true ise tüm programlar güncellenir.' }
    },
    timeout: 30 * 60000,
    run: async (a) => {
      if (!a.all && !a.id) throw new ToolError('Bir paket kimliği (id) ver ya da hepsini güncellemek için all=true kullan.');
      const target = a.all ? ['--all'] : ['--id', safeName(a.id, 'Paket kimliği'), '-e'];
      const r = await winget(['upgrade', ...target, '--accept-package-agreements', '--accept-source-agreements'], 30 * 60000 - 5000);
      const tail = wingetTail(r.out + '\n' + r.err);
      const what = a.all ? 'Tüm programlar' : a.id;
      if (r.code !== 0) throw new ToolError(`${what} güncellenemedi.`, tail || `winget çıkış kodu ${r.code}`);
      return { summary: `${what} güncellendi.`, display: { type: 'code', title: `winget upgrade ${a.all ? '--all' : a.id}`, text: tail }, data: { target: what, output: truncate(tail, 1500) } };
    }
  },
  {
    name: 'sys_env_vars',
    category: 'system',
    title: 'Ortam değişkenleri',
    description: 'Ortam değişkenlerini (PATH, TEMP...) listeler. Anahtar/şifre içerebilecek değerler gizlenir.',
    params: { filter: { type: 'string', description: 'Değişken adında ya da değerinde aranacak ifade (isteğe bağlı).' } },
    run: async (a) => {
      const all = Object.entries(process.env).sort(([x], [y]) => x.localeCompare(y));
      const shown = all.map(([k, v]) => [k, SECRET_ENV.test(k) ? '•••••• (gizli)' : String(v)])
        .filter(([k, v]) => matches(a.filter, k, v === '•••••• (gizli)' ? '' : v));
      const short = (v, n) => (v.length > n ? v.slice(0, n) + '…' : v);
      return listResult(
        `${shown.length} ortam değişkeni${a.filter ? ` "${a.filter}" ile eşleşti` : ''}.${shown.length && shown.length <= 3 ? ' ' + shown.map(([k, v]) => `${k} = ${short(v, 100)}`).join('; ') : ''}`,
        `Ortam değişkenleri (${shown.length})`,
        shown.slice(0, 100).map(([k, v]) => ({ title: k, subtitle: short(v, 160), icon: 'terminal' })),
        Object.fromEntries(shown.slice(0, 40).map(([k, v]) => [k, short(v, 120)]))
      );
    }
  },
  {
    name: 'sys_hosts_file',
    category: 'system',
    title: 'Hosts dosyasını göster',
    description: 'Sistemin hosts dosyasını (alan adı yönlendirmeleri) salt okunur olarak gösterir.',
    params: {},
    run: async () => {
      const p = isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts';
      let text;
      try { text = await fsp.readFile(p, 'utf8'); } catch (e) { throw new ToolError(`Hosts dosyası okunamadı: ${p}`, e.code); }
      const entries = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      return {
        summary: entries.length ? `Hosts dosyasında ${entries.length} etkin kayıt var.` : 'Hosts dosyasında etkin kayıt yok; yalnızca açıklama satırları var.',
        display: { type: 'code', title: p, text: truncate(text, 6000) },
        data: { path: p, entries: entries.slice(0, 60) }
      };
    }
  },
  {
    name: 'sys_fonts',
    category: 'system',
    title: 'Yüklü yazı tipleri',
    description: 'Bilgisayarda yüklü yazı tipi ailelerini listeler; bir yazı tipinin kurulu olup olmadığını öğrenmek için filtre ver.',
    params: { filter: { type: 'string', description: 'Yazı tipi adında aranacak ifade, ör. "roboto" (isteğe bağlı).' } },
    timeout: 60000,
    run: async (a) => {
      let names;
      if (isWin) {
        names = (await ps('Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }')).split(/\r?\n/);
      } else if (await hasBin('fc-list')) {
        names = (await run('fc-list', [':', 'family'], { timeout: 30000 })).split('\n').map((l) => l.split(',')[0]);
      } else if (isMac) {
        names = [];
        for (const dir of ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')]) {
          try { for (const n of await fsp.readdir(dir)) if (/\.(ttf|otf|ttc|dfont)$/i.test(n)) names.push(n.replace(/\.[^.]+$/, '')); } catch { /* missing */ }
        }
      } else throw unsupported('Yazı tipi listesi');
      names = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'tr'));
      const hits = names.filter((n) => matches(a.filter, n));
      return listResult(
        a.filter ? (hits.length ? `"${a.filter}" ile eşleşen ${hits.length} yazı tipi: ${hits.slice(0, 6).join(', ')}.` : `"${a.filter}" adlı yazı tipi yüklü değil.`) : `${hits.length} yazı tipi ailesi yüklü.`,
        `Yazı tipleri (${hits.length})`,
        hits.slice(0, 120).map((n) => ({ title: n, icon: 'note' })),
        { count: hits.length, fonts: hits.slice(0, 80) }
      );
    }
  },
  {
    name: 'sys_drivers',
    category: 'system',
    title: 'Sürücüler',
    description: 'Yüklü aygıt sürücülerini sürüm ve tarihleriyle listeler (en yeni 50). Aygıt adı, üretici ya da sınıfa göre filtrelenebilir.',
    params: { filter: { type: 'string', description: 'Aygıt adı, üretici ya da sınıf, ör. "nvidia", "net" (isteğe bağlı).' } },
    timeout: 120000,
    run: async (a) => {
      const list = (await winList('Sürücü listesi',
        "Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | Select-Object DeviceName, DriverVersion, DriverProviderName, DeviceClass, @{n='Date';e={ if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' } }}",
        { timeout: 110000 }))
        .filter((d) => matches(a.filter, d.DeviceName, d.DriverProviderName, d.DeviceClass))
        .sort((x, y) => String(y.Date).localeCompare(String(x.Date)));
      const top = list.slice(0, 50);
      return listResult(
        top.length ? `${list.length} sürücü bulundu${a.filter ? ` ("${a.filter}")` : ''}. En yeniler: ${top.slice(0, 3).map((d) => `${d.DeviceName} ${d.DriverVersion}`).join(', ')}.` : 'Eşleşen sürücü bulunamadı.',
        `Sürücüler (${top.length}/${list.length})`,
        top.map((d) => ({ title: d.DeviceName, subtitle: [d.DriverProviderName, d.DeviceClass].filter(Boolean).join(' · '), meta: `${d.DriverVersion || '—'} · ${d.Date || '—'}`, icon: 'gear' })),
        top.slice(0, 35).map((d) => ({ device: d.DeviceName, version: d.DriverVersion, date: d.Date }))
      );
    }
  },
  {
    name: 'sys_event_errors',
    category: 'system',
    title: 'Sistem olay günlüğü hataları',
    description: 'Son 24 saatte sistem olay günlüğüne düşen hataları (en son 15) gösterir; çökme ya da donma sebebini ararken kullan.',
    params: {},
    timeout: 60000,
    run: async () => {
      let list;
      if (isWin) {
        list = asArray(await psJson(
          "$e=Get-WinEvent -FilterHashtable @{LogName='System'; Level=2; StartTime=(Get-Date).AddHours(-24)} -MaxEvents 15 -ErrorAction SilentlyContinue; " +
          "@($e | ForEach-Object { [pscustomobject]@{ Time=$_.TimeCreated.ToString('yyyy-MM-dd HH:mm'); Source=$_.ProviderName; Id=$_.Id; Msg=(([string]$_.Message) -split '\\r?\\n')[0].Trim() } })",
          { timeout: 50000 }
        )).map((e) => ({ time: e.Time, source: e.Source, id: e.Id, message: e.Msg || '' }));
      } else if (isLinux) {
        const out = await run('journalctl', ['-p', 'err', '-S', '-24h', '-n', '15', '--no-pager', '-o', 'short-iso', '-q'], { timeout: 30000, env: C_ENV });
        list = out.split('\n').map((l) => l.match(/^(\S+)\s+\S+\s+([^:[]+)(?:\[\d+\])?:\s*(.*)$/)).filter(Boolean)
          .map((m) => ({ time: m[1].replace('T', ' ').slice(0, 16), source: m[2], id: '', message: m[3] })).reverse();
      } else throw unsupported('Olay günlüğü');
      if (!list.length) return { summary: 'Son 24 saatte sistem günlüğünde hata yok.', display: { type: 'value', label: 'Sistem hataları (24 sa)', value: '0', icon: 'shield' }, data: { count: 0 } };
      return listResult(
        `Son 24 saatte ${list.length} sistem hatası. En son: ${list[0].source} — ${truncate(list[0].message, 140)}`,
        'Sistem hataları (son 24 saat)',
        list.map((e) => ({ title: truncate(e.message || '(açıklama yok)', 160), subtitle: `${e.source}${e.id ? ` · olay ${e.id}` : ''}`, meta: e.time, icon: 'warning' })),
        list.map((e) => ({ time: e.time, source: e.source, id: e.id, message: truncate(e.message, 200) }))
      );
    }
  }
];

module.exports = tools;
Object.defineProperty(module.exports, 'parsers', {
  enumerable: false,
  value: { parseWingetTable, parseNetshNetworks, parseNetshProfiles, parseWlanInterface, parsePowerSchemes, parsePs, groupProcs, parseSs, parseLpstat, parseOsRelease, splitNmcli, wingetTail }
});
