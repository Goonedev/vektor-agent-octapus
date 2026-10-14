'use strict';

/*
 * Sites pack: one-shot openers for popular services and in-site search shortcuts that build the
 * site's own search URL (query always URL-encoded).
 */

const { ToolError, openUri, linkResult } = require('./kit');

/* ------------------------------------------------------------ site openers */

// [key, name, url, what it is]
const SITES = [
  ['gmail', 'Gmail', 'https://mail.google.com/', 'Google e-posta'],
  ['google_drive', 'Google Drive', 'https://drive.google.com/', 'bulut dosyaları'],
  ['google_calendar', 'Google Takvim', 'https://calendar.google.com/', 'takvim ve etkinlikler'],
  ['google_photos', 'Google Fotoğraflar', 'https://photos.google.com/', 'fotoğraf arşivi'],
  ['google_translate', 'Google Çeviri', 'https://translate.google.com/?sl=auto&tl=tr', 'çeviri'],
  ['outlook', 'Outlook', 'https://outlook.live.com/mail/', 'Microsoft e-posta'],
  ['onedrive', 'OneDrive', 'https://onedrive.live.com/', 'Microsoft bulut dosyaları'],
  ['icloud', 'iCloud', 'https://www.icloud.com/', 'Apple bulut hizmetleri'],
  ['instagram', 'Instagram', 'https://www.instagram.com/', 'sosyal medya'],
  ['x', 'X', 'https://x.com/', 'sosyal medya (eski adıyla Twitter)'],
  ['facebook', 'Facebook', 'https://www.facebook.com/', 'sosyal medya'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/', 'profesyonel ağ'],
  ['reddit', 'Reddit', 'https://www.reddit.com/', 'topluluk forumları'],
  ['tiktok', 'TikTok', 'https://www.tiktok.com/', 'kısa videolar'],
  ['twitch', 'Twitch', 'https://www.twitch.tv/', 'canlı yayınlar'],
  ['kick', 'Kick', 'https://kick.com/', 'canlı yayınlar'],
  ['netflix', 'Netflix', 'https://www.netflix.com/browse', 'dizi ve film'],
  ['disney_plus', 'Disney+', 'https://www.disneyplus.com/', 'dizi ve film'],
  ['prime_video', 'Prime Video', 'https://www.primevideo.com/', 'dizi ve film'],
  ['spotify', 'Spotify Web', 'https://open.spotify.com/', 'müzik ve podcast (web oynatıcı)'],
  ['youtube_music', 'YouTube Music', 'https://music.youtube.com/', 'müzik'],
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/', 'müzik ve ses'],
  ['chatgpt', 'ChatGPT', 'https://chatgpt.com/', 'OpenAI sohbet asistanı'],
  ['claude', 'Claude', 'https://claude.ai/', 'Anthropic yapay zekâ asistanı'],
  ['gemini', 'Gemini', 'https://gemini.google.com/', 'Google yapay zekâ asistanı'],
  ['github', 'GitHub', 'https://github.com/', 'kod depoları'],
  ['stackoverflow', 'Stack Overflow', 'https://stackoverflow.com/', 'yazılım soru-cevap'],
  ['notion', 'Notion', 'https://www.notion.so/', 'notlar ve çalışma alanı'],
  ['trello', 'Trello', 'https://trello.com/', 'görev panoları'],
  ['figma', 'Figma', 'https://www.figma.com/', 'arayüz tasarımı'],
  ['canva', 'Canva', 'https://www.canva.com/', 'grafik tasarım'],
  ['discord', 'Discord', 'https://discord.com/app', 'sohbet sunucuları (web)'],
  ['whatsapp', 'WhatsApp Web', 'https://web.whatsapp.com/', 'mesajlaşma (web)'],
  ['telegram', 'Telegram Web', 'https://web.telegram.org/', 'mesajlaşma (web)'],
  ['trendyol', 'Trendyol', 'https://www.trendyol.com/', 'alışveriş'],
  ['hepsiburada', 'Hepsiburada', 'https://www.hepsiburada.com/', 'alışveriş'],
  ['amazon', 'Amazon Türkiye', 'https://www.amazon.com.tr/', 'alışveriş'],
  ['n11', 'n11', 'https://www.n11.com/', 'alışveriş'],
  ['sahibinden', 'Sahibinden', 'https://www.sahibinden.com/', 'ilan sitesi (emlak, vasıta, ikinci el)'],
  ['yemeksepeti', 'Yemeksepeti', 'https://www.yemeksepeti.com/', 'yemek siparişi'],
  ['getir', 'Getir', 'https://getir.com/', 'hızlı market ve yemek siparişi'],
  ['edevlet', 'e-Devlet', 'https://www.turkiye.gov.tr/', 'kamu hizmetleri kapısı'],
  ['mhrs', 'MHRS', 'https://www.mhrs.gov.tr/', 'hastane randevusu'],
  ['vikipedi', 'Vikipedi', 'https://tr.wikipedia.org/', 'Türkçe ansiklopedi'],
  ['eksisozluk', 'Ekşi Sözlük', 'https://eksisozluk.com/', 'kolektif sözlük'],
  ['google_news', 'Google Haberler', 'https://news.google.com/?hl=tr&gl=TR&ceid=TR:tr', 'güncel haberler'],
  ['speedtest', 'Speedtest', 'https://www.speedtest.net/', 'internet hız testi'],
  ['epic_games', 'Epic Games Store', 'https://store.epicgames.com/tr/', 'oyun mağazası'],
  ['steam_store', 'Steam Mağaza', 'https://store.steampowered.com/', 'oyun mağazası'],
  ['pinterest', 'Pinterest', 'https://www.pinterest.com/', 'görsel fikir panoları']
];

function siteTool([key, name, url, what]) {
  return {
    name: `site_${key}`,
    category: 'sites',
    title: `${name} aç`,
    description: `${name} sitesini (${what}) varsayılan tarayıcıda açar.`,
    run: async (a, ctx) => {
      await openUri(ctx, url);
      return linkResult(url, name);
    }
  };
}

/* ------------------------------------------------------------ in-site search */

const enc = encodeURIComponent;
const google = (site, q) => `https://www.google.com/search?q=${enc(`site:${site} ${q}`)}`;

// [key, site name, url builder(query), what is searched]
const SEARCHES = [
  ['google_images', 'Google Görseller', (q) => `https://www.google.com/search?tbm=isch&q=${enc(q)}`, 'görseller'],
  ['google_news', 'Google Haberler', (q) => `https://news.google.com/search?q=${enc(q)}&hl=tr&gl=TR&ceid=TR:tr`, 'haberler'],
  ['google_scholar', 'Google Akademik', (q) => `https://scholar.google.com/scholar?hl=tr&q=${enc(q)}`, 'akademik makaleler'],
  ['youtube_music', 'YouTube Music', (q) => `https://music.youtube.com/search?q=${enc(q)}`, 'şarkı, sanatçı ve albümler'],
  ['spotify', 'Spotify', (q) => `https://open.spotify.com/search/${enc(q)}`, 'şarkı, sanatçı, podcast'],
  ['vikipedi', 'Vikipedi', (q) => `https://tr.wikipedia.org/w/index.php?search=${enc(q)}`, 'Türkçe Vikipedi maddeleri'],
  ['eksisozluk', 'Ekşi Sözlük', (q) => `https://eksisozluk.com/?q=${enc(q)}`, 'başlıklar'],
  ['reddit', 'Reddit', (q) => `https://www.reddit.com/search/?q=${enc(q)}`, 'gönderi ve topluluklar'],
  ['x', 'X', (q) => `https://x.com/search?q=${enc(q)}&src=typed_query`, 'gönderiler'],
  ['tiktok', 'TikTok', (q) => `https://www.tiktok.com/search?q=${enc(q)}`, 'videolar'],
  ['twitch', 'Twitch', (q) => `https://www.twitch.tv/search?term=${enc(q)}`, 'yayıncı ve kategoriler'],
  ['github_repos', 'GitHub depoları', (q) => `https://github.com/search?q=${enc(q)}&type=repositories`, 'depolar'],
  ['github_code', 'GitHub kodu', (q) => `https://github.com/search?q=${enc(q)}&type=code`, 'kod'],
  ['stackoverflow', 'Stack Overflow', (q) => `https://stackoverflow.com/search?q=${enc(q)}`, 'sorular'],
  ['npm', 'npm', (q) => `https://www.npmjs.com/search?q=${enc(q)}`, 'JavaScript paketleri'],
  ['pypi', 'PyPI', (q) => `https://pypi.org/search/?q=${enc(q)}`, 'Python paketleri'],
  ['mdn', 'MDN', (q) => `https://developer.mozilla.org/en-US/search?q=${enc(q)}`, 'web geliştirme belgeleri'],
  ['docker_hub', 'Docker Hub', (q) => `https://hub.docker.com/search?q=${enc(q)}`, 'konteyner imajları'],
  ['amazon', 'Amazon Türkiye', (q) => `https://www.amazon.com.tr/s?k=${enc(q)}`, 'ürünler'],
  ['trendyol', 'Trendyol', (q) => `https://www.trendyol.com/sr?q=${enc(q)}`, 'ürünler'],
  ['hepsiburada', 'Hepsiburada', (q) => `https://www.hepsiburada.com/ara?q=${enc(q)}`, 'ürünler'],
  ['n11', 'n11', (q) => `https://www.n11.com/arama?q=${enc(q)}`, 'ürünler'],
  ['sahibinden', 'Sahibinden', (q) => `https://www.sahibinden.com/kelime-ile-arama?query_text=${enc(q)}`, 'ilanlar'],
  ['akakce', 'Akakçe', (q) => `https://www.akakce.com/arama/?q=${enc(q)}`, 'fiyat karşılaştırma'],
  ['cimri', 'Cimri', (q) => `https://www.cimri.com/arama?q=${enc(q)}`, 'fiyat karşılaştırma'],
  ['ebay', 'eBay', (q) => `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}`, 'ürünler'],
  ['aliexpress', 'AliExpress', (q) => `https://www.aliexpress.com/wholesale?SearchText=${enc(q)}`, 'ürünler'],
  ['imdb', 'IMDb', (q) => `https://www.imdb.com/find/?q=${enc(q)}`, 'film, dizi ve oyuncular'],
  ['steam', 'Steam', (q) => `https://store.steampowered.com/search/?term=${enc(q)}`, 'oyunlar'],
  ['netflix', 'Netflix', (q) => `https://www.netflix.com/search?q=${enc(q)}`, 'dizi ve filmler'],
  ['google_play', 'Google Play', (q) => `https://play.google.com/store/search?q=${enc(q)}&c=apps`, 'Android uygulamaları'],
  ['microsoft_store', 'Microsoft Store', (q) => `https://apps.microsoft.com/search?query=${enc(q)}`, 'Windows uygulamaları'],
  ['udemy', 'Udemy', (q) => `https://www.udemy.com/courses/search/?q=${enc(q)}`, 'kurslar'],
  ['coursera', 'Coursera', (q) => `https://www.coursera.org/search?query=${enc(q)}`, 'kurslar'],
  // Yemeksepeti has no location-free search URL, so search its pages through Google.
  ['yemeksepeti', 'Yemeksepeti', (q) => google('yemeksepeti.com', q), 'restoran ve yemekler (Google üzerinden)'],
  ['booking', 'Booking.com', (q) => `https://www.booking.com/searchresults.tr.html?ss=${enc(q)}`, 'oteller ve konaklama'],
  ['airbnb', 'Airbnb', (q) => `https://www.airbnb.com.tr/s/${enc(q)}/homes`, 'konaklama yerleri'],
  ['skyscanner', 'Skyscanner', skyscanner, 'uçuşlar ("IST AMS" gibi havalimanı kodlarıyla doğrudan)'],
  ['tdk', 'TDK Güncel Türkçe Sözlük', (q) => `https://sozluk.gov.tr/?kelime=${enc(q)}`, 'kelime anlamları'],
  ['tureng', 'Tureng', (q) => `https://tureng.com/tr/turkce-ingilizce/${enc(q)}`, 'Türkçe-İngilizce çeviri'],
  ['cambridge', 'Cambridge Dictionary', (q) => `https://dictionary.cambridge.org/search/direct/?datasetsearch=english&q=${enc(q)}`, 'İngilizce kelimeler'],
  ['genius', 'Genius', (q) => `https://genius.com/search?q=${enc(q)}`, 'şarkı sözleri'],
  ['google_books', 'Google Kitaplar', (q) => `https://www.google.com/search?tbm=bks&q=${enc(q)}`, 'kitaplar'],
  ['pinterest', 'Pinterest', (q) => `https://www.pinterest.com/search/pins/?q=${enc(q)}`, 'görsel fikirler'],
  ['unsplash', 'Unsplash', (q) => `https://unsplash.com/s/photos/${enc(q.replace(/\s+/g, '-'))}`, 'ücretsiz fotoğraflar'],
  ['internet_archive', 'Internet Archive', (q) => `https://archive.org/search?query=${enc(q)}`, 'arşivlenmiş kitap, video ve yazılımlar'],
  ['letterboxd', 'Letterboxd', (q) => `https://letterboxd.com/search/${enc(q)}/`, 'filmler'],
  ['wolfram_alpha', 'Wolfram Alpha', (q) => `https://www.wolframalpha.com/input?i=${enc(q)}`, 'hesaplama ve bilgi']
];

function skyscanner(q) {
  const m = q.match(/^([a-z]{3})\s*(?:[-–>]+|\s|\bto\b)\s*([a-z]{3})$/i);
  if (m) return `https://www.skyscanner.com.tr/transport/flights/${m[1].toLowerCase()}/${m[2].toLowerCase()}/`;
  return google('skyscanner.com.tr', q);
}

function queryOf(a) {
  const q = String(a?.query ?? '').trim();
  if (!q) throw new ToolError('Aranacak bir ifade söylemelisin.');
  return q;
}

function searchTool([key, name, build, what]) {
  return {
    name: `search_${key}`,
    category: 'sites',
    title: `${name} araması`,
    description: `${name} üzerinde arama yapar ve sonuçları tarayıcıda açar (${what}).`,
    params: { query: { type: 'string', description: 'Aranacak ifade.', required: true } },
    run: async (a, ctx) => {
      const q = queryOf(a);
      const url = build(q);
      await openUri(ctx, url);
      const r = linkResult(url, `${name}: ${q}`);
      r.summary = `${name} üzerinde "${q}" araması açıldı.`;
      return r;
    }
  };
}

const extra = [
  {
    name: 'search_directions',
    category: 'sites',
    title: 'Yol tarifi',
    description: 'Google Haritalar\'da iki yer arasında yol tarifini açar. Başlangıç verilmezse mevcut konumdan hesaplanır.',
    params: {
      to: { type: 'string', description: 'Varış noktası (adres veya yer adı).', required: true },
      from: { type: 'string', description: 'Başlangıç noktası. Boş bırakılırsa mevcut konum.' },
      mode: { type: 'string', enum: ['driving', 'walking', 'transit', 'bicycling'], description: 'Ulaşım şekli. Varsayılan araba.' }
    },
    run: async (a, ctx) => {
      const to = String(a?.to ?? '').trim();
      if (!to) throw new ToolError('Nereye gitmek istediğini söylemelisin.');
      const from = String(a?.from ?? '').trim();
      const p = new URLSearchParams({ api: '1', destination: to });
      if (from) p.set('origin', from);
      if (a?.mode) p.set('travelmode', a.mode);
      const url = `https://www.google.com/maps/dir/?${p.toString().replace(/\+/g, '%20')}`;
      await openUri(ctx, url);
      const r = linkResult(url, `Yol tarifi: ${from || 'Konumum'} → ${to}`);
      r.summary = `${from || 'Mevcut konumdan'} ${to} için yol tarifi açıldı.`;
      return r;
    }
  },
  {
    name: 'search_instagram_tag',
    category: 'sites',
    title: 'Instagram etiketi',
    description: 'Instagram\'da bir hashtag sayfasını açar (# ve boşluklar otomatik temizlenir).',
    params: { query: { type: 'string', description: 'Etiket, örneğin "#istanbul" veya "kedi maması".', required: true } },
    run: async (a, ctx) => {
      const tag = queryOf(a).replace(/[#\s]+/g, '');
      if (!tag) throw new ToolError('Geçerli bir etiket söylemelisin.');
      const url = `https://www.instagram.com/explore/tags/${enc(tag)}/`;
      await openUri(ctx, url);
      const r = linkResult(url, `Instagram #${tag}`);
      r.summary = `Instagram'da #${tag} etiketi açıldı.`;
      return r;
    }
  }
];

const searchTools = SEARCHES.map(searchTool);
// keep the directions/tag tools next to their siblings in the list
searchTools.splice(3, 0, extra[0]);
searchTools.splice(11, 0, extra[1]);

module.exports = [...SITES.map(siteTool), ...searchTools];
module.exports.SITES = SITES;
module.exports.SEARCHES = SEARCHES;
