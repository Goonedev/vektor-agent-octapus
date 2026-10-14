'use strict';

/*
 * Developer pack: git, npm scripts, HTTP requests, ports, toolchain versions, docker,
 * .gitignore templates and a cron explainer. Output parsing is pure and exported as `parsers`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { isWin, ToolError, resolvePath, fetchWithTimeout, normalizeUrl, truncate, psJson } = require('../util');
const { asArray } = require('./kit');

/* ------------------------------------------------------------ helpers */

/** Like util.run but never rejects on a non-zero exit: resolves { code, out, missing }. */
function exec(cmd, args, { cwd, timeout = 20000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, ...(env || {}) }
    }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ missing: true, code: -1, out: '', stdout: '', stderr: '' });
      const code = err ? (err.killed ? 'zaman aşımı' : typeof err.code === 'number' ? err.code : 1) : 0;
      const out = [stdout, stderr].map((s) => String(s || '').trimEnd()).filter(Boolean).join('\n');
      resolve({ code, out, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** npm is a .cmd shim on Windows, which execFile cannot start without a shell; args are validated by callers. */
const npmCmd = (args) => (isWin ? ['cmd.exe', ['/d', '/s', '/c', 'npm', ...args]] : ['npm', args]);

const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C' };

function projectDir(input) {
  const p = resolvePath(input);
  if (!fs.existsSync(p)) throw new ToolError(`${p} bulunamadı.`);
  return fs.statSync(p).isDirectory() ? p : path.dirname(p);
}

function gitError(out) {
  const t = String(out || '');
  if (/not a git repository/i.test(t)) return new ToolError('Bu klasör bir git deposu değil.', 'Proje klasörünün yolunu ver.');
  if (/does not have any commits yet|unknown revision|bad default revision/i.test(t)) return new ToolError('Bu depoda henüz commit yok.');
  if (/could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(t)) return new ToolError('Uzak depoya kimlik doğrulaması yapılamadı.', 'Git kimlik bilgilerini terminalden bir kez ayarla.');
  return new ToolError(t.trim().split('\n').slice(-3).join(' ') || 'git komutu başarısız oldu.');
}

async function git(dir, args, opts = {}) {
  const r = await exec('git', ['-C', dir, ...args], { timeout: opts.timeout ?? 20000, env: GIT_ENV });
  if (r.missing) throw new ToolError('git bu sistemde bulunamadı.', 'git-scm.com adresinden kurabilirsin.');
  if (r.code !== 0 && !opts.allowFail) throw gitError(r.out);
  return r;
}

/* ------------------------------------------------------------- parsers */

const SEP = '\x1f';

function ago(sec, now = Date.now()) {
  const s = Math.max(0, Math.round(now / 1000 - Number(sec)));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)} gün önce`;
  if (s < 86400 * 730) return `${Math.floor(s / (86400 * 30))} ay önce`;
  return `${Math.floor(s / (86400 * 365))} yıl önce`;
}

const trackTr = (t) => String(t || '').replace(/^\[|\]$/g, '').replace(/ahead (\d+)/, '$1 ileride').replace(/behind (\d+)/, '$1 geride').replace(/^gone$/, 'uzak dal silinmiş');

function parseGitLog(text, now = Date.now()) {
  return String(text || '').split('\n').filter(Boolean).map((l) => {
    const [hash, author, ts, ...subject] = l.split(SEP);
    return { hash, author, when: ago(ts, now), time: Number(ts) * 1000, subject: subject.join(SEP) };
  });
}

function parseNumstat(text) {
  const files = String(text || '').split('\n').filter(Boolean).map((l) => {
    const [add, del, ...name] = l.split('\t');
    const bin = add === '-';
    return { file: name.join('\t'), added: bin ? 0 : Number(add), removed: bin ? 0 : Number(del), binary: bin };
  });
  return { files, added: files.reduce((s, f) => s + f.added, 0), removed: files.reduce((s, f) => s + f.removed, 0) };
}

function parseBranches(text, now = Date.now()) {
  const local = [], remote = [];
  for (const l of String(text || '').split('\n').filter(Boolean)) {
    const [head, ref, ts, track, symref, ...subject] = l.split(SEP);
    if (symref) continue;
    const b = { current: head === '*', when: ago(ts, now), track: trackTr(track), subject: subject.join(SEP) };
    if (ref.startsWith('refs/heads/')) local.push({ ...b, name: ref.slice(11) });
    else if (ref.startsWith('refs/remotes/')) { if (!ref.endsWith('/HEAD')) remote.push({ ...b, name: ref.slice(13) }); }
  }
  return { local, remote, current: local.find((b) => b.current)?.name || null };
}

function parsePackageScripts(pkgText) {
  let pkg;
  try { pkg = JSON.parse(pkgText); } catch { throw new ToolError('package.json okunamadı (geçersiz JSON).'); }
  return { name: pkg.name || null, version: pkg.version || null, scripts: Object.entries(pkg.scripts || {}).map(([name, cmd]) => ({ name, cmd: String(cmd) })) };
}

function parseLsof(text, port) {
  const seen = new Map();
  for (const l of String(text || '').split('\n').slice(1)) {
    const cols = l.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const name = cols.slice(8).join(' ');
    const state = (name.match(/\(([A-Z_]+)\)$/) || [])[1] || (cols[7] === 'UDP' ? 'UDP' : '');
    const local = name.replace(/\s*\([A-Z_]+\)$/, '').split('->')[0];
    if (port && !local.endsWith(`:${port}`)) continue;
    const pid = Number(cols[1]);
    if (!seen.has(pid) || state === 'LISTEN') seen.set(pid, { pid, name: cols[0], user: cols[2], state, local });
  }
  return [...seen.values()];
}

function parseSs(text, port) {
  const out = new Map();
  for (const l of String(text || '').split('\n').filter(Boolean)) {
    const cols = l.trim().split(/\s+/);
    const [state, , , local] = cols;
    if (port && !String(local).endsWith(`:${port}`)) continue;
    for (const m of l.matchAll(/\("([^"]+)",pid=(\d+)/g)) {
      const pid = Number(m[2]);
      if (!out.has(pid) || state === 'LISTEN') out.set(pid, { pid, name: m[1], state, local });
    }
  }
  return [...out.values()];
}

function parseVersion(text) {
  const t = String(text || '').split('\n').filter((l) => !/^(Picked up|NOTE:|WARNING:)/i.test(l.trim())).join('\n');
  const m = t.match(/version\s+"?v?(\d+(?:\.\d+)+)/i) || t.match(/v?(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function parseDockerPs(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => {
    let j;
    try { j = JSON.parse(l); } catch { return null; }
    return { id: j.ID, name: j.Names, image: j.Image, status: j.Status, state: j.State || (/^Up/i.test(j.Status || '') ? 'running' : 'exited'), ports: j.Ports || '' };
  }).filter(Boolean);
}

function describeJson(v) {
  if (Array.isArray(v)) return `dizi, ${v.length} öğe`;
  if (v && typeof v === 'object') { const k = Object.keys(v); return `nesne, ${k.length} anahtar: ${k.slice(0, 8).join(', ')}${k.length > 8 ? '…' : ''}`; }
  return typeof v;
}

function pickPath(v, p) {
  if (!p) return v;
  let cur = v;
  for (const key of String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object' || !(key in cur)) throw new ToolError(`“${p}” yolu yanıtta bulunamadı (takıldığı yer: ${key}).`);
    cur = cur[key];
  }
  return cur;
}

/* --------------------------------------------------------------- cron */

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const FIELDS = [
  { key: 'minute', label: 'dakika', min: 0, max: 59 },
  { key: 'hour', label: 'saat', min: 0, max: 23 },
  { key: 'dom', label: 'ayın günü', min: 1, max: 31 },
  { key: 'month', label: 'ay', min: 1, max: 12, names: MONTH_NAMES },
  { key: 'dow', label: 'haftanın günü', min: 0, max: 7, names: DOW_NAMES }
];
const MACROS = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };

function parseField(expr, f) {
  const num = (s) => {
    const k = String(s).toLowerCase();
    const n = f.names && k in f.names ? f.names[k] : /^\d+$/.test(k) ? Number(k) : NaN;
    if (!Number.isInteger(n) || n < f.min || n > f.max) throw new ToolError(`Cron ${f.label} alanında geçersiz değer: “${s}” (${f.min}–${f.max}).`);
    return n;
  };
  const tokens = [];
  const values = new Set();
  for (const tok of expr.split(',')) {
    if (!tok) throw new ToolError(`Cron ${f.label} alanı hatalı: “${expr}”.`);
    const [base, stepStr, extra] = tok.split('/');
    if (extra !== undefined) throw new ToolError(`Cron ${f.label} alanı hatalı: “${tok}”.`);
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new ToolError(`Cron ${f.label} alanında geçersiz adım: “${tok}”.`);
    let a, b, type;
    if (base === '*') { a = f.min; b = f.key === 'dow' ? 6 : f.max; type = stepStr ? 'step' : 'all'; }
    else if (base.includes('-')) { const [x, y] = base.split('-'); a = num(x); b = num(y); type = 'range'; if (b < a) throw new ToolError(`Cron ${f.label} aralığı ters: “${tok}”.`); }
    else { a = num(base); b = stepStr ? (f.key === 'dow' ? 6 : f.max) : a; type = stepStr ? 'range' : 'value'; }
    for (let v = a; v <= b; v += step) values.add(f.key === 'dow' ? v % 7 : v);
    tokens.push({ type, a, b, step });
  }
  return { expr, star: expr.startsWith('*'), tokens, values: [...values].sort((x, y) => x - y) };
}

function parseCron(expression) {
  let e = String(expression || '').trim().toLowerCase();
  if (e === '@reboot') throw new ToolError('@reboot zamanla değil, açılışta çalışır; sonraki çalışma zamanı hesaplanamaz.');
  e = MACROS[e] || e;
  const parts = e.split(/\s+/);
  if (parts.length !== 5) throw new ToolError(`Cron ifadesi 5 alan olmalı (dakika saat gün ay haftagünü); ${parts.length} alan verildi.`);
  const out = {};
  FIELDS.forEach((f, i) => { out[f.key] = parseField(parts[i], f); });
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

function listTr(arr) {
  return arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} ve ${arr[arr.length - 1]}`;
}

function tokensText(field, fmt, unit) {
  return listTr(field.tokens.map((t) => {
    if (t.type === 'step') return `her ${t.step} ${unit}`;
    if (t.type === 'range') return t.step > 1 ? `${fmt(t.a)}–${fmt(t.b)} arası her ${t.step} ${unit}` : `${fmt(t.a)}–${fmt(t.b)}`;
    return fmt(t.a);
  }));
}

function explainCron(expression) {
  const c = parseCron(expression);
  const onlyValues = (f) => f.tokens.every((t) => t.type === 'value');
  const allStar = (f) => f.tokens.length === 1 && f.tokens[0].type === 'all';
  const parts = [];

  if (!allStar(c.month)) parts.push(`${tokensText(c.month, (v) => MONTHS_TR[v - 1], 'ayda')} aylarında`);

  const domR = !c.dom.star, dowR = !c.dow.star;
  const dowText = () => {
    const t = c.dow.tokens.map((x) => (x.type === 'range' && x.step === 1 ? `${DAYS_TR[x.a % 7]}–${DAYS_TR[x.b % 7]}` : null));
    return t.every(Boolean) ? `${listTr(t)} günleri` : `${listTr(c.dow.values.map((v) => DAYS_TR[v]))} günleri`;
  };
  const domText = () => `ayın ${tokensText(c.dom, (v) => `${v}.`, 'günde')} günü`;
  if (domR && dowR) parts.push(`${domText()} veya ${dowText()}`);
  else if (domR) parts.push(domText());
  else if (dowR) parts.push(dowText());
  else if (allStar(c.dom) && allStar(c.dow)) parts.push('her gün');
  else parts.push(`her gün (${c.dom.expr} ${c.dow.expr})`);

  const m = c.minute, h = c.hour;
  if (onlyValues(m) && onlyValues(h) && m.values.length * h.values.length <= 8) {
    parts.push(`saat ${listTr(h.values.flatMap((hh) => m.values.map((mm) => `${pad(hh)}:${pad(mm)}`)))}`);
  } else {
    if (!allStar(h)) {
      if (h.tokens.length === 1 && h.tokens[0].type === 'range' && h.tokens[0].step === 1) parts.push(`${pad(h.tokens[0].a)}:00–${pad(h.tokens[0].b)}:59 arasında`);
      else if (h.tokens.length === 1 && h.tokens[0].type === 'step') parts.push(`her ${h.tokens[0].step} saatte bir`);
      else if (onlyValues(h)) parts.push(`${listTr(h.values.map((v) => `${pad(v)}:00`))} saatlerinde`);
      else parts.push(`saat ${tokensText(h, pad, 'saatte')}`);
    }
    if (allStar(m)) parts.push('her dakika');
    else if (m.tokens.length === 1 && m.tokens[0].type === 'step') parts.push(`her ${m.tokens[0].step} dakikada bir (${listTr(m.values.slice(0, 6).map((v) => `:${pad(v)}`))}${m.values.length > 6 ? '…' : ''})`);
    else if (onlyValues(m) && allStar(h) && m.values.length === 1 && m.values[0] === 0) parts.push('her saat başı');
    else if (onlyValues(m)) parts.push(`${allStar(h) ? 'her saatin' : 'saatin'} ${listTr(m.values.map((v) => `${v}.`))} dakikasında`);
    else parts.push(`dakika ${tokensText(m, pad, 'dakikada')}`);
  }
  const text = allStar(m) && allStar(h) && allStar(c.dom) && allStar(c.dow) && allStar(c.month) ? 'Her dakika' : parts.join(', ');
  return { text: text.charAt(0).toLocaleUpperCase('tr') + text.slice(1), cron: c };
}

/** Next `n` run times after `from` (local time). */
function nextRuns(expression, from = new Date(), n = 5) {
  const c = typeof expression === 'string' ? parseCron(expression) : expression;
  const months = new Set(c.month.values), doms = new Set(c.dom.values), dows = new Set(c.dow.values);
  const dayOk = (d) => {
    const dm = doms.has(d.getDate()), dw = dows.has(d.getDay());
    if (c.dom.star && c.dow.star) return true;
    if (c.dom.star) return dw;
    if (c.dow.star) return dm;
    return dm || dw;
  };
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const out = [];
  for (let i = 0; i < 366 * 8 && out.length < n; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (!months.has(day.getMonth() + 1) || !dayOk(day)) continue;
    for (const h of c.hour.values) {
      for (const m of c.minute.values) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        if (t < start || t.getHours() !== h || t.getMinutes() !== m) continue;
        out.push(t);
        if (out.length >= n) return out;
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- ports */

async function portProcesses(port) {
  if (isWin) {
    const rows = await psJson(`@(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{ pid = [int]$_.OwningProcess; name = [string]$p.ProcessName; path = [string]$p.Path; state = [string]$_.State; local = "$($_.LocalAddress):$($_.LocalPort)" } })`);
    const seen = new Map();
    for (const r of asArray(rows)) if (r && (!seen.has(r.pid) || r.state === 'Listen')) seen.set(r.pid, r);
    return [...seen.values()];
  }
  const l = await exec('lsof', ['-nP', `-i:${port}`], { timeout: 10000 });
  if (!l.missing) return parseLsof(l.stdout, port);
  const s = await exec('ss', ['-Htanp', 'sport', '=', `:${port}`], { timeout: 10000 });
  if (s.missing) throw new ToolError('Port sorgusu için lsof ya da ss gerekli.', 'sudo apt install lsof');
  return parseSs(s.stdout, port);
}

function checkPortArg(port) {
  if (!(Number.isInteger(port) && port > 0 && port < 65536)) throw new ToolError('Port 1–65535 arasında bir tam sayı olmalı.');
  return port;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/* -------------------------------------------------------------- tools */

const pathParam = { path: { type: 'string', description: 'Proje klasörü, ör. "~/projeler/site".', required: true } };
const terminal = (command, cwd, output, code = 0) => ({ type: 'terminal', command, cwd, output: truncate(output || '', 4000), code });

module.exports = [
  {
    name: 'dev_git_log',
    category: 'dev',
    title: 'Git geçmişi',
    description: 'Bir git deposunun son commitlerini (hash, yazar, zaman, mesaj) listeler.',
    params: { ...pathParam, count: { type: 'integer', description: 'Kaç commit. Varsayılan 15, en çok 100.' } },
    run: async (a) => {
      const dir = projectDir(a.path);
      const n = Math.max(1, Math.min(100, a.count || 15));
      const r = await git(dir, ['log', '-n', String(n), '--format=%h%x1f%an%x1f%ct%x1f%s']);
      const list = parseGitLog(r.stdout);
      if (!list.length) throw new ToolError('Bu depoda henüz commit yok.');
      return {
        summary: `Son ${list.length} commit. En sonuncusu: “${list[0].subject}” (${list[0].author}, ${list[0].when}).`,
        display: { type: 'list', title: `${path.basename(dir)} · git log`, items: list.map((c) => ({ title: c.subject, subtitle: `${c.hash} · ${c.author}`, meta: c.when, icon: 'code' })) },
        data: list.map((c) => `${c.hash} ${c.subject} (${c.author}, ${c.when})`)
      };
    }
  },
  {
    name: 'dev_git_diff',
    category: 'dev',
    title: 'Git değişiklik özeti',
    description: 'Bir depodaki commitlenmemiş değişikliklerin özetini verir: hangi dosyada kaç satır eklendi/silindi, kaç yeni dosya var.',
    params: { ...pathParam, staged: { type: 'boolean', description: 'Yalnızca sahnelenmiş (staged) değişiklikler. Varsayılan false.' } },
    run: async (a) => {
      const dir = projectDir(a.path);
      let r = await git(dir, a.staged ? ['diff', '--cached', '--numstat'] : ['diff', 'HEAD', '--numstat'], { allowFail: !a.staged });
      if (r.code !== 0) r = await git(dir, ['diff', '--numstat']);
      const d = parseNumstat(r.stdout);
      const untracked = a.staged ? [] : (await git(dir, ['ls-files', '--others', '--exclude-standard'])).stdout.split('\n').filter(Boolean);
      if (!d.files.length && !untracked.length) {
        return { summary: a.staged ? 'Sahnelenmiş değişiklik yok.' : 'Çalışma alanı temiz; değişiklik yok.', display: { type: 'value', label: path.basename(dir), value: 'Değişiklik yok', icon: 'code' }, data: { files: 0 } };
      }
      const items = [
        ...d.files.sort((x, y) => y.added + y.removed - (x.added + x.removed)).slice(0, 40).map((f) => ({ title: f.file, meta: f.binary ? 'ikili' : `+${f.added} −${f.removed}`, icon: 'doc', path: path.join(dir, f.file) })),
        ...untracked.slice(0, 20).map((f) => ({ title: f, meta: 'yeni', icon: 'note', path: path.join(dir, f) }))
      ];
      return {
        summary: `${d.files.length} dosya değişti (+${d.added} −${d.removed} satır)${untracked.length ? `, ${untracked.length} yeni (izlenmeyen) dosya` : ''}.`,
        display: { type: 'list', title: `${path.basename(dir)} · ${a.staged ? 'staged' : 'değişiklikler'} · +${d.added} −${d.removed}`, items },
        data: { files: d.files.slice(0, 50).map((f) => `${f.file} +${f.added} -${f.removed}`), added: d.added, removed: d.removed, untracked: untracked.slice(0, 30) }
      };
    }
  },
  {
    name: 'dev_git_branches',
    category: 'dev',
    title: 'Git dalları',
    description: 'Bir depodaki yerel ve uzak dalları, aktif dalı ve uzakla farkını (ahead/behind) son güncellenme sırasına göre listeler.',
    params: pathParam,
    run: async (a) => {
      const dir = projectDir(a.path);
      const fmt = ['%(HEAD)', '%(refname)', '%(committerdate:unix)', '%(upstream:track)', '%(symref)', '%(subject)'].join('%1f');
      const r = await git(dir, ['for-each-ref', '--sort=-committerdate', `--format=${fmt}`, 'refs/heads', 'refs/remotes']);
      const b = parseBranches(r.stdout);
      if (!b.local.length) throw new ToolError('Bu depoda henüz dal yok.');
      return {
        summary: `Aktif dal ${b.current || '—'}. ${b.local.length} yerel, ${b.remote.length} uzak dal: ${b.local.slice(0, 6).map((x) => x.name).join(', ')}.`,
        display: { type: 'list', title: `${path.basename(dir)} · dallar`, items: [
          ...b.local.slice(0, 30).map((x) => ({ title: `${x.current ? '● ' : ''}${x.name}`, subtitle: truncate(x.subject, 90), meta: [x.track, x.when].filter(Boolean).join(' · '), icon: x.current ? 'bolt' : 'code' })),
          ...b.remote.slice(0, 15).map((x) => ({ title: x.name, subtitle: truncate(x.subject, 90), meta: x.when, icon: 'cloud' }))
        ] },
        data: { current: b.current, local: b.local.map((x) => x.name), remote: b.remote.map((x) => x.name) }
      };
    }
  },
  {
    name: 'dev_git_pull',
    category: 'dev',
    title: 'Git pull',
    description: 'Bir depoda uzak daldaki değişiklikleri çeker ve birleştirir (git pull). Çalışma alanını değiştirir.',
    danger: true,
    timeout: 150000,
    params: pathParam,
    run: async (a) => {
      const dir = projectDir(a.path);
      const r = await git(dir, ['pull', '--no-edit'], { timeout: 120000, allowFail: true });
      if (r.code !== 0) throw gitError(r.out);
      const upToDate = /already up.to.date/i.test(r.out);
      const d = upToDate ? parseNumstat('') : parseNumstat((await git(dir, ['diff', '--numstat', 'HEAD@{1}', 'HEAD'], { allowFail: true })).stdout);
      return {
        summary: upToDate ? 'Depo zaten güncel.' : `Güncellendi: ${d.files.length} dosya değişti (+${d.added} −${d.removed}).`,
        display: terminal('git pull', dir, r.out, 0),
        data: { upToDate, files: d.files.length, added: d.added, removed: d.removed }
      };
    }
  },
  {
    name: 'dev_git_commit',
    category: 'dev',
    title: 'Git commit',
    description: 'Sahnelenmiş değişiklikleri verilen mesajla commitler. all=true ise önce tüm değişiklikleri ekler (git add -A). Push yapmaz.',
    danger: true,
    params: {
      ...pathParam,
      message: { type: 'string', description: 'Commit mesajı.', required: true },
      all: { type: 'boolean', description: 'Önce tüm değişiklikleri ekle (git add -A). Varsayılan false.' }
    },
    run: async (a) => {
      const dir = projectDir(a.path);
      const msg = String(a.message || '').trim();
      if (!msg) throw new ToolError('Commit mesajı boş olamaz.');
      if (a.all) await git(dir, ['add', '-A']);
      const staged = await git(dir, ['diff', '--cached', '--quiet'], { allowFail: true });
      if (staged.code === 0) throw new ToolError('Commitlenecek sahnelenmiş değişiklik yok.', a.all ? undefined : 'Tüm değişiklikleri eklemek için all=true kullan.');
      const r = await git(dir, ['commit', '-m', msg], { timeout: 60000, allowFail: true });
      if (r.code !== 0) {
        if (/tell me who you are|user\.email/i.test(r.out)) throw new ToolError('Git kullanıcı adı/e-postası ayarlı değil.', 'git config --global user.name "Ad" ve user.email ayarla.');
        throw gitError(r.out);
      }
      const hash = (await git(dir, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
      const d = parseNumstat((await git(dir, ['show', '--numstat', '--format=', 'HEAD'])).stdout);
      return {
        summary: `Commit ${hash} oluşturuldu: “${msg}” (${d.files.length} dosya, +${d.added} −${d.removed}).`,
        display: terminal(`git commit -m "${truncate(msg, 60)}"`, dir, r.out, 0),
        data: { hash, files: d.files.length, added: d.added, removed: d.removed }
      };
    }
  },
  {
    name: 'dev_npm_scripts',
    category: 'dev',
    title: 'npm scriptleri',
    description: 'Bir projenin package.json dosyasındaki scriptleri (build, dev, test...) ve komutlarını listeler.',
    params: pathParam,
    run: async (a) => {
      const dir = projectDir(a.path);
      const file = path.join(dir, 'package.json');
      if (!fs.existsSync(file)) throw new ToolError(`${dir} içinde package.json yok.`);
      const p = parsePackageScripts(fs.readFileSync(file, 'utf8'));
      const pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock')) ? 'bun' : 'npm';
      if (!p.scripts.length) return { summary: `${p.name || path.basename(dir)} projesinde script tanımlı değil.`, display: { type: 'value', label: p.name || path.basename(dir), value: 'Script yok', icon: 'terminal' }, data: { scripts: [] } };
      return {
        summary: `${p.name || path.basename(dir)} scriptleri: ${p.scripts.map((s) => s.name).join(', ')}.${pm !== 'npm' ? ` Paket yöneticisi: ${pm}.` : ''}`,
        display: { type: 'list', title: `${p.name || path.basename(dir)}${p.version ? ` ${p.version}` : ''} · scriptler`, items: p.scripts.map((s) => ({ title: s.name, subtitle: truncate(s.cmd, 120), icon: 'terminal' })) },
        data: { name: p.name, packageManager: pm, scripts: Object.fromEntries(p.scripts.map((s) => [s.name, truncate(s.cmd, 200)])) }
      };
    }
  },
  {
    name: 'dev_npm_run',
    category: 'dev',
    title: 'npm script çalıştır',
    description: 'Bir projede package.json\'daki bir scripti (npm run <script>) çalıştırır ve çıktının sonunu gösterir. En çok 10 dakika sürer; sürekli çalışan dev sunucuları için uygun değil.',
    danger: true,
    timeout: 620000,
    params: { ...pathParam, script: { type: 'string', description: 'Script adı, ör. "build", "test".', required: true } },
    run: async (a) => {
      const dir = projectDir(a.path);
      const file = path.join(dir, 'package.json');
      if (!fs.existsSync(file)) throw new ToolError(`${dir} içinde package.json yok.`);
      const { scripts } = parsePackageScripts(fs.readFileSync(file, 'utf8'));
      const script = String(a.script).trim();
      if (!scripts.some((s) => s.name === script)) throw new ToolError(`“${script}” scripti yok.`, `Mevcut scriptler: ${scripts.map((s) => s.name).join(', ') || 'yok'}.`);
      if (!/^[\w:.@/-]+$/.test(script)) throw new ToolError('Script adı güvenli olmayan karakterler içeriyor.');
      const [cmd, args] = npmCmd(['run', script]);
      const t0 = Date.now();
      const r = await exec(cmd, args, { cwd: dir, timeout: 600000, env: { FORCE_COLOR: '0', NO_COLOR: '1' } });
      if (r.missing) throw new ToolError('npm bulunamadı.', 'Node.js\'i nodejs.org adresinden kur.');
      const out = r.out.replace(/\x1b\[[0-9;]*m/g, '');
      const secs = Math.round((Date.now() - t0) / 1000);
      return {
        summary: r.code === 0 ? `npm run ${script} başarıyla bitti (${secs} sn).` : r.code === 'zaman aşımı' ? `npm run ${script} 10 dakikada bitmedi ve durduruldu.` : `npm run ${script} hata ile bitti (çıkış kodu ${r.code}).`,
        display: { type: 'terminal', command: `npm run ${script}`, cwd: dir, output: out.length > 4000 ? '…\n' + out.slice(-4000) : out, code: r.code },
        data: { exitCode: r.code, seconds: secs, tail: out.slice(-3000) }
      };
    }
  },
  {
    name: 'dev_http_request',
    category: 'dev',
    title: 'HTTP isteği',
    description: 'Bir adrese GET, POST, PUT, DELETE ya da HEAD isteği atar; durum kodunu, başlıkları ve yanıt gövdesini gösterir. API test etmek için kullan. GET/HEAD dışındaki istekler onay ister.',
    danger: (a) => !['GET', 'HEAD'].includes(String(a.method || 'GET').toUpperCase()),
    params: {
      url: { type: 'string', description: 'İstek adresi.', required: true },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'], description: 'HTTP yöntemi. Varsayılan GET.' },
      body: { type: 'string', description: 'İstek gövdesi (JSON ya da düz metin).' },
      headers_json: { type: 'string', description: 'Ek başlıklar, JSON nesnesi olarak, ör. {"Authorization":"Bearer x"}.' }
    },
    run: async (a) => {
      const url = normalizeUrl(a.url);
      const method = String(a.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(method)) throw new ToolError('Desteklenmeyen HTTP yöntemi.');
      let headers = {};
      if (a.headers_json) {
        try { headers = JSON.parse(a.headers_json); } catch { throw new ToolError('headers_json geçerli bir JSON nesnesi değil.'); }
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new ToolError('headers_json bir JSON nesnesi olmalı.');
      }
      const hasBody = a.body != null && a.body !== '' && !['GET', 'HEAD'].includes(method);
      if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        let json = false;
        try { JSON.parse(a.body); json = true; } catch { json = false; }
        headers['Content-Type'] = json ? 'application/json' : 'text/plain; charset=utf-8';
      }
      const t0 = Date.now();
      const res = await fetchWithTimeout(url, { method, headers, body: hasBody ? a.body : undefined, redirect: 'follow' }, 20000);
      const ms = Date.now() - t0;
      const ct = res.headers.get('content-type') || '';
      let text = method === 'HEAD' ? '' : await res.text().catch(() => '');
      let parsed;
      if (/json/i.test(ct) || /^\s*[[{]/.test(text)) { try { parsed = JSON.parse(text); text = JSON.stringify(parsed, null, 2); } catch { /* not JSON */ } }
      const hdr = [...res.headers.entries()].slice(0, 20).map(([k, v]) => `${k}: ${truncate(v, 160)}`).join('\n');
      return {
        summary: `${method} ${new URL(url).host}: HTTP ${res.status} ${res.statusText || ''} (${ms} ms, ${text.length} karakter${parsed !== undefined ? `, JSON ${describeJson(parsed)}` : ''}).`.replace(/\s+\(/, ' ('),
        display: { type: 'code', title: `${method} ${res.status} · ${ms} ms · ${truncate(url, 80)}`, text: `${hdr}\n\n${truncate(text, 5000)}` },
        data: { status: res.status, ms, contentType: ct, body: truncate(text, 5000) }
      };
    }
  },
  {
    name: 'dev_fetch_json',
    category: 'dev',
    title: 'URL\'den JSON',
    description: 'Bir adresten JSON indirir ve okunaklı biçimde gösterir. İstenirse "data.items.0.name" gibi bir yolla belirli bir alanı seçer.',
    params: {
      url: { type: 'string', description: 'JSON adresi.', required: true },
      pick: { type: 'string', description: 'İsteğe bağlı alan yolu, ör. "data.items[0].name".' }
    },
    run: async (a) => {
      const url = normalizeUrl(a.url);
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
      if (!res.ok) throw new ToolError(`Sunucu ${res.status} döndürdü.`);
      const raw = await res.text();
      let json;
      try { json = JSON.parse(raw); } catch { throw new ToolError('Yanıt geçerli JSON değil.', truncate(raw, 120)); }
      const v = pickPath(json, a.pick);
      const pretty = JSON.stringify(v, null, 2) ?? String(v);
      return {
        summary: `${new URL(url).host}${a.pick ? ` → ${a.pick}` : ''}: ${typeof v === 'object' && v !== null ? describeJson(v) : truncate(String(v), 200)}.`,
        display: { type: 'code', title: `${truncate(url, 70)}${a.pick ? ` · ${a.pick}` : ''}`, text: truncate(pretty, 6000) },
        data: { json: truncate(pretty, 6000) }
      };
    }
  },
  {
    name: 'dev_port_process',
    category: 'dev',
    title: 'Portu kullanan süreç',
    description: 'Bir yerel portu (ör. 3000) hangi programın kullandığını gösterir: süreç adı, PID ve bağlantı durumu.',
    params: { port: { type: 'integer', description: 'Port numarası.', required: true } },
    run: async (a) => {
      const port = checkPortArg(a.port);
      const list = await portProcesses(port);
      if (!list.length) return { summary: `${port} portunu kullanan bir süreç yok; port boş.`, display: { type: 'value', label: `Port ${port}`, value: 'Boş', icon: 'plug' }, data: { port, processes: [] } };
      return {
        summary: `${port} portunu ${list.map((p) => `${p.name || '?'} (PID ${p.pid}${p.state ? `, ${p.state}` : ''})`).join(', ')} kullanıyor.`,
        display: { type: 'list', title: `Port ${port}`, items: list.map((p) => ({ title: p.name || `PID ${p.pid}`, subtitle: [p.local, p.path].filter(Boolean).join(' · '), meta: `PID ${p.pid}${p.state ? ` · ${p.state}` : ''}`, icon: 'plug' })) },
        data: { port, processes: list.map((p) => ({ pid: p.pid, name: p.name, state: p.state })) }
      };
    }
  },
  {
    name: 'dev_free_port',
    category: 'dev',
    title: 'Portu boşalt',
    description: 'Bir yerel portu dinleyen süreci sonlandırarak portu boşaltır (ör. takılı kalan geliştirme sunucusu). Kaydedilmemiş veriler kaybolabilir.',
    danger: true,
    params: { port: { type: 'integer', description: 'Port numarası.', required: true } },
    run: async (a) => {
      const port = checkPortArg(a.port);
      const all = await portProcesses(port);
      const listening = all.filter((p) => /listen/i.test(p.state || ''));
      const targets = (listening.length ? listening : all).filter((p) => p.pid > 4 && p.pid !== process.pid);
      if (!targets.length) return { summary: `${port} portu zaten boş.`, display: { type: 'value', label: `Port ${port}`, value: 'Boş', icon: 'plug' }, data: { port, killed: [] } };
      const killed = [], failed = [];
      for (const p of targets) {
        try { process.kill(p.pid, 'SIGTERM'); } catch (e) { failed.push({ ...p, error: e.code === 'EPERM' ? 'yetki yok' : e.code || e.message }); continue; }
        await new Promise((r) => setTimeout(r, 800));
        if (alive(p.pid)) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* already gone */ } }
        killed.push(p);
      }
      await new Promise((r) => setTimeout(r, 400));
      const still = (await portProcesses(port).catch(() => [])).filter((p) => /listen/i.test(p.state || ''));
      return {
        summary: still.length ? `${port} portu hâlâ kullanımda (${still.map((p) => `${p.name} ${p.pid}`).join(', ')}).${failed.length ? ' Bazı süreçler için yönetici yetkisi gerekebilir.' : ''}` : `${port} portu boşaltıldı: ${killed.map((p) => `${p.name || '?'} (PID ${p.pid})`).join(', ')} sonlandırıldı.`,
        display: { type: 'list', title: `Port ${port} · ${still.length ? 'hâlâ dolu' : 'boşaltıldı'}`, items: [...killed.map((p) => ({ title: p.name || `PID ${p.pid}`, meta: `PID ${p.pid} · sonlandırıldı`, icon: 'stop' })), ...failed.map((p) => ({ title: p.name || `PID ${p.pid}`, meta: `PID ${p.pid} · ${p.error}`, icon: 'warning' }))] },
        data: { port, killed: killed.map((p) => p.pid), failed: failed.map((p) => p.pid), free: !still.length }
      };
    }
  },
  {
    name: 'dev_versions',
    category: 'dev',
    title: 'Geliştirici araç sürümleri',
    description: 'Bilgisayarda kurulu geliştirici araçlarının sürümlerini gösterir: Node, npm, Python, Git, Java, Docker, .NET, Go, Rust. Kurulu olmayanları atlar.',
    run: async () => {
      const py = isWin ? [['py', ['--version']], ['python', ['--version']], ['python3', ['--version']]] : [['python3', ['--version']], ['python', ['--version']]];
      const tools = [
        ['Node.js', [['node', ['--version']]]],
        ['npm', [npmCmd(['--version'])]],
        ['Python', py],
        ['Git', [['git', ['--version']]]],
        ['Java', [['java', ['-version']]]],
        ['Docker', [['docker', ['--version']]]],
        ['.NET', [['dotnet', ['--version']]]],
        ['Go', [['go', ['version']]]],
        ['Rust', [['rustc', ['--version']]]]
      ];
      const results = await Promise.all(tools.map(async ([label, cands]) => {
        for (const [cmd, args] of cands) {
          const r = await exec(cmd, args, { timeout: 10000 });
          const v = !r.missing && r.code === 0 ? parseVersion(r.out) : null;
          if (v) return { label, version: v, cmd };
        }
        return { label, version: null };
      }));
      const found = results.filter((r) => r.version);
      const missing = results.filter((r) => !r.version).map((r) => r.label);
      return {
        summary: `${found.map((r) => `${r.label} ${r.version}`).join(', ') || 'Hiçbir araç bulunamadı'}.${missing.length ? ` Bulunamayan: ${missing.join(', ')}.` : ''}`,
        display: { type: 'kv', rows: results.map((r) => [r.label, r.version || 'kurulu değil']) },
        data: Object.fromEntries(results.map((r) => [r.label, r.version]))
      };
    }
  },
  {
    name: 'dev_docker_ps',
    category: 'dev',
    title: 'Docker konteynerleri',
    description: 'Çalışan Docker konteynerlerini (all=true ise durmuş olanları da) imaj, durum ve portlarıyla listeler.',
    params: { all: { type: 'boolean', description: 'Durmuş konteynerleri de göster. Varsayılan false.' } },
    run: async (a) => {
      const r = await exec('docker', ['ps', ...(a.all ? ['-a'] : []), '--no-trunc', '--format', '{{json .}}'], { timeout: 15000 });
      if (r.missing) throw new ToolError('Docker kurulu değil.', 'docker.com adresinden Docker Desktop kurabilirsin.');
      if (r.code !== 0) {
        if (/cannot connect|error during connect|daemon|pipe/i.test(r.out)) throw new ToolError('Docker çalışmıyor; önce Docker Desktop\'ı başlat.');
        throw new ToolError(truncate(r.out, 200) || 'docker ps başarısız oldu.');
      }
      const list = parseDockerPs(r.stdout);
      if (!list.length) return { summary: a.all ? 'Hiç konteyner yok.' : 'Çalışan konteyner yok.', display: { type: 'value', label: 'Docker', value: a.all ? 'Konteyner yok' : 'Çalışan konteyner yok', icon: 'cube' }, data: [] };
      const running = list.filter((c) => c.state === 'running').length;
      return {
        summary: `${list.length} konteyner (${running} çalışıyor): ${list.slice(0, 6).map((c) => `${c.name} (${c.image})`).join(', ')}.`,
        display: { type: 'list', title: `Docker · ${running}/${list.length} çalışıyor`, items: list.map((c) => ({ title: c.name, subtitle: [c.image, truncate(c.ports, 80)].filter(Boolean).join(' · '), meta: c.status, icon: c.state === 'running' ? 'play' : 'stop' })) },
        data: list.map((c) => ({ name: c.name, image: c.image, status: c.status, ports: truncate(c.ports, 120) }))
      };
    }
  },
  {
    name: 'dev_gitignore',
    category: 'dev',
    title: '.gitignore oluştur',
    description: 'Bir proje klasörüne şablonlardan (ör. node, python, windows, macos, visualstudiocode) .gitignore dosyası oluşturur. Varolan dosyanın üzerine yazılacaksa onay ister.',
    danger: (a) => { try { return fs.existsSync(path.join(resolvePath(a.path), '.gitignore')); } catch { return true; } },
    params: {
      ...pathParam,
      templates: { type: 'string', description: 'Virgülle ayrılmış şablonlar, ör. "node,windows,visualstudiocode".', required: true }
    },
    run: async (a) => {
      const dir = resolvePath(a.path);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new ToolError(`${dir} klasörü bulunamadı.`);
      const list = String(a.templates).split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (!list.length) throw new ToolError('En az bir şablon adı vermelisin, ör. node.');
      if (list.some((t) => !/^[a-z0-9+_.-]+$/.test(t))) throw new ToolError('Şablon adları yalnızca harf, rakam ve - _ . + içerebilir.');
      const res = await fetchWithTimeout(`https://www.toptal.com/developers/gitignore/api/${list.map(encodeURIComponent).join(',')}`, {}, 12000);
      const text = await res.text().catch(() => '');
      if (/#!! ERROR/.test(text)) {
        const bad = (text.match(/ERROR: (.+?) is undefined/) || [])[1];
        throw new ToolError(`Tanımsız şablon${bad ? `: ${bad}` : ''}.`, 'Örnek şablonlar: node, python, java, go, rust, windows, macos, linux, visualstudiocode, jetbrains.');
      }
      if (!res.ok || !text.trim()) throw new ToolError(`Şablon alınamadı (${res.status}).`);
      const file = path.join(dir, '.gitignore');
      const existed = fs.existsSync(file);
      fs.writeFileSync(file, text.replace(/\r\n/g, '\n'));
      const rules = text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
      return {
        summary: `.gitignore ${existed ? 'güncellendi (üzerine yazıldı)' : 'oluşturuldu'}: ${list.join(', ')} şablonları, ${rules} kural.`,
        display: { type: 'file', path: file, name: '.gitignore', meta: `${list.join(', ')} · ${rules} kural` },
        data: { path: file, templates: list, rules, overwritten: existed }
      };
    }
  },
  {
    name: 'dev_cron_explain',
    category: 'dev',
    title: 'Cron açıkla',
    description: '5 alanlı bir cron ifadesini (ör. "*/15 9-17 * * 1-5") Türkçe açıklar ve sonraki çalışma zamanlarını hesaplar. @daily gibi kısaltmaları da anlar.',
    params: {
      expression: { type: 'string', description: 'Cron ifadesi: dakika saat gün ay haftagünü.', required: true },
      count: { type: 'integer', description: 'Kaç sonraki çalışma zamanı. Varsayılan 5, en çok 20.' }
    },
    run: async (a) => {
      const { text, cron } = explainCron(a.expression);
      const runs = nextRuns(cron, new Date(), Math.max(1, Math.min(20, a.count || 5)));
      const fmt = (d) => `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} ${DAYS_TR[d.getDay()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return {
        summary: `${text}.${runs.length ? ` Sonraki çalışma: ${fmt(runs[0])}.` : ' Önümüzdeki yıllarda hiç çalışmıyor.'}`,
        display: { type: 'list', title: `${a.expression.trim()} — ${text}`, items: runs.map((d, i) => ({ title: fmt(d), meta: i === 0 ? 'sıradaki' : '', icon: 'timer' })) },
        data: { explanation: text, next: runs.map((d) => d.toISOString()) }
      };
    }
  }
];

module.exports.parsers = { ago, trackTr, parseGitLog, parseNumstat, parseBranches, parsePackageScripts, parseLsof, parseSs, parseVersion, parseDockerPs, describeJson, pickPath, parseCron, explainCron, nextRuns };
