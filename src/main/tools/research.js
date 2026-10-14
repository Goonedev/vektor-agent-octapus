'use strict';

/*
 * Research tools. deep_research searches the web and reads pages (via Gemini's Google Search
 * grounding) and answers without opening a browser. find_download_link researches where a file
 * can be downloaded, and download_from_web downloads a chosen link (with approval).
 */

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { ToolError, dirFor, bytes, normalizeUrl, fetchWithTimeout, truncate } = require('./util');

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

module.exports = [
  {
    name: 'deep_research',
    category: 'web',
    title: 'Derin araştırma',
    description: 'Bir soruyu web\'de araştırır: arama yapar, kaynak sayfaları okur ve kaynaklı bir cevap verir. Tarayıcı açmaz. Güncel, çok kaynaklı ya da derinlemesine bilgi gerektiren sorularda (fiyat, karşılaştırma, "en iyi X", haber, teknik detay) bunu kullan; sonucu kullanıcıya sesli özetle.',
    timeout: 90000,
    params: {
      question: { type: 'string', description: 'Araştırılacak soru ya da konu.', required: true },
      deep: { type: 'boolean', description: 'Daha kapsamlı araştırma (birden fazla kaynak, daha uzun). Varsayılan normal.' }
    },
    run: async (a, ctx) => {
      const { research } = require('../research');
      const { text, sources } = await research(ctx.settings, a.question, a.deep ? 'deep' : 'normal');
      if (!text) throw new ToolError('Araştırma bir sonuç döndürmedi.');
      return {
        summary: text,
        display: {
          type: 'article',
          title: a.question,
          subtitle: sources.length ? `${sources.length} kaynak` : 'Web araştırması',
          text: truncate(text, 1200),
          sources: sources.slice(0, 8)
        },
        data: { answer: truncate(text, 6000), sources: sources.slice(0, 8).map((s) => s.url) }
      };
    }
  },
  {
    name: 'find_download_link',
    category: 'web',
    title: 'İndirme bağlantısı bul',
    description: 'Bir dosyanın (program, belge, sürücü, PDF...) nereden indirilebileceğini araştırır ve doğrudan indirme bağlantıları önerir. Resmi kaynakları tercih eder. Bulduktan sonra kullanıcı onaylarsa download_from_web ile indir.',
    timeout: 90000,
    params: {
      what: { type: 'string', description: 'İndirilecek şeyin adı, ör. "7-Zip son sürüm", "Dune 2021 afişi".', required: true },
      file_type: { type: 'string', description: 'İstenen dosya türü, ör. exe, pdf, zip, mp3. İsteğe bağlı.' }
    },
    run: async (a, ctx) => {
      const { findDownload } = require('../research');
      const { candidates, sources } = await findDownload(ctx.settings, a.what, a.file_type);
      if (!candidates.length) throw new ToolError(`“${a.what}” için doğrudan indirme bağlantısı bulunamadı.`);
      return {
        summary: `${candidates.length} indirme bağlantısı bulundu. En uygunu: ${candidates[0].source || host(candidates[0].url)}. İndirmemi ister misin?`,
        display: { type: 'list', title: `“${a.what}” için indirme bağlantıları`, items: candidates.map((c) => ({ title: c.source || host(c.url), subtitle: c.note || c.url, meta: host(c.url), icon: 'arrows' })) },
        data: { candidates: candidates.map((c) => ({ url: c.url, source: c.source, note: c.note })), sources: sources.slice(0, 5).map((s) => s.url) }
      };
    }
  },
  {
    name: 'download_from_web',
    category: 'web',
    title: 'Bağlantıdan indir',
    description: 'Verilen bir adresteki dosyayı İndirilenler klasörüne indirir. Genelde find_download_link ile bulunan bir adresle kullanılır. İsteğe bağlı olarak indirince açar.',
    danger: true,
    timeout: 300000,
    params: {
      url: { type: 'string', description: 'İndirilecek dosyanın doğrudan adresi.', required: true },
      filename: { type: 'string', description: 'Kaydedilecek dosya adı. Boşsa adresten çıkarılır.' },
      open_after: { type: 'boolean', description: 'İndirince dosyayı aç.' }
    },
    run: async (a, ctx) => {
      const url = normalizeUrl(a.url);
      const res = await fetchWithTimeout(url, {}, 240000);
      if (!res.ok || !res.body) throw new ToolError(`İndirme başarısız: ${res.status}.`);
      const type = res.headers.get('content-type') || '';
      if (/^text\/html/i.test(type)) throw new ToolError('Bu adres bir dosya değil, bir web sayfası. Önce find_download_link ile doğrudan dosya bağlantısı bul.');
      let name = (a.filename || decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'indirilen-dosya').replace(/[<>:"/\\|?*]/g, '_');
      const dir = dirFor('downloads');
      let target = path.join(dir, name);
      for (let i = 1; fs.existsSync(target); i++) {
        const ext = path.extname(name);
        target = path.join(dir, `${path.basename(name, ext)} (${i})${ext}`);
      }
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(target));
      const size = fs.statSync(target).size;
      if (a.open_after) await ctx.electron.shell.openPath(target).catch(() => {});
      return {
        summary: `${path.basename(target)} indirildi (${bytes(size)})${a.open_after ? ' ve açıldı' : ''}.`,
        display: { type: 'file', path: target, name: path.basename(target), meta: `${bytes(size)} · ${host(url)}`, icon: 'arrows' },
        data: { path: target, size }
      };
    }
  }
];
