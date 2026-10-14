'use strict';

/*
 * File operations pack: folder analysis (size, big files, duplicates, types, empty folders),
 * batch rename, find/replace, hashing, comparing, trees, merging and simple image edits.
 * Every walk is bounded and never follows symbolic links.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolvePath, bytes } = require('../util');
const { ToolError, truncate, valueResult, kvResult, listResult } = require('./kit');

/* ------------------------------------------------------------ helpers */

const SYSTEM_SKIP = new Set(['$Recycle.Bin', 'System Volume Information', '$RECYCLE.BIN']);
const DEV_SKIP = new Set(['node_modules', '.git']);
const JUNK = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

async function statOrThrow(p) {
  try { return await fsp.stat(p); } catch { throw new ToolError(`${p} bulunamadı.`); }
}

async function mustDir(input) {
  const p = resolvePath(input);
  if (!(await statOrThrow(p)).isDirectory()) throw new ToolError(`${path.basename(p)} bir klasör değil.`);
  return p;
}

async function mustFile(input) {
  const p = resolvePath(input);
  if (!(await statOrThrow(p)).isFile()) throw new ToolError(`${path.basename(p)} bir dosya değil.`);
  return p;
}

const clampInt = (v, def, min, max) => Math.max(min, Math.min(max, Number.isFinite(v) ? Math.round(v) : def));

/**
 * Depth-first walk. onFile(full, stat, rel) for files, onDir(full, rel) for folders (return false
 * to skip descending). Stops after maxEntries; returns { truncated }.
 */
async function walk(root, { onFile, onDir, maxEntries = 100000, skip = SYSTEM_SKIP, stat = true } = {}) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > maxEntries) return { truncated: true };
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        if (onDir && (await onDir(full, path.relative(root, full))) === false) continue;
        stack.push(full);
      } else if (e.isFile() && onFile) {
        let st = null;
        if (stat) { try { st = await fsp.lstat(full); } catch { continue; } }
        await onFile(full, st, path.relative(root, full));
      }
    }
  }
  return { truncated: false };
}

function hashFile(p, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(p).on('error', (e) => reject(new ToolError(`${path.basename(p)} okunamadı: ${e.code || e.message}`)))
      .on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
  });
}

/** Reads a file as UTF-8 text, refusing binaries and very large files. */
async function readText(p, max = 10 * 1024 * 1024) {
  const st = await fsp.stat(p);
  if (st.size > max) throw new ToolError(`${path.basename(p)} çok büyük (${bytes(st.size)}).`);
  const buf = await fsp.readFile(p);
  if (buf.subarray(0, 8192).includes(0)) throw new ToolError(`${path.basename(p)} bir metin dosyası değil.`);
  return buf.toString('utf8');
}

function uniqueTarget(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  for (let i = 1; ; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildPattern(find, regex, flags = 'g') {
  if (!find) throw new ToolError('Aranacak ifade boş olamaz.');
  try {
    return new RegExp(regex ? find : escapeRegex(find), flags);
  } catch (e) {
    throw new ToolError(`Geçersiz düzenli ifade: ${e.message}`);
  }
}

const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/;

/** Plans a batch rename of the files directly inside dir. Pure apart from reading the folder. */
async function planRename(dir, { find, replace = '', regex = false }) {
  const re = buildPattern(find, regex);
  const names = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  const existing = new Set(names.map((n) => n.toLowerCase()));
  const proposals = [], skipped = [];
  for (const name of names) {
    re.lastIndex = 0;
    const to = name.replace(re, replace).trim();
    if (to === name) continue;
    if (!to || to === '.' || to === '..' || INVALID_NAME.test(to)) skipped.push({ from: name, to, reason: 'geçersiz ad' });
    else proposals.push({ from: name, to });
  }
  // A target may reuse the name of a file that is itself being renamed away.
  const moving = new Set(proposals.map((p) => p.from.toLowerCase()));
  const plan = [], targets = new Set();
  for (const p of proposals) {
    const key = p.to.toLowerCase();
    if (targets.has(key) || (existing.has(key) && key !== p.from.toLowerCase() && !moving.has(key))) skipped.push({ ...p, reason: 'aynı adda dosya var' });
    else { plan.push(p); targets.add(key); }
  }
  return { plan, skipped };
}

/** Applies a plan; goes through temporary names so swaps and case-only changes work. */
async function applyRename(dir, plan) {
  const tmp = plan.map((p, i) => ({ ...p, tmp: `.vektor-rename-${process.pid}-${i}-${p.from}` }));
  const done = [];
  for (const p of tmp) {
    try { await fsp.rename(path.join(dir, p.from), path.join(dir, p.tmp)); done.push(p); } catch { /* skip this one */ }
  }
  let ok = 0;
  for (const p of done) {
    const target = fs.existsSync(path.join(dir, p.to)) ? uniqueTarget(path.join(dir, p.to)) : path.join(dir, p.to);
    try { await fsp.rename(path.join(dir, p.tmp), target); ok++; } catch { await fsp.rename(path.join(dir, p.tmp), path.join(dir, p.from)).catch(() => {}); }
  }
  return ok;
}

/** Builds an ASCII tree. */
async function buildTree(root, { depth = 3, dirsOnly = false, hidden = false, maxLines = 400 } = {}) {
  const lines = [path.basename(root) || root];
  let dirs = 0, files = 0, cut = false;
  async function visit(dir, prefix, level) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries = entries.filter((e) => (hidden || !e.name.startsWith('.')) && !e.isSymbolicLink() && (e.isDirectory() || (!dirsOnly && e.isFile())))
      .sort((x, y) => (y.isDirectory() - x.isDirectory()) || x.name.localeCompare(y.name, 'tr'));
    for (let i = 0; i < entries.length; i++) {
      if (lines.length >= maxLines) { cut = true; return; }
      const e = entries[i], last = i === entries.length - 1;
      const isDir = e.isDirectory();
      const skipped = isDir && (DEV_SKIP.has(e.name) || SYSTEM_SKIP.has(e.name));
      lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${isDir ? '/' : ''}${skipped ? ' …' : ''}`);
      if (isDir) {
        dirs++;
        if (!skipped && level < depth) await visit(path.join(dir, e.name), prefix + (last ? '    ' : '│   '), level + 1);
      } else files++;
    }
  }
  await visit(root, '', 1);
  if (cut) lines.push(`… (${maxLines} satırda kesildi)`);
  return { text: lines.join('\n'), dirs, files, truncated: cut };
}

/** Recursively-empty folders (only junk files like desktop.ini count as empty). Returns the outermost ones. */
async function findEmptyDirs(root, { maxEntries = 100000 } = {}) {
  let seen = 0;
  const empties = [];
  async function visit(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return false; }
    let empty = true;
    const childEmpties = [];
    for (const e of entries) {
      if (++seen > maxEntries) return false;
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (SYSTEM_SKIP.has(e.name) || DEV_SKIP.has(e.name)) { empty = false; continue; }
        const full = path.join(dir, e.name);
        if (await visit(full)) childEmpties.push(full);
        else empty = false;
      } else if (!JUNK.has(e.name.toLowerCase())) empty = false;
    }
    if (!empty) empties.push(...childEmpties);
    return empty;
  }
  const rootEmpty = await visit(root);
  return { dirs: empties, rootEmpty, truncated: seen > maxEntries };
}

/** Reads width/height/format from image headers (PNG, JPEG, GIF, BMP, WebP). */
function imageHeader(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { format: 'PNG', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'GIF') return { format: 'GIF', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) return { format: 'BMP', width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { format: 'WEBP', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { format: 'WEBP', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    return { format: 'WEBP', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { format: 'JPEG', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { format: 'JPEG', width: null, height: null };
  }
  return null;
}

async function readHeader(p) {
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return imageHeader(buf.subarray(0, bytesRead));
  } finally { await fh.close(); }
}

function loadImage(ctx, p) {
  const ni = ctx?.electron?.nativeImage;
  if (!ni) throw new ToolError('Resim işleme bu ortamda kullanılamıyor.');
  const img = ni.createFromPath(p);
  if (!img || img.isEmpty()) throw new ToolError(`${path.basename(p)} açılamadı; PNG ya da JPEG olmalı.`, 'Diğer biçimleri önce PNG/JPEG\'e çevirmen gerekebilir.');
  return img;
}

const isJpeg = (p) => /\.jpe?g$/i.test(p);

/** Fits w×h into the requested box keeping the aspect ratio. */
function fitSize(w0, h0, width, height) {
  if (!width && !height) throw new ToolError('Genişlik ya da yükseklikten en az birini ver.');
  if ((width && width < 1) || (height && height < 1) || width > 20000 || height > 20000) throw new ToolError('Boyut 1 ile 20000 piksel arasında olmalı.');
  const scale = width && height ? Math.min(width / w0, height / h0) : width ? width / w0 : height / h0;
  return { width: Math.max(1, Math.round(w0 * scale)), height: Math.max(1, Math.round(h0 * scale)) };
}

/* ---------------------------------------------------------------- tools */

const pathParam = (desc = 'Klasör yolu ya da takma adı (masaüstü, indirilenler, belgeler...).') => ({ type: 'string', description: desc, required: true });

const tools = [
  {
    name: 'files_folder_size',
    category: 'files',
    title: 'Klasör boyutu',
    description: 'Bir klasörün toplam boyutunu ve dosya sayısını hesaplar, en çok yer kaplayan alt klasörleri gösterir.',
    params: { path: pathParam() },
    timeout: 240000,
    run: async (a) => {
      const root = await mustDir(a.path);
      let total = 0, count = 0;
      const top = new Map();
      const { truncated } = await walk(root, {
        maxEntries: 300000,
        onFile: (_f, st, rel) => {
          total += st.size; count++;
          const head = rel.split(path.sep)[0];
          const key = head === rel ? '' : head;
          top.set(key, (top.get(key) || 0) + st.size);
        }
      });
      const subs = [...top.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15);
      const items = subs.map(([k, v]) => ({
        title: k || '(bu klasördeki dosyalar)',
        subtitle: total ? `%${Math.round(100 * v / total)}` : '',
        meta: bytes(v),
        icon: k ? 'folder' : 'doc',
        path: k ? path.join(root, k) : root
      }));
      return {
        summary: `${path.basename(root) || root} toplam ${bytes(total)}, ${count}${truncated ? '+' : ''} dosya.${subs[0]?.[0] ? ` En büyük alt klasör: ${subs[0][0]} (${bytes(subs[0][1])}).` : ''}`,
        display: { type: 'list', title: `${path.basename(root) || root} — ${bytes(total)} · ${count}${truncated ? '+' : ''} dosya`, items },
        data: { path: root, bytes: total, size: bytes(total), files: count, truncated, top: subs.map(([k, v]) => ({ name: k || '.', size: bytes(v) })) }
      };
    }
  },
  {
    name: 'files_find_large',
    category: 'files',
    title: 'Büyük dosyaları bul',
    description: 'Bir klasörde (alt klasörler dahil) belirli bir boyuttan büyük dosyaları en büyükten başlayarak listeler; yer açmak için kullan.',
    params: {
      path: pathParam(),
      min_mb: { type: 'number', description: 'En küçük boyut (MB). Varsayılan 100.' },
      top: { type: 'integer', description: 'Kaç dosya gösterilsin (varsayılan 20, en çok 100).' }
    },
    timeout: 240000,
    run: async (a) => {
      const root = await mustDir(a.path);
      const min = (Number.isFinite(a.min_mb) ? Math.max(0, a.min_mb) : 100) * 1024 * 1024;
      const n = clampInt(a.top, 20, 1, 100);
      const found = [];
      const { truncated } = await walk(root, { maxEntries: 300000, onFile: (f, st) => { if (st.size >= min) found.push({ path: f, size: st.size, mtime: st.mtime }); } });
      found.sort((x, y) => y.size - x.size);
      const list = found.slice(0, n);
      const sum = found.reduce((s, f) => s + f.size, 0);
      return listResult(
        list.length ? `${bytes(min)} üstünde ${found.length} dosya (toplam ${bytes(sum)}). En büyük: ${path.basename(list[0].path)} (${bytes(list[0].size)}).` : `${bytes(min)} üstünde dosya bulunamadı.`,
        `Büyük dosyalar · ${path.basename(root) || root}${truncated ? ' (tarama sınırlandı)' : ''}`,
        list.map((f) => ({ title: path.basename(f.path), subtitle: path.relative(root, path.dirname(f.path)) || '.', meta: bytes(f.size), icon: 'doc', path: f.path })),
        { count: found.length, total: bytes(sum), files: list.slice(0, 30).map((f) => ({ path: f.path, size: bytes(f.size) })), truncated }
      );
    }
  },
  {
    name: 'files_find_duplicates',
    category: 'files',
    title: 'Yinelenen dosyaları bul',
    description: 'Bir klasörde içeriği birebir aynı olan dosyaları bulur (boyut + SHA-1). Hiçbir şeyi silmez, yalnızca rapor verir.',
    params: {
      path: pathParam(),
      min_kb: { type: 'number', description: 'Bundan küçük dosyaları atla (KB). Varsayılan 1.' }
    },
    timeout: 600000,
    run: async (a) => {
      const root = await mustDir(a.path);
      const min = Math.max(1, (Number.isFinite(a.min_kb) ? a.min_kb : 1) * 1024);
      const bySize = new Map();
      const skip = new Set([...SYSTEM_SKIP, ...DEV_SKIP]);
      const { truncated } = await walk(root, {
        maxEntries: 200000, skip,
        onFile: (f, st) => { if (st.size >= min) { const l = bySize.get(st.size); l ? l.push(f) : bySize.set(st.size, [f]); } }
      });
      const groups = [];
      let hashed = 0;
      for (const [size, files] of [...bySize.entries()].filter(([, l]) => l.length > 1).sort((x, y) => y[0] - x[0])) {
        if (hashed > 5000) break;
        const byHash = new Map();
        for (const f of files) {
          let h;
          try { h = await hashFile(f, 'sha1'); } catch { continue; }
          hashed++;
          const l = byHash.get(h); l ? l.push(f) : byHash.set(h, [f]);
        }
        for (const [hash, l] of byHash) if (l.length > 1) groups.push({ size, hash, files: l });
      }
      groups.sort((x, y) => y.size * (y.files.length - 1) - x.size * (x.files.length - 1));
      const wasted = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
      return listResult(
        groups.length ? `${groups.length} grup yinelenen dosya bulundu; fazladan kopyalar ${bytes(wasted)} yer kaplıyor.` : 'Yinelenen dosya bulunamadı.',
        `Yinelenen dosyalar · ${bytes(wasted)} fazlalık`,
        groups.slice(0, 50).map((g) => ({
          title: `${path.basename(g.files[0])} ×${g.files.length}`,
          subtitle: truncate(g.files.map((f) => path.relative(root, f)).join(' · '), 300),
          meta: bytes(g.size),
          icon: 'layers',
          path: g.files[0]
        })),
        { groups: groups.length, wasted: bytes(wasted), wastedBytes: wasted, truncated, top: groups.slice(0, 15).map((g) => ({ size: bytes(g.size), files: g.files.slice(0, 6).map((f) => path.relative(root, f)) })) }
      );
    }
  },
  {
    name: 'files_count_by_type',
    category: 'files',
    title: 'Türe göre dosya sayısı',
    description: 'Bir klasördeki dosyaları uzantıya göre sayar ve her türün toplam boyutunu gösterir.',
    params: { path: pathParam() },
    timeout: 240000,
    run: async (a) => {
      const root = await mustDir(a.path);
      const map = new Map();
      let count = 0;
      const { truncated } = await walk(root, {
        maxEntries: 300000,
        onFile: (f, st) => {
          count++;
          const ext = path.extname(f).slice(1).toLowerCase() || '(uzantısız)';
          const e = map.get(ext) || { ext, count: 0, size: 0 };
          e.count++; e.size += st.size;
          map.set(ext, e);
        }
      });
      const list = [...map.values()].sort((x, y) => y.count - x.count || y.size - x.size);
      return listResult(
        list.length ? `${count} dosya, ${list.length} tür. En çok: ${list.slice(0, 4).map((e) => `${e.ext} ${e.count}`).join(', ')}.` : 'Klasörde dosya yok.',
        `Dosya türleri · ${path.basename(root) || root}${truncated ? ' (tarama sınırlandı)' : ''}`,
        list.slice(0, 40).map((e) => ({ title: e.ext === '(uzantısız)' ? e.ext : `.${e.ext}`, subtitle: `${e.count} dosya`, meta: bytes(e.size), icon: 'doc' })),
        { files: count, types: list.slice(0, 40).map((e) => ({ ext: e.ext, count: e.count, size: bytes(e.size) })), truncated }
      );
    }
  },
  {
    name: 'files_bulk_rename',
    category: 'files',
    title: 'Toplu yeniden adlandır',
    description: 'Bir klasördeki dosya adlarında bul-değiştir yapar. Önce preview=true ile önizle; uygulamak kullanıcı onayı ister. Çakışan adlar atlanır.',
    danger: (a) => !a.preview,
    params: {
      path: pathParam('Dosyaların bulunduğu klasör.'),
      find: { type: 'string', description: 'Adlarda aranacak metin (regex=true ise düzenli ifade).', required: true },
      replace: { type: 'string', description: 'Yerine yazılacak metin; boş bırakılırsa silinir. Regex modunda $1 gibi gruplar kullanılabilir.' },
      regex: { type: 'boolean', description: 'find bir düzenli ifade mi?' },
      preview: { type: 'boolean', description: 'true ise hiçbir şeyi değiştirmeden ne olacağını gösterir.' }
    },
    run: async (a) => {
      const dir = await mustDir(a.path);
      const { plan, skipped } = await planRename(dir, { find: a.find, replace: a.replace ?? '', regex: !!a.regex });
      if (plan.length > 1000) throw new ToolError(`${plan.length} dosya etkilenecek; tek seferde en çok 1000 dosya yeniden adlandırılabilir.`);
      const items = [
        ...plan.slice(0, 80).map((p) => ({ title: p.to, subtitle: `← ${p.from}`, icon: 'doc' })),
        ...skipped.slice(0, 20).map((s) => ({ title: s.from, subtitle: `Atlandı: ${s.reason}`, icon: 'warning' }))
      ];
      if (!plan.length) return { summary: `Adında "${a.find}" geçen ve değişecek dosya yok${skipped.length ? ` (${skipped.length} çakışma atlandı)` : ''}.`, display: items.length ? { type: 'list', title: 'Değişiklik yok', items } : undefined, data: { renamed: 0, skipped: skipped.length } };
      if (a.preview) {
        return listResult(`Önizleme: ${plan.length} dosya yeniden adlandırılacak${skipped.length ? `, ${skipped.length} atlanacak` : ''}. Örnek: ${plan[0].from} → ${plan[0].to}.`, `Önizleme · ${plan.length} dosya`, items, { preview: true, count: plan.length, skipped: skipped.length, changes: plan.slice(0, 30).map((p) => `${p.from} → ${p.to}`) });
      }
      const ok = await applyRename(dir, plan);
      return listResult(`${ok} dosya yeniden adlandırıldı${skipped.length ? `, ${skipped.length} atlandı` : ''}.`, `Yeniden adlandırıldı · ${ok} dosya`, items, { renamed: ok, skipped: skipped.length, changes: plan.slice(0, 30).map((p) => `${p.from} → ${p.to}`) });
    }
  },
  {
    name: 'files_find_replace',
    category: 'files',
    title: 'Dosyada bul-değiştir',
    description: 'Bir metin dosyasının içinde geçen ifadeyi değiştirir ve kaç yerde değiştiğini söyler. Dosyanın üstüne yazdığı için onay ister.',
    danger: true,
    params: {
      path: pathParam('Metin dosyasının yolu.'),
      find: { type: 'string', description: 'Aranacak metin (regex=true ise düzenli ifade).', required: true },
      replace: { type: 'string', description: 'Yerine yazılacak metin; boşsa silinir.' },
      regex: { type: 'boolean', description: 'find bir düzenli ifade mi?' },
      ignore_case: { type: 'boolean', description: 'Büyük/küçük harf farkını yok say.' }
    },
    run: async (a) => {
      const p = await mustFile(a.path);
      const text = await readText(p);
      const re = buildPattern(a.find, !!a.regex, a.ignore_case ? 'gi' : 'g');
      const count = (text.match(re) || []).length;
      if (!count) return { summary: `${path.basename(p)} içinde "${a.find}" bulunamadı; dosya değişmedi.`, data: { replaced: 0 } };
      const out = text.replace(re, a.replace ?? '');
      await fsp.writeFile(p, out, 'utf8');
      return {
        summary: `${path.basename(p)} içinde ${count} yer değiştirildi.`,
        display: { type: 'file', path: p, name: path.basename(p), meta: `${count} değişiklik · ${bytes(Buffer.byteLength(out))}` },
        data: { path: p, replaced: count }
      };
    }
  },
  {
    name: 'files_hash',
    category: 'files',
    title: 'Dosya hash',
    description: 'Bir dosyanın MD5, SHA-1 ya da SHA-256 özetini hesaplar; beklenen değer verilirse karşılaştırır (indirme doğrulama).',
    params: {
      path: pathParam('Dosya yolu.'),
      algorithm: { type: 'string', enum: ['md5', 'sha1', 'sha256'], description: 'Algoritma (varsayılan sha256).' },
      expected: { type: 'string', description: 'Karşılaştırılacak beklenen hash (isteğe bağlı).' }
    },
    timeout: 600000,
    run: async (a) => {
      const p = await mustFile(a.path);
      const algo = ['md5', 'sha1', 'sha256'].includes(a.algorithm) ? a.algorithm : 'sha256';
      const hash = await hashFile(p, algo);
      const label = algo.toUpperCase().replace('SHA', 'SHA-');
      if (a.expected) {
        const ok = hash === String(a.expected).trim().toLowerCase();
        return {
          summary: ok ? `${label} eşleşiyor; dosya doğrulandı.` : `${label} eşleşmiyor! Dosya bozuk ya da farklı olabilir.`,
          display: { type: 'kv', rows: [['Dosya', path.basename(p)], [label, hash], ['Beklenen', String(a.expected).trim()], ['Sonuç', ok ? 'Eşleşiyor ✓' : 'Eşleşmiyor ✗']] },
          data: { algorithm: algo, hash, match: ok }
        };
      }
      return valueResult(`${label} · ${path.basename(p)}`, hash, { icon: 'key', detail: bytes(fs.statSync(p).size), data: { algorithm: algo, hash, path: p } });
    }
  },
  {
    name: 'files_compare',
    category: 'files',
    title: 'İki dosyayı karşılaştır',
    description: 'İki dosyanın aynı olup olmadığını boyut ve SHA-256 ile kontrol eder; metin dosyalarında ilk farklı satırı gösterir.',
    params: {
      first: pathParam('Birinci dosya.'),
      second: pathParam('İkinci dosya.')
    },
    timeout: 600000,
    run: async (a) => {
      const p1 = await mustFile(a.first), p2 = await mustFile(a.second);
      const [s1, s2] = [fs.statSync(p1).size, fs.statSync(p2).size];
      const [h1, h2] = await Promise.all([hashFile(p1, 'sha256'), hashFile(p2, 'sha256')]);
      const same = h1 === h2;
      const rows = [['Birinci', `${path.basename(p1)} · ${bytes(s1)}`], ['İkinci', `${path.basename(p2)} · ${bytes(s2)}`], ['SHA-256 (1)', h1.slice(0, 16) + '…'], ['SHA-256 (2)', h2.slice(0, 16) + '…'], ['Sonuç', same ? 'Birebir aynı' : 'Farklı']];
      const data = { identical: same, size1: s1, size2: s2 };
      let diffNote = '';
      if (!same) {
        try {
          const [t1, t2] = [await readText(p1, 5 * 1024 * 1024), await readText(p2, 5 * 1024 * 1024)];
          const l1 = t1.split(/\r?\n/), l2 = t2.split(/\r?\n/);
          let i = 0;
          while (i < l1.length && i < l2.length && l1[i] === l2[i]) i++;
          if (i === l1.length && i === l2.length) {
            diffNote = ' Metin aynı; yalnızca satır sonları ya da kodlama farklı.';
            rows.push(['Fark', 'Yalnızca satır sonları/kodlama']);
          } else {
            rows.push(['İlk fark', `${i + 1}. satır`], ['Birincide', truncate(l1[i] ?? '(dosya bitti)', 200)], ['İkincide', truncate(l2[i] ?? '(dosya bitti)', 200)]);
            diffNote = ` İlk fark ${i + 1}. satırda.`;
            Object.assign(data, { firstDiffLine: i + 1, line1: truncate(l1[i] ?? '', 200), line2: truncate(l2[i] ?? '', 200) });
          }
        } catch { /* binary: hash result is enough */ }
      }
      return kvResult(same ? 'İki dosya birebir aynı.' : `Dosyalar farklı${s1 !== s2 ? ` (boyutlar ${bytes(s1)} ve ${bytes(s2)})` : ''}.${diffNote}`, rows, data);
    }
  },
  {
    name: 'files_tree',
    category: 'files',
    title: 'Klasör ağacı',
    description: 'Bir klasörün yapısını ağaç biçiminde gösterir (derinlik sınırlı). node_modules ve .git içine girilmez.',
    params: {
      path: pathParam(),
      depth: { type: 'integer', description: 'Kaç seviye inilsin (varsayılan 3, en çok 8).' },
      dirs_only: { type: 'boolean', description: 'Yalnızca klasörleri göster.' },
      hidden: { type: 'boolean', description: 'Nokta ile başlayan gizli öğeleri de göster.' }
    },
    run: async (a) => {
      const root = await mustDir(a.path);
      const t = await buildTree(root, { depth: clampInt(a.depth, 3, 1, 8), dirsOnly: !!a.dirs_only, hidden: !!a.hidden });
      return {
        summary: `${path.basename(root) || root} ağacı: ${t.dirs} klasör${a.dirs_only ? '' : `, ${t.files} dosya`} gösterildi${t.truncated ? ' (kısaltıldı)' : ''}.`,
        display: { type: 'code', title: root, text: t.text },
        data: { text: truncate(t.text, 6000), dirs: t.dirs, files: t.files }
      };
    }
  },
  {
    name: 'files_merge_text',
    category: 'files',
    title: 'Metin dosyalarını birleştir',
    description: 'Birden çok metin dosyasını sırayla tek bir dosyada birleştirir. Çıktı dosyası zaten varsa üzerine yazmak onay ister.',
    danger: (a) => { try { return fs.existsSync(resolvePath(a.output)); } catch { return false; } },
    params: {
      inputs: { type: 'array', items: { type: 'string' }, description: 'Birleştirilecek dosya yolları, sırasıyla.', required: true },
      output: { type: 'string', description: 'Oluşturulacak dosya, ör. "masaüstü/birlesik.txt".', required: true },
      headers: { type: 'boolean', description: 'Her dosyanın önüne adını başlık olarak ekle.' }
    },
    run: async (a) => {
      const inputs = Array.isArray(a.inputs) ? a.inputs : [];
      if (inputs.length < 2) throw new ToolError('Birleştirmek için en az iki dosya ver.');
      if (inputs.length > 200) throw new ToolError('Tek seferde en çok 200 dosya birleştirilebilir.');
      const out = resolvePath(a.output);
      const paths = [];
      for (const i of inputs) {
        const p = await mustFile(i);
        if (path.resolve(p) === path.resolve(out)) throw new ToolError('Çıktı dosyası girdilerden biri olamaz.');
        paths.push(p);
      }
      const parts = [];
      for (const p of paths) {
        const t = await readText(p, 20 * 1024 * 1024);
        parts.push((a.headers ? `===== ${path.basename(p)} =====\n` : '') + t.replace(/^﻿/, '').replace(/\s+$/, ''));
      }
      const text = parts.join(a.headers ? '\n\n' : '\n') + '\n';
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, text, 'utf8');
      return {
        summary: `${paths.length} dosya ${path.basename(out)} içinde birleştirildi (${bytes(Buffer.byteLength(text))}).`,
        display: { type: 'file', path: out, name: path.basename(out), meta: `${paths.length} dosya · ${bytes(Buffer.byteLength(text))}` },
        data: { output: out, files: paths.length, bytes: Buffer.byteLength(text) }
      };
    }
  },
  {
    name: 'files_image_info',
    category: 'files',
    title: 'Resim bilgisi',
    description: 'Bir resmin biçimini, piksel boyutunu, en-boy oranını ve dosya boyutunu gösterir.',
    params: { path: pathParam('Resim dosyasının yolu.') },
    run: async (a, ctx) => {
      const p = await mustFile(a.path);
      const head = await readHeader(p);
      let size = head && head.width ? { width: head.width, height: head.height } : null;
      if (ctx?.electron?.nativeImage) {
        const img = ctx.electron.nativeImage.createFromPath(p);
        if (img && !img.isEmpty()) size = img.getSize();
      }
      if (!size) throw new ToolError(`${path.basename(p)} tanınan bir resim değil.`, 'PNG, JPEG, GIF, BMP ve WebP desteklenir.');
      const g = (x, y) => (y ? g(y, x % y) : x);
      const d = g(size.width, size.height) || 1;
      const fileSize = fs.statSync(p).size;
      const format = head?.format || path.extname(p).slice(1).toUpperCase();
      const rows = [['Dosya', path.basename(p)], ['Biçim', format], ['Boyut', `${size.width} × ${size.height} piksel`], ['En-boy oranı', `${size.width / d}:${size.height / d}`], ['Megapiksel', (size.width * size.height / 1e6).toFixed(2)], ['Dosya boyutu', bytes(fileSize)]];
      return kvResult(`${path.basename(p)}: ${format}, ${size.width}×${size.height} piksel, ${bytes(fileSize)}.`, rows, { format, width: size.width, height: size.height, bytes: fileSize });
    }
  },
  {
    name: 'files_resize_image',
    category: 'files',
    title: 'Resmi yeniden boyutlandır',
    description: 'Bir resmi oranını koruyarak yeniden boyutlandırır ve "-GENİŞLİKxYÜKSEKLİK" ekli yeni bir dosyaya kaydeder; aslına dokunmaz.',
    params: {
      path: pathParam('Resim dosyasının yolu (PNG ya da JPEG).'),
      width: { type: 'integer', description: 'Yeni genişlik (piksel).' },
      height: { type: 'integer', description: 'Yeni yükseklik (piksel). İkisi birden verilirse resim bu kutuya sığdırılır.' }
    },
    run: async (a, ctx) => {
      const p = await mustFile(a.path);
      const img = loadImage(ctx, p);
      const s0 = img.getSize();
      const s = fitSize(s0.width, s0.height, a.width, a.height);
      const resized = img.resize({ width: s.width, height: s.height, quality: 'best' });
      const jpeg = isJpeg(p);
      const ext = jpeg ? path.extname(p) : '.png';
      const out = uniqueTarget(path.join(path.dirname(p), `${path.basename(p, path.extname(p))}-${s.width}x${s.height}${ext}`));
      const buf = jpeg ? resized.toJPEG(90) : resized.toPNG();
      await fsp.writeFile(out, buf);
      return {
        summary: `Resim ${s0.width}×${s0.height} boyutundan ${s.width}×${s.height} boyutuna ${s.width > s0.width ? 'büyütülüp' : 'küçültülüp'} ${path.basename(out)} olarak kaydedildi.`,
        display: { type: 'file', path: out, name: path.basename(out), meta: `${s.width}×${s.height} · ${bytes(buf.length)}` },
        data: { output: out, width: s.width, height: s.height, bytes: buf.length }
      };
    }
  },
  {
    name: 'files_convert_image',
    category: 'files',
    title: 'Resim formatını çevir',
    description: 'Bir resmi PNG ↔ JPG arasında çevirir ve yeni bir dosya olarak kaydeder; aslına dokunmaz. JPG\'de saydam alanlar korunmaz.',
    params: {
      path: pathParam('Resim dosyasının yolu.'),
      format: { type: 'string', enum: ['png', 'jpg'], description: 'Hedef biçim.', required: true },
      quality: { type: 'integer', description: 'JPG kalitesi 1-100 (varsayılan 90).' }
    },
    run: async (a, ctx) => {
      const p = await mustFile(a.path);
      const target = a.format === 'jpg' ? 'jpg' : 'png';
      if ((target === 'jpg' && isJpeg(p)) || (target === 'png' && /\.png$/i.test(p))) throw new ToolError(`Dosya zaten ${target.toUpperCase()} biçiminde.`);
      const img = loadImage(ctx, p);
      const q = clampInt(a.quality, 90, 1, 100);
      const buf = target === 'jpg' ? img.toJPEG(q) : img.toPNG();
      const out = uniqueTarget(path.join(path.dirname(p), `${path.basename(p, path.extname(p))}.${target}`));
      await fsp.writeFile(out, buf);
      return {
        summary: `${path.basename(p)} ${target.toUpperCase()} biçimine çevrildi: ${path.basename(out)} (${bytes(buf.length)}).`,
        display: { type: 'file', path: out, name: path.basename(out), meta: `${target.toUpperCase()}${target === 'jpg' ? ` · kalite ${q}` : ''} · ${bytes(buf.length)}` },
        data: { output: out, bytes: buf.length }
      };
    }
  },
  {
    name: 'files_copy_path',
    category: 'files',
    title: 'Yolu panoya kopyala',
    description: 'Bir dosya ya da klasörün tam yolunu (ya da yalnızca adını, üst klasörünü veya file:// adresini) panoya kopyalar.',
    params: {
      path: pathParam('Dosya ya da klasör yolu.'),
      kind: { type: 'string', enum: ['full', 'name', 'folder', 'url'], description: 'full = tam yol (varsayılan), name = yalnızca ad, folder = bulunduğu klasör, url = file:// adresi.' }
    },
    run: async (a, ctx) => {
      const p = resolvePath(a.path);
      await statOrThrow(p);
      const kind = a.kind || 'full';
      const value = kind === 'name' ? path.basename(p) : kind === 'folder' ? path.dirname(p) : kind === 'url' ? pathToFileURL(p).href : p;
      if (!ctx?.clip?.writeText) throw new ToolError('Pano bu ortamda kullanılamıyor.');
      await ctx.clip.writeText(value);
      return { summary: `Panoya kopyalandı: ${value}`, display: { type: 'value', label: 'Panoya kopyalandı', value, icon: 'clipboard' }, data: { value } };
    }
  },
  {
    name: 'files_find_empty_dirs',
    category: 'files',
    title: 'Boş klasörleri bul',
    description: 'Bir klasörün altındaki boş klasörleri (yalnızca desktop.ini/Thumbs.db gibi sistem dosyası içerenler dahil) listeler. Hiçbir şeyi silmez.',
    params: { path: pathParam() },
    timeout: 240000,
    run: async (a) => {
      const root = await mustDir(a.path);
      const { dirs, rootEmpty, truncated } = await findEmptyDirs(root);
      dirs.sort((x, y) => x.localeCompare(y, 'tr'));
      if (rootEmpty) return { summary: `${path.basename(root) || root} klasörünün kendisi tamamen boş.`, data: { rootEmpty: true, dirs: [] } };
      return listResult(
        dirs.length ? `${dirs.length} boş klasör bulundu${truncated ? ' (tarama sınırlandı)' : ''}.` : 'Boş klasör bulunamadı.',
        `Boş klasörler · ${path.basename(root) || root}`,
        dirs.slice(0, 100).map((d) => ({ title: path.basename(d), subtitle: path.relative(root, path.dirname(d)) || '.', icon: 'folder', path: d })),
        { count: dirs.length, dirs: dirs.slice(0, 50).map((d) => path.relative(root, d)), truncated }
      );
    }
  }
];

module.exports = tools;
Object.defineProperty(module.exports, 'helpers', {
  enumerable: false,
  value: { walk, planRename, applyRename, buildTree, findEmptyDirs, imageHeader, fitSize, hashFile }
});
