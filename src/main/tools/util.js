'use strict';

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLATFORM = process.platform;
const isWin = PLATFORM === 'win32';
const isMac = PLATFORM === 'darwin';
const isLinux = PLATFORM === 'linux';

class ToolError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

/** Runs a binary without a shell. Resolves stdout; rejects with a readable message. */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: opts.timeout ?? 20000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return reject(new ToolError(`"${cmd}" bu sistemde bulunamadı.`, opts.missingHint));
        }
        const msg = (stderr || err.message || '').toString().trim().split('\n').slice(-3).join(' ');
        return reject(new ToolError(msg || `${cmd} başarısız oldu.`));
      }
      resolve((stdout || '').toString());
    });
  });
}

/** Starts a process detached from Vektör so it outlives the app. */
function launch(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: opts.shell ?? false, cwd: opts.cwd });
    } catch (e) {
      return reject(new ToolError(e.message));
    }
    child.once('error', (e) => reject(new ToolError(e.code === 'ENOENT' ? `"${cmd}" bulunamadı.` : e.message)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/* ------------------------------------------------------------ PowerShell */

const psStr = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

function ps(script, opts = {}) {
  const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;${script}`, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: opts.timeout ?? 30000 });
}

async function psJson(script, opts) {
  const out = await ps(`${script} | ConvertTo-Json -Depth 4 -Compress`, opts);
  const text = out.trim();
  if (!text) return null;
  return JSON.parse(text);
}

/*
 * Windows native helpers (volume, keyboard, mouse, windows) live in one C# file.
 * It is compiled once into the user's app-data folder and loaded from there on
 * later calls, which keeps each call well under a second.
 */
let nativeDir = path.join(os.tmpdir(), 'vektor-native');
function setNativeDir(dir) { nativeDir = dir; }

async function winNative(body, opts) {
  // The source is copied out first: PowerShell cannot read files packed inside app.asar.
  const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'VektorNative.cs'), 'utf8');
  const version = require('node:crypto').createHash('sha1').update(source).digest('hex').slice(0, 10);
  const dll = path.join(nativeDir, `VektorNative-${version}.dll`);
  let loader = `Add-Type -Path ${psStr(dll)};`;
  if (!fs.existsSync(dll)) {
    fs.mkdirSync(nativeDir, { recursive: true });
    const src = path.join(nativeDir, `VektorNative-${version}.cs`);
    fs.writeFileSync(src, source);
    loader = `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${psStr(src)})) -OutputAssembly ${psStr(dll)} -OutputType Library;` + loader;
  }
  return ps(loader + body, opts);
}

/* ----------------------------------------------------------- AppleScript */

const osaStr = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function osa(script, opts = {}) {
  return run('osascript', ['-e', script], opts);
}

function jxa(script, opts = {}) {
  return run('osascript', ['-l', 'JavaScript', '-e', script], opts);
}

/* -------------------------------------------------------------- Linux */

async function hasBin(name) {
  try {
    await run(isWin ? 'where' : 'which', [name], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

async function linuxFirst(candidates) {
  for (const [bin, args] of candidates) {
    if (await hasBin(bin)) return run(bin, args);
  }
  throw new ToolError(
    `Bu işlem için şu araçlardan biri gerekli: ${candidates.map((c) => c[0]).join(', ')}.`,
    'Paket yöneticinle kurabilirsin (ör. sudo apt install ' + candidates[0][0] + ').'
  );
}

/* ------------------------------------------------------------ Matching */

/** Case- and accent-insensitive key for Turkish text: "İndirilenler", "Indirilenler" and "indirilenler" all match. */
function norm(s) {
  return String(s ?? '').replace(/ı/g, 'i').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/* --------------------------------------------------------------- Paths */

let knownDirs = null;
function setKnownDirs(dirs) { knownDirs = dirs; }

const ALIASES = {
  desktop: ['masaüstü', 'masaustu', 'desktop'],
  downloads: ['indirilenler', 'indirmeler', 'downloads', 'download'],
  documents: ['belgeler', 'dokümanlar', 'belgelerim', 'documents'],
  pictures: ['resimler', 'fotoğraflar', 'pictures', 'photos'],
  music: ['müzik', 'muzik', 'music'],
  videos: ['videolar', 'videos', 'movies'],
  home: ['ev', 'home', 'kullanıcı', '~']
};

function dirFor(key) {
  if (knownDirs && knownDirs[key]) return knownDirs[key];
  const home = os.homedir();
  const map = { home, desktop: 'Desktop', downloads: 'Downloads', documents: 'Documents', pictures: 'Pictures', music: 'Music', videos: isMac ? 'Movies' : 'Videos' };
  return key === 'home' ? home : path.join(home, map[key]);
}

/** Resolves "~/x", "masaüstü/x", "Downloads" and relative paths to an absolute path. */
function resolvePath(input, base) {
  if (!input || typeof input !== 'string') throw new ToolError('Bir dosya yolu belirtmelisin.');
  let p = input.trim().replace(/^["']|["']$/g, '');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) {
    const [head, ...rest] = p.split(/[\\/]/);
    const lower = norm(head);
    const key = Object.keys(ALIASES).find((k) => ALIASES[k].some((w) => norm(w) === lower));
    p = key ? path.join(dirFor(key), ...rest) : path.join(base || dirFor('home'), p);
  }
  return path.normalize(p);
}

/* ----------------------------------------------------------- Formatting */

function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${units[i]}`;
}

function duration(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const parts = [];
  if (d) parts.push(`${d} gün`);
  if (h) parts.push(`${h} sa`);
  if (m) parts.push(`${m} dk`);
  if (!d && !h && (s || !parts.length)) parts.push(`${s} sn`);
  return parts.join(' ');
}

function truncate(text, max = 4000) {
  text = String(text ?? '');
  return text.length > max ? text.slice(0, max) + `\n… (${text.length - max} karakter daha)` : text;
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'Vektor/0.1 (desktop assistant)', ...(opts.headers || {}) } });
    return res;
  } catch (e) {
    throw new ToolError(e.name === 'AbortError' ? 'İstek zaman aşımına uğradı.' : `Bağlantı kurulamadı: ${e.cause?.code || e.message}`);
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, opts, ms) {
  const res = await fetchWithTimeout(url, opts, ms);
  if (!res.ok) throw new ToolError(`Sunucu ${res.status} döndürdü.`);
  return res.json();
}

function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) throw new ToolError('Bir adres belirtmelisin.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  const parsed = new URL(u);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ToolError('Yalnızca http ve https adresleri açılabilir.');
  return parsed.toString();
}

function unsupported(feature) {
  return new ToolError(`${feature} bu işletim sisteminde (${PLATFORM}) desteklenmiyor.`);
}

module.exports = {
  PLATFORM, isWin, isMac, isLinux,
  ToolError, norm, run, launch, ps, psJson, psStr, winNative, setNativeDir,
  osa, osaStr, jxa, hasBin, linuxFirst,
  resolvePath, dirFor, setKnownDirs,
  bytes, duration, truncate, fetchWithTimeout, fetchJson, normalizeUrl, unsupported
};
