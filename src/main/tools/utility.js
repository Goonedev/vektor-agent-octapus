'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const fs = require('node:fs');
const { exec } = require('node:child_process');
const { isWin, isMac, ToolError, norm, run, launch, resolvePath, fetchJson, fetchWithTimeout, truncate, dirFor, hasBin } = require('./util');
const { evaluate, format, convertUnits } = require('./calc');

/* ------------------------------------------------------------- weather */

const WMO = {
  0: ['Açık', 'sun'], 1: ['Çoğunlukla açık', 'sun'], 2: ['Parçalı bulutlu', 'cloud-sun'], 3: ['Kapalı', 'cloud'],
  45: ['Sisli', 'fog'], 48: ['Kırağılı sis', 'fog'],
  51: ['Hafif çisenti', 'drizzle'], 53: ['Çisenti', 'drizzle'], 55: ['Yoğun çisenti', 'drizzle'], 56: ['Donan çisenti', 'drizzle'], 57: ['Donan çisenti', 'drizzle'],
  61: ['Hafif yağmur', 'rain'], 63: ['Yağmur', 'rain'], 65: ['Şiddetli yağmur', 'rain'], 66: ['Donan yağmur', 'rain'], 67: ['Donan yağmur', 'rain'],
  71: ['Hafif kar', 'snow'], 73: ['Kar', 'snow'], 75: ['Yoğun kar', 'snow'], 77: ['Kar taneleri', 'snow'],
  80: ['Sağanak', 'rain'], 81: ['Kuvvetli sağanak', 'rain'], 82: ['Şiddetli sağanak', 'rain'], 85: ['Kar sağanağı', 'snow'], 86: ['Yoğun kar sağanağı', 'snow'],
  95: ['Gök gürültülü fırtına', 'storm'], 96: ['Dolu ile fırtına', 'storm'], 99: ['Şiddetli dolu', 'storm']
};
const wmo = (c) => WMO[c] || ['Bilinmiyor', 'cloud'];

async function locate(city) {
  if (city) {
    const g = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=tr&name=${encodeURIComponent(city)}`);
    const r = g.results?.[0];
    if (!r) throw new ToolError(`“${city}” konumu bulunamadı.`);
    return { name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
  }
  const ip = await fetchJson('https://ipwho.is/?lang=tr');
  if (ip.success === false) throw new ToolError('Konum bulunamadı; bir şehir adı söyle.');
  return { name: ip.city, region: [ip.region, ip.country].filter(Boolean).join(', '), lat: ip.latitude, lon: ip.longitude };
}

/* ---------------------------------------------------------- world clock */

const CITY_TZ = {
  istanbul: 'Europe/Istanbul', ankara: 'Europe/Istanbul', izmir: 'Europe/Istanbul', türkiye: 'Europe/Istanbul',
  londra: 'Europe/London', london: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam',
  roma: 'Europe/Rome', madrid: 'Europe/Madrid', moskova: 'Europe/Moscow', atina: 'Europe/Athens', bakü: 'Asia/Baku', tiflis: 'Asia/Tbilisi',
  dubai: 'Asia/Dubai', riyad: 'Asia/Riyadh', tahran: 'Asia/Tehran', kahire: 'Africa/Cairo', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata',
  pekin: 'Asia/Shanghai', şanghay: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', tokyo: 'Asia/Tokyo', seul: 'Asia/Seoul', singapur: 'Asia/Singapore',
  sidney: 'Australia/Sydney', sydney: 'Australia/Sydney', 'new york': 'America/New_York', newyork: 'America/New_York', washington: 'America/New_York',
  chicago: 'America/Chicago', 'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', toronto: 'America/Toronto',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires', bakı: 'Asia/Baku',
  viyana: 'Europe/Vienna', zürih: 'Europe/Zurich', stockholm: 'Europe/Stockholm', kiev: 'Europe/Kyiv', varşova: 'Europe/Warsaw'
};

function tzFor(place) {
  const p = norm(place);
  const hit = Object.keys(CITY_TZ).find((k) => norm(k) === p);
  if (hit) return CITY_TZ[hit];
  try { new Intl.DateTimeFormat('en', { timeZone: place }); return place; } catch { return null; }
}

/* ---------------------------------------------------------------- RSS */

function parseRss(xml) {
  const items = [];
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => { const r = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return r ? decode(r[1]) : ''; };
    const source = get('source');
    let title = get('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    items.push({ title, link: get('link'), date: get('pubDate'), source });
  }
  return items;
}

/* --------------------------------------------------------------- ping */

async function ping(host) {
  const args = isWin ? ['-n', '4', '-w', '2000', host] : ['-c', '4', '-W', isMac ? '2000' : '2', host];
  const out = await run('ping', args, { timeout: 15000 }).catch((e) => e.message);
  const times = [...String(out).matchAll(/(?:time|süre|zeit)[=<]\s*([\d.,]+)\s*ms/gi)].map((m) => parseFloat(m[1].replace(',', '.')));
  return { sent: 4, received: times.length, avg: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, min: times.length ? Math.min(...times) : null, max: times.length ? Math.max(...times) : null };
}

function checkPort(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host, port });
    const done = (open) => { sock.destroy(); resolve({ open, ms: Date.now() - t0 }); };
    sock.setTimeout(timeout, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/* -------------------------------------------------------------- tools */

module.exports = [
  {
    name: 'calculate',
    category: 'utility',
    title: 'Hesapla',
    description: 'Matematik ifadesini kesin olarak hesaplar: + - * / ^ %, parantez, sqrt, sin (derece), log, ln, fact, pi. Yüzde: "1500 * 18%" ya da "200 + 10%". Sayısal sonuçları her zaman bununla hesapla, tahmin etme.',
    params: { expression: { type: 'string', description: 'İfade, ör. "(1250*12) * 0.82".', required: true } },
    run: async (a) => {
      let v;
      try { v = evaluate(a.expression); } catch (e) { throw new ToolError(`Hesaplanamadı: ${e.message}`); }
      return { summary: `${a.expression} = ${format(v)}`, display: { type: 'value', value: format(v), label: a.expression, icon: 'calculator' }, data: { result: v } };
    }
  },
  {
    name: 'convert_units',
    category: 'utility',
    title: 'Birim çevir',
    description: 'Uzunluk, ağırlık, hacim, sıcaklık (c/f/k), hız, veri boyutu, süre, alan, enerji ve basınç birimleri arasında çevirir. Birimleri kısaltmayla ver: km, mi, kg, lb, l, gal, c, f, mb, gb, km/h, mph, m2, kwh...',
    params: {
      value: { type: 'number', description: 'Değer.', required: true },
      from: { type: 'string', description: 'Kaynak birim.', required: true },
      to: { type: 'string', description: 'Hedef birim.', required: true }
    },
    run: async (a) => {
      let v;
      try { v = convertUnits(a.value, a.from, a.to); } catch (e) { throw new ToolError(e.message); }
      return { summary: `${format(a.value)} ${a.from} = ${format(v, 4)} ${a.to}`, display: { type: 'value', value: `${format(v, 4)} ${a.to}`, label: `${format(a.value)} ${a.from}`, icon: 'arrows' }, data: { result: v } };
    }
  },
  {
    name: 'convert_currency',
    category: 'utility',
    title: 'Döviz çevir',
    description: 'Güncel kurlarla para birimi çevirir (USD, EUR, TRY, GBP, JPY...).',
    params: {
      amount: { type: 'number', description: 'Miktar. Varsayılan 1.' },
      from: { type: 'string', description: 'Kaynak para birimi kodu, ör. USD.', required: true },
      to: { type: 'string', description: 'Hedef para birimi kodu, ör. TRY.', required: true }
    },
    run: async (a) => {
      const from = a.from.toUpperCase().replace('TL', 'TRY'), to = a.to.toUpperCase().replace('TL', 'TRY');
      const amount = a.amount ?? 1;
      const d = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
      if (d.result !== 'success' || !d.rates?.[to]) throw new ToolError(`${from} → ${to} kuru bulunamadı.`);
      const v = amount * d.rates[to];
      const updated = new Date(d.time_last_update_unix * 1000).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
      return {
        summary: `${format(amount)} ${from} = ${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${to} (1 ${from} = ${d.rates[to].toFixed(4)} ${to}).`,
        display: { type: 'value', value: `${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${to}`, label: `${format(amount)} ${from}`, detail: `1 ${from} = ${d.rates[to].toFixed(4)} ${to} · ${updated}`, icon: 'currency' },
        data: { result: v, rate: d.rates[to] }
      };
    }
  },
  {
    name: 'get_weather',
    category: 'utility',
    title: 'Hava durumu',
    description: 'Bir şehrin anlık hava durumunu ve 5 günlük tahminini getirir. Şehir verilmezse kullanıcının konumu kullanılır.',
    params: { city: { type: 'string', description: 'Şehir adı.' } },
    run: async (a) => {
      const loc = await locate(a.city);
      const w = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=5&timezone=auto`);
      const c = w.current;
      const [cond, icon] = wmo(c.weather_code);
      const nowIdx = Math.max(0, w.hourly.time.findIndex((t) => t >= c.time.slice(0, 13)));
      const hourly = w.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({ time: t.slice(11, 16), temp: Math.round(w.hourly.temperature_2m[nowIdx + i]), icon: wmo(w.hourly.weather_code[nowIdx + i])[1] }));
      const days = w.daily.time.map((t, i) => ({
        day: i === 0 ? 'Bugün' : new Date(t + 'T12:00').toLocaleDateString('tr-TR', { weekday: 'short' }),
        max: Math.round(w.daily.temperature_2m_max[i]), min: Math.round(w.daily.temperature_2m_min[i]),
        rain: w.daily.precipitation_probability_max[i], icon: wmo(w.daily.weather_code[i])[1], cond: wmo(w.daily.weather_code[i])[0]
      }));
      return {
        summary: `${loc.name}: ${Math.round(c.temperature_2m)}°C, ${cond.toLocaleLowerCase('tr')}; hissedilen ${Math.round(c.apparent_temperature)}°. Bugün en yüksek ${days[0].max}°, en düşük ${days[0].min}°, yağış olasılığı %${days[0].rain ?? 0}.`,
        display: { type: 'weather', place: loc.name, region: loc.region, temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), cond, icon, isDay: !!c.is_day, humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m), hourly, days },
        data: { place: loc.name, temp: c.temperature_2m, cond, days: days.map((d) => `${d.day}: ${d.min}–${d.max}° ${d.cond}, yağış %${d.rain ?? 0}`) }
      };
    }
  },
  {
    name: 'get_news',
    category: 'utility',
    title: 'Haberler',
    description: 'Google Haberler\'den güncel manşetleri ya da bir konudaki haberleri getirir.',
    params: {
      topic: { type: 'string', description: 'Konu (boşsa genel manşetler).' },
      lang: { type: 'string', enum: ['tr', 'en'], description: 'Dil. Varsayılan tr.' }
    },
    run: async (a) => {
      const en = a.lang === 'en';
      const loc = en ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=tr&gl=TR&ceid=TR:tr';
      const url = a.topic ? `https://news.google.com/rss/search?q=${encodeURIComponent(a.topic)}&${loc}` : `https://news.google.com/rss?${loc}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new ToolError('Haberler alınamadı.');
      const items = parseRss(await res.text()).slice(0, 10);
      return {
        summary: items.length ? `${items.length} haber: ${items.slice(0, 5).map((i) => i.title).join(' | ')}` : 'Haber bulunamadı.',
        display: { type: 'news', title: a.topic ? `“${a.topic}”` : 'Manşetler', items: items.map((i) => ({ title: i.title, source: i.source, url: i.link, time: i.date ? new Date(i.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '' })) },
        data: items.map((i) => `${i.title} (${i.source})`)
      };
    }
  },
  {
    name: 'world_clock',
    category: 'utility',
    title: 'Dünya saati',
    description: 'Bir ya da birden fazla şehirde şu an saatin kaç olduğunu gösterir.',
    params: { places: { type: 'array', items: { type: 'string' }, description: 'Şehirler ya da IANA saat dilimleri, ör. ["Tokyo", "New York"].', required: true } },
    run: async (a) => {
      const now = new Date();
      const localOffset = -now.getTimezoneOffset();
      const items = (a.places || []).map((p) => {
        const tz = tzFor(p);
        if (!tz) return { title: p, subtitle: 'Saat dilimi bilinmiyor', icon: 'globe' };
        const time = now.toLocaleTimeString('tr-TR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
        const day = now.toLocaleDateString('tr-TR', { timeZone: tz, weekday: 'long' });
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value || 'GMT';
        const m = parts.match(/GMT([+-])(\d{2}):(\d{2})/);
        const off = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
        const diff = (off - localOffset) / 60;
        return { title: p, subtitle: `${day} · ${diff === 0 ? 'aynı saat' : `${diff > 0 ? '+' : ''}${diff} sa`}`, meta: time, icon: 'globe' };
      });
      return { summary: items.map((i) => `${i.title}: ${i.meta || '?'}`).join(', '), display: { type: 'list', items }, data: items.map((i) => ({ place: i.title, time: i.meta })) };
    }
  },
  {
    name: 'generate_password',
    category: 'utility',
    title: 'Şifre üret',
    description: 'Güçlü, rastgele bir şifre üretir ve panoya kopyalar. Şifreyi sesli okuma; sadece panoda olduğunu söyle.',
    params: {
      length: { type: 'integer', description: 'Uzunluk. Varsayılan 20.' },
      symbols: { type: 'boolean', description: 'Sembol içersin mi. Varsayılan true.' }
    },
    run: async (a, ctx) => {
      const len = Math.max(8, Math.min(128, a.length || 20));
      const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', ...(a.symbols === false ? [] : ['!@#$%^&*-_=+?'])];
      const all = sets.join('');
      const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
      while (chars.length < len) chars.push(all[crypto.randomInt(all.length)]);
      for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
      const pw = chars.join('');
      await ctx.clip.writeText(pw);
      return { summary: `${len} karakterli şifre üretildi ve panoya kopyalandı.`, display: { type: 'secret', value: pw, label: `${len} karakter · panoda` }, data: { length: len, copied: true } };
    }
  },
  {
    name: 'random_pick',
    category: 'utility',
    title: 'Rastgele seç',
    description: 'Yazı tura atar, zar atar, aralıkta rastgele sayı üretir ya da bir listeden seçim yapar.',
    params: {
      mode: { type: 'string', enum: ['coin', 'dice', 'number', 'choice'], description: 'coin = yazı tura, dice = zar, number = sayı, choice = listeden seç.', required: true },
      min: { type: 'integer', description: 'number için en küçük değer.' },
      max: { type: 'integer', description: 'number için en büyük değer; dice için yüz sayısı.' },
      options: { type: 'array', items: { type: 'string' }, description: 'choice için seçenekler.' }
    },
    run: async (a) => {
      let value;
      if (a.mode === 'coin') value = crypto.randomInt(2) ? 'Yazı' : 'Tura';
      else if (a.mode === 'dice') value = String(crypto.randomInt(1, (a.max || 6) + 1));
      else if (a.mode === 'number') {
        const lo = a.min ?? 1, hi = a.max ?? 100;
        if (hi < lo) throw new ToolError('max, min\'den küçük olamaz.');
        value = String(crypto.randomInt(lo, hi + 1));
      } else {
        if (!a.options?.length) throw new ToolError('Seçenek listesi vermelisin.');
        value = a.options[crypto.randomInt(a.options.length)];
      }
      const label = { coin: 'Yazı tura', dice: `Zar (d${a.max || 6})`, number: `${a.min ?? 1}–${a.max ?? 100}`, choice: (a.options || []).join(' · ') }[a.mode];
      return { summary: `Sonuç: ${value}.`, display: { type: 'value', value, label, icon: a.mode === 'dice' ? 'dice' : 'spark' }, data: { result: value } };
    }
  },

  /* network */
  {
    name: 'ping_host',
    category: 'network',
    title: 'Ping',
    description: 'Bir sunucuya ping atarak gecikmeyi ve paket kaybını ölçer. İnternet bağlantısını test etmek için 8.8.8.8 kullan.',
    params: { host: { type: 'string', description: 'Alan adı ya da IP. Varsayılan 8.8.8.8.' } },
    run: async (a) => {
      const host = (a.host || '8.8.8.8').replace(/^https?:\/\//, '').split('/')[0];
      if (!/^[\w.-]+$/.test(host)) throw new ToolError('Geçersiz adres.');
      const r = await ping(host);
      const loss = Math.round(100 * (r.sent - r.received) / r.sent);
      return {
        summary: r.received ? `${host}: ortalama ${r.avg} ms, kayıp %${loss}.` : `${host} yanıt vermiyor.`,
        display: { type: 'kv', status: r.received ? (r.avg < 80 ? 'success' : 'warning') : 'danger', rows: [['Hedef', host], ['Ortalama', r.avg != null ? `${r.avg} ms` : '—'], ['En az / en çok', r.min != null ? `${r.min} / ${r.max} ms` : '—'], ['Paket kaybı', `%${loss}`]] },
        data: { ...r, loss }
      };
    }
  },
  {
    name: 'dns_lookup',
    category: 'network',
    title: 'DNS sorgusu',
    description: 'Bir alan adının IP adreslerini ve kayıtlarını sorgular.',
    params: {
      domain: { type: 'string', description: 'Alan adı.', required: true },
      type: { type: 'string', enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'], description: 'Kayıt türü. Varsayılan A.' }
    },
    run: async (a) => {
      const domain = a.domain.replace(/^https?:\/\//, '').split('/')[0];
      const type = a.type || 'A';
      let records;
      try { records = await dns.resolve(domain, type); } catch (e) { throw new ToolError(`${domain} için ${type} kaydı bulunamadı (${e.code}).`); }
      const flat = records.map((r) => (typeof r === 'string' ? r : Array.isArray(r) ? r.join('') : r.exchange ? `${r.exchange} (öncelik ${r.priority})` : JSON.stringify(r)));
      return { summary: `${domain} ${type}: ${flat.slice(0, 5).join(', ')}.`, display: { type: 'list', title: `${domain} · ${type}`, items: flat.map((f) => ({ title: f, icon: 'globe' })) }, data: flat };
    }
  },
  {
    name: 'check_port',
    category: 'network',
    title: 'Port kontrolü',
    description: 'Bir sunucuda TCP portunun açık olup olmadığını kontrol eder (ör. localhost 3000).',
    params: {
      host: { type: 'string', description: 'Sunucu. Varsayılan localhost.' },
      port: { type: 'integer', description: 'Port numarası.', required: true }
    },
    run: async (a) => {
      const host = a.host || '127.0.0.1';
      if (!(a.port > 0 && a.port < 65536)) throw new ToolError('Port 1–65535 arasında olmalı.');
      const r = await checkPort(host, a.port);
      return { summary: `${host}:${a.port} ${r.open ? 'açık' : 'kapalı'}.`, display: { type: 'kv', status: r.open ? 'success' : 'danger', rows: [['Adres', `${host}:${a.port}`], ['Durum', r.open ? 'Açık' : 'Kapalı'], ['Süre', `${r.ms} ms`]] }, data: r };
    }
  },

  /* developer */
  {
    name: 'run_command',
    category: 'dev',
    title: 'Komut çalıştır',
    description: 'Terminal komutu çalıştırır ve çıktısını döndürür (Windows\'ta PowerShell, diğerlerinde sh). Başka araç işi görmüyorsa kullan; her çalıştırma kullanıcı onayı ister.',
    danger: true,
    params: {
      command: { type: 'string', description: 'Çalıştırılacak komut.', required: true },
      cwd: { type: 'string', description: 'Çalışma klasörü. Varsayılan ev klasörü.' }
    },
    run: async (a) => {
      const cwd = a.cwd ? resolvePath(a.cwd) : dirFor('home');
      const t0 = Date.now();
      const { code, out } = await new Promise((resolve) => {
        const opts = { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: isWin ? 'powershell.exe' : process.env.SHELL || '/bin/sh' };
        exec(a.command, opts, (err, stdout, stderr) => resolve({ code: err ? (err.killed ? 'zaman aşımı' : err.code ?? 1) : 0, out: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim() }));
      });
      return {
        summary: code === 0 ? `Komut başarılı (${Date.now() - t0} ms).` : `Komut çıkış kodu ${code} ile bitti.`,
        display: { type: 'terminal', command: a.command, cwd, output: truncate(out, 4000), code },
        data: { exitCode: code, output: truncate(out, 6000) }
      };
    }
  },
  {
    name: 'git_status',
    category: 'dev',
    title: 'Git durumu',
    description: 'Bir proje klasörünün git dalını, değişen dosyalarını ve son commitlerini gösterir.',
    params: { path: { type: 'string', description: 'Proje klasörü.', required: true } },
    run: async (a) => {
      const cwd = resolvePath(a.path);
      if (!fs.existsSync(cwd)) throw new ToolError(`${cwd} bulunamadı.`);
      const status = await run('git', ['status', '--short', '--branch'], { cwd, missingHint: 'git kurulu değil.' });
      const log = await run('git', ['log', '--oneline', '-5', '--format=%h %s (%cr)'], { cwd }).catch(() => '');
      const [branch, ...changes] = status.trim().split('\n');
      return {
        summary: `${branch.replace(/^## /, '')}; ${changes.filter(Boolean).length} değişiklik.`,
        display: { type: 'terminal', command: 'git status', cwd, output: `${status.trim()}\n\n${log.trim()}`, code: 0 },
        data: { branch: branch.replace(/^## /, ''), changes: changes.filter(Boolean), recent: log.trim().split('\n') }
      };
    }
  },
  {
    name: 'open_in_vscode',
    category: 'dev',
    title: 'VS Code\'da aç',
    description: 'Bir dosya ya da klasörü Visual Studio Code\'da açar.',
    params: { path: { type: 'string', description: 'Dosya ya da klasör.', required: true } },
    run: async (a) => {
      const p = resolvePath(a.path);
      if (!fs.existsSync(p)) throw new ToolError(`${p} bulunamadı.`);
      if (isMac) await run('open', ['-a', 'Visual Studio Code', p]);
      else if (await hasBin('code')) await launch('code', [p], { shell: isWin });
      else throw new ToolError('VS Code bulunamadı. PATH\'e "code" komutunu ekle.');
      return { summary: `${p} VS Code'da açıldı.`, display: { type: 'app', name: 'Visual Studio Code', detail: p } };
    }
  }
];

module.exports.parseRss = parseRss;
module.exports.tzFor = tzFor;
