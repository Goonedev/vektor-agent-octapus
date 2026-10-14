'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isWin, isMac, ToolError, norm, run, ps, psStr, resolvePath, dirFor, bytes, truncate, hasBin } = require('./util');

const SKIP = new Set(['node_modules', '.git', '$Recycle.Bin', 'AppData', 'Library', '.cache', '.Trash', 'System Volume Information', '__pycache__', '.venv']);

const CATEGORIES = {
  Resimler: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg', 'tiff', 'raw', 'ico'],
  Videolar: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'flv', 'm4v'],
  Müzik: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  Belgeler: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'pages', 'epub'],
  Tablolar: ['xls', 'xlsx', 'csv', 'ods', 'numbers'],
  Sunumlar: ['ppt', 'pptx', 'odp', 'key'],
  Arşivler: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  Kurulumlar: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk'],
  Kod: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1']
};

function kindOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return Object.keys(CATEGORIES).find((k) => CATEGORIES[k].includes(ext)) || 'Diğer';
}

const ICON_BY_KIND = { Resimler: 'photo', Videolar: 'film', Müzik: 'music', Belgeler: 'doc', Tablolar: 'table', Sunumlar: 'doc', Arşivler: 'archive', Kurulumlar: 'cube', Kod: 'code', Diğer: 'doc' };

function mustExist(p) {
  if (!fs.existsSync(p)) throw new ToolError(`${p} bulunamadı.`);
  return p;
}

function uniqueTarget(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  for (let i = 1; ; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

function fileItem(full, st) {
  const isDir = st.isDirectory();
  return {
    title: path.basename(full),
    subtitle: isDir ? 'Klasör' : `${kindOf(full)} · ${st.mtime.toLocaleDateString('tr-TR')}`,
    meta: isDir ? '' : bytes(st.size),
    icon: isDir ? 'folder' : ICON_BY_KIND[kindOf(full)],
    path: full
  };
}

/** Walks a tree breadth-first, bounded by depth and entry count so it never hangs on a whole disk. */
async function walk(root, { maxDepth = 6, maxEntries = 40000, onFile }) {
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < maxEntries) {
    const [dir, depth] = queue.shift();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > maxEntries) break;
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && depth < maxDepth) queue.push([full, depth + 1]);
        if (onFile(full, e, true) === false) return;
      } else if (onFile(full, e, false) === false) return;
    }
  }
}

function globToRegex(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

module.exports = [
  {
    name: 'list_directory',
    category: 'files',
    title: 'Klasörü listele',
    description: 'Bir klasörün içeriğini listeler. "masaüstü", "indirilenler", "belgeler" gibi takma adları anlar.',
    params: {
      path: { type: 'string', description: 'Klasör yolu ya da takma adı.', required: true },
      sort: { type: 'string', enum: ['name', 'date', 'size'], description: 'Sıralama. Varsayılan date (en yeni üstte).' }
    },
    run: async (a) => {
      const dir = mustExist(resolvePath(a.path));
      const names = await fsp.readdir(dir);
      const items = [];
      for (const n of names) {
        if (n.startsWith('.') || n === 'desktop.ini') continue;
        try { const st = await fsp.stat(path.join(dir, n)); items.push({ ...fileItem(path.join(dir, n), st), _m: st.mtimeMs, _s: st.isDirectory() ? -1 : st.size }); } catch { /* skip unreadable */ }
      }
      const sort = a.sort || 'date';
      items.sort((x, y) => sort === 'name' ? x.title.localeCompare(y.title, 'tr') : sort === 'size' ? y._s - x._s : y._m - x._m);
      return {
        summary: `${path.basename(dir) || dir} içinde ${items.length} öğe var.`,
        display: { type: 'list', title: dir, items: items.slice(0, 60) },
        data: { path: dir, count: items.length, items: items.slice(0, 40).map((i) => `${i.title}${i.meta ? ` (${i.meta})` : i.subtitle === 'Klasör' ? '/' : ''}`) }
      };
    }
  },
  {
    name: 'read_text_file',
    category: 'files',
    title: 'Dosyayı oku',
    description: 'Bir metin dosyasının içeriğini okur (txt, md, kod, csv, json...).',
    params: { path: { type: 'string', description: 'Dosya yolu.', required: true } },
    run: async (a) => {
      const p = mustExist(resolvePath(a.path));
      const st = await fsp.stat(p);
      if (st.isDirectory()) throw new ToolError('Bu bir klasör; list_directory kullan.');
      if (st.size > 5 * 1024 * 1024) throw new ToolError(`Dosya çok büyük (${bytes(st.size)}).`);
      const buf = await fsp.readFile(p);
      if (buf.subarray(0, 4096).includes(0)) throw new ToolError('Bu bir metin dosyası değil.');
      const text = buf.toString('utf8');
      return {
        summary: `${path.basename(p)} okundu (${text.split('\n').length} satır).`,
        display: { type: 'code', title: path.basename(p), text: truncate(text, 3000) },
        data: { path: p, content: truncate(text, 12000) }
      };
    }
  },
  {
    name: 'write_text_file',
    category: 'files',
    title: 'Dosyaya yaz',
    description: 'Yeni bir metin dosyası oluşturur. Var olan bir dosyanın üstüne yazmak kullanıcı onayı ister.',
    danger: (a) => { try { return fs.existsSync(resolvePath(a.path)); } catch { return false; } },
    params: {
      path: { type: 'string', description: 'Dosya yolu, ör. "masaüstü/notlar.txt".', required: true },
      content: { type: 'string', description: 'Yazılacak metin.', required: true }
    },
    run: async (a) => {
      const p = resolvePath(a.path);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, a.content, 'utf8');
      return { summary: `${path.basename(p)} kaydedildi.`, display: { type: 'file', path: p, name: path.basename(p), meta: bytes(Buffer.byteLength(a.content)) } };
    }
  },
  {
    name: 'append_text_file',
    category: 'files',
    title: 'Dosyaya ekle',
    description: 'Bir metin dosyasının sonuna satır ekler; dosya yoksa oluşturur.',
    params: {
      path: { type: 'string', description: 'Dosya yolu.', required: true },
      content: { type: 'string', description: 'Eklenecek metin.', required: true }
    },
    run: async (a) => {
      const p = resolvePath(a.path);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      let prefix = '';
      try { const cur = await fsp.readFile(p, 'utf8'); if (cur && !cur.endsWith('\n')) prefix = '\n'; } catch { /* new file */ }
      await fsp.appendFile(p, prefix + a.content + '\n', 'utf8');
      return { summary: `${path.basename(p)} dosyasına eklendi.`, display: { type: 'file', path: p, name: path.basename(p), meta: 'Satır eklendi' } };
    }
  },
  {
    name: 'create_folder',
    category: 'files',
    title: 'Klasör oluştur',
    description: 'Yeni bir klasör oluşturur (ara klasörlerle birlikte).',
    params: { path: { type: 'string', description: 'Oluşturulacak klasör, ör. "masaüstü/Projeler".', required: true } },
    run: async (a) => {
      const p = resolvePath(a.path);
      await fsp.mkdir(p, { recursive: true });
      return { summary: `${path.basename(p)} klasörü hazır.`, display: { type: 'file', path: p, name: path.basename(p), meta: 'Klasör', icon: 'folder' } };
    }
  },
  {
    name: 'move_to_trash',
    category: 'files',
    title: 'Çöp kutusuna taşı',
    description: 'Bir dosya ya da klasörü çöp kutusuna taşır (kalıcı silmez, geri alınabilir).',
    danger: true,
    params: { path: { type: 'string', description: 'Silinecek dosya ya da klasör.', required: true } },
    run: async (a, ctx) => {
      const p = mustExist(resolvePath(a.path));
      await ctx.electron.shell.trashItem(p);
      return { summary: `${path.basename(p)} çöp kutusuna taşındı.`, display: { type: 'file', path: p, name: path.basename(p), meta: 'Çöp kutusunda', icon: 'trash' } };
    }
  },
  {
    name: 'move_path',
    category: 'files',
    title: 'Taşı / yeniden adlandır',
    description: 'Bir dosya ya da klasörü başka yere taşır veya yeniden adlandırır. Hedef bir klasörse içine taşınır.',
    params: {
      source: { type: 'string', description: 'Kaynak yol.', required: true },
      destination: { type: 'string', description: 'Hedef yol ya da klasör.', required: true }
    },
    run: async (a) => {
      const src = mustExist(resolvePath(a.source));
      let dst = resolvePath(a.destination, path.dirname(src));
      if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) dst = path.join(dst, path.basename(src));
      dst = uniqueTarget(dst);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      try {
        await fsp.rename(src, dst);
      } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        await fsp.cp(src, dst, { recursive: true });
        await fsp.rm(src, { recursive: true });
      }
      return { summary: `${path.basename(src)} → ${dst}`, display: { type: 'file', path: dst, name: path.basename(dst), meta: `Önceki: ${src}` } };
    }
  },
  {
    name: 'copy_path',
    category: 'files',
    title: 'Kopyala',
    description: 'Bir dosya ya da klasörü başka bir yere kopyalar.',
    params: {
      source: { type: 'string', description: 'Kaynak yol.', required: true },
      destination: { type: 'string', description: 'Hedef yol ya da klasör.', required: true }
    },
    run: async (a) => {
      const src = mustExist(resolvePath(a.source));
      let dst = resolvePath(a.destination, path.dirname(src));
      if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) dst = path.join(dst, path.basename(src));
      dst = uniqueTarget(dst);
      await fsp.cp(src, dst, { recursive: true });
      return { summary: `${path.basename(src)} kopyalandı.`, display: { type: 'file', path: dst, name: path.basename(dst), meta: 'Kopya' } };
    }
  },
  {
    name: 'search_files',
    category: 'files',
    title: 'Dosya ara',
    description: 'Bir klasör ve alt klasörlerinde adına göre dosya arar. "*.pdf" gibi kalıplar ya da ad parçası kabul eder.',
    params: {
      query: { type: 'string', description: 'Aranan ad parçası ya da kalıp (ör. "fatura", "*.pdf").', required: true },
      path: { type: 'string', description: 'Aramanın yapılacağı klasör. Varsayılan ev klasörü.' }
    },
    run: async (a) => {
      const root = mustExist(resolvePath(a.path || '~'));
      const q = a.query.trim();
      const matcher = /[*?]/.test(q) ? ((n) => globToRegex(q).test(n)) : ((n) => norm(n).includes(norm(q)));
      const found = [];
      await walk(root, {
        onFile: (full, e) => {
          if (matcher(e.name)) found.push(full);
          return found.length < 100;
        }
      });
      const items = found.slice(0, 50).map((f) => { try { return fileItem(f, fs.statSync(f)); } catch { return null; } }).filter(Boolean);
      return {
        summary: found.length ? `${found.length}${found.length >= 100 ? '+' : ''} sonuç bulundu.` : `“${q}” ile eşleşen dosya yok.`,
        display: { type: 'list', title: `“${q}” — ${root}`, items },
        data: found.slice(0, 30)
      };
    }
  },
  {
    name: 'recent_files',
    category: 'files',
    title: 'Son dosyalar',
    description: 'Bir klasördeki (varsayılan İndirilenler) en son değişen dosyaları gösterir.',
    params: {
      path: { type: 'string', description: 'Klasör. Varsayılan indirilenler.' },
      limit: { type: 'integer', description: 'Kaç dosya. Varsayılan 10.' }
    },
    run: async (a) => {
      const root = mustExist(resolvePath(a.path || 'indirilenler'));
      const files = [];
      await walk(root, { maxDepth: 2, onFile: (full, e, isDir) => { if (!isDir) { try { files.push([full, fs.statSync(full)]); } catch { /* gone */ } } } });
      files.sort((x, y) => y[1].mtimeMs - x[1].mtimeMs);
      const top = files.slice(0, a.limit || 10);
      return {
        summary: top.length ? `En yeni: ${path.basename(top[0][0])}.` : 'Klasör boş.',
        display: { type: 'list', title: root, items: top.map(([f, st]) => fileItem(f, st)) },
        data: top.map(([f, st]) => ({ name: path.basename(f), modified: st.mtime.toISOString(), size: bytes(st.size) }))
      };
    }
  },
  {
    name: 'file_info',
    category: 'files',
    title: 'Dosya bilgisi',
    description: 'Bir dosya ya da klasörün boyutunu, tarihlerini ve türünü gösterir. Klasörler için toplam boyutu hesaplar.',
    params: { path: { type: 'string', description: 'Dosya ya da klasör yolu.', required: true } },
    run: async (a) => {
      const p = mustExist(resolvePath(a.path));
      const st = await fsp.stat(p);
      let size = st.size, count = 0;
      if (st.isDirectory()) {
        size = 0;
        await walk(p, { maxDepth: 12, maxEntries: 150000, onFile: (full, e, isDir) => { if (!isDir) { count++; try { size += fs.statSync(full).size; } catch { /* skip */ } } } });
      }
      const rows = [
        ['Ad', path.basename(p)], ['Konum', path.dirname(p)],
        ['Tür', st.isDirectory() ? `Klasör (${count} dosya)` : kindOf(p)],
        ['Boyut', bytes(size)],
        ['Oluşturulma', st.birthtime.toLocaleString('tr-TR')],
        ['Değiştirilme', st.mtime.toLocaleString('tr-TR')]
      ];
      return { summary: `${path.basename(p)}: ${bytes(size)}.`, display: { type: 'kv', rows }, data: Object.fromEntries(rows) };
    }
  },
  {
    name: 'open_path',
    category: 'files',
    title: 'Dosya / klasör aç',
    description: 'Bir dosyayı varsayılan uygulamasıyla ya da bir klasörü dosya yöneticisinde açar.',
    params: { path: { type: 'string', description: 'Açılacak yol.', required: true } },
    run: async (a, ctx) => {
      const p = mustExist(resolvePath(a.path));
      const err = await ctx.electron.shell.openPath(p);
      if (err) throw new ToolError(err);
      return { summary: `${path.basename(p)} açıldı.`, display: { type: 'file', path: p, name: path.basename(p), meta: 'Açıldı' } };
    }
  },
  {
    name: 'reveal_in_folder',
    category: 'files',
    title: 'Klasörde göster',
    description: 'Dosyayı bulunduğu klasörde seçili olarak gösterir.',
    params: { path: { type: 'string', description: 'Gösterilecek dosya.', required: true } },
    run: async (a, ctx) => {
      const p = mustExist(resolvePath(a.path));
      ctx.electron.shell.showItemInFolder(p);
      return { summary: `${path.basename(p)} klasöründe gösterildi.`, display: { type: 'file', path: p, name: path.basename(p), meta: path.dirname(p) } };
    }
  },
  {
    name: 'compress_zip',
    category: 'files',
    title: 'ZIP oluştur',
    description: 'Bir dosya ya da klasörü ZIP arşivi olarak sıkıştırır.',
    params: {
      path: { type: 'string', description: 'Sıkıştırılacak dosya ya da klasör.', required: true },
      output: { type: 'string', description: 'Oluşacak .zip yolu. Boşsa yanına kaydedilir.' }
    },
    run: async (a) => {
      const src = mustExist(resolvePath(a.path));
      const out = uniqueTarget(a.output ? resolvePath(a.output) : src.replace(/[\\/]+$/, '') + '.zip');
      if (isWin) await ps(`Compress-Archive -Path ${psStr(src)} -DestinationPath ${psStr(out)}`, { timeout: 300000 });
      else if (isMac) await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', src, out], { timeout: 300000 });
      else await run('zip', ['-r', '-q', out, path.basename(src)], { cwd: path.dirname(src), timeout: 300000, missingHint: 'sudo apt install zip' });
      return { summary: `${path.basename(out)} oluşturuldu.`, display: { type: 'file', path: out, name: path.basename(out), meta: bytes(fs.statSync(out).size), icon: 'archive' } };
    }
  },
  {
    name: 'extract_zip',
    category: 'files',
    title: 'ZIP aç',
    description: 'Bir ZIP arşivini bir klasöre çıkarır.',
    params: {
      path: { type: 'string', description: '.zip dosyası.', required: true },
      destination: { type: 'string', description: 'Çıkarılacak klasör. Boşsa arşiv adıyla yanına.' }
    },
    run: async (a) => {
      const src = mustExist(resolvePath(a.path));
      const dst = a.destination ? resolvePath(a.destination) : uniqueTarget(src.replace(/\.zip$/i, ''));
      await fsp.mkdir(dst, { recursive: true });
      if (isWin) await ps(`Expand-Archive -Path ${psStr(src)} -DestinationPath ${psStr(dst)} -Force`, { timeout: 300000 });
      else if (isMac) await run('ditto', ['-x', '-k', src, dst], { timeout: 300000 });
      else if (await hasBin('unzip')) await run('unzip', ['-o', '-q', src, '-d', dst], { timeout: 300000 });
      else await run('python3', ['-m', 'zipfile', '-e', src, dst], { timeout: 300000 });
      return { summary: `${path.basename(src)} → ${dst}`, display: { type: 'file', path: dst, name: path.basename(dst), meta: 'Çıkarıldı', icon: 'folder' } };
    }
  },
  {
    name: 'organize_folder',
    category: 'files',
    title: 'Klasörü düzenle',
    description: 'Bir klasördeki dosyaları türlerine göre alt klasörlere (Resimler, Belgeler, Videolar, Arşivler...) taşır. İndirilenler/Masaüstü temizliği için idealdir.',
    danger: true,
    params: { path: { type: 'string', description: 'Düzenlenecek klasör. Varsayılan indirilenler.' } },
    run: async (a) => {
      const dir = mustExist(resolvePath(a.path || 'indirilenler'));
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const moved = {};
      for (const e of entries) {
        if (!e.isFile() || e.name.startsWith('.') || e.name === 'desktop.ini') continue;
        const kind = kindOf(e.name);
        const target = uniqueTarget(path.join(dir, kind, e.name));
        await fsp.mkdir(path.join(dir, kind), { recursive: true });
        await fsp.rename(path.join(dir, e.name), target);
        moved[kind] = (moved[kind] || 0) + 1;
      }
      const total = Object.values(moved).reduce((x, y) => x + y, 0);
      return {
        summary: total ? `${total} dosya ${Object.keys(moved).length} klasöre ayrıldı.` : 'Düzenlenecek dosya yoktu.',
        display: { type: 'list', title: dir, items: Object.entries(moved).map(([k, n]) => ({ title: k, subtitle: `${n} dosya`, icon: 'folder' })) },
        data: moved
      };
    }
  }
];

module.exports.kindOf = kindOf;
