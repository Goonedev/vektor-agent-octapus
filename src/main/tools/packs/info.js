'use strict';

/*
 * Information pack: keyless public APIs (crypto, quakes, prayer times, weather extras,
 * Wikipedia, package registries, domains, speed test...). Response parsing lives in pure
 * functions exported as `parsers` so tests can run without the network.
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns').promises;
const crypto = require('node:crypto');
const { domainToASCII } = require('node:url');
const { ToolError, norm, fetchWithTimeout, normalizeUrl, truncate, dirFor, bytes, duration } = require('../util');
const { host } = require('./kit');

const T = 12000;

/* ------------------------------------------------------------ helpers */

const nf = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('tr-TR', { maximumFractionDigits: d }) : '—');
const pct = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '-'}%${nf(Math.abs(n), 2)}` : '—');
const big = (n) => {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return `${nf(n / 1e12, 2)} trilyon`;
  if (a >= 1e9) return `${nf(n / 1e9, 2)} milyar`;
  if (a >= 1e6) return `${nf(n / 1e6, 2)} milyon`;
  return nf(n, 0);
};
const price = (n) => (Number.isFinite(n) ? nf(n, Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 4 : 8) : '—');
const fmtDate = (d, tz) => (d ? new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', ...(tz ? { timeZone: tz } : {}) }) : '—');
const fmtDateTime = (d, tz) => new Date(d).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

/** GET JSON with readable Turkish errors. */
async function getJson(url, { notFound, headers, ms = T } = {}) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json', ...(headers || {}) } }, ms);
  if (res.status === 404 && notFound) throw new ToolError(notFound);
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
    throw new ToolError('Servis istek sınırına ulaştı; biraz sonra tekrar dene.');
  }
  if (!res.ok) throw new ToolError(`Sunucu ${res.status} döndürdü.`);
  try { return await res.json(); } catch { throw new ToolError('Sunucudan geçersiz yanıt geldi.'); }
}

/** City → coordinates via Open-Meteo geocoding; no city → approximate location from IP (same approach as get_weather). */
async function locate(city) {
  if (city) {
    const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=tr&name=${encodeURIComponent(city)}`);
    const r = g.results?.[0];
    if (!r) throw new ToolError(`“${city}” konumu bulunamadı.`);
    return { name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
  }
  const ip = await getJson('https://ipwho.is/?lang=tr');
  if (ip.success === false) throw new ToolError('Konum bulunamadı; bir şehir adı söyle.');
  return { name: ip.city, region: [ip.region, ip.country].filter(Boolean).join(', '), lat: ip.latitude, lon: ip.longitude };
}

/* ------------------------------------------------------------- crypto */

const COINS = {
  btc: 'bitcoin', bitcoin: 'bitcoin', eth: 'ethereum', ethereum: 'ethereum', ether: 'ethereum', usdt: 'tether', tether: 'tether',
  bnb: 'binancecoin', binance: 'binancecoin', sol: 'solana', solana: 'solana', xrp: 'ripple', ripple: 'ripple', usdc: 'usd-coin',
  ada: 'cardano', cardano: 'cardano', doge: 'dogecoin', dogecoin: 'dogecoin', trx: 'tron', tron: 'tron', ton: 'the-open-network',
  avax: 'avalanche-2', avalanche: 'avalanche-2', shib: 'shiba-inu', shiba: 'shiba-inu', dot: 'polkadot', polkadot: 'polkadot',
  link: 'chainlink', chainlink: 'chainlink', matic: 'matic-network', polygon: 'matic-network', pol: 'polygon-ecosystem-token',
  ltc: 'litecoin', litecoin: 'litecoin', bch: 'bitcoin-cash', atom: 'cosmos', cosmos: 'cosmos', xlm: 'stellar', stellar: 'stellar',
  uni: 'uniswap', uniswap: 'uniswap', near: 'near', apt: 'aptos', aptos: 'aptos', arb: 'arbitrum', arbitrum: 'arbitrum',
  op: 'optimism', optimism: 'optimism', sui: 'sui', pepe: 'pepe', etc: 'ethereum-classic', fil: 'filecoin', filecoin: 'filecoin',
  xmr: 'monero', monero: 'monero', hbar: 'hedera-hashgraph', icp: 'internet-computer', render: 'render-token', inj: 'injective-protocol',
  chz: 'chiliz', chiliz: 'chiliz', mana: 'decentraland', sand: 'the-sandbox', axs: 'axie-infinity', ape: 'apecoin', ftm: 'fantom',
  algo: 'algorand', algorand: 'algorand', vet: 'vechain', trump: 'official-trump', wld: 'worldcoin-wld', kas: 'kaspa', kaspa: 'kaspa'
};

function coinId(q) {
  const k = norm(q).replace(/\s+/g, '');
  return COINS[k] || null;
}

function parseCryptoPrice(json, id) {
  const c = json?.[id];
  if (!c || c.usd == null) return null;
  return { id, try: c.try, usd: c.usd, tryChange: c.try_24h_change, usdChange: c.usd_24h_change };
}

function parseCryptoTop(arr) {
  return (Array.isArray(arr) ? arr : []).map((c) => ({
    rank: c.market_cap_rank, id: c.id, name: c.name, symbol: String(c.symbol || '').toUpperCase(),
    price: c.current_price, change: c.price_change_percentage_24h, cap: c.market_cap
  }));
}

/* ---------------------------------------------------------- earthquakes */

const DIRS = { N: 'K', S: 'G', E: 'D', W: 'B' };
const PLACES = { Turkey: 'Türkiye', 'Türkiye': 'Türkiye', Greece: 'Yunanistan', Cyprus: 'Kıbrıs', Syria: 'Suriye', Iran: 'İran', Iraq: 'Irak', Georgia: 'Gürcistan', Armenia: 'Ermenistan', Azerbaijan: 'Azerbaycan', Bulgaria: 'Bulgaristan', 'Aegean Sea': 'Ege Denizi', 'Black Sea': 'Karadeniz', 'Eastern Mediterranean Sea': 'Doğu Akdeniz', 'central Mediterranean Sea': 'Akdeniz', 'Dodecanese Islands, Greece': 'Onikiadalar, Yunanistan' };

function trPlace(place) {
  let p = String(place || '').trim();
  for (const [en, tr] of Object.entries(PLACES)) p = p.replace(new RegExp(`\\b${en}\\b`, 'g'), tr);
  const m = p.match(/^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/);
  if (m) return `${m[3]} (${m[1]} km ${m[2].split('').map((c) => DIRS[c]).join('')})`;
  return p.replace(/^near the coast of /i, 'kıyı açıkları: ').replace(/^off the coast of /i, 'açıklarında: ');
}

function parseQuakes(geo, { tz, now = Date.now() } = {}) {
  return (geo?.features || []).map((f) => {
    const p = f.properties || {}, c = f.geometry?.coordinates || [];
    return {
      mag: Math.round((p.mag ?? 0) * 10) / 10,
      place: trPlace(p.place || p.title || 'Bilinmeyen yer'),
      time: p.time,
      when: fmtDateTime(p.time, tz),
      ago: ago(p.time, now),
      depth: Number.isFinite(c[2]) ? Math.round(c[2]) : null,
      lat: c[1], lon: c[0], url: p.url
    };
  });
}

/* --------------------------------------------------------- prayer times */

const PRAYERS = [['Fajr', 'İmsak'], ['Sunrise', 'Güneş'], ['Dhuhr', 'Öğle'], ['Asr', 'İkindi'], ['Maghrib', 'Akşam'], ['Isha', 'Yatsı']];
const toMin = (hhmm) => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m; };

/** nowHHMM: current time at the city ("HH:MM"). */
function parsePrayer(json, nowHHMM) {
  const t = json?.data?.timings;
  if (!t) return null;
  const times = PRAYERS.map(([k, tr]) => ({ name: tr, time: String(t[k] || '').slice(0, 5) }));
  let next = null;
  if (nowHHMM) {
    const now = toMin(nowHHMM);
    const hit = times.find((x) => toMin(x.time) > now);
    next = hit ? { ...hit, inMin: toMin(hit.time) - now, tomorrow: false } : { ...times[0], inMin: toMin(times[0].time) + 1440 - now, tomorrow: true };
  }
  const h = json.data.date?.hijri;
  const HIJRI = { 1: 'Muharrem', 2: 'Safer', 3: 'Rebiülevvel', 4: 'Rebiülahir', 5: 'Cemaziyelevvel', 6: 'Cemaziyelahir', 7: 'Recep', 8: 'Şaban', 9: 'Ramazan', 10: 'Şevval', 11: 'Zilkade', 12: 'Zilhicce' };
  return {
    times, next,
    hijri: h ? `${Number(h.day)} ${HIJRI[h.month?.number] || h.month?.en || ''} ${h.year}`.trim() : null,
    date: json.data.date?.gregorian?.date || json.data.date?.readable,
    tz: json.data.meta?.timezone
  };
}

/* ------------------------------------------------------- open-meteo extras */

function parseSun(json) {
  const d = json?.daily;
  if (!d?.sunrise?.length) return null;
  return d.time.map((day, i) => ({
    day, sunrise: String(d.sunrise[i]).slice(11, 16), sunset: String(d.sunset[i]).slice(11, 16),
    daylight: d.daylight_duration ? d.daylight_duration[i] : (toMin(String(d.sunset[i]).slice(11, 16)) - toMin(String(d.sunrise[i]).slice(11, 16))) * 60
  }));
}

function aqiCategory(aqi) {
  if (!Number.isFinite(aqi)) return { label: 'Bilinmiyor', tone: undefined, advice: '' };
  if (aqi <= 20) return { label: 'İyi', tone: 'success', advice: 'Dışarıda vakit geçirmek için uygun.' };
  if (aqi <= 40) return { label: 'Makul', tone: 'success', advice: 'Hava kalitesi kabul edilebilir.' };
  if (aqi <= 60) return { label: 'Orta', tone: undefined, advice: 'Hassas kişiler uzun süreli efordan kaçınabilir.' };
  if (aqi <= 80) return { label: 'Kötü', tone: 'danger', advice: 'Hassas gruplar dışarıdaki eforu azaltmalı.' };
  if (aqi <= 100) return { label: 'Çok kötü', tone: 'danger', advice: 'Herkes dışarıdaki eforu azaltmalı.' };
  return { label: 'Son derece kötü', tone: 'danger', advice: 'Mümkünse dışarı çıkma, pencereleri kapalı tut.' };
}

function parseAir(json) {
  const c = json?.current;
  if (!c) return null;
  const aqi = c.european_aqi;
  return { aqi, ...aqiCategory(aqi), pm25: c.pm2_5, pm10: c.pm10, no2: c.nitrogen_dioxide, o3: c.ozone, time: c.time };
}

function uvCategory(uv) {
  if (!Number.isFinite(uv)) return { label: 'Bilinmiyor', advice: '' };
  if (uv < 3) return { label: 'Düşük', tone: 'success', advice: 'Özel önlem gerekmez.' };
  if (uv < 6) return { label: 'Orta', advice: 'Öğle saatlerinde gölgede kal, güneş kremi kullan.' };
  if (uv < 8) return { label: 'Yüksek', tone: 'danger', advice: 'Şapka, gözlük ve SPF 30+ güneş kremi kullan.' };
  if (uv < 11) return { label: 'Çok yüksek', tone: 'danger', advice: '11:00–16:00 arası güneşten kaçın, koruyucu kullan.' };
  return { label: 'Aşırı', tone: 'danger', advice: 'Dışarıda kalma süresini en aza indir; tam koruma şart.' };
}

function parseUv(json) {
  const now = json?.current?.uv_index;
  const max = json?.daily?.uv_index_max?.[0];
  return { now: Number.isFinite(now) ? Math.round(now * 10) / 10 : null, max: Number.isFinite(max) ? Math.round(max * 10) / 10 : null, cat: uvCategory(now ?? max), maxCat: uvCategory(max) };
}

/** Next `hours` hours of precipitation chance from Open-Meteo hourly data. */
function parseRain(json, hours = 12) {
  const h = json?.hourly;
  if (!h?.time) return null;
  const cur = String(json.current?.time || h.time[0]).slice(0, 13);
  const start = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) >= cur));
  const list = h.time.slice(start, start + hours).map((t, i) => ({
    time: t.slice(11, 16), prob: h.precipitation_probability?.[start + i] ?? 0, mm: h.precipitation?.[start + i] ?? 0
  }));
  const max = Math.max(0, ...list.map((x) => x.prob));
  const wet = list.filter((x) => x.prob >= 40 || x.mm >= 0.2);
  const verdict = max >= 60 || wet.some((x) => x.mm >= 0.5) ? 'yes' : max >= 30 ? 'maybe' : 'no';
  return { list, max, wet, verdict, total: Math.round(list.reduce((a, x) => a + x.mm, 0) * 10) / 10 };
}

/* ---------------------------------------------------------- moon phase */

const SYNODIC = 29.530588853;
const NEW_MOON_JD = 2451550.1; // 2000-01-06 18:14 UTC
const MOON_NAMES = ['Yeni Ay', 'Büyüyen Hilal', 'İlk Dördün', 'Büyüyen Şişkin Ay', 'Dolunay', 'Küçülen Şişkin Ay', 'Son Dördün', 'Küçülen Hilal'];

function moonPhase(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const age = (((jd - NEW_MOON_JD) % SYNODIC) + SYNODIC) % SYNODIC;
  const frac = age / SYNODIC;
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * frac)) / 2) * 1000) / 10;
  const idx = Math.floor(frac * 8 + 0.5) % 8;
  const day = 86400000;
  return {
    age: Math.round(age * 10) / 10,
    fraction: frac,
    illumination,
    name: MOON_NAMES[idx],
    waxing: frac < 0.5,
    nextFull: new Date(date.getTime() + (((0.5 - frac) % 1 + 1) % 1) * SYNODIC * day),
    nextNew: new Date(date.getTime() + ((1 - frac) % 1 || 1) * SYNODIC * day)
  };
}

/* ------------------------------------------------------------- holidays */

function parseHolidays(arr, today, limit = 8) {
  const t = typeof today === 'string' ? today : isoDay(today || new Date());
  return (Array.isArray(arr) ? arr : [])
    .filter((h) => h.date >= t)
    .slice(0, limit)
    .map((h) => ({ date: h.date, name: h.localName || h.name, en: h.name, days: Math.round((Date.parse(h.date + 'T00:00:00Z') - Date.parse(t + 'T00:00:00Z')) / 86400000) }));
}

/* -------------------------------------------------------------- country */

function parseCountry(arr, query) {
  const list = Array.isArray(arr) ? arr : [];
  if (!list.length) return null;
  const q = norm(query);
  const c = list.find((x) => [x.name?.common, x.name?.official, x.translations?.tur?.common, x.cca2, x.cca3].some((n) => n && norm(n) === q)) || list[0];
  const callingCode = c.idd?.root ? `${c.idd.root}${c.idd.suffixes?.length === 1 ? c.idd.suffixes[0] : ''}` : null;
  return {
    name: c.translations?.tur?.common || c.name?.common,
    official: c.translations?.tur?.official || c.name?.official,
    nativeName: c.name?.common,
    capital: (c.capital || []).join(', ') || '—',
    region: [c.region, c.subregion].filter(Boolean).join(' / '),
    population: c.population,
    area: c.area,
    languages: Object.values(c.languages || {}).join(', '),
    currencies: Object.entries(c.currencies || {}).map(([code, v]) => `${v.name} (${code}${v.symbol ? `, ${v.symbol}` : ''})`).join(', '),
    timezones: (c.timezones || []).slice(0, 4).join(', '),
    callingCode, tld: (c.tld || []).join(', '), drives: c.car?.side === 'left' ? 'Sol' : c.car?.side === 'right' ? 'Sağ' : null,
    borders: (c.borders || []).length, code: c.cca2, flag: c.flags?.png
  };
}

/* ------------------------------------------------------------------ IP */

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  return /^(::1|fe80:|fc|fd)/i.test(ip);
}

function parseIp(json) {
  if (!json) return null;
  if (json.success === false || json.error) return { error: json.message || json.reason || 'Bilinmeyen hata' };
  if ('success' in json) { // ipwho.is
    return {
      ip: json.ip, city: json.city, region: json.region, country: json.country, code: json.country_code,
      lat: json.latitude, lon: json.longitude, isp: json.connection?.isp || json.connection?.org, asn: json.connection?.asn,
      tz: json.timezone?.id, utc: json.timezone?.utc, postal: json.postal
    };
  }
  return { // ipapi.co
    ip: json.ip, city: json.city, region: json.region, country: json.country_name, code: json.country_code,
    lat: json.latitude, lon: json.longitude, isp: json.org, asn: json.asn ? String(json.asn).replace(/^AS/, '') : null,
    tz: json.timezone, utc: json.utc_offset, postal: json.postal
  };
}

/* ----------------------------------------------------------- dictionary */

const POS = { noun: 'isim', verb: 'fiil', adjective: 'sıfat', adverb: 'zarf', pronoun: 'zamir', preposition: 'edat', conjunction: 'bağlaç', interjection: 'ünlem', exclamation: 'ünlem', determiner: 'belirteç' };

function parseDictionary(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const e = arr[0];
  const meanings = arr.flatMap((x) => x.meanings || []).map((m) => ({
    pos: POS[m.partOfSpeech] || m.partOfSpeech,
    defs: (m.definitions || []).slice(0, 3).map((d) => ({ def: d.definition, example: d.example })),
    synonyms: [...(m.synonyms || []), ...(m.definitions || []).flatMap((d) => d.synonyms || [])].slice(0, 6)
  }));
  const phonetic = e.phonetic || (e.phonetics || []).find((p) => p.text)?.text || '';
  const audio = (e.phonetics || []).find((p) => p.audio)?.audio || null;
  return { word: e.word, phonetic, audio, meanings };
}

/* ------------------------------------------------------------ wikipedia */

function parseOnThisDay(json, type = 'events', limit = 8) {
  const list = json?.[type] || [];
  const items = list.map((e) => ({ year: e.year, text: e.text, url: e.pages?.[0]?.content_urls?.desktop?.page }));
  items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  if (items.length <= limit) return items;
  // Spread across the centuries rather than only the latest years.
  const step = items.length / limit;
  return Array.from({ length: limit }, (_, i) => items[Math.floor(i * step)]);
}

function parseWikiSummary(json) {
  if (!json?.title) return null;
  return { title: json.title, description: json.description, extract: json.extract, image: json.thumbnail?.source, url: json.content_urls?.desktop?.page };
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function parseWikiSearch(json, lang = 'tr') {
  const s = json?.query?.search || [];
  return {
    total: json?.query?.searchinfo?.totalhits ?? s.length,
    items: s.map((r) => ({ title: r.title, snippet: stripHtml(r.snippet), words: r.wordcount, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}` }))
  };
}

/* ------------------------------------------------------- dev registries */

function parseRepoRef(input) {
  const s = String(input || '').trim().replace(/^git\+/, '').replace(/\.git$/, '');
  const m = s.match(/(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/#?].*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function parseGithubRepo(r) {
  return {
    name: r.full_name, description: r.description, url: r.html_url, stars: r.stargazers_count, forks: r.forks_count,
    issues: r.open_issues_count, watchers: r.subscribers_count ?? r.watchers_count, language: r.language,
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : r.license?.name || null,
    branch: r.default_branch, created: r.created_at, pushed: r.pushed_at, topics: (r.topics || []).slice(0, 8), archived: !!r.archived, homepage: r.homepage || null
  };
}

function parseGithubUser(u, repos) {
  const top = (Array.isArray(repos) ? repos : []).filter((r) => !r.fork).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 5)
    .map((r) => ({ name: r.name, stars: r.stargazers_count, language: r.language, url: r.html_url, description: r.description }));
  return {
    login: u.login, name: u.name, bio: u.bio, company: u.company, location: u.location, blog: u.blog, url: u.html_url,
    repos: u.public_repos, followers: u.followers, following: u.following, created: u.created_at, type: u.type, top
  };
}

function parseNpm(meta, dl) {
  const repo = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url;
  return {
    name: meta.name, version: meta.version, description: meta.description, license: typeof meta.license === 'string' ? meta.license : meta.license?.type,
    homepage: meta.homepage, repo: repo ? repo.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '') : null,
    deps: Object.keys(meta.dependencies || {}).length, node: meta.engines?.node, weekly: dl?.downloads ?? null,
    author: typeof meta.author === 'string' ? meta.author : meta.author?.name
  };
}

function parsePypi(json) {
  const i = json?.info;
  if (!i) return null;
  const urls = i.project_urls || {};
  const released = json.urls?.[0]?.upload_time_iso_8601 || json.releases?.[i.version]?.[0]?.upload_time_iso_8601 || null;
  const lic = i.license_expression || (i.license && i.license.length < 60 ? i.license : null) || (i.classifiers || []).find((c) => c.startsWith('License ::'))?.split('::').pop().trim() || null;
  return {
    name: i.name, version: i.version, summary: i.summary, author: i.author || i.author_email || i.maintainer, license: lic,
    python: i.requires_python, homepage: i.home_page || urls.Homepage || urls.homepage || urls.Source || null,
    url: i.package_url || `https://pypi.org/project/${i.name}/`, released, versions: Object.keys(json.releases || {}).length
  };
}

/* --------------------------------------------------------------- feeds */

function parseHn(items) {
  return items.filter((x) => x && x.title && !x.deleted && !x.dead).map((x) => ({
    title: x.title, url: x.url || `https://news.ycombinator.com/item?id=${x.id}`, score: x.score ?? 0, comments: x.descendants ?? 0, by: x.by,
    host: x.url ? host(x.url) : 'news.ycombinator.com', time: x.time * 1000
  }));
}

function parseReddit(json, { nsfw = false } = {}) {
  return (json?.data?.children || []).map((c) => c.data).filter((d) => d && !d.stickied && (nsfw || !d.over_18)).map((d) => ({
    title: stripHtml(d.title), sub: d.subreddit_name_prefixed || `r/${d.subreddit}`, score: d.score, comments: d.num_comments,
    url: `https://www.reddit.com${d.permalink}`, author: d.author
  }));
}

function parseBooks(json) {
  return {
    total: json?.numFound ?? 0,
    items: (json?.docs || []).map((d) => ({
      title: d.title, authors: (d.author_name || []).slice(0, 3).join(', '), year: d.first_publish_year, editions: d.edition_count,
      pages: d.number_of_pages_median, rating: d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : null,
      url: d.key ? `https://openlibrary.org${d.key}` : null
    }))
  };
}

/* ----------------------------------------------------------- domains */

function cleanDomain(input) {
  let d = String(input || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
  d = domainToASCII(d);
  if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new ToolError('Geçerli bir alan adı belirtmelisin (ör. ornek.com).');
  return d;
}

function vcardName(entity) {
  const v = entity?.vcardArray?.[1] || [];
  return v.find((x) => x[0] === 'fn')?.[3] || v.find((x) => x[0] === 'org')?.[3] || entity?.handle || null;
}

function parseRdap(json, now = Date.now()) {
  const ev = Object.fromEntries((json?.events || []).map((e) => [e.eventAction, e.eventDate]));
  const registrar = (json?.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const expires = ev.expiration || null;
  return {
    domain: (json?.ldhName || '').toLowerCase(),
    registrar: vcardName(registrar),
    created: ev.registration || null,
    updated: ev['last changed'] || ev['last update of RDAP database'] || null,
    expires,
    daysLeft: expires ? Math.floor((Date.parse(expires) - now) / 86400000) : null,
    status: (json?.status || []).slice(0, 4),
    nameservers: (json?.nameservers || []).map((n) => String(n.ldhName || '').toLowerCase()).filter(Boolean).slice(0, 4),
    dnssec: json?.secureDNS?.delegationSigned ?? null
  };
}

function parseCert(cert, { authorized, error, now = Date.now() } = {}) {
  if (!cert || !cert.valid_to) return null;
  const to = Date.parse(cert.valid_to), from = Date.parse(cert.valid_from);
  const alt = String(cert.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '')).filter(Boolean);
  return {
    subject: cert.subject?.CN || alt[0] || '—',
    issuer: [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(' · ') || '—',
    validFrom: new Date(from).toISOString(), validTo: new Date(to).toISOString(),
    daysLeft: Math.floor((to - now) / 86400000),
    names: alt.slice(0, 6), altCount: alt.length,
    authorized: !!authorized, error: error || null,
    fingerprint: cert.fingerprint256 ? cert.fingerprint256.slice(0, 29) + '…' : null
  };
}

const MAIN_HEADERS = ['content-type', 'content-length', 'server', 'cache-control', 'last-modified', 'etag', 'location', 'x-powered-by', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'access-control-allow-origin', 'content-encoding', 'alt-svc', 'via', 'cf-ray', 'age', 'expires', 'date'];
const SECURITY = { 'strict-transport-security': 'HSTS', 'content-security-policy': 'CSP', 'x-content-type-options': 'X-Content-Type-Options', 'x-frame-options': 'X-Frame-Options', 'referrer-policy': 'Referrer-Policy' };

function parseHeaders(entries) {
  const map = new Map();
  for (const [k, v] of entries) map.set(k.toLowerCase(), map.has(k.toLowerCase()) ? `${map.get(k.toLowerCase())}, ${v}` : v);
  const rows = MAIN_HEADERS.filter((k) => map.has(k)).map((k) => [k, truncate(map.get(k), 160)]);
  const missing = Object.entries(SECURITY).filter(([k]) => !map.has(k) && !(k === 'x-frame-options' && /frame-ancestors/.test(map.get('content-security-policy') || ''))).map(([, v]) => v);
  return { rows, total: map.size, missing, cookies: (map.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean).length };
}

/* ------------------------------------------------------------ currency */

function parseRateHistory(json, to) {
  const pts = Object.entries(json?.rates || {}).map(([date, r]) => ({ date, rate: r[to] })).filter((p) => Number.isFinite(p.rate)).sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return null;
  const min = pts.reduce((a, b) => (b.rate < a.rate ? b : a));
  const max = pts.reduce((a, b) => (b.rate > a.rate ? b : a));
  const first = pts[0], last = pts[pts.length - 1];
  const step = Math.max(1, Math.ceil(pts.length / 6));
  const sample = pts.filter((_, i) => i % step === 0);
  if (sample[sample.length - 1] !== last) sample.push(last);
  return { first, last, min, max, change: ((last.rate - first.rate) / first.rate) * 100, sample, count: pts.length };
}

/* ------------------------------------------------------------ speed */

const mbps = (byteCount, ms) => (ms > 0 ? Math.round((byteCount * 8) / (ms / 1000) / 1e6 * 10) / 10 : 0);

async function readFor(res, deadline) {
  const reader = res.body.getReader();
  let n = 0;
  while (true) {
    if (Date.now() > deadline) { await reader.cancel().catch(() => {}); break; }
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
  }
  return n;
}

/* -------------------------------------------------------------- tools */

const cityParam = { city: { type: 'string', description: 'Şehir adı. Boşsa kullanıcının konumu kullanılır.' } };

module.exports = [
  {
    name: 'info_crypto_price',
    category: 'info',
    title: 'Kripto fiyatı',
    description: 'Bir kripto paranın güncel TL ve dolar fiyatını ve 24 saatlik değişimini getirir (CoinGecko). BTC, ETH, SOL gibi sembol ya da adla çalışır.',
    params: { coin: { type: 'string', description: 'Coin adı ya da sembolü, ör. "bitcoin", "ETH", "solana".', required: true } },
    run: async (a) => {
      let id = coinId(a.coin), name = null;
      if (!id) {
        const s = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(a.coin)}`);
        const hit = (s.coins || []).find((c) => norm(c.symbol) === norm(a.coin) || norm(c.name) === norm(a.coin)) || s.coins?.[0];
        if (!hit) throw new ToolError(`“${a.coin}” adında bir kripto para bulunamadı.`);
        id = hit.id; name = `${hit.name} (${String(hit.symbol).toUpperCase()})`;
      }
      const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=try,usd&include_24hr_change=true`);
      const p = parseCryptoPrice(j, id);
      if (!p) throw new ToolError(`“${a.coin}” için fiyat bulunamadı.`);
      name = name || id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
      return {
        summary: `${name}: ${price(p.try)} TL (${price(p.usd)} $), 24 saatte ${pct(p.usdChange)}.`,
        display: { type: 'value', label: name, value: `${price(p.try)} ₺`, detail: `${price(p.usd)} $ · 24 sa ${pct(p.usdChange)}`, icon: 'currency' },
        data: p
      };
    }
  },
  {
    name: 'info_crypto_top',
    category: 'info',
    title: 'Kripto ilk 10',
    description: 'Piyasa değerine göre en büyük 10 kripto parayı fiyat ve 24 saatlik değişimiyle listeler.',
    params: { currency: { type: 'string', enum: ['usd', 'try'], description: 'Fiyat birimi. Varsayılan usd.' } },
    run: async (a) => {
      const cur = a.currency === 'try' ? 'try' : 'usd';
      const sym = cur === 'try' ? '₺' : '$';
      const list = parseCryptoTop(await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${cur}&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h`));
      if (!list.length) throw new ToolError('Piyasa verisi alınamadı.');
      return {
        summary: `İlk 10: ${list.slice(0, 5).map((c) => `${c.symbol} ${price(c.price)} ${sym} (${pct(c.change)})`).join(', ')}.`,
        display: { type: 'list', title: `Piyasa değerine göre ilk 10 (${cur.toUpperCase()})`, items: list.map((c) => ({ title: `${c.rank}. ${c.name} (${c.symbol})`, subtitle: `Piyasa değeri ${big(c.cap)} ${sym}`, meta: `${price(c.price)} ${sym} · ${pct(c.change)}`, icon: 'currency' })) },
        data: list.map((c) => ({ rank: c.rank, symbol: c.symbol, price: c.price, change24h: c.change && Math.round(c.change * 100) / 100 }))
      };
    }
  },
  {
    name: 'info_earthquakes',
    category: 'info',
    title: 'Son depremler',
    description: 'Türkiye ve çevresinde (ya da dünyada) son depremleri büyüklük, yer ve zamanla listeler (USGS verisi).',
    params: {
      min_magnitude: { type: 'number', description: 'En küçük büyüklük. Varsayılan 3.' },
      days: { type: 'integer', description: 'Kaç gün geriye bakılsın. Varsayılan 7, en çok 30.' },
      region: { type: 'string', enum: ['turkiye', 'dunya'], description: 'Bölge. Varsayılan turkiye.' },
      limit: { type: 'integer', description: 'En çok kaç deprem. Varsayılan 10.' }
    },
    run: async (a) => {
      const min = Math.max(0, Math.min(9, a.min_magnitude ?? 3));
      const days = Math.max(1, Math.min(30, a.days || 7));
      const limit = Math.max(1, Math.min(30, a.limit || 10));
      const world = a.region === 'dunya';
      const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19);
      const bbox = world ? '' : '&minlatitude=35.5&maxlatitude=42.5&minlongitude=25.5&maxlongitude=45';
      const geo = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=${limit}&minmagnitude=${min}&starttime=${start}${bbox}`);
      const list = parseQuakes(geo);
      const where = world ? 'Dünyada' : 'Türkiye ve çevresinde';
      if (!list.length) return { summary: `${where} son ${days} günde ${nf(min, 1)} ve üzeri deprem kaydedilmedi.`, display: { type: 'value', label: 'Son depremler', value: 'Kayıt yok', detail: `Son ${days} gün · M${nf(min, 1)}+`, icon: 'activity' }, data: [] };
      const biggest = list.reduce((x, y) => (y.mag > x.mag ? y : x));
      return {
        summary: `${where} son ${days} günde ${list.length} deprem. En son: ${list[0].place}, büyüklük ${nf(list[0].mag, 1)}, ${list[0].ago}. En büyüğü ${nf(biggest.mag, 1)} (${biggest.place}).`,
        display: { type: 'list', title: `${where} · son ${days} gün · M${nf(min, 1)}+`, items: list.map((q) => ({ title: `M${nf(q.mag, 1)} · ${q.place}`, subtitle: `${q.when}${q.depth != null ? ` · derinlik ${q.depth} km` : ''}`, meta: q.ago, icon: q.mag >= 5 ? 'warning' : 'activity' })) },
        data: list.map((q) => ({ mag: q.mag, place: q.place, time: new Date(q.time).toISOString(), depthKm: q.depth }))
      };
    }
  },
  {
    name: 'info_prayer_times',
    category: 'info',
    title: 'Namaz vakitleri',
    description: 'Bir şehrin bugünkü namaz vakitlerini (Diyanet hesaplama yöntemi) ve bir sonraki vakte kalan süreyi gösterir.',
    params: {
      city: { type: 'string', description: 'Şehir, ör. İstanbul. Varsayılan İstanbul.' },
      country: { type: 'string', description: 'Ülke (İngilizce). Varsayılan Turkey.' }
    },
    run: async (a) => {
      const city = (a.city || 'Istanbul').trim();
      const country = (a.country || 'Turkey').trim();
      const j = await getJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=13`);
      const tz = j?.data?.meta?.timezone;
      let nowHHMM;
      try { nowHHMM = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) }); } catch { nowHHMM = new Date().toTimeString().slice(0, 5); }
      const p = parsePrayer(j, nowHHMM);
      if (!p) throw new ToolError(`${city} için namaz vakitleri bulunamadı.`);
      const left = duration(p.next.inMin * 60);
      return {
        summary: `${city} namaz vakitleri: ${p.times.map((t) => `${t.name} ${t.time}`).join(', ')}. ${p.next.tomorrow ? 'Yarınki ' : ''}${p.next.name} vaktine ${left} var.`,
        display: { type: 'list', title: `${city} · ${p.date || ''}${p.hijri ? ` · ${p.hijri}` : ''}`, items: p.times.map((t) => ({ title: t.name, meta: t.time, subtitle: t.name === p.next.name ? `Sıradaki vakit · ${left} kaldı` : undefined, icon: t.name === p.next.name ? 'bell' : t.name === 'Güneş' ? 'sun' : t.name === 'Yatsı' || t.name === 'İmsak' ? 'moon' : 'timer' })) },
        data: { city, times: Object.fromEntries(p.times.map((t) => [t.name, t.time])), next: p.next, hijri: p.hijri }
      };
    }
  },
  {
    name: 'info_sun_times',
    category: 'info',
    title: 'Gün doğumu ve batımı',
    description: 'Bir şehirde güneşin doğuş ve batış saatlerini ve gün uzunluğunu gösterir (bugün ve sonraki günler).',
    params: { ...cityParam, days: { type: 'integer', description: 'Kaç gün. Varsayılan 1, en çok 7.' } },
    run: async (a) => {
      const loc = await locate(a.city);
      const days = Math.max(1, Math.min(7, a.days || 1));
      const list = parseSun(await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=sunrise,sunset,daylight_duration&forecast_days=${days}&timezone=auto`));
      if (!list) throw new ToolError('Güneş saatleri alınamadı.');
      const d = list[0];
      if (days === 1) {
        return {
          summary: `${loc.name}: gün doğumu ${d.sunrise}, gün batımı ${d.sunset}; gün uzunluğu ${duration(d.daylight)}.`,
          display: { type: 'kv', rows: [['Yer', `${loc.name}${loc.region ? `, ${loc.region}` : ''}`], ['Gün doğumu', d.sunrise], ['Gün batımı', d.sunset], ['Gün uzunluğu', duration(d.daylight)]] },
          data: { place: loc.name, ...d }
        };
      }
      return {
        summary: `${loc.name}: bugün gün doğumu ${d.sunrise}, batımı ${d.sunset}.`,
        display: { type: 'list', title: `${loc.name} · güneş saatleri`, items: list.map((x, i) => ({ title: i === 0 ? 'Bugün' : new Date(x.day + 'T12:00').toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short' }), subtitle: `Gün uzunluğu ${duration(x.daylight)}`, meta: `${x.sunrise} – ${x.sunset}`, icon: 'sun' })) },
        data: { place: loc.name, days: list }
      };
    }
  },
  {
    name: 'info_air_quality',
    category: 'info',
    title: 'Hava kalitesi',
    description: 'Bir şehrin anlık hava kalitesini (Avrupa AQI), PM2.5 ve PM10 değerlerini ve sağlık önerisini gösterir.',
    params: cityParam,
    run: async (a) => {
      const loc = await locate(a.city);
      const q = parseAir(await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&timezone=auto`));
      if (!q || q.aqi == null) throw new ToolError('Hava kalitesi verisi alınamadı.');
      return {
        summary: `${loc.name} hava kalitesi: ${q.label} (AQI ${Math.round(q.aqi)}). PM2.5 ${nf(q.pm25, 1)}, PM10 ${nf(q.pm10, 1)} µg/m³. ${q.advice}`,
        display: {
          type: 'stats',
          items: [
            { label: `AQI · ${q.label}`, value: Math.round(q.aqi), detail: `${loc.name} · ${q.advice}`, tone: q.tone },
            { label: 'PM2.5', value: Math.round(q.pm25 ?? 0), unit: 'µg', detail: `AB günlük sınır 25 µg/m³`, tone: q.pm25 > 25 ? 'danger' : 'success' },
            { label: 'PM10', value: Math.round(q.pm10 ?? 0), unit: 'µg', detail: `AB günlük sınır 50 µg/m³`, tone: q.pm10 > 50 ? 'danger' : 'success' }
          ]
        },
        data: { place: loc.name, aqi: q.aqi, category: q.label, pm2_5: q.pm25, pm10: q.pm10, no2: q.no2, o3: q.o3 }
      };
    }
  },
  {
    name: 'info_uv_index',
    category: 'info',
    title: 'UV indeksi',
    description: 'Bir şehirde şu anki ve bugünün en yüksek UV indeksini, risk düzeyini ve korunma önerisini gösterir.',
    params: cityParam,
    run: async (a) => {
      const loc = await locate(a.city);
      const u = parseUv(await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=uv_index&daily=uv_index_max&forecast_days=1&timezone=auto`));
      if (u.now == null && u.max == null) throw new ToolError('UV verisi alınamadı.');
      return {
        summary: `${loc.name}: UV indeksi şu an ${nf(u.now ?? 0, 1)} (${u.cat.label}), bugün en yüksek ${nf(u.max, 1)} (${u.maxCat.label}). ${u.maxCat.advice}`,
        display: { type: 'value', label: `${loc.name} · UV indeksi`, value: `${nf(u.now ?? 0, 1)} · ${u.cat.label}`, detail: `Bugün en yüksek ${nf(u.max, 1)} (${u.maxCat.label}). ${u.maxCat.advice}`, icon: 'sun' },
        data: { place: loc.name, now: u.now, max: u.max, level: u.cat.label, maxLevel: u.maxCat.label }
      };
    }
  },
  {
    name: 'info_rain_check',
    category: 'info',
    title: 'Yağmur yağacak mı',
    description: 'Önümüzdeki saatlerde yağmur bekleniyor mu, hangi saatlerde ve ne olasılıkla, söyler. "Şemsiye alayım mı" sorusu için kullan.',
    params: { ...cityParam, hours: { type: 'integer', description: 'Kaç saat ileriye bakılsın. Varsayılan 12, en çok 48.' } },
    run: async (a) => {
      const loc = await locate(a.city);
      const hours = Math.max(1, Math.min(48, a.hours || 12));
      const r = parseRain(await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=precipitation&hourly=precipitation_probability,precipitation&forecast_days=3&timezone=auto`), hours);
      if (!r) throw new ToolError('Yağış tahmini alınamadı.');
      const when = r.wet.slice(0, 6).map((x) => x.time).join(', ');
      const verdict = { yes: 'Evet, yağmur bekleniyor', maybe: 'Yağmur ihtimali var', no: 'Hayır, yağmur beklenmiyor' }[r.verdict];
      const summary = r.verdict === 'no'
        ? `${loc.name}: önümüzdeki ${hours} saatte yağmur beklenmiyor (en yüksek olasılık %${r.max}).`
        : `${loc.name}: ${verdict.toLocaleLowerCase('tr')}; en yüksek olasılık %${r.max}${when ? `, özellikle ${when} civarı` : ''}. ${r.verdict === 'yes' ? 'Şemsiye almanı öneririm.' : ''}`.trim();
      return {
        summary,
        display: { type: 'list', title: `${loc.name} · ${verdict}`, items: r.list.map((x) => ({ title: x.time, subtitle: x.mm ? `${nf(x.mm, 1)} mm` : undefined, meta: `%${x.prob}`, icon: x.prob >= 50 ? 'cloud' : x.prob >= 30 ? 'cloud-sun' : 'sun' })) },
        data: { place: loc.name, verdict: r.verdict, maxProbability: r.max, totalMm: r.total, wetHours: r.wet.map((x) => x.time) }
      };
    }
  },
  {
    name: 'info_moon_phase',
    category: 'info',
    title: 'Ay evresi',
    description: 'Bugünün (ya da verilen tarihin) ay evresini, aydınlanma yüzdesini ve sıradaki dolunay/yeni ay tarihlerini hesaplar.',
    params: { date: { type: 'string', description: 'Tarih (YYYY-AA-GG). Boşsa bugün.' } },
    run: async (a) => {
      let d = new Date();
      if (a.date) {
        d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date + 'T12:00:00' : a.date);
        if (Number.isNaN(d.getTime())) throw new ToolError('Tarih anlaşılamadı; YYYY-AA-GG biçiminde ver.');
      }
      const m = moonPhase(d);
      return {
        summary: `${fmtDate(d)}: ${m.name}, aydınlanma %${nf(m.illumination, 0)} (ay yaşı ${nf(m.age, 1)} gün). Sıradaki dolunay ${fmtDate(m.nextFull)}, yeni ay ${fmtDate(m.nextNew)}.`,
        display: { type: 'value', label: `Ay evresi · ${fmtDate(d)}`, value: m.name, detail: `%${nf(m.illumination, 0)} aydınlık · ${nf(m.age, 1)} günlük · dolunay ${fmtDate(m.nextFull)} · yeni ay ${fmtDate(m.nextNew)}`, icon: 'moon' },
        data: { phase: m.name, illumination: m.illumination, ageDays: m.age, nextFull: isoDay(m.nextFull), nextNew: isoDay(m.nextNew) }
      };
    }
  },
  {
    name: 'info_holidays',
    category: 'info',
    title: 'Resmi tatiller',
    description: 'Yaklaşan resmi tatilleri ve kaç gün kaldığını listeler. Varsayılan ülke Türkiye.',
    params: {
      country: { type: 'string', description: 'İki harfli ülke kodu, ör. TR, DE, US. Varsayılan TR.' },
      limit: { type: 'integer', description: 'Kaç tatil. Varsayılan 8.' }
    },
    run: async (a) => {
      const cc = String(a.country || 'TR').trim().toUpperCase().slice(0, 2);
      if (!/^[A-Z]{2}$/.test(cc)) throw new ToolError('Ülke kodu iki harf olmalı, ör. TR.');
      const limit = Math.max(1, Math.min(25, a.limit || 8));
      const year = new Date().getFullYear();
      const nf404 = `${cc} için tatil verisi yok.`;
      let list = await getJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`, { notFound: nf404 });
      if (parseHolidays(list, new Date(), limit).length < limit) list = list.concat(await getJson(`https://date.nager.at/api/v3/PublicHolidays/${year + 1}/${cc}`, { notFound: nf404 }).catch(() => []));
      const items = parseHolidays(list, new Date(), limit);
      if (!items.length) throw new ToolError('Yaklaşan tatil bulunamadı.');
      const first = items[0];
      return {
        summary: `Sıradaki tatil: ${first.name}, ${fmtDate(first.date + 'T12:00')}${first.days === 0 ? ' (bugün)' : ` (${first.days} gün sonra)`}. Sonrakiler: ${items.slice(1, 4).map((h) => h.name).join(', ')}.`,
        display: { type: 'list', title: `Yaklaşan resmi tatiller · ${cc}`, items: items.map((h) => ({ title: h.name, subtitle: new Date(h.date + 'T12:00').toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), meta: h.days === 0 ? 'bugün' : `${h.days} gün`, icon: 'bell' })) },
        data: items
      };
    }
  },
  {
    name: 'info_country',
    category: 'info',
    title: 'Ülke bilgisi',
    description: 'Bir ülkenin başkenti, nüfusu, yüzölçümü, dilleri, para birimi, saat dilimi ve telefon kodu gibi temel bilgilerini getirir.',
    params: { name: { type: 'string', description: 'Ülke adı (Türkçe ya da İngilizce) veya kodu, ör. "Almanya", "Japan", "FR".', required: true } },
    run: async (a) => {
      const q = a.name.trim();
      const enc = encodeURIComponent(q);
      let arr = null;
      for (const url of [`https://restcountries.com/v3.1/name/${enc}`, `https://restcountries.com/v3.1/translation/${enc}`, ...(/^[a-z]{2,3}$/i.test(q) ? [`https://restcountries.com/v3.1/alpha/${enc}`] : [])]) {
        try { arr = await getJson(url, { notFound: 'yok' }); if (arr) break; } catch (e) { if (e.message !== 'yok') throw e; }
      }
      const c = parseCountry(Array.isArray(arr) ? arr : arr ? [arr] : [], q);
      if (!c) throw new ToolError(`“${q}” adında bir ülke bulunamadı.`);
      return {
        summary: `${c.name}: başkent ${c.capital}, nüfus ${big(c.population)}, yüzölçümü ${nf(c.area, 0)} km². Dil: ${c.languages}. Para birimi: ${c.currencies}.`,
        display: { type: 'kv', rows: [['Ülke', c.name], ['Resmi adı', c.official], ['Başkent', c.capital], ['Bölge', c.region], ['Nüfus', nf(c.population, 0)], ['Yüzölçümü', `${nf(c.area, 0)} km²`], ['Diller', c.languages || '—'], ['Para birimi', c.currencies || '—'], ['Saat dilimi', c.timezones], ['Telefon kodu', c.callingCode || '—'], ['İnternet uzantısı', c.tld || '—'], ['Trafik', c.drives ? `${c.drives}dan akar` : '—'], ['Komşu sayısı', c.borders]] },
        data: c
      };
    }
  },
  {
    name: 'info_ip_location',
    category: 'info',
    title: 'IP konumu',
    description: 'Bir IP adresinin (ya da alan adının) yaklaşık konumunu, servis sağlayıcısını ve saat dilimini gösterir. Boşsa kendi genel IP\'ni sorgular.',
    params: { ip: { type: 'string', description: 'IP adresi ya da alan adı. Boşsa kendi IP\'n.' } },
    run: async (a) => {
      let ip = String(a.ip || '').trim().replace(/^https?:\/\//, '').split('/')[0];
      if (ip && !net.isIP(ip)) {
        try { ip = (await dns.lookup(cleanDomain(ip))).address; } catch (e) { throw e instanceof ToolError ? e : new ToolError(`“${a.ip}” çözümlenemedi.`); }
      }
      if (ip && isPrivateIp(ip)) throw new ToolError(`${ip} yerel ağ adresi; konumu bulunamaz.`);
      let r = null;
      try { r = parseIp(await getJson(`https://ipwho.is/${encodeURIComponent(ip)}?lang=tr`)); } catch { r = null; }
      if (!r || r.error) {
        const alt = parseIp(await getJson(`https://ipapi.co/${ip ? encodeURIComponent(ip) + '/' : ''}json/`));
        if (!alt || alt.error) throw new ToolError(`IP konumu bulunamadı${r?.error ? `: ${r.error}` : '.'}`);
        r = alt;
      }
      return {
        summary: `${r.ip}: ${[r.city, r.region, r.country].filter(Boolean).join(', ')}${r.isp ? `; sağlayıcı ${r.isp}` : ''}.`,
        display: { type: 'kv', rows: [['IP', r.ip], ['Konum', [r.city, r.region].filter(Boolean).join(', ') || '—'], ['Ülke', r.country ? `${r.country} (${r.code})` : '—'], ['Sağlayıcı', r.isp || '—'], ['ASN', r.asn ? `AS${r.asn}` : '—'], ['Saat dilimi', [r.tz, r.utc].filter(Boolean).join(' · ') || '—'], ['Koordinat', r.lat != null ? `${nf(r.lat, 4)}, ${nf(r.lon, 4)}` : '—']] },
        data: r
      };
    }
  },
  {
    name: 'info_dictionary',
    category: 'info',
    title: 'İngilizce sözlük',
    description: 'İngilizce bir kelimenin okunuşunu, türünü, tanımlarını, örnek cümlelerini ve eş anlamlılarını getirir. Tanımları kullanıcıya Türkçe açıkla.',
    params: { word: { type: 'string', description: 'İngilizce kelime.', required: true } },
    run: async (a) => {
      const w = a.word.trim().toLowerCase();
      const d = parseDictionary(await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { notFound: `“${w}” sözlükte bulunamadı.` }));
      if (!d) throw new ToolError(`“${w}” sözlükte bulunamadı.`);
      const text = d.meanings.map((m) => `${m.pos}\n${m.defs.map((x, i) => `  ${i + 1}. ${x.def}${x.example ? `\n     “${x.example}”` : ''}`).join('\n')}${m.synonyms.length ? `\n  eş anlamlı: ${m.synonyms.join(', ')}` : ''}`).join('\n\n');
      return {
        summary: `${d.word} ${d.phonetic}: ${d.meanings.slice(0, 2).map((m) => `(${m.pos}) ${m.defs[0]?.def}`).join(' ')}`,
        display: { type: 'article', title: d.word, subtitle: [d.phonetic, d.meanings.map((m) => m.pos).join(', ')].filter(Boolean).join(' · '), text, url: `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(d.word)}` },
        data: { word: d.word, phonetic: d.phonetic, meanings: d.meanings.slice(0, 4) }
      };
    }
  },
  {
    name: 'info_on_this_day',
    category: 'info',
    title: 'Tarihte bugün',
    description: 'Tarihte bugün (ya da verilen günde) yaşanan olayları, doğumları veya ölümleri Vikipedi\'den getirir.',
    params: {
      date: { type: 'string', description: 'Gün (AA-GG ya da YYYY-AA-GG). Boşsa bugün.' },
      type: { type: 'string', enum: ['events', 'births', 'deaths'], description: 'events = olaylar, births = doğumlar, deaths = ölümler. Varsayılan events.' }
    },
    run: async (a) => {
      const type = ['births', 'deaths'].includes(a.type) ? a.type : 'events';
      let mm, dd;
      const m = String(a.date || '').match(/(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/);
      if (m) { mm = m[1].padStart(2, '0'); dd = m[2].padStart(2, '0'); } else { const n = new Date(); mm = String(n.getMonth() + 1).padStart(2, '0'); dd = String(n.getDate()).padStart(2, '0'); }
      let items = [], lang = 'tr';
      for (const l of ['tr', 'en']) {
        try {
          items = parseOnThisDay(await getJson(`https://api.wikimedia.org/feed/v1/wikipedia/${l}/onthisday/${type}/${mm}/${dd}`), type, 8);
        } catch { items = []; }
        if (items.length) { lang = l; break; }
      }
      if (!items.length) throw new ToolError('Bu gün için kayıt bulunamadı.');
      const label = { events: 'Olaylar', births: 'Doğumlar', deaths: 'Ölümler' }[type];
      const day = new Date(2000, Number(mm) - 1, Number(dd)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      return {
        summary: `Tarihte ${day}${lang === 'en' ? ' (İngilizce kaynak)' : ''}: ${items.slice(0, 4).map((i) => `${i.year}: ${i.text}`).join(' | ')}`,
        display: { type: 'list', title: `Tarihte ${day} · ${label}`, items: items.map((i) => ({ title: truncate(i.text, 160), meta: String(i.year ?? ''), icon: 'history', path: i.url })) },
        data: { lang, items: items.map((i) => ({ year: i.year, text: truncate(i.text, 300) })) }
      };
    }
  },
  {
    name: 'info_random_wiki',
    category: 'info',
    title: 'Rastgele Vikipedi',
    description: 'Vikipedi\'den rastgele bir maddenin özetini getirir. "Bana ilginç bir şey anlat" gibi isteklerde kullan.',
    params: { lang: { type: 'string', enum: ['tr', 'en'], description: 'Dil. Varsayılan tr.' } },
    run: async (a) => {
      const lang = a.lang === 'en' ? 'en' : 'tr';
      const p = parseWikiSummary(await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`));
      if (!p) throw new ToolError('Rastgele madde alınamadı.');
      return {
        summary: `${p.title}${p.description ? ` (${p.description})` : ''}: ${truncate(p.extract || '', 500)}`,
        display: { type: 'article', title: p.title, subtitle: p.description, text: p.extract, image: p.image, url: p.url },
        data: { title: p.title, description: p.description, extract: truncate(p.extract, 1500) }
      };
    }
  },
  {
    name: 'info_wiki_search',
    category: 'info',
    title: 'Vikipedi arama',
    description: 'Vikipedi\'de anahtar kelimeyle madde arar ve eşleşen maddeleri kısa alıntılarıyla listeler.',
    params: {
      query: { type: 'string', description: 'Aranacak ifade.', required: true },
      lang: { type: 'string', enum: ['tr', 'en'], description: 'Dil. Varsayılan tr.' }
    },
    run: async (a) => {
      const lang = a.lang === 'en' ? 'en' : 'tr';
      const r = parseWikiSearch(await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=10&srsearch=${encodeURIComponent(a.query)}`), lang);
      if (!r.items.length) throw new ToolError(`Vikipedi'de “${a.query}” için sonuç yok.`);
      return {
        summary: `“${a.query}” için ${nf(r.total, 0)} sonuç. İlkler: ${r.items.slice(0, 5).map((i) => i.title).join(', ')}.`,
        display: { type: 'list', title: `Vikipedi · “${a.query}”`, items: r.items.map((i) => ({ title: i.title, subtitle: truncate(i.snippet, 140), meta: `${nf(i.words, 0)} kelime`, icon: 'book', path: i.url })) },
        data: r.items.map((i) => ({ title: i.title, snippet: i.snippet }))
      };
    }
  },
  {
    name: 'info_github_repo',
    category: 'info',
    title: 'GitHub deposu',
    description: 'Bir GitHub deposunun yıldız, fork, açık issue sayısını, dilini, lisansını ve son güncellemesini gösterir.',
    params: { repo: { type: 'string', description: '"sahip/depo" ya da GitHub adresi, ör. "nodejs/node".', required: true } },
    run: async (a) => {
      const ref = parseRepoRef(a.repo);
      if (!ref) throw new ToolError('Depoyu "sahip/depo" biçiminde ver.');
      const r = parseGithubRepo(await getJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { notFound: `${ref.owner}/${ref.repo} deposu bulunamadı.`, headers: { Accept: 'application/vnd.github+json' } }));
      return {
        summary: `${r.name}: ${nf(r.stars, 0)} yıldız, ${nf(r.forks, 0)} fork, ${nf(r.issues, 0)} açık issue. Dil ${r.language || '—'}, son push ${fmtDate(r.pushed)}.${r.description ? ` ${r.description}` : ''}`,
        display: { type: 'kv', rows: [['Depo', r.name], ['Açıklama', truncate(r.description || '—', 160)], ['Yıldız', nf(r.stars, 0)], ['Fork', nf(r.forks, 0)], ['Açık issue/PR', nf(r.issues, 0)], ['İzleyen', nf(r.watchers, 0)], ['Dil', r.language || '—'], ['Lisans', r.license || '—'], ['Ana dal', r.branch], ['Oluşturulma', fmtDate(r.created)], ['Son push', fmtDate(r.pushed)], ...(r.topics.length ? [['Konular', r.topics.join(', ')]] : []), ...(r.archived ? [['Durum', 'Arşivlenmiş']] : []), ['Adres', r.url]] },
        data: r
      };
    }
  },
  {
    name: 'info_github_user',
    category: 'info',
    title: 'GitHub kullanıcısı',
    description: 'Bir GitHub kullanıcısının ya da kuruluşunun profilini, takipçi sayısını ve en çok yıldız alan depolarını gösterir.',
    params: { username: { type: 'string', description: 'GitHub kullanıcı adı.', required: true } },
    run: async (a) => {
      const u = String(a.username).trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').split('/')[0];
      if (!/^[A-Za-z0-9-]{1,39}$/.test(u)) throw new ToolError('Geçersiz GitHub kullanıcı adı.');
      const gh = { Accept: 'application/vnd.github+json' };
      const [user, repos] = await Promise.all([
        getJson(`https://api.github.com/users/${u}`, { notFound: `GitHub'da “${u}” bulunamadı.`, headers: gh }),
        getJson(`https://api.github.com/users/${u}/repos?per_page=100&sort=pushed`, { headers: gh }).catch(() => [])
      ]);
      const p = parseGithubUser(user, repos);
      return {
        summary: `${p.name || p.login} (@${p.login}): ${nf(p.followers, 0)} takipçi, ${nf(p.repos, 0)} açık depo.${p.top[0] ? ` En popüler deposu ${p.top[0].name} (${nf(p.top[0].stars, 0)} yıldız).` : ''}`,
        display: { type: 'list', title: `${p.name || p.login} · @${p.login}${p.bio ? ` — ${truncate(p.bio, 80)}` : ''}`, items: [
          { title: `${nf(p.followers, 0)} takipçi · ${nf(p.following, 0)} takip · ${nf(p.repos, 0)} depo`, subtitle: [p.company, p.location, `katılım ${fmtDate(p.created)}`].filter(Boolean).join(' · '), icon: 'user', path: p.url },
          ...p.top.map((r) => ({ title: r.name, subtitle: truncate(r.description || r.language || '', 100), meta: `${nf(r.stars, 0)} yıldız`, icon: 'code', path: r.url }))
        ] },
        data: p
      };
    }
  },
  {
    name: 'info_npm_package',
    category: 'info',
    title: 'npm paketi',
    description: 'Bir npm paketinin son sürümünü, açıklamasını, lisansını, bağımlılık sayısını ve haftalık indirme sayısını gösterir.',
    params: { name: { type: 'string', description: 'Paket adı, ör. "react" ya da "@types/node".', required: true } },
    run: async (a) => {
      const name = a.name.trim().toLowerCase();
      if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) throw new ToolError('Geçersiz npm paket adı.');
      const [meta, dl] = await Promise.all([
        getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, { notFound: `npm'de “${name}” paketi yok.` }),
        getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`).catch(() => null)
      ]);
      const p = parseNpm(meta, dl);
      return {
        summary: `${p.name} ${p.version}: ${p.description || 'açıklama yok'}. Haftalık ${p.weekly != null ? nf(p.weekly, 0) : '?'} indirme, lisans ${p.license || '—'}.`,
        display: { type: 'kv', rows: [['Paket', p.name], ['Sürüm', p.version], ['Açıklama', truncate(p.description || '—', 200)], ['Haftalık indirme', p.weekly != null ? nf(p.weekly, 0) : '—'], ['Lisans', p.license || '—'], ['Bağımlılık', p.deps], ...(p.node ? [['Node', p.node]] : []), ['Depo', p.repo || '—'], ['npm', `https://www.npmjs.com/package/${p.name}`]] },
        data: p
      };
    }
  },
  {
    name: 'info_pypi_package',
    category: 'info',
    title: 'PyPI paketi',
    description: 'Bir Python (PyPI) paketinin son sürümünü, özetini, lisansını, gereken Python sürümünü ve yayın tarihini gösterir.',
    params: { name: { type: 'string', description: 'Paket adı, ör. "requests".', required: true } },
    run: async (a) => {
      const name = a.name.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new ToolError('Geçersiz paket adı.');
      const p = parsePypi(await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { notFound: `PyPI'de “${name}” paketi yok.` }));
      if (!p) throw new ToolError('Paket bilgisi okunamadı.');
      return {
        summary: `${p.name} ${p.version}${p.released ? ` (${fmtDate(p.released)})` : ''}: ${p.summary || 'özet yok'}.`,
        display: { type: 'kv', rows: [['Paket', p.name], ['Sürüm', p.version], ['Yayın', fmtDate(p.released)], ['Özet', truncate(p.summary || '—', 200)], ['Lisans', p.license || '—'], ['Python', p.python || '—'], ['Yazar', truncate(p.author || '—', 80)], ['Sürüm sayısı', p.versions], ['Ana sayfa', p.homepage || '—'], ['PyPI', p.url]] },
        data: p
      };
    }
  },
  {
    name: 'info_hacker_news',
    category: 'info',
    title: 'Hacker News',
    description: 'Hacker News\'teki en popüler (ya da en yeni / en iyi) teknoloji haberlerini puan ve yorum sayısıyla listeler.',
    params: {
      kind: { type: 'string', enum: ['top', 'new', 'best'], description: 'top = popüler, new = yeni, best = en iyi. Varsayılan top.' },
      count: { type: 'integer', description: 'Kaç haber. Varsayılan 10, en çok 20.' }
    },
    run: async (a) => {
      const kind = ['new', 'best'].includes(a.kind) ? a.kind : 'top';
      const count = Math.max(1, Math.min(20, a.count || 10));
      const ids = await getJson(`https://hacker-news.firebaseio.com/v0/${kind}stories.json`);
      const raw = await Promise.all((ids || []).slice(0, count + 3).map((id) => getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)));
      const items = parseHn(raw).slice(0, count);
      if (!items.length) throw new ToolError('Hacker News alınamadı.');
      return {
        summary: `Hacker News: ${items.slice(0, 5).map((i) => i.title).join(' | ')}`,
        display: { type: 'list', title: `Hacker News · ${{ top: 'popüler', new: 'yeni', best: 'en iyi' }[kind]}`, items: items.map((i) => ({ title: i.title, subtitle: `${i.host} · ${i.by} · ${ago(i.time)}`, meta: `${i.score} puan · ${i.comments} yorum`, icon: 'newspaper', path: i.url })) },
        data: items.map((i) => ({ title: i.title, url: i.url, score: i.score, comments: i.comments }))
      };
    }
  },
  {
    name: 'info_reddit',
    category: 'info',
    title: 'Reddit popüler',
    description: 'Bir subreddit\'in (varsayılan r/popular) şu anki popüler gönderilerini listeler.',
    params: { subreddit: { type: 'string', description: 'Subreddit adı, ör. "turkey", "programming". Varsayılan popular.' } },
    run: async (a) => {
      const sub = String(a.subreddit || 'popular').trim().replace(/^\/?r\//i, '');
      if (!/^[A-Za-z0-9_]{2,21}$/.test(sub)) throw new ToolError('Geçersiz subreddit adı.');
      const res = await fetchWithTimeout(`https://www.reddit.com/r/${sub}/hot.json?limit=15&raw_json=1`, { headers: { 'User-Agent': 'desktop:vektor-assistant:0.4 (Vektor masaustu asistani)', Accept: 'application/json' } }, T);
      if (res.status === 404 || res.status === 302) throw new ToolError(`r/${sub} bulunamadı.`);
      if (res.status === 403) throw new ToolError(`r/${sub} özel ya da erişim engellendi.`);
      if (res.status === 429) throw new ToolError('Reddit istek sınırına ulaşıldı; biraz sonra tekrar dene.');
      if (!res.ok) throw new ToolError(`Reddit ${res.status} döndürdü.`);
      const items = parseReddit(await res.json().catch(() => null)).slice(0, 10);
      if (!items.length) throw new ToolError(`r/${sub} içinde gönderi bulunamadı.`);
      return {
        summary: `r/${sub} popüler: ${items.slice(0, 5).map((i) => i.title).join(' | ')}`,
        display: { type: 'list', title: `Reddit · r/${sub}`, items: items.map((i) => ({ title: truncate(i.title, 150), subtitle: `${i.sub} · u/${i.author}`, meta: `${nf(i.score, 0)} · ${nf(i.comments, 0)} yorum`, icon: 'chat', path: i.url })) },
        data: items.map((i) => ({ title: i.title, sub: i.sub, score: i.score, comments: i.comments }))
      };
    }
  },
  {
    name: 'info_short_link',
    category: 'info',
    title: 'Kısa link',
    description: 'Uzun bir adresi is.gd ile kısaltır ve kısa linki panoya kopyalar.',
    params: { url: { type: 'string', description: 'Kısaltılacak adres.', required: true } },
    run: async (a, ctx) => {
      const url = normalizeUrl(a.url);
      const j = await getJson(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`);
      if (!j.shorturl) throw new ToolError(`Kısaltılamadı: ${j.errormessage || 'bilinmeyen hata'}.`);
      let copied = false;
      try { await ctx?.clip?.writeText(j.shorturl); copied = !!ctx?.clip; } catch { copied = false; }
      return {
        summary: `Kısa link: ${j.shorturl}${copied ? ' (panoya kopyalandı)' : ''}.`,
        display: { type: 'value', label: truncate(url, 80), value: j.shorturl, detail: copied ? 'Panoya kopyalandı' : undefined, icon: 'link' },
        data: { short: j.shorturl, url, copied }
      };
    }
  },
  {
    name: 'info_qr_code',
    category: 'info',
    title: 'QR kod',
    description: 'Bir metin ya da adres için QR kod üretir ve gösterir; istenirse İndirilenler klasörüne PNG olarak kaydeder.',
    params: {
      text: { type: 'string', description: 'QR koda yazılacak metin ya da adres.', required: true },
      size: { type: 'integer', description: 'Piksel boyutu. Varsayılan 300.' },
      save: { type: 'boolean', description: 'İndirilenler klasörüne kaydedilsin mi. Varsayılan false.' }
    },
    run: async (a) => {
      const text = String(a.text);
      if (!text.trim()) throw new ToolError('QR kod için bir metin vermelisin.');
      if (text.length > 900) throw new ToolError('Metin QR kod için çok uzun (en çok 900 karakter).');
      const size = Math.max(100, Math.min(1000, a.size || 300));
      const res = await fetchWithTimeout(`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&format=png&data=${encodeURIComponent(text)}`, {}, T);
      if (!res.ok || !/image\/png/.test(res.headers.get('content-type') || 'image/png')) throw new ToolError(`QR kod üretilemedi (${res.status}).`);
      const buf = Buffer.from(await res.arrayBuffer());
      let saved = null;
      if (a.save) {
        const dir = dirFor('downloads');
        fs.mkdirSync(dir, { recursive: true });
        const slug = text.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'kod';
        saved = path.join(dir, `qr-${slug}.png`);
        for (let i = 1; fs.existsSync(saved); i++) saved = path.join(dir, `qr-${slug} (${i}).png`);
        fs.writeFileSync(saved, buf);
      }
      return {
        summary: `QR kod hazır${saved ? `, ${path.basename(saved)} olarak İndirilenler'e kaydedildi` : ''}.`,
        display: { type: 'image', src: `data:image/png;base64,${buf.toString('base64')}`, caption: truncate(text, 80), path: saved || undefined },
        data: { text: truncate(text, 200), size, path: saved }
      };
    }
  },
  {
    name: 'info_domain_whois',
    category: 'info',
    title: 'Alan adı kaydı',
    description: 'Bir alan adının kayıt şirketini, kayıt ve bitiş tarihlerini, durumunu ve isim sunucularını (RDAP/whois) gösterir.',
    params: { domain: { type: 'string', description: 'Alan adı, ör. ornek.com.', required: true } },
    run: async (a) => {
      const d = cleanDomain(a.domain);
      const r = parseRdap(await getJson(`https://rdap.org/domain/${d}`, { notFound: `${d} için kayıt bulunamadı (alan adı boşta olabilir ya da bu uzantı RDAP desteklemiyor).`, headers: { Accept: 'application/rdap+json, application/json' } }));
      return {
        summary: `${d}: kayıt şirketi ${r.registrar || '—'}, kayıt ${fmtDate(r.created)}, bitiş ${fmtDate(r.expires)}${r.daysLeft != null ? ` (${r.daysLeft} gün kaldı)` : ''}.`,
        display: { type: 'kv', status: r.daysLeft == null ? undefined : r.daysLeft < 0 ? 'danger' : r.daysLeft < 30 ? 'warning' : 'success', rows: [['Alan adı', r.domain || d], ['Kayıt şirketi', r.registrar || '—'], ['Kayıt tarihi', fmtDate(r.created)], ['Son güncelleme', fmtDate(r.updated)], ['Bitiş tarihi', fmtDate(r.expires)], ['Kalan', r.daysLeft != null ? `${r.daysLeft} gün` : '—'], ['Durum', r.status.join(', ') || '—'], ['İsim sunucuları', r.nameservers.join(', ') || '—'], ['DNSSEC', r.dnssec == null ? '—' : r.dnssec ? 'Açık' : 'Kapalı']] },
        data: r
      };
    }
  },
  {
    name: 'info_ssl_cert',
    category: 'info',
    title: 'SSL sertifikası',
    description: 'Bir sitenin SSL/TLS sertifikasını kontrol eder: kime ve kim tarafından verildiği, geçerlilik tarihleri ve bitişe kalan gün.',
    params: {
      host: { type: 'string', description: 'Alan adı, ör. ornek.com.', required: true },
      port: { type: 'integer', description: 'Port. Varsayılan 443.' }
    },
    run: async (a) => {
      const h = cleanDomain(a.host);
      const port = a.port || 443;
      if (!(port > 0 && port < 65536)) throw new ToolError('Port 1–65535 arasında olmalı.');
      const info = await new Promise((resolve, reject) => {
        const sock = tls.connect({ host: h, port, servername: h, rejectUnauthorized: false, timeout: T }, () => {
          const cert = sock.getPeerCertificate();
          const out = { cert, authorized: sock.authorized, error: sock.authorizationError ? String(sock.authorizationError) : null, protocol: sock.getProtocol() };
          sock.end();
          resolve(out);
        });
        sock.once('timeout', () => { sock.destroy(); reject(new ToolError('Bağlantı zaman aşımına uğradı.')); });
        sock.once('error', (e) => reject(new ToolError(`${h}:${port} bağlantısı kurulamadı: ${e.code || e.message}`)));
      });
      const c = parseCert(info.cert, info);
      if (!c) throw new ToolError('Sertifika okunamadı.');
      const status = !c.authorized || c.daysLeft < 0 ? 'danger' : c.daysLeft < 21 ? 'warning' : 'success';
      return {
        summary: `${h} sertifikası ${c.daysLeft < 0 ? `${-c.daysLeft} gün önce dolmuş` : `${c.daysLeft} gün daha geçerli`} (bitiş ${fmtDate(c.validTo)}). Veren: ${c.issuer}.${c.authorized ? '' : ` Uyarı: güvenilir değil (${c.error}).`}`,
        display: { type: 'kv', status, rows: [['Site', `${h}:${port}`], ['Konu', c.subject], ['Veren', c.issuer], ['Başlangıç', fmtDate(c.validFrom)], ['Bitiş', fmtDate(c.validTo)], ['Kalan', `${c.daysLeft} gün`], ['Güvenilir', c.authorized ? 'Evet' : `Hayır (${c.error})`], ['Protokol', info.protocol || '—'], ['Kapsanan adlar', `${c.names.join(', ')}${c.altCount > c.names.length ? ` +${c.altCount - c.names.length}` : ''}`]] },
        data: { ...c, protocol: info.protocol }
      };
    }
  },
  {
    name: 'info_http_headers',
    category: 'info',
    title: 'HTTP başlıkları',
    description: 'Bir adrese istek atıp durum kodunu, yönlendirmeyi, sunucu ve önbellek başlıklarını ve eksik güvenlik başlıklarını gösterir.',
    params: { url: { type: 'string', description: 'Adres.', required: true } },
    run: async (a) => {
      const url = normalizeUrl(a.url);
      const t0 = Date.now();
      let res = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow' }, T);
      if (res.status === 405 || res.status === 501) {
        res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, T);
        res.body?.cancel?.();
      }
      const ms = Date.now() - t0;
      const h = parseHeaders([...res.headers.entries()]);
      const rows = [['Durum', `${res.status} ${res.statusText || ''}`.trim()], ...(res.redirected ? [['Son adres', res.url]] : []), ['Süre', `${ms} ms`], ...h.rows];
      if (h.cookies) rows.push(['Çerez', `${h.cookies} adet set-cookie`]);
      if (h.missing.length) rows.push(['Eksik güvenlik başlıkları', h.missing.join(', ')]);
      return {
        summary: `${host(url)}: HTTP ${res.status}${res.redirected ? ` (→ ${host(res.url)})` : ''}, ${h.total} başlık${h.rows.find((r) => r[0] === 'server') ? `, sunucu ${h.rows.find((r) => r[0] === 'server')[1]}` : ''}.${h.missing.length ? ` Eksik güvenlik başlıkları: ${h.missing.join(', ')}.` : ''}`,
        display: { type: 'kv', status: res.ok ? 'success' : res.status < 500 ? 'warning' : 'danger', rows },
        data: { status: res.status, finalUrl: res.url, headers: Object.fromEntries(h.rows), missingSecurity: h.missing }
      };
    }
  },
  {
    name: 'info_speed_test',
    category: 'info',
    title: 'İnternet hız testi',
    description: 'Cloudflare sunucularıyla indirme ve yükleme hızını (Mbps) ve gecikmeyi ölçer. Yaklaşık 30–45 saniye sürer.',
    timeout: 60000,
    run: async () => {
      const base = 'https://speed.cloudflare.com';
      // Latency: tiny requests, first one warms the connection.
      const pings = [];
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        const r = await fetchWithTimeout(`${base}/__down?bytes=0`, { cache: 'no-store' }, 5000);
        await r.arrayBuffer();
        if (i) pings.push(performance.now() - t0);
      }
      pings.sort((x, y) => x - y);
      const latency = Math.round(pings[Math.floor(pings.length / 2)]);
      const jitter = Math.round(pings.slice(1).reduce((s, v, i) => s + Math.abs(v - pings[i]), 0) / Math.max(1, pings.length - 1));
      // Download: 25 MB, capped at 22 s.
      let t0 = performance.now();
      const dres = await fetchWithTimeout(`${base}/__down?bytes=25000000`, { cache: 'no-store' }, 15000);
      if (!dres.ok || !dres.body) throw new ToolError(`Hız testi sunucusu ${dres.status} döndürdü.`);
      const got = await readFor(dres, Date.now() + 22000);
      const down = mbps(got, performance.now() - t0);
      const colo = dres.headers.get('cf-meta-colo'), city = dres.headers.get('cf-meta-city');
      // Upload: 5 MB of random bytes.
      let up = null;
      try {
        const payload = crypto.randomBytes(5 * 1000 * 1000);
        t0 = performance.now();
        const ures = await fetchWithTimeout(`${base}/__up`, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/octet-stream' } }, 18000);
        await ures.arrayBuffer().catch(() => null);
        if (ures.ok) up = mbps(payload.length, performance.now() - t0);
      } catch { up = null; }
      return {
        summary: `İndirme ${nf(down, 1)} Mbps, yükleme ${up != null ? `${nf(up, 1)} Mbps` : 'ölçülemedi'}, gecikme ${latency} ms.`,
        display: { type: 'kv', status: down >= 25 ? 'success' : down >= 5 ? 'warning' : 'danger', rows: [['İndirme', `${nf(down, 1)} Mbps`], ['Yükleme', up != null ? `${nf(up, 1)} Mbps` : '—'], ['Gecikme', `${latency} ms`], ['Dalgalanma (jitter)', `${jitter} ms`], ['İndirilen veri', bytes(got)], ['Sunucu', [city, colo].filter(Boolean).join(' · ') || 'Cloudflare']] },
        data: { downloadMbps: down, uploadMbps: up, latencyMs: latency, jitterMs: jitter }
      };
    }
  },
  {
    name: 'info_currency_history',
    category: 'info',
    title: 'Döviz geçmişi',
    description: 'Bir döviz kurunun son günlerdeki seyrini gösterir: en düşük, en yüksek ve yüzde değişim (Avrupa Merkez Bankası verisi).',
    params: {
      from: { type: 'string', description: 'Kaynak para birimi. Varsayılan USD.' },
      to: { type: 'string', description: 'Hedef para birimi. Varsayılan TRY.' },
      days: { type: 'integer', description: 'Kaç gün geriye. Varsayılan 30, en çok 365.' }
    },
    run: async (a) => {
      const fix = (c, d) => String(c || d).trim().toUpperCase().replace(/^TL$/, 'TRY');
      const from = fix(a.from, 'USD'), to = fix(a.to, 'TRY');
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new ToolError('Para birimlerini üç harfli kodla ver, ör. USD, EUR, TRY.');
      if (from === to) throw new ToolError('Kaynak ve hedef para birimi aynı olamaz.');
      const days = Math.max(2, Math.min(365, a.days || 30));
      const end = new Date(), start = new Date(Date.now() - days * 86400000);
      const j = await getJson(`https://api.frankfurter.app/${isoDay(start)}..${isoDay(end)}?from=${from}&to=${to}`, { notFound: `${from} ya da ${to} desteklenmiyor.` });
      const h = parseRateHistory(j, to);
      if (!h) throw new ToolError(`${from}/${to} için geçmiş kur bulunamadı.`);
      const r = (v) => nf(v, 4);
      return {
        summary: `${from}/${to} son ${days} gün: ${r(h.first.rate)} → ${r(h.last.rate)} (${pct(h.change)}). En düşük ${r(h.min.rate)} (${fmtDate(h.min.date + 'T12:00')}), en yüksek ${r(h.max.rate)} (${fmtDate(h.max.date + 'T12:00')}).`,
        display: { type: 'list', title: `${from}/${to} · son ${days} gün · ${pct(h.change)} · en düşük ${r(h.min.rate)} · en yüksek ${r(h.max.rate)}`, items: h.sample.map((p) => ({ title: new Date(p.date + 'T12:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }), meta: r(p.rate), icon: 'currency' })) },
        data: { from, to, first: h.first, last: h.last, min: h.min, max: h.max, changePct: Math.round(h.change * 100) / 100 }
      };
    }
  },
  {
    name: 'info_book_search',
    category: 'info',
    title: 'Kitap ara',
    description: 'Open Library\'de kitap arar; yazar, ilk yayın yılı, baskı sayısı ve sayfa sayısıyla listeler.',
    params: {
      query: { type: 'string', description: 'Kitap adı, yazar ya da konu.', required: true },
      author: { type: 'string', description: 'İsteğe bağlı yazar filtresi.' }
    },
    run: async (a) => {
      const q = new URLSearchParams({ q: a.query, limit: '8', fields: 'title,author_name,first_publish_year,key,edition_count,number_of_pages_median,ratings_average' });
      if (a.author) q.set('author', a.author);
      const r = parseBooks(await getJson(`https://openlibrary.org/search.json?${q}`, { ms: 15000 }));
      if (!r.items.length) throw new ToolError(`“${a.query}” için kitap bulunamadı.`);
      return {
        summary: `${nf(r.total, 0)} sonuç. ${r.items.slice(0, 4).map((b) => `${b.title}${b.authors ? ` (${b.authors}${b.year ? `, ${b.year}` : ''})` : ''}`).join('; ')}.`,
        display: { type: 'list', title: `Kitaplar · “${a.query}”`, items: r.items.map((b) => ({ title: b.title, subtitle: [b.authors, b.year, b.pages ? `${b.pages} sayfa` : null].filter(Boolean).join(' · '), meta: b.rating ? `${nf(b.rating, 1)}/5` : b.editions ? `${b.editions} baskı` : '', icon: 'book', path: b.url })) },
        data: r.items.map((b) => ({ title: b.title, authors: b.authors, year: b.year }))
      };
    }
  }
];

module.exports.parsers = {
  coinId, parseCryptoPrice, parseCryptoTop, trPlace, parseQuakes, parsePrayer, parseSun, aqiCategory, parseAir, uvCategory, parseUv,
  parseRain, moonPhase, parseHolidays, parseCountry, isPrivateIp, parseIp, parseDictionary, parseOnThisDay, parseWikiSummary,
  parseWikiSearch, parseRepoRef, parseGithubRepo, parseGithubUser, parseNpm, parsePypi, parseHn, parseReddit, parseBooks,
  cleanDomain, parseRdap, parseCert, parseHeaders, parseRateHistory, mbps, ago, pct
};
