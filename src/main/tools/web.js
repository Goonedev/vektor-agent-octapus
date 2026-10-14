'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { ToolError, normalizeUrl, fetchWithTimeout, fetchJson, truncate, dirFor, bytes } = require('./util');

const ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  yandex: 'https://yandex.com.tr/search/?text='
};

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

async function open(ctx, url, title) {
  await ctx.electron.shell.openExternal(url);
  return {
    summary: `${title || host(url)} açıldı.`,
    display: { type: 'link', url, title: title || host(url), host: host(url) },
    data: { url }
  };
}

module.exports = [
  {
    name: 'open_url',
    category: 'web',
    title: 'Web sitesi aç',
    description: 'Varsayılan tarayıcıda bir web sitesi açar. "youtube.com" gibi alan adları da kabul edilir.',
    params: { url: { type: 'string', description: 'Açılacak adres, ör. "github.com" veya tam URL.', required: true } },
    run: (a, ctx) => open(ctx, normalizeUrl(a.url))
  },
  {
    name: 'web_search',
    category: 'web',
    title: 'Web\'de ara',
    description: 'Tarayıcıda bir arama motorunda arama yapar.',
    params: {
      query: { type: 'string', description: 'Aranacak ifade.', required: true },
      engine: { type: 'string', enum: Object.keys(ENGINES), description: 'Arama motoru. Varsayılan google.' }
    },
    run: (a, ctx) => open(ctx, (ENGINES[a.engine] || ENGINES.google) + encodeURIComponent(a.query), `“${a.query}” araması`)
  },
  {
    name: 'youtube_search',
    category: 'web',
    title: 'YouTube\'da ara',
    description: 'YouTube\'da video arar ve sonuç sayfasını açar.',
    params: { query: { type: 'string', description: 'Video ya da şarkı adı.', required: true } },
    run: (a, ctx) => open(ctx, 'https://www.youtube.com/results?search_query=' + encodeURIComponent(a.query), `YouTube: ${a.query}`)
  },
  {
    name: 'open_maps',
    category: 'web',
    title: 'Haritada göster',
    description: 'Google Haritalar\'da bir yeri gösterir ya da iki nokta arasında yol tarifi açar.',
    params: {
      destination: { type: 'string', description: 'Gidilecek yer ya da aranacak konum.', required: true },
      origin: { type: 'string', description: 'Yol tarifi için başlangıç noktası. Boşsa sadece konum gösterilir.' },
      mode: { type: 'string', enum: ['driving', 'walking', 'transit', 'bicycling'], description: 'Ulaşım şekli.' }
    },
    run: (a, ctx) => {
      const url = a.origin
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(a.origin)}&destination=${encodeURIComponent(a.destination)}&travelmode=${a.mode || 'driving'}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.destination)}`;
      return open(ctx, url, a.origin ? `${a.origin} → ${a.destination}` : a.destination);
    }
  },
  {
    name: 'translate_text',
    category: 'web',
    title: 'Çeviri aç',
    description: 'Metni Google Çeviri\'de açar. Kısa çevirileri kendin yapabilirsin; bu araç kullanıcı çeviriyi ekranda görmek isterse kullanılır.',
    params: {
      text: { type: 'string', description: 'Çevrilecek metin.', required: true },
      to: { type: 'string', description: 'Hedef dil kodu, ör. en, de, tr.', required: true },
      from: { type: 'string', description: 'Kaynak dil kodu. Boşsa otomatik algılanır.' }
    },
    run: (a, ctx) => open(ctx, `https://translate.google.com/?sl=${a.from || 'auto'}&tl=${a.to}&text=${encodeURIComponent(a.text)}&op=translate`, `Çeviri → ${a.to}`)
  },
  {
    name: 'compose_email',
    category: 'web',
    title: 'E-posta taslağı',
    description: 'Varsayılan e-posta uygulamasında alıcı, konu ve gövdesi dolu yeni bir e-posta taslağı açar. Göndermez.',
    params: {
      to: { type: 'string', description: 'Alıcı adresi (birden fazlaysa virgülle).' },
      subject: { type: 'string', description: 'Konu.' },
      body: { type: 'string', description: 'E-posta metni.' }
    },
    run: async (a, ctx) => {
      const q = new URLSearchParams();
      if (a.subject) q.set('subject', a.subject);
      if (a.body) q.set('body', a.body);
      const url = `mailto:${encodeURIComponent(a.to || '')}?${q.toString().replace(/\+/g, '%20')}`;
      await ctx.electron.shell.openExternal(url);
      return {
        summary: `E-posta taslağı açıldı${a.to ? ` (${a.to})` : ''}.`,
        display: { type: 'kv', rows: [['Alıcı', a.to || '—'], ['Konu', a.subject || '—'], ['Metin', truncate(a.body || '—', 200)]] }
      };
    }
  },
  {
    name: 'wikipedia_summary',
    category: 'web',
    title: 'Vikipedi özeti',
    description: 'Vikipedi\'den bir konunun kısa özetini getirir. Bilgiyi kullanıcıya sesli özetle.',
    params: {
      topic: { type: 'string', description: 'Konu başlığı.', required: true },
      lang: { type: 'string', description: 'Dil kodu. Varsayılan tr.' }
    },
    run: async (a) => {
      const lang = (a.lang || 'tr').slice(0, 5);
      const search = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${encodeURIComponent(a.topic)}`);
      const title = search?.[1]?.[0];
      if (!title) throw new ToolError(`Vikipedi'de “${a.topic}” bulunamadı.`);
      const page = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      return {
        summary: page.extract || 'Özet bulunamadı.',
        display: {
          type: 'article',
          title: page.title,
          subtitle: page.description,
          text: page.extract,
          image: page.thumbnail?.source,
          url: page.content_urls?.desktop?.page
        },
        data: { title: page.title, description: page.description, extract: page.extract }
      };
    }
  },
  {
    name: 'read_webpage',
    category: 'web',
    title: 'Sayfayı oku',
    description: 'Bir web sayfasının metnini indirir, böylece içeriğini özetleyebilir ya da soruları yanıtlayabilirsin.',
    params: { url: { type: 'string', description: 'Okunacak sayfa adresi.', required: true } },
    run: async (a) => {
      const url = normalizeUrl(a.url);
      const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html,text/plain' } });
      if (!res.ok) throw new ToolError(`Sayfa ${res.status} döndürdü.`);
      const raw = await res.text();
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const text = /html/i.test(res.headers.get('content-type') || 'html') ? htmlToText(raw) : raw;
      const title = titleMatch ? htmlToText(titleMatch[1]) : host(url);
      return {
        summary: `“${title}” okundu (${text.length} karakter).`,
        display: { type: 'article', title, subtitle: host(url), text: truncate(text, 600), url },
        data: { title, text: truncate(text, 6000) }
      };
    }
  },
  {
    name: 'check_website',
    category: 'web',
    title: 'Site durumu',
    description: 'Bir web sitesinin açık olup olmadığını ve yanıt süresini kontrol eder.',
    params: { url: { type: 'string', description: 'Kontrol edilecek adres.', required: true } },
    run: async (a) => {
      const url = normalizeUrl(a.url);
      const t0 = performance.now();
      let status = 0, ok = false, error;
      try {
        const res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, 10000);
        status = res.status; ok = res.ok;
        res.body?.cancel?.();
      } catch (e) { error = e.message; }
      const ms = Math.round(performance.now() - t0);
      return {
        summary: ok ? `${host(url)} çalışıyor (${status}, ${ms} ms).` : `${host(url)} yanıt vermiyor${status ? ` (${status})` : ''}.`,
        display: { type: 'kv', status: ok ? 'success' : 'danger', rows: [['Site', host(url)], ['Durum', ok ? 'Çevrim içi' : 'Erişilemiyor'], ['HTTP', status || '—'], ['Süre', `${ms} ms`], ...(error ? [['Hata', error]] : [])] },
        data: { ok, status, ms }
      };
    }
  },
  {
    name: 'download_file',
    category: 'web',
    title: 'Dosya indir',
    description: 'Bir adresteki dosyayı İndirilenler klasörüne kaydeder.',
    params: {
      url: { type: 'string', description: 'İndirilecek dosyanın adresi.', required: true },
      filename: { type: 'string', description: 'Kaydedilecek dosya adı. Boşsa adresten çıkarılır.' }
    },
    run: async (a) => {
      const url = normalizeUrl(a.url);
      const res = await fetchWithTimeout(url, {}, 120000);
      if (!res.ok || !res.body) throw new ToolError(`İndirme başarısız: ${res.status}.`);
      let name = a.filename || decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'indirilen-dosya';
      name = name.replace(/[<>:"/\\|?*]/g, '_');
      const dir = dirFor('downloads');
      let target = path.join(dir, name);
      for (let i = 1; fs.existsSync(target); i++) {
        const ext = path.extname(name);
        target = path.join(dir, `${path.basename(name, ext)} (${i})${ext}`);
      }
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(target));
      const size = fs.statSync(target).size;
      return {
        summary: `${path.basename(target)} indirildi (${bytes(size)}).`,
        display: { type: 'file', path: target, name: path.basename(target), meta: bytes(size) },
        data: { path: target, size }
      };
    }
  }
];

module.exports.htmlToText = htmlToText;
