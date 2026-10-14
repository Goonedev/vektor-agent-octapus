'use strict';

/*
 * Text transforms. Every tool reads `text` or, when it is missing, the clipboard, and can
 * write its result back to the clipboard with `copy`. Pure JS, no network.
 */

const crypto = require('node:crypto');
const { ToolError, valueResult, textResult, kvResult, listResult, truncate } = require('./kit');

const TR = 'tr-TR';
const up = (s) => String(s).toLocaleUpperCase(TR);
const low = (s) => String(s).toLocaleLowerCase(TR);
const fmt = (n, d = 2) => Number(n).toLocaleString(TR, { maximumFractionDigits: d });

const TEXT = { type: 'string', description: 'İşlenecek metin. Verilmezse panodaki metin kullanılır.' };
const COPY = { type: 'boolean', description: 'Sonucu panoya da kopyala.' };

async function source(a, ctx) {
  let t = a.text;
  if (t == null || t === '') {
    try { t = await ctx?.clip?.readText?.(); } catch { t = ''; }
  }
  t = t == null ? '' : String(t);
  if (!t.trim()) throw new ToolError('Dönüştürülecek metin yok; metni söyle ya da panoya kopyala.');
  return t;
}

/** Tool factory: fn(text, args, ctx) returns a string or a result with an optional copyText. */
function tx(name, title, description, fn, opts = {}) {
  const params = {};
  if (!opts.noText) params.text = TEXT;
  Object.assign(params, opts.params || {});
  params.copy = COPY;
  return {
    name: `text_${name}`,
    category: 'text',
    title,
    description,
    params,
    run: async (a = {}, ctx = {}) => {
      const text = opts.noText ? null : await source(a, ctx);
      let r = await fn(text, a, ctx);
      if (typeof r === 'string') r = out(title, r);
      const { copyText, ...res } = r;
      if (a.copy && copyText != null) {
        if (!ctx?.clip?.writeText) throw new ToolError('Pano kullanılamıyor.');
        await ctx.clip.writeText(String(copyText));
        res.summary += ' Sonuç panoya kopyalandı.';
        res.data = { ...(res.data || {}), copied: true };
      }
      return res;
    }
  };
}

const out = (title, text, summary) => ({ ...textResult(title, text, summary), copyText: text });
const val = (label, value, opts) => ({ ...valueResult(label, value, opts), copyText: String(value) });

function need(a, key, label) {
  const v = a[key];
  if (v == null || v === '') throw new ToolError(`${label} belirtmelisin.`);
  return v;
}

/* --------------------------------------------------------------- helpers */

const lines = (t) => String(t).replace(/\r\n?/g, '\n').split('\n');
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;
const words = (t) => String(t).match(WORD_RE) || [];

function graphemes(t) {
  try { return Array.from(new Intl.Segmenter(TR, { granularity: 'grapheme' }).segment(t), (s) => s.segment); }
  catch { return Array.from(t); }
}

const FOLD = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U', â: 'a', Â: 'A', î: 'i', Î: 'I', û: 'u', Û: 'U' };
const foldTr = (s) => String(s).replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g, (c) => FOLD[c]);

function slugify(t, sep = '-') {
  const s = foldTr(low(t).replace(/&/g, ' ve ')).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const e = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${e}+|${e}+$`, 'g'), '');
}

function minutes(m) {
  const total = Math.max(0, Math.round(m * 60));
  const mm = Math.floor(total / 60), ss = total % 60;
  if (!mm) return `${ss} sn`;
  return ss ? `${mm} dk ${ss} sn` : `${mm} dk`;
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeRegex(pattern, flags) {
  try { return new RegExp(pattern, flags); } catch (e) { throw new ToolError(`Geçersiz düzenli ifade: ${e.message}`); }
}

/** Parses a number written in Turkish (1.234,56) or English (1,234.56) style. */
function parseLooseNumber(s) {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(,\d{3}){2,}(\.\d+)?$/.test(s) || /^\d{1,3}(,\d{3})+\.\d+$/.test(s)) return Number(s.replace(/,/g, ''));
  return Number(s.replace(',', '.'));
}

const NUM_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?|\d{1,3}(?:,\d{3})+\.\d+|\d+(?:[.,]\d+)?/g;

function extractNumbers(t) {
  const res = [];
  for (const m of t.matchAll(NUM_RE)) {
    const before = t[m.index - 1], before2 = t[m.index - 2];
    if (before && /[\d.,]/.test(before)) continue;
    let n = parseLooseNumber(m[0]);
    if (before === '-' && !(before2 && /[\p{L}\p{N}]/u.test(before2))) n = -n;
    if (Number.isFinite(n)) res.push({ raw: (n < 0 ? '-' : '') + m[0], value: n });
  }
  return res;
}

const PHONE_RE = /(?<![\d+])(?:(?:\+|00)\s?90[\s.-]?)?\(?0?\s?([2-5]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{2})(?!\d)/g;

function extractPhones(t) {
  const seen = new Map();
  for (const m of t.matchAll(PHONE_RE)) {
    const norm = `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
    if (!seen.has(norm)) seen.set(norm, { number: norm, raw: m[0].trim(), type: m[1][0] === '5' ? 'Cep' : 'Sabit hat' });
  }
  return [...seen.values()];
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', times: '×',
  divide: '÷', middot: '·', bull: '•', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sect: '§', para: '¶',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', acirc: 'â', Acirc: 'Â', icirc: 'î', ucirc: 'û',
  gbreve: 'ğ', Gbreve: 'Ğ', scedil: 'ş', Scedil: 'Ş', inodot: 'ı', Idot: 'İ', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à'
};

function htmlUnescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENTITIES[e] ?? m;
  });
}

const htmlEscape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Newer V8 messages omit the position: the first prefix that fails for a reason other than
   "ended too early" ends at the bad character. */
function firstBadChar(text) {
  const n = Math.min(text.length, 20000);
  for (let i = 1; i <= n; i++) {
    try { JSON.parse(text.slice(0, i)); } catch (err) {
      const at = Number((err.message.match(/position (\d+)/) || [])[1]);
      const early = /end of JSON|Unterminated/i.test(err.message) || (Number.isFinite(at) && at >= i);
      if (!early) return Number.isFinite(at) ? at : i - 1;
    }
  }
  return 0;
}

function jsonError(text, e) {
  let pos = Number((e.message.match(/position (\d+)/) || [])[1]);
  if (!Number.isFinite(pos)) pos = /end of JSON/i.test(e.message) ? text.length : firstBadChar(text);
  const before = text.slice(0, pos).split('\n');
  const line = before.length, col = before[before.length - 1].length + 1;
  const src = text.split('\n')[line - 1] ?? '';
  const snippet = `${src.slice(Math.max(0, col - 40), col + 40)}\n${' '.repeat(Math.min(col - 1, 40))}^`;
  const reason = /end of JSON/i.test(e.message) ? 'Metin beklenmedik şekilde bitti (kapanmamış parantez ya da tırnak olabilir)'
    : /double-quoted property/i.test(e.message) ? 'Anahtar adı çift tırnak içinde olmalı (ya da fazladan virgül var)'
      : /after property value|after array element/i.test(e.message) ? 'Virgül ya da kapanış parantezi eksik'
        : /Unexpected token|not valid JSON/i.test(e.message) ? 'Beklenmeyen karakter' : 'Sözdizimi hatası';
  return { pos, line, col, reason, message: e.message, snippet };
}

function parseJson(text) {
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    const er = jsonError(text, e);
    throw new ToolError(`Geçersiz JSON: ${er.reason}, satır ${er.line}, sütun ${er.col}.`, er.message);
  }
}

function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const c of text) {
    if (c === '"') q = !q;
    else if (!q && (c === '\n' || c === '\r')) break;
    else if (!q && c in counts) counts[c]++;
  }
  const best = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
  return best[1] ? best[0] : ',';
}

function parseCsv(text, delim) {
  const rows = [];
  let row = [], field = '', q = false, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"' && field === '' && !quoted) { q = true; quoted = true; }
    else if (c === delim) { row.push(field); field = ''; quoted = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; quoted = false;
    } else field += c;
  }
  if (q) throw new ToolError('CSV çözülemedi: kapanmamış bir tırnak var.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvCell(v, delim) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...',
  8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.',
  '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-',
  '_': '..--.-', '"': '.-..-.', $: '...-..-', '@': '.--.-.'
};
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  if ((n + 1) * (m + 1) > 6e6) throw new ToolError('Metinler karşılaştırma için çok uzun.', 'Her biri en fazla birkaç bin satır olmalı.');
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return { ops, common: dp[0] };
}

function b64urlJson(part, label) {
  try {
    const s = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(s);
  } catch { throw new ToolError(`JWT ${label} bölümü çözülemedi; geçerli bir JWT değil.`); }
}

const LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
  'enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit ' +
  'voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt ' +
  'mollit anim id est laborum curabitur pretium tincidunt lacus nulla gravida orci a odio nullam varius turpis et commodo pharetra ' +
  'est eros bibendum elit nec luctus magna felis sollicitudin mauris integer viverra').split(' ');

function loremSentence() {
  const n = crypto.randomInt(6, 15);
  const w = Array.from({ length: n }, () => LOREM[crypto.randomInt(LOREM.length)]);
  if (n > 8) w[crypto.randomInt(3, n - 3)] += ',';
  const s = w.join(' ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hashTool(alg, label) {
  return tx(alg.replace('-', ''), `${label} özeti`, `Metnin ${label} özetini (hash) UTF-8 olarak hesaplar ve onaltılık (hex) verir.`, (t) => {
    const hex = crypto.createHash(alg).update(t, 'utf8').digest('hex');
    return val(label, hex, { icon: 'key', detail: `${Buffer.byteLength(t, 'utf8')} bayt girdi`, data: { algorithm: alg, hex } });
  });
}

/* ----------------------------------------------------------------- tools */

module.exports = [
  tx('upper', 'Büyük harf', 'Metni Türkçe kurallarla BÜYÜK HARFE çevirir (i→İ, ı→I).', (t) => up(t)),
  tx('lower', 'Küçük harf', 'Metni Türkçe kurallarla küçük harfe çevirir (İ→i, I→ı).', (t) => low(t)),
  tx('title_case', 'Başlık düzeni', 'Her kelimenin ilk harfini büyük, kalanını küçük yapar (Türkçe uyumlu; "istanbul\'da" → "İstanbul\'da").',
    (t) => low(t).replace(/(^|[\s\-("[{/«“])(\p{L})/gu, (m, p, c) => p + up(c))),
  tx('sentence_case', 'Cümle düzeni', 'Metni küçük harfe çevirip her cümlenin ilk harfini büyütür.',
    (t) => low(t).replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (m, p, c) => p + up(c))),
  tx('reverse', 'Metni ters çevir', 'Metni karakter karakter tersine çevirir (emoji ve birleşik harfleri bozmadan).',
    (t) => graphemes(t).reverse().join('')),
  tx('word_count', 'Kelime say', 'Metindeki kelime, cümle ve paragraf sayısını verir.', (t) => {
    const w = words(t).length;
    const sentences = (t.match(/[^.!?…]*\p{L}[^.!?…]*([.!?…]+|$)/gu) || []).filter((s) => s.trim()).length;
    const paragraphs = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
    return { ...val('Kelime sayısı', w, { icon: 'doc', detail: `${sentences} cümle · ${paragraphs} paragraf`, data: { words: w, sentences, paragraphs } }), summary: `Metinde ${fmt(w)} kelime, ${sentences} cümle ve ${paragraphs} paragraf var.` };
  }),
  tx('char_count', 'Karakter say', 'Metindeki karakter sayısını boşluklu ve boşluksuz olarak verir; harf ve rakamları da sayar.', (t) => {
    const g = graphemes(t);
    const all = g.length, noSpace = g.filter((c) => !/^\s+$/.test(c)).length;
    const letters = (t.match(/\p{L}/gu) || []).length, digits = (t.match(/\p{N}/gu) || []).length;
    return {
      ...kvResult(`Metin ${fmt(all)} karakter (boşluksuz ${fmt(noSpace)}).`,
        [['Boşluklu', fmt(all)], ['Boşluksuz', fmt(noSpace)], ['Harf', fmt(letters)], ['Rakam', fmt(digits)], ['Bayt (UTF-8)', fmt(Buffer.byteLength(t, 'utf8'))]],
        { withSpaces: all, withoutSpaces: noSpace, letters, digits }),
      copyText: String(all)
    };
  }),
  tx('line_count', 'Satır say', 'Metindeki toplam, dolu ve boş satır sayısını verir.', (t) => {
    const ls = lines(t), filled = ls.filter((l) => l.trim()).length;
    return { ...val('Satır sayısı', ls.length, { icon: 'doc', detail: `${filled} dolu · ${ls.length - filled} boş`, data: { lines: ls.length, nonEmpty: filled, empty: ls.length - filled } }), summary: `Metinde ${ls.length} satır var (${filled} dolu, ${ls.length - filled} boş).` };
  }),
  tx('reading_time', 'Okuma süresi', 'Metnin tahmini sessiz okuma (dakikada 200 kelime) ve sesli konuşma (dakikada 130 kelime) süresini hesaplar.', (t) => {
    const w = words(t).length;
    const read = minutes(w / 200), speak = minutes(w / 130);
    return { ...val('Okuma süresi', read, { icon: 'timer', detail: `${fmt(w)} kelime · sesli okuma ${speak}`, data: { words: w, readingMinutes: +(w / 200).toFixed(2), speakingMinutes: +(w / 130).toFixed(2) } }), summary: `${fmt(w)} kelime: okuması yaklaşık ${read}, sesli anlatması yaklaşık ${speak} sürer.` };
  }),
  tx('slug', 'Slug oluştur', 'Metni URL dostu kısa ada (slug) çevirir: Türkçe harfleri sadeleştirir, küçük harf ve tire kullanır. "Çok Güzel Şehir!" → "cok-guzel-sehir".', (t, a) => {
    const s = slugify(t, a.separator || '-');
    if (!s) throw new ToolError('Metinde slug yapılacak harf ya da rakam yok.');
    return val('Slug', s, { icon: 'link' });
  }, { params: { separator: { type: 'string', description: 'Ayraç; varsayılan "-" (ör. "_").' } } }),
  tx('clean_spaces', 'Boşlukları temizle', 'Satır başı/sonu boşluklarını siler, art arda boşlukları teke indirir, fazla boş satırları kaldırır. single_line ile tüm metni tek satır yapar.', (t, a) => {
    let r = lines(t).map((l) => l.replace(/[ \t ​]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (a.single_line) r = r.replace(/\s*\n\s*/g, ' ');
    return out('Temizlenmiş metin', r, `Boşluklar temizlendi (${fmt(t.length)} → ${fmt(r.length)} karakter).`);
  }, { params: { single_line: { type: 'boolean', description: 'Satırları birleştirip tek satır yap.' } } }),
  tx('sort_lines', 'Satırları sırala', 'Satırları Türkçe alfabeye göre sıralar (boş satırları atar). reverse ile tersten, numeric ile sayısal sıralar.', (t, a) => {
    const col = new Intl.Collator(TR, { numeric: !!a.numeric, sensitivity: 'base' });
    const ls = lines(t).filter((l) => l.trim());
    ls.sort((x, y) => (a.numeric ? (parseFloat(x.replace(',', '.')) - parseFloat(y.replace(',', '.'))) || col.compare(x, y) : col.compare(x, y)));
    if (a.reverse) ls.reverse();
    return out('Sıralı satırlar', ls.join('\n'), ls.length <= 10 ? `Sıralandı: ${ls.join(', ')}` : `${ls.length} satır sıralandı.`);
  }, { params: { reverse: { type: 'boolean', description: 'Z\'den A\'ya / büyükten küçüğe.' }, numeric: { type: 'boolean', description: 'Satır başındaki sayılara göre sırala.' } } }),
  tx('dedupe_lines', 'Tekrarları kaldır', 'Tekrarlanan satırları siler, ilk geçenleri sırasıyla tutar.', (t, a) => {
    const seen = new Set(), res = [];
    for (const l of lines(t)) {
      const k = a.ignore_case ? low(l.trim()) : l.trim();
      if (k && seen.has(k)) continue;
      seen.add(k);
      res.push(l);
    }
    const removed = lines(t).length - res.length;
    return out('Tekrarsız satırlar', res.join('\n'), `${removed} tekrar satır kaldırıldı, ${res.length} satır kaldı.`);
  }, { params: { ignore_case: { type: 'boolean', description: 'Büyük/küçük harf farkını yok say.' } } }),
  tx('shuffle_lines', 'Satırları karıştır', 'Satırların sırasını rastgele karıştırır (boş satırları atar).', (t) => {
    const ls = shuffle(lines(t).filter((l) => l.trim()));
    return out('Karışık satırlar', ls.join('\n'), ls.length <= 10 ? `Karıştırıldı: ${ls.join(', ')}` : `${ls.length} satır karıştırıldı.`);
  }),
  tx('number_lines', 'Satırları numarala', 'Her satırın başına sıra numarası ekler.', (t, a) => {
    const start = Number.isFinite(+a.start) ? Math.trunc(+a.start) : 1;
    const sep = a.separator ?? '. ';
    const ls = lines(t);
    const skip = !!a.skip_empty;
    let n = start;
    const width = String(start + ls.length - 1).length;
    const r = ls.map((l) => (skip && !l.trim() ? l : `${String(n++).padStart(width, ' ')}${sep}${l}`)).join('\n');
    return out('Numaralı satırlar', r, `${n - start} satır numaralandı.`);
  }, {
    params: {
      start: { type: 'integer', description: 'Başlangıç numarası; varsayılan 1.' },
      separator: { type: 'string', description: 'Numaradan sonraki ayraç; varsayılan ". ".' },
      skip_empty: { type: 'boolean', description: 'Boş satırları numaralama.' }
    }
  }),
  tx('replace', 'Bul ve değiştir', 'Metinde bir ifadeyi bulup başka bir ifadeyle değiştirir; regex ve büyük/küçük harf duyarsız mod desteklenir.', (t, a) => {
    const find = String(need(a, 'find', 'Aranacak ifadeyi'));
    const rep = a.replace == null ? '' : String(a.replace);
    const re = makeRegex(a.regex ? find : escRe(find), a.ignore_case ? 'giu' : 'gu');
    let count = 0;
    const r = t.replace(re, (...m) => {
      count++;
      if (!a.regex) return rep;
      const groups = m.slice(1, -2);
      return rep.replace(/\$(\d{1,2}|&)/g, (x, g) => (g === '&' ? m[0] : groups[+g - 1] ?? ''));
    });
    if (!count) return { summary: `"${find}" metinde bulunamadı; değişiklik yapılmadı.`, display: { type: 'code', title: 'Değişiklik yok', text: truncate(t, 6000) }, data: { count: 0 }, copyText: t };
    return { ...out('Değiştirilmiş metin', r, `${count} yer değiştirildi.${r.length <= 200 ? ` Sonuç: ${r}` : ''}`), data: { count, text: truncate(r, 8000) } };
  }, {
    params: {
      find: { type: 'string', description: 'Aranacak ifade (regex açıksa düzenli ifade).', required: true },
      replace: { type: 'string', description: 'Yerine konacak ifade; boşsa silinir. Regex modunda $1, $2 grup başvurusu olur.' },
      regex: { type: 'boolean', description: 'find bir düzenli ifadedir.' },
      ignore_case: { type: 'boolean', description: 'Büyük/küçük harf duyarsız.' }
    }
  }),
  tx('regex_test', 'Regex dene', 'Bir düzenli ifadeyi metinde dener; eşleşmeleri, konumlarını ve yakalanan grupları listeler.', (t, a) => {
    const pattern = String(need(a, 'pattern', 'Düzenli ifadeyi'));
    const flags = String(a.flags || '');
    if (!/^[dgimsuyv]*$/.test(flags)) throw new ToolError(`Geçersiz bayrak: ${flags}`, 'Kullanılabilir bayraklar: g i m s u y d v');
    const re = makeRegex(pattern, flags.includes('g') ? flags : flags + 'g');
    const matches = [];
    for (const m of t.matchAll(re)) {
      matches.push({ match: m[0], index: m.index, groups: m.slice(1), named: m.groups ? { ...m.groups } : undefined });
      if (matches.length >= 200) break;
    }
    if (!matches.length) return { summary: `/${pattern}/${flags} metinde eşleşmedi.`, display: { type: 'value', label: 'Eşleşme', value: 'Yok', icon: 'search' }, data: { count: 0, matches: [] }, copyText: '' };
    const items = matches.slice(0, 50).map((m, i) => ({
      title: m.match === '' ? '(boş eşleşme)' : truncate(m.match, 120),
      subtitle: m.groups.length ? m.groups.map((g, k) => `$${k + 1}=${g ?? '—'}`).join(' · ') : undefined,
      meta: `#${i + 1} · konum ${m.index}`
    }));
    return { ...listResult(`${matches.length}${matches.length >= 200 ? '+' : ''} eşleşme bulundu: ${matches.slice(0, 5).map((m) => m.match).join(', ')}`, `/${pattern}/${flags}`, items, { count: matches.length, matches: matches.slice(0, 50) }), copyText: matches.map((m) => m.match).join('\n') };
  }, {
    params: {
      pattern: { type: 'string', description: 'Düzenli ifade (eğik çizgisiz), ör. "(\\d+)-(\\d+)".', required: true },
      flags: { type: 'string', description: 'Bayraklar, ör. "i", "im". g her zaman eklenir.' }
    }
  }),
  tx('extract_emails', 'E-posta ayıkla', 'Metindeki tüm e-posta adreslerini bulur ve tekrarsız listeler.', (t) => {
    const found = [...new Set((t.match(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu) || []).map((e) => e.replace(/^[.]+|[.]+$/g, '')))];
    if (!found.length) return { summary: 'Metinde e-posta adresi bulunamadı.', display: { type: 'value', label: 'E-posta', value: 'Yok', icon: 'search' }, data: { emails: [] }, copyText: '' };
    return { ...listResult(`${found.length} e-posta bulundu: ${found.slice(0, 5).join(', ')}`, 'E-postalar', found.map((e) => ({ title: e, icon: 'send' })), { emails: found }), copyText: found.join('\n') };
  }),
  tx('extract_urls', 'URL ayıkla', 'Metindeki tüm web adreslerini (http, https, www) bulur ve tekrarsız listeler.', (t) => {
    const raw = t.match(/\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/gi) || [];
    const clean = raw.map((u) => {
      u = u.replace(/[.,;:!?]+$/, '');
      while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1).replace(/[.,;:!?]+$/, '');
      return u;
    });
    const found = [...new Set(clean)];
    if (!found.length) return { summary: 'Metinde web adresi bulunamadı.', display: { type: 'value', label: 'URL', value: 'Yok', icon: 'search' }, data: { urls: [] }, copyText: '' };
    return { ...listResult(`${found.length} adres bulundu.`, 'Adresler', found.map((u) => ({ title: u, icon: 'link' })), { urls: found }), copyText: found.join('\n') };
  }),
  tx('extract_numbers', 'Sayı ayıkla', 'Metindeki sayıları bulur (Türkçe 1.234,56 ve İngilizce 1,234.56 biçimlerini anlar); toplam ve ortalamayı da verir.', (t) => {
    const nums = extractNumbers(t);
    if (!nums.length) return { summary: 'Metinde sayı bulunamadı.', display: { type: 'value', label: 'Sayı', value: 'Yok', icon: 'calculator' }, data: { numbers: [] }, copyText: '' };
    const values = nums.map((n) => n.value);
    const sum = values.reduce((x, y) => x + y, 0);
    return {
      ...listResult(`${nums.length} sayı bulundu; toplamı ${fmt(sum, 4)}, ortalaması ${fmt(sum / nums.length, 4)}.`, 'Sayılar',
        nums.slice(0, 100).map((n) => ({ title: fmt(n.value, 10), meta: n.raw !== String(n.value) ? n.raw : undefined, icon: 'calculator' })),
        { numbers: values.slice(0, 500), sum, average: sum / nums.length }),
      copyText: values.join('\n')
    };
  }),
  tx('extract_phones', 'Telefon ayıkla', 'Metindeki Türkiye telefon numaralarını (+90 5xx…, 05xx…, (0212)…) bulur ve +90 biçiminde listeler.', (t) => {
    const found = extractPhones(t);
    if (!found.length) return { summary: 'Metinde telefon numarası bulunamadı.', display: { type: 'value', label: 'Telefon', value: 'Yok', icon: 'search' }, data: { phones: [] }, copyText: '' };
    return { ...listResult(`${found.length} telefon numarası bulundu: ${found.slice(0, 3).map((p) => p.number).join(', ')}`, 'Telefonlar', found.map((p) => ({ title: p.number, subtitle: p.raw, meta: p.type, icon: 'chat' })), { phones: found }), copyText: found.map((p) => p.number).join('\n') };
  }),
  tx('base64_encode', 'Base64 kodla', 'Metni UTF-8 olarak Base64\'e kodlar. url_safe ile URL güvenli (base64url) biçim üretir.', (t, a) => {
    let r = Buffer.from(t, 'utf8').toString('base64');
    if (a.url_safe) r = r.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return out('Base64', r);
  }, { params: { url_safe: { type: 'boolean', description: 'base64url biçimi (+ / yerine - _ , dolgusuz).' } } }),
  tx('base64_decode', 'Base64 çöz', 'Base64 (ya da base64url) metni UTF-8 metne çözer.', (t) => {
    let s = t.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) throw new ToolError('Bu geçerli bir Base64 metni değil.');
    s = s.padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
    const buf = Buffer.from(s, 'base64');
    const r = buf.toString('utf8');
    const binary = r.includes('�') || /[\x00-\x08\x0e-\x1f]/.test(r);
    if (binary) return { summary: `Çözüldü ama içerik metin değil, ikili veri gibi görünüyor (${buf.length} bayt).`, display: { type: 'code', title: 'Base64 (onaltılık)', text: truncate(buf.toString('hex').replace(/(..)/g, '$1 ').trim(), 6000) }, data: { bytes: buf.length, binary: true }, copyText: buf.toString('hex') };
    return out('Çözülen metin', r);
  }),
  tx('url_encode', 'URL kodla', 'Metni URL\'de güvenle kullanılacak biçimde yüzde kodlamasıyla kodlar (ş → %C5%9F). full ile tam adresin yapısını korur.', (t, a) => out('URL kodlu', a.full ? encodeURI(t) : encodeURIComponent(t)),
    { params: { full: { type: 'boolean', description: 'Tam bir adres; / ? & : gibi ayraçları kodlama.' } } }),
  tx('url_decode', 'URL çöz', 'Yüzde kodlu (%C5%9F) metni normal metne çevirir; + işaretlerini boşluk yapar.', (t, a) => {
    const s = a.keep_plus ? t : t.replace(/\+/g, ' ');
    try { return out('Çözülen metin', decodeURIComponent(s)); } catch { throw new ToolError('Metinde geçersiz yüzde kodlaması var.'); }
  }, { params: { keep_plus: { type: 'boolean', description: '+ işaretlerini boşluğa çevirme.' } } }),
  tx('html_escape', 'HTML kaçış', 'Metindeki & < > " \' karakterlerini HTML varlıklarına çevirir.', (t) => out('HTML kaçışlı', htmlEscape(t))),
  tx('html_unescape', 'HTML kaçışını çöz', 'HTML varlıklarını (&amp;, &lt;, &#351;, &ccedil; …) normal karakterlere çevirir.', (t) => out('Çözülen metin', htmlUnescape(t))),
  hashTool('md5', 'MD5'),
  hashTool('sha1', 'SHA-1'),
  hashTool('sha256', 'SHA-256'),
  hashTool('sha512', 'SHA-512'),
  tx('uuid', 'UUID üret', 'Rastgele UUID (v4) üretir; count ile 1-20 tane. Metin gerekmez.', (t, a) => {
    const n = Math.min(20, Math.max(1, Math.trunc(+a.count || 1)));
    const ids = Array.from({ length: n }, () => crypto.randomUUID());
    if (n === 1) return val('UUID', ids[0], { icon: 'key' });
    return { ...out(`${n} UUID`, ids.join('\n'), `${n} UUID üretildi.`), data: { uuids: ids } };
  }, { noText: true, params: { count: { type: 'integer', description: 'Kaç tane (1-20); varsayılan 1.' } } }),
  tx('json_format', 'JSON güzelleştir', 'JSON metnini girintili ve okunur biçime getirir; hatalıysa hatanın yerini söyler.', (t, a) => {
    const indent = a.indent === 0 ? 0 : Math.min(8, Math.max(1, Math.trunc(+a.indent || 2)));
    const r = JSON.stringify(parseJson(t), null, a.tabs ? '\t' : indent);
    return out('JSON', r, `JSON düzenlendi (${r.split('\n').length} satır).`);
  }, { params: { indent: { type: 'integer', description: 'Girinti boşluk sayısı; varsayılan 2.' }, tabs: { type: 'boolean', description: 'Boşluk yerine sekme kullan.' } } }),
  tx('json_minify', 'JSON küçült', 'JSON metnindeki tüm gereksiz boşlukları atarak tek satıra indirir.', (t) => {
    const r = JSON.stringify(parseJson(t));
    return out('Küçültülmüş JSON', r, `JSON küçültüldü (${fmt(t.length)} → ${fmt(r.length)} karakter).`);
  }),
  tx('json_validate', 'JSON doğrula', 'Metnin geçerli JSON olup olmadığını denetler; hatalıysa satır ve sütununu, sebebini gösterir.', (t) => {
    try {
      const v = JSON.parse(t.replace(/^﻿/, ''));
      const kind = Array.isArray(v) ? `dizi, ${v.length} öğe` : v && typeof v === 'object' ? `nesne, ${Object.keys(v).length} anahtar` : `tek değer (${typeof v})`;
      return { summary: `Geçerli JSON: ${kind}.`, display: { type: 'value', label: 'JSON geçerli', value: '✓ Geçerli', detail: kind, icon: 'shield' }, data: { valid: true }, copyText: 'Geçerli' };
    } catch (e) {
      const er = jsonError(t, e);
      return {
        summary: `JSON geçersiz: ${er.reason}, satır ${er.line}, sütun ${er.col}.`,
        display: { type: 'code', title: `Hata · satır ${er.line}, sütun ${er.col}`, text: `${er.reason}\n\n${er.snippet}\n\n${er.message}` },
        data: { valid: false, line: er.line, column: er.col, position: er.pos, error: er.message },
        copyText: `Satır ${er.line}, sütun ${er.col}: ${er.reason}`
      };
    }
  }),
  tx('csv_to_json', 'CSV → JSON', 'CSV metnini JSON nesne dizisine çevirir. Ayracı (virgül, noktalı virgül, sekme) kendisi bulur; tırnaklı alanları anlar.', (t, a) => {
    const text = t.replace(/^﻿/, '');
    const map = { tab: '\t', '\\t': '\t', virgül: ',', 'noktalı virgül': ';' };
    const delim = a.delimiter ? (map[a.delimiter] ?? a.delimiter) : detectDelimiter(text);
    const rows = parseCsv(text, delim);
    if (!rows.length) throw new ToolError('CSV içinde satır bulunamadı.');
    const conv = (v) => (a.numbers && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);
    let result;
    if (a.no_header) result = rows.map((r) => r.map(conv));
    else {
      const head = rows[0].map((h, i) => h.trim() || `sütun${i + 1}`);
      const seen = {};
      const keys = head.map((h) => (seen[h] = (seen[h] || 0) + 1) > 1 ? `${h}_${seen[h]}` : h);
      result = rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, conv(r[i] ?? '')])));
    }
    const json = JSON.stringify(result, null, 2);
    const dName = { ',': 'virgül', ';': 'noktalı virgül', '\t': 'sekme' }[delim] || `"${delim}"`;
    return { ...out('JSON', json, `${result.length} kayıt JSON'a çevrildi (ayraç: ${dName}).`), data: { rows: result.length, delimiter: delim, text: truncate(json, 8000) } };
  }, {
    params: {
      delimiter: { type: 'string', description: 'Ayraç: ",", ";", "tab". Verilmezse otomatik bulunur.' },
      no_header: { type: 'boolean', description: 'İlk satır başlık değil; satırları dizi olarak ver.' },
      numbers: { type: 'boolean', description: 'Sayısal alanları sayıya çevir.' }
    }
  }),
  tx('json_to_csv', 'JSON → CSV', 'JSON nesne dizisini CSV tablosuna çevirir (sütunlar tüm anahtarlardan oluşur).', (t, a) => {
    let v = parseJson(t);
    if (!Array.isArray(v)) {
      const arr = v && typeof v === 'object' ? Object.values(v).find(Array.isArray) : null;
      v = arr || [v];
    }
    const delim = a.delimiter === 'tab' ? '\t' : (a.delimiter || ',');
    let rows;
    if (v.every(Array.isArray)) rows = v;
    else if (v.every((x) => x && typeof x === 'object')) {
      const keys = [];
      for (const o of v) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
      rows = [keys, ...v.map((o) => keys.map((k) => o[k]))];
    } else rows = [['değer'], ...v.map((x) => [x])];
    const csv = rows.map((r) => r.map((c) => csvCell(c, delim)).join(delim)).join('\n');
    return out('CSV', csv, `${rows.length} satırlık CSV oluşturuldu.`);
  }, { params: { delimiter: { type: 'string', description: 'Ayraç: "," (varsayılan), ";" ya da "tab".' } } }),
  tx('lorem', 'Lorem ipsum', 'Tasarım ve deneme için lorem ipsum yer tutucu metin üretir. Metin gerekmez.', (t, a) => {
    const n = Math.min(20, Math.max(1, Math.trunc(+a.paragraphs || 3)));
    const paras = Array.from({ length: n }, (_, i) => {
      const s = Array.from({ length: crypto.randomInt(4, 8) }, loremSentence);
      if (i === 0) s[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
      return s.join(' ');
    });
    return out('Lorem ipsum', paras.join('\n\n'), `${n} paragraf lorem ipsum üretildi.`);
  }, { noText: true, params: { paragraphs: { type: 'integer', description: 'Paragraf sayısı (1-20); varsayılan 3.' } } }),
  tx('remove_turkish', 'Türkçe karakterleri kaldır', 'Türkçe harfleri Latin karşılıklarına çevirir: ç→c, ğ→g, ı→i, İ→I, ö→o, ş→s, ü→u.', (t) => out('Sadeleştirilmiş metin', foldTr(t))),
  tx('morse_encode', 'Mors kodla', 'Metni Mors alfabesine çevirir (harfler boşlukla, kelimeler " / " ile ayrılır). Türkçe harfler önce sadeleştirilir.', (t) => {
    const skipped = new Set();
    const r = foldTr(up(t)).trim().split(/\s+/).map((w) => Array.from(w).map((c) => {
      if (MORSE[c]) return MORSE[c];
      skipped.add(c);
      return null;
    }).filter(Boolean).join(' ')).filter(Boolean).join(' / ');
    if (!r) throw new ToolError('Metinde Mors\'a çevrilebilecek karakter yok.');
    return out('Mors', r, `Mors: ${truncate(r, 300)}${skipped.size ? ` (atlanan: ${[...skipped].join(' ')})` : ''}`);
  }),
  tx('morse_decode', 'Mors çöz', 'Mors kodunu metne çevirir. Harfleri boşlukla, kelimeleri "/" ya da üç boşlukla ayır.', (t) => {
    const s = t.replace(/[·•∙]/g, '.').replace(/[−–—_]/g, '-').trim();
    if (!/^[.\-\s/|]+$/.test(s)) throw new ToolError('Bu bir Mors kodu gibi görünmüyor; yalnızca nokta, tire, boşluk ve / olmalı.');
    let unknown = 0;
    const r = s.split(/\s*[/|]\s*|\s{3,}/).map((w) => w.trim().split(/\s+/).filter(Boolean).map((c) => {
      if (UNMORSE[c]) return UNMORSE[c];
      unknown++;
      return '?';
    }).join('')).filter(Boolean).join(' ');
    return out('Çözülen metin', r, `Mors çözüldü: ${truncate(r, 300)}${unknown ? ` (${unknown} tanınmayan kod ? ile gösterildi)` : ''}`);
  }),
  tx('rot13', 'ROT13', 'Metne ROT13 şifrelemesi uygular (Latin harfleri 13 kaydırır); aynı işlem geri de çevirir.',
    (t) => t.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); })),
  tx('to_binary', 'Metni ikiliye çevir', 'Metnin UTF-8 baytlarını 8 bitlik ikili (0/1) gruplara çevirir.', (t) => {
    const r = Array.from(Buffer.from(t, 'utf8'), (b) => b.toString(2).padStart(8, '0')).join(' ');
    return out('İkili', r);
  }),
  tx('from_binary', 'İkiliden metne çevir', 'Boşlukla ayrılmış ya da bitişik 8 bitlik ikili (0/1) kodu UTF-8 metne çevirir.', (t) => {
    const s = t.trim();
    if (!/^[01\s]+$/.test(s)) throw new ToolError('İkili kod yalnızca 0, 1 ve boşluk içermeli.');
    let groups = s.split(/\s+/);
    if (groups.length === 1) {
      if (s.length % 8) throw new ToolError('Bitişik ikili kodun uzunluğu 8\'in katı olmalı.');
      groups = s.match(/.{8}/g);
    }
    if (groups.some((g) => g.length > 8)) throw new ToolError('Her grup en fazla 8 bit olmalı.');
    const r = Buffer.from(groups.map((g) => parseInt(g, 2))).toString('utf8');
    return out('Çözülen metin', r);
  }),
  tx('compare', 'İki metni karşılaştır', 'İki metni satır satır karşılaştırır (tek satırlıysa kelime kelime); eklenenleri +, silinenleri - ile gösterir ve benzerlik yüzdesini verir.', (t, a) => {
    const A = String(need(a, 'a', 'Birinci metni')), B = String(need(a, 'b', 'İkinci metni'));
    const la = lines(A), lb = lines(B);
    const byWord = la.length <= 1 && lb.length <= 1;
    const xa = byWord ? A.trim().split(/\s+/) : la, xb = byWord ? B.trim().split(/\s+/) : lb;
    const { ops, common } = lcsDiff(xa, xb);
    const pct = xa.length + xb.length ? (2 * common) / (xa.length + xb.length) * 100 : 100;
    const added = ops.filter((o) => o[0] === '+').length, removed = ops.filter((o) => o[0] === '-').length;
    const unit = byWord ? 'kelime' : 'satır';
    const diff = ops.map(([op, s]) => `${op} ${s}`).join('\n');
    const summary = A === B ? 'İki metin birebir aynı.' : `Benzerlik %${fmt(pct, 1)}: ${added} ${unit} eklenmiş, ${removed} ${unit} silinmiş.`;
    return {
      summary,
      display: { type: 'code', title: `Fark · %${fmt(pct, 1)} benzer`, text: truncate(diff, 6000) },
      data: { similarity: +pct.toFixed(2), added, removed, unchanged: common, unit, diff: truncate(diff, 6000) },
      copyText: diff
    };
  }, {
    noText: true,
    params: {
      a: { type: 'string', description: 'Birinci (eski) metin.', required: true },
      b: { type: 'string', description: 'İkinci (yeni) metin.', required: true }
    }
  }),
  tx('jwt_decode', 'JWT çöz', 'Bir JWT\'nin başlık ve içerik (payload) bölümlerini çözer, exp/iat/nbf sürelerini tarih olarak gösterir. İmzayı DOĞRULAMAZ.', (t) => {
    const tok = t.trim().replace(/^Bearer\s+/i, '');
    const parts = tok.split('.');
    if (parts.length < 2 || parts.length > 3 || !parts.every((p, i) => /^[A-Za-z0-9_-]*$/.test(p) && (p || i === 2))) throw new ToolError('Bu bir JWT değil; nokta ile ayrılmış üç base64url bölümü olmalı.');
    const header = b64urlJson(parts[0], 'başlık'), payload = b64urlJson(parts[1], 'içerik');
    const when = (s) => new Date(s * 1000).toLocaleString(TR, { dateStyle: 'medium', timeStyle: 'medium' });
    const rows = [['İmza', 'DOĞRULANMADI (yalnızca çözüldü)'], ['Algoritma', header.alg ?? '—'], ['Tür', header.typ ?? '—']];
    if (header.kid) rows.push(['Anahtar (kid)', header.kid]);
    const now = Date.now() / 1000;
    let status = '';
    for (const [k, v] of Object.entries(payload)) {
      if (['exp', 'iat', 'nbf', 'auth_time'].includes(k) && typeof v === 'number') rows.push([k, `${when(v)} (${v})`]);
      else rows.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
    if (typeof payload.exp === 'number') status = payload.exp < now ? ` Süresi ${when(payload.exp)} tarihinde dolmuş.` : ` ${when(payload.exp)} tarihine kadar geçerli.`;
    const json = JSON.stringify({ header, payload }, null, 2);
    return {
      ...kvResult(`JWT çözüldü (${header.alg || 'algoritma yok'}).${status} Dikkat: imza doğrulanmadı, içeriğe güvenmeden önce sunucuda doğrulanmalı.`, rows,
        { header, payload, expired: typeof payload.exp === 'number' ? payload.exp < now : null, signatureVerified: false }),
      copyText: json
    };
  })
];

module.exports.helpers = { slugify, foldTr, parseCsv, detectDelimiter, extractNumbers, extractPhones, lcsDiff, htmlUnescape };
