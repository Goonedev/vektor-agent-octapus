'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const info = require('../src/main/tools/packs/info');
const dev = require('../src/main/tools/packs/dev');
const { ToolError } = require('../src/main/tools/util');

const P = info.parsers;
const D = dev.parsers;
const CATEGORIES = ['web', 'apps', 'files', 'system', 'control', 'media', 'clipboard', 'input', 'windows', 'productivity', 'utility', 'network', 'dev', 'settings', 'sites', 'shortcuts', 'text', 'info'];
const DISPLAY = ['value', 'kv', 'list', 'stats', 'link', 'article', 'code', 'keys', 'file', 'image', 'secret', 'power', 'terminal'];

const clip = { value: '', readText: async () => clip.value, writeText: async (s) => { clip.value = s; } };
const ctx = { clip };
const tool = (pack, name) => { const t = pack.find((x) => x.name === name); assert.ok(t, `missing ${name}`); return t; };

/* Routes global fetch to canned responses so run() can be exercised offline. */
function mockFetch(routes) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    const hit = routes.find(([re]) => re.test(u));
    if (!hit) throw new Error(`unmocked ${u}`);
    const r = typeof hit[1] === 'function' ? hit[1](u, opts) : hit[1];
    if (r instanceof Response) return r;
    const body = Buffer.isBuffer(r.body) ? r.body : typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? r);
    return new Response(body, { status: r.status || 200, headers: r.headers || { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}

test('info and dev packs have the expected shape, size and unique names', () => {
  assert.equal(info.length, 30);
  assert.equal(dev.length, 15);
  // The registry may already include these packs (as copies); every name must occur there at most once.
  const registry = require('../src/main/tools').TOOLS.map((t) => t.name);
  const collides = (name) => registry.filter((n) => n === name).length > 1;
  const names = new Set();
  for (const t of [...info, ...dev]) {
    const prefix = t.category === 'info' ? 'info_' : 'dev_';
    assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/);
    assert.ok(t.name.startsWith(prefix), `${t.name} prefix`);
    assert.ok(CATEGORIES.includes(t.category), `${t.name} category`);
    assert.ok(!names.has(t.name), `duplicate ${t.name}`);
    assert.ok(!collides(t.name), `${t.name} collides with another tool`);
    names.add(t.name);
    assert.equal(typeof t.title, 'string');
    assert.equal(typeof t.description, 'string');
    assert.ok(t.title.length && t.description.length > 20, `${t.name} text`);
    assert.equal(typeof t.run, 'function');
    assert.ok(t.danger === undefined || typeof t.danger === 'boolean' || typeof t.danger === 'function');
    for (const [k, p] of Object.entries(t.params || {})) {
      assert.ok(['string', 'number', 'integer', 'boolean', 'array'].includes(p.type), `${t.name}.${k} type`);
      assert.equal(typeof p.description, 'string', `${t.name}.${k} description`);
      for (const key of Object.keys(p)) assert.ok(['type', 'description', 'required', 'enum', 'items'].includes(key), `${t.name}.${k}.${key}`);
      if ('required' in p) assert.equal(p.required, true);
    }
  }
  assert.ok(info.every((t) => t.category === 'info'));
  assert.ok(dev.every((t) => t.category === 'dev'));
});

test('destructive dev tools ask for approval; read-only ones do not', () => {
  for (const n of ['dev_git_pull', 'dev_git_commit', 'dev_npm_run', 'dev_free_port']) assert.equal(tool(dev, n).danger, true, n);
  for (const n of ['dev_git_log', 'dev_git_diff', 'dev_git_branches', 'dev_npm_scripts', 'dev_versions', 'dev_cron_explain', 'dev_port_process']) assert.ok(!tool(dev, n).danger, n);
  const http = tool(dev, 'dev_http_request').danger;
  assert.equal(http({ method: 'GET' }), false);
  assert.equal(http({}), false);
  assert.equal(http({ method: 'HEAD' }), false);
  assert.equal(http({ method: 'POST' }), true);
  assert.equal(http({ method: 'delete' }), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-gi-'));
  const gi = tool(dev, 'dev_gitignore').danger;
  assert.equal(gi({ path: dir }), false);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  assert.equal(gi({ path: dir }), true);
  assert.ok(info.every((t) => !t.danger));
});

/* ------------------------------------------------------------ info parsers */

test('moon phase: new moon on 2024-04-08, full moon on 2024-04-23', () => {
  const nm = P.moonPhase(new Date('2024-04-08T18:21:00Z'));
  assert.equal(nm.name, 'Yeni Ay');
  assert.ok(nm.illumination < 1, `illumination ${nm.illumination}`);
  const fm = P.moonPhase(new Date('2024-04-23T23:49:00Z'));
  assert.equal(fm.name, 'Dolunay');
  assert.ok(fm.illumination > 98);
  assert.equal(fm.nextNew.toISOString().slice(0, 10), '2024-05-08');
  const fq = P.moonPhase(new Date('2024-04-15T19:13:00Z'));
  assert.equal(fq.name, 'İlk Dördün');
  assert.ok(Math.abs(fq.illumination - 50) < 6);
  assert.equal(P.moonPhase(new Date('2024-04-01T03:15:00Z')).name, 'Son Dördün');
  assert.equal(nm.nextFull.toISOString().slice(0, 10), '2024-04-23');
});

test('crypto parsers and coin aliases', () => {
  assert.equal(P.coinId('BTC'), 'bitcoin');
  assert.equal(P.coinId('Ethereum'), 'ethereum');
  assert.equal(P.coinId('doge'), 'dogecoin');
  assert.equal(P.coinId('bilinmeyencoin'), null);
  const p = P.parseCryptoPrice({ bitcoin: { try: 4102345.12, try_24h_change: 1.53, usd: 98765.4, usd_24h_change: 1.21 } }, 'bitcoin');
  assert.deepEqual(p, { id: 'bitcoin', try: 4102345.12, usd: 98765.4, tryChange: 1.53, usdChange: 1.21 });
  assert.equal(P.parseCryptoPrice({}, 'bitcoin'), null);
  const top = P.parseCryptoTop([
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 98765, market_cap: 1.95e12, market_cap_rank: 1, price_change_percentage_24h: -0.8 },
    { id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 3456.7, market_cap: 4.1e11, market_cap_rank: 2, price_change_percentage_24h: 2.1 }
  ]);
  assert.equal(top.length, 2);
  assert.equal(top[1].symbol, 'ETH');
  assert.equal(top[0].rank, 1);
  assert.equal(P.pct(-0.8), '-%0,8');
  assert.equal(P.pct(2.1), '+%2,1');
});

test('earthquake GeoJSON parses with Turkish places and relative time', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const geo = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { mag: 4.62, place: '12 km SW of Sindirgi, Turkey', time: now - 2 * 3600000, url: 'https://earthquake.usgs.gov/x', title: 'M 4.6 - 12 km SW of Sindirgi, Turkey' }, geometry: { type: 'Point', coordinates: [28.1, 39.2, 10.3] } },
      { type: 'Feature', properties: { mag: 3.1, place: 'Aegean Sea', time: now - 30 * 60000 }, geometry: { type: 'Point', coordinates: [26.1, 38.9, 7] } }
    ]
  };
  const q = P.parseQuakes(geo, { tz: 'Europe/Istanbul', now });
  assert.equal(q.length, 2);
  assert.equal(q[0].mag, 4.6);
  assert.equal(q[0].place, 'Sindirgi, Türkiye (12 km GB)');
  assert.equal(q[0].depth, 10);
  assert.equal(q[0].ago, '2 sa önce');
  assert.match(q[0].when, /13:00/);
  assert.equal(q[1].place, 'Ege Denizi');
  assert.equal(q[1].ago, '30 dk önce');
  assert.equal(P.trPlace('5 km NNE of Elbistan, Türkiye'), 'Elbistan, Türkiye (5 km KKD)');
});

test('prayer times (Diyanet) parse and find the next prayer', () => {
  const json = {
    code: 200, status: 'OK',
    data: {
      timings: { Fajr: '05:48', Sunrise: '07:12', Dhuhr: '13:04', Asr: '16:12', Sunset: '18:46', Maghrib: '18:46', Isha: '20:05', Imsak: '05:38', Midnight: '00:59' },
      date: { readable: '14 Oct 2026', gregorian: { date: '14-10-2026' }, hijri: { date: '03-05-1448', day: '3', month: { number: 5, en: 'Jumādá al-ūlá' }, year: '1448' } },
      meta: { timezone: 'Europe/Istanbul', method: { id: 13 } }
    }
  };
  const p = P.parsePrayer(json, '14:30');
  assert.deepEqual(p.times.map((t) => t.name), ['İmsak', 'Güneş', 'Öğle', 'İkindi', 'Akşam', 'Yatsı']);
  assert.equal(p.times[0].time, '05:48');
  assert.equal(p.next.name, 'İkindi');
  assert.equal(p.next.inMin, 102);
  assert.equal(p.hijri, '3 Cemaziyelevvel 1448');
  const late = P.parsePrayer(json, '22:00');
  assert.equal(late.next.name, 'İmsak');
  assert.equal(late.next.tomorrow, true);
  assert.equal(late.next.inMin, 2 * 60 + 5 * 60 + 48);
  assert.equal(P.parsePrayer({ code: 400 }), null);
});

test('open-meteo extras: sun, air quality, UV and rain', () => {
  const sun = P.parseSun({ daily: { time: ['2026-10-14'], sunrise: ['2026-10-14T07:12'], sunset: ['2026-10-14T18:46'], daylight_duration: [41664.2] } });
  assert.deepEqual(sun[0], { day: '2026-10-14', sunrise: '07:12', sunset: '18:46', daylight: 41664.2 });

  const air = P.parseAir({ current: { time: '2026-10-14T12:00', european_aqi: 47, pm2_5: 18.4, pm10: 31.2, nitrogen_dioxide: 22.1, ozone: 60 } });
  assert.equal(air.label, 'Orta');
  assert.equal(air.pm25, 18.4);
  assert.equal(P.aqiCategory(12).label, 'İyi');
  assert.equal(P.aqiCategory(85).label, 'Çok kötü');
  assert.equal(P.aqiCategory(140).label, 'Son derece kötü');

  const uv = P.parseUv({ current: { uv_index: 3.25 }, daily: { uv_index_max: [6.8] } });
  assert.equal(uv.now, 3.3);
  assert.equal(uv.cat.label, 'Orta');
  assert.equal(uv.maxCat.label, 'Yüksek');
  assert.equal(P.uvCategory(11.2).label, 'Aşırı');

  const times = Array.from({ length: 24 }, (_, i) => `2026-10-14T${String(i).padStart(2, '0')}:00`);
  const probs = times.map((_, i) => (i >= 15 && i <= 17 ? 70 : 5));
  const mm = times.map((_, i) => (i === 16 ? 1.4 : 0));
  const rain = P.parseRain({ current: { time: '2026-10-14T10:15' }, hourly: { time: times, precipitation_probability: probs, precipitation: mm } }, 12);
  assert.equal(rain.list.length, 12);
  assert.equal(rain.list[0].time, '10:00');
  assert.equal(rain.verdict, 'yes');
  assert.equal(rain.max, 70);
  assert.deepEqual(rain.wet.map((x) => x.time), ['15:00', '16:00', '17:00']);
  const dry = P.parseRain({ current: { time: '2026-10-14T10:00' }, hourly: { time: times, precipitation_probability: times.map(() => 10), precipitation: times.map(() => 0) } }, 6);
  assert.equal(dry.verdict, 'no');
});

test('holidays, country and IP parsers', () => {
  const hol = [
    { date: '2026-01-01', localName: 'Yılbaşı', name: "New Year's Day", countryCode: 'TR' },
    { date: '2026-10-29', localName: 'Cumhuriyet Bayramı', name: 'Republic Day', countryCode: 'TR' },
    { date: '2026-05-19', localName: 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı', name: 'Youth Day', countryCode: 'TR' }
  ];
  const up = P.parseHolidays(hol, '2026-10-14');
  assert.equal(up.length, 1);
  assert.equal(up[0].name, 'Cumhuriyet Bayramı');
  assert.equal(up[0].days, 15);

  const de = P.parseCountry([{
    name: { common: 'Germany', official: 'Federal Republic of Germany' }, cca2: 'DE', cca3: 'DEU', capital: ['Berlin'], region: 'Europe', subregion: 'Western Europe',
    population: 83240525, area: 357114, languages: { deu: 'German' }, currencies: { EUR: { name: 'Euro', symbol: '€' } }, timezones: ['UTC+01:00'],
    idd: { root: '+4', suffixes: ['9'] }, tld: ['.de'], car: { side: 'right' }, borders: ['AUT', 'BEL', 'CZE'], translations: { tur: { common: 'Almanya', official: 'Almanya Federal Cumhuriyeti' } }
  }], 'Almanya');
  assert.equal(de.name, 'Almanya');
  assert.equal(de.capital, 'Berlin');
  assert.equal(de.callingCode, '+49');
  assert.equal(de.currencies, 'Euro (EUR, €)');
  assert.equal(de.drives, 'Sağ');
  assert.equal(de.borders, 3);

  const ip = P.parseIp({ ip: '8.8.8.8', success: true, type: 'IPv4', country: 'Amerika Birleşik Devletleri', country_code: 'US', region: 'California', city: 'Mountain View', latitude: 37.42, longitude: -122.08, connection: { asn: 15169, org: 'Google LLC', isp: 'Google LLC' }, timezone: { id: 'America/Los_Angeles', utc: '-07:00' } });
  assert.equal(ip.city, 'Mountain View');
  assert.equal(ip.isp, 'Google LLC');
  assert.equal(ip.tz, 'America/Los_Angeles');
  assert.deepEqual(P.parseIp({ success: false, message: 'Invalid IP address' }), { error: 'Invalid IP address' });
  const alt = P.parseIp({ ip: '1.1.1.1', city: 'Sydney', region: 'New South Wales', country_name: 'Australia', country_code: 'AU', org: 'CLOUDFLARENET', asn: 'AS13335', timezone: 'Australia/Sydney' });
  assert.equal(alt.asn, '13335');
  assert.equal(alt.country, 'Australia');
  assert.ok(P.isPrivateIp('192.168.1.10'));
  assert.ok(P.isPrivateIp('172.20.0.1'));
  assert.ok(!P.isPrivateIp('8.8.8.8'));
});

test('dictionary and Wikipedia parsers', () => {
  const d = P.parseDictionary([{
    word: 'serendipity', phonetic: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', phonetics: [{ text: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', audio: 'https://x/serendipity.mp3' }],
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'An unsought, unintended, and/or unexpected discovery.', example: 'It was pure serendipity.', synonyms: ['chance'] }], synonyms: ['luck'] }]
  }]);
  assert.equal(d.word, 'serendipity');
  assert.equal(d.meanings[0].pos, 'isim');
  assert.deepEqual(d.meanings[0].synonyms, ['luck', 'chance']);
  assert.equal(d.audio, 'https://x/serendipity.mp3');

  const otd = P.parseOnThisDay({ events: [
    { text: 'Hastings Muharebesi.', year: 1066, pages: [{ content_urls: { desktop: { page: 'https://tr.wikipedia.org/wiki/Hastings_Muharebesi' } } }] },
    { text: 'Olay B', year: 1947, pages: [] },
    { text: 'Olay C', year: 2012 }
  ] }, 'events', 8);
  assert.deepEqual(otd.map((e) => e.year), [2012, 1947, 1066]);
  assert.match(otd[2].url, /Hastings/);
  const many = P.parseOnThisDay({ births: Array.from({ length: 40 }, (_, i) => ({ text: `K${i}`, year: 1500 + i * 10 })) }, 'births', 8);
  assert.equal(many.length, 8);
  assert.equal(many[0].year, 1890);

  const s = P.parseWikiSearch({ query: { searchinfo: { totalhits: 1234 }, search: [{ ns: 0, title: 'Mustafa Kemal Atatürk', pageid: 1, wordcount: 25000, snippet: '<span class="searchmatch">Atatürk</span> &quot;Gazi&quot;', timestamp: '2026-10-01T00:00:00Z' }] } });
  assert.equal(s.total, 1234);
  assert.equal(s.items[0].snippet, 'Atatürk "Gazi"');
  assert.equal(s.items[0].url, 'https://tr.wikipedia.org/wiki/Mustafa_Kemal_Atat%C3%BCrk');
  const w = P.parseWikiSummary({ title: 'Kedi', description: 'evcil hayvan', extract: 'Kedi, ...', thumbnail: { source: 'https://img/k.jpg' }, content_urls: { desktop: { page: 'https://tr.wikipedia.org/wiki/Kedi' } } });
  assert.equal(w.image, 'https://img/k.jpg');
});

test('registry parsers: GitHub, npm, PyPI', () => {
  assert.deepEqual(P.parseRepoRef('nodejs/node'), { owner: 'nodejs', repo: 'node' });
  assert.deepEqual(P.parseRepoRef('https://github.com/facebook/react.git'), { owner: 'facebook', repo: 'react' });
  assert.deepEqual(P.parseRepoRef('github.com/a-b/c.d/tree/main/src'), { owner: 'a-b', repo: 'c.d' });
  assert.equal(P.parseRepoRef('sadece-isim'), null);

  const r = P.parseGithubRepo({ full_name: 'nodejs/node', description: 'Node.js JavaScript runtime', html_url: 'https://github.com/nodejs/node', stargazers_count: 108000, forks_count: 29000, open_issues_count: 1700, subscribers_count: 2900, language: 'JavaScript', license: { spdx_id: 'NOASSERTION', name: 'Other' }, default_branch: 'main', created_at: '2014-11-26T19:57:11Z', pushed_at: '2026-10-14T08:00:00Z', topics: ['nodejs', 'javascript'], archived: false });
  assert.equal(r.stars, 108000);
  assert.equal(r.license, 'Other');
  assert.equal(r.watchers, 2900);

  const u = P.parseGithubUser({ login: 'torvalds', name: 'Linus Torvalds', public_repos: 8, followers: 230000, following: 0, html_url: 'https://github.com/torvalds', created_at: '2011-09-03T15:26:22Z' },
    [{ name: 'linux', stargazers_count: 190000, fork: false }, { name: 'subsurface', stargazers_count: 2600, fork: false }, { name: 'forked', stargazers_count: 999999, fork: true }]);
  assert.deepEqual(u.top.map((x) => x.name), ['linux', 'subsurface']);

  const n = P.parseNpm({ name: 'express', version: '5.1.0', description: 'Fast, unopinionated, minimalist web framework', license: 'MIT', repository: { type: 'git', url: 'git+https://github.com/expressjs/express.git' }, dependencies: { a: '1', b: '2' }, engines: { node: '>= 18' } }, { downloads: 51234567, start: '2026-10-07', end: '2026-10-13', package: 'express' });
  assert.equal(n.repo, 'https://github.com/expressjs/express');
  assert.equal(n.deps, 2);
  assert.equal(n.weekly, 51234567);

  const py = P.parsePypi({ info: { name: 'requests', version: '2.32.5', summary: 'Python HTTP for Humans.', author: 'Kenneth Reitz', license: 'Apache-2.0', requires_python: '>=3.9', home_page: 'https://requests.readthedocs.io', package_url: 'https://pypi.org/project/requests/' }, releases: { '2.32.4': [], '2.32.5': [{ upload_time_iso_8601: '2025-08-18T20:46:00.542304Z' }] }, urls: [{ upload_time_iso_8601: '2025-08-18T20:46:00.542304Z' }] });
  assert.equal(py.version, '2.32.5');
  assert.equal(py.license, 'Apache-2.0');
  assert.equal(py.versions, 2);
  assert.equal(py.released.slice(0, 10), '2025-08-18');
});

test('feed parsers: Hacker News, Reddit, Open Library', () => {
  const hn = P.parseHn([{ id: 1, title: 'Show HN: X', url: 'https://www.example.com/a', score: 321, descendants: 45, by: 'pg', time: 1760000000 }, { id: 2, deleted: true }, null, { id: 3, title: 'Ask HN: Y?', score: 10, by: 'a', time: 1760000000 }]);
  assert.equal(hn.length, 2);
  assert.equal(hn[0].host, 'example.com');
  assert.equal(hn[1].url, 'https://news.ycombinator.com/item?id=3');

  const red = P.parseReddit({ data: { children: [
    { kind: 't3', data: { title: 'Sabitlenmiş', stickied: true, subreddit: 'turkey', permalink: '/r/turkey/1', score: 1, num_comments: 0 } },
    { kind: 't3', data: { title: 'Kapadokya &amp; balonlar', subreddit: 'turkey', subreddit_name_prefixed: 'r/turkey', permalink: '/r/turkey/comments/abc/x/', score: 1520, num_comments: 87, author: 'ali', over_18: false } },
    { kind: 't3', data: { title: 'nsfw', subreddit: 'x', permalink: '/r/x/2', over_18: true } }
  ] } });
  assert.equal(red.length, 1);
  assert.equal(red[0].title, 'Kapadokya & balonlar');
  assert.equal(red[0].url, 'https://www.reddit.com/r/turkey/comments/abc/x/');

  const b = P.parseBooks({ numFound: 2, docs: [{ key: '/works/OL45883W', title: 'Tutunamayanlar', author_name: ['Oğuz Atay'], first_publish_year: 1972, edition_count: 12, number_of_pages_median: 724, ratings_average: 4.66 }] });
  assert.equal(b.items[0].url, 'https://openlibrary.org/works/OL45883W');
  assert.equal(b.items[0].rating, 4.7);
});

test('domain, certificate, header, rate and speed parsers', () => {
  assert.equal(P.cleanDomain('https://www.Example.com/path?q=1'), 'example.com');
  assert.match(P.cleanDomain('çiçek.com.tr'), /^xn--[a-z0-9-]+\.com\.tr$/);
  assert.throws(() => P.cleanDomain('not a domain'), ToolError);

  const now = Date.parse('2026-10-14T00:00:00Z');
  const rd = P.parseRdap({
    objectClassName: 'domain', ldhName: 'GOOGLE.COM', status: ['client delete prohibited', 'client transfer prohibited'],
    events: [{ eventAction: 'registration', eventDate: '1997-09-15T04:00:00Z' }, { eventAction: 'expiration', eventDate: '2028-09-14T04:00:00Z' }, { eventAction: 'last changed', eventDate: '2019-09-09T15:39:04Z' }],
    entities: [{ objectClassName: 'entity', roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'MarkMonitor Inc.']]] }],
    nameservers: [{ ldhName: 'NS1.GOOGLE.COM' }, { ldhName: 'NS2.GOOGLE.COM' }], secureDNS: { delegationSigned: false }
  }, now);
  assert.equal(rd.domain, 'google.com');
  assert.equal(rd.registrar, 'MarkMonitor Inc.');
  assert.equal(rd.daysLeft, 701);
  assert.deepEqual(rd.nameservers, ['ns1.google.com', 'ns2.google.com']);
  assert.equal(rd.dnssec, false);

  const cert = P.parseCert({ subject: { CN: '*.example.com' }, issuer: { C: 'US', O: "Let's Encrypt", CN: 'R11' }, valid_from: 'Sep  1 00:00:00 2026 GMT', valid_to: 'Nov 30 23:59:59 2026 GMT', subjectaltname: 'DNS:*.example.com, DNS:example.com', fingerprint256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99' }, { authorized: true, now });
  assert.equal(cert.subject, '*.example.com');
  assert.equal(cert.issuer, "Let's Encrypt · R11");
  assert.equal(cert.daysLeft, 47);
  assert.deepEqual(cert.names, ['*.example.com', 'example.com']);

  const h = P.parseHeaders([['Content-Type', 'text/html; charset=utf-8'], ['Server', 'nginx'], ['Strict-Transport-Security', 'max-age=63072000'], ['Set-Cookie', 'a=1; Path=/'], ['Set-Cookie', 'b=2; Path=/'], ['X-Custom', 'z']]);
  assert.deepEqual(h.rows.map((r) => r[0]), ['content-type', 'server', 'strict-transport-security']);
  assert.deepEqual(h.missing, ['CSP', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']);
  assert.equal(h.cookies, 2);

  const hist = P.parseRateHistory({ amount: 1, base: 'USD', start_date: '2026-09-14', end_date: '2026-10-14', rates: { '2026-10-14': { TRY: 42.1 }, '2026-09-15': { TRY: 41.2 }, '2026-09-30': { TRY: 41.0 }, '2026-10-07': { TRY: 42.4 } } }, 'TRY');
  assert.equal(hist.first.date, '2026-09-15');
  assert.equal(hist.last.rate, 42.1);
  assert.equal(hist.min.rate, 41.0);
  assert.equal(hist.max.date, '2026-10-07');
  assert.ok(Math.abs(hist.change - 2.1845) < 0.001);
  assert.equal(hist.sample[hist.sample.length - 1].date, '2026-10-14');
  assert.equal(P.parseRateHistory({ rates: {} }, 'TRY'), null);

  assert.equal(P.mbps(25e6, 2000), 100);
  assert.equal(P.mbps(5e6, 4000), 10);
  assert.equal(P.mbps(1, 0), 0);
});

/* ------------------------------------------------------- info run() offline */

test('network tools run end-to-end against mocked APIs', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const m = mockFetch([
    [/coingecko\.com\/api\/v3\/simple\/price/, { bitcoin: { try: 4102345.12, try_24h_change: 1.5, usd: 98765.4, usd_24h_change: 1.2 } }],
    [/earthquake\.usgs\.gov/, { features: [{ properties: { mag: 4.1, place: '8 km E of Sindirgi, Turkey', time: Date.now() - 600000 }, geometry: { coordinates: [28, 39, 9] } }] }],
    [/api\.aladhan\.com/, { code: 200, data: { timings: { Fajr: '05:48', Sunrise: '07:12', Dhuhr: '13:04', Asr: '16:12', Maghrib: '18:46', Isha: '20:05' }, date: { gregorian: { date: '14-10-2026' } }, meta: { timezone: 'Europe/Istanbul' } } }],
    [/date\.nager\.at\/api\/v3\/PublicHolidays\/\d+\/TR/, (u) => [{ date: `${u.match(/(\d{4})\/TR/)[1]}-10-29`, localName: 'Cumhuriyet Bayramı', name: 'Republic Day' }, { date: `${u.match(/(\d{4})\/TR/)[1]}-12-31`, localName: 'Yılbaşı arifesi', name: 'x' }]],
    [/registry\.npmjs\.org\/express\/latest/, { name: 'express', version: '5.1.0', description: 'Fast web framework', license: 'MIT' }],
    [/api\.npmjs\.org\/downloads/, { downloads: 51234567 }],
    [/api\.github\.com\/repos\/nope\/nope/, { status: 404, body: { message: 'Not Found' } }],
    [/api\.dictionaryapi\.dev/, { status: 404, body: { title: 'No Definitions Found' } }],
    [/api\.frankfurter\.app/, { rates: { '2026-09-15': { TRY: 41.2 }, '2026-10-14': { TRY: 42.1 } } }],
    [/is\.gd\/create\.php/, { shorturl: 'https://is.gd/AbC123' }],
    [/api\.qrserver\.com/, { body: png, headers: { 'content-type': 'image/png' } }],
    [/geocoding-api\.open-meteo\.com/, { results: [{ name: 'Ankara', admin1: 'Ankara', country: 'Türkiye', latitude: 39.92, longitude: 32.85 }] }],
    [/air-quality-api\.open-meteo\.com/, { current: { time: '2026-10-14T12:00', european_aqi: 31, pm2_5: 9.8, pm10: 20.4 } }],
    [/^https:\/\/example\.com\/$/, (u, o) => new Response(null, { status: 200, headers: { server: 'ECS', 'content-type': 'text/html', 'x-content-type-options': 'nosniff' } })]
  ]);
  try {
    const run = (n, a) => tool(info, n).run(a, ctx);
    const btc = await run('info_crypto_price', { coin: 'btc' });
    assert.match(btc.summary, /^Bitcoin: 4\.102\.345,12 TL \(98\.765,4 \$\), 24 saatte \+%1,2\.$/);
    assert.equal(btc.display.type, 'value');

    const q = await run('info_earthquakes', {});
    assert.match(q.summary, /Türkiye ve çevresinde son 7 günde 1 deprem.*Sindirgi, Türkiye \(8 km D\), büyüklük 4,1, 10 dk önce/);
    assert.match(m.calls.find((c) => /usgs/.test(c.url)).url, /minlatitude=35\.5.*minmagnitude=3|minmagnitude=3.*minlatitude=35\.5/);

    const pr = await run('info_prayer_times', { city: 'Ankara' });
    assert.match(pr.summary, /^Ankara namaz vakitleri: İmsak 05:48, Güneş 07:12, Öğle 13:04/);
    assert.match(m.calls.find((c) => /aladhan/.test(c.url)).url, /method=13/);

    const hol = await run('info_holidays', { limit: 3 });
    assert.equal(hol.display.items.length, 3);

    const npm = await run('info_npm_package', { name: 'express' });
    assert.match(npm.summary, /express 5\.1\.0: Fast web framework\. Haftalık 51\.234\.567 indirme, lisans MIT\./);

    await assert.rejects(run('info_github_repo', { repo: 'nope/nope' }), /nope\/nope deposu bulunamadı/);
    await assert.rejects(run('info_dictionary', { word: 'qwzx' }), /sözlükte bulunamadı/);

    const fx = await run('info_currency_history', {});
    assert.match(fx.summary, /^USD\/TRY son 30 gün: 41,2 → 42,1 \(\+%2,18\)/);

    clip.value = '';
    const short = await run('info_short_link', { url: 'example.com/uzun/bir/adres' });
    assert.equal(short.data.short, 'https://is.gd/AbC123');
    assert.equal(clip.value, 'https://is.gd/AbC123');

    const qr = await run('info_qr_code', { text: 'https://vektor.app' });
    assert.equal(qr.display.type, 'image');
    assert.ok(qr.display.src.startsWith('data:image/png;base64,'));
    assert.equal(Buffer.from(qr.display.src.split(',')[1], 'base64').toString('hex'), png.toString('hex'));
    assert.equal(qr.data.path, null);

    const air = await run('info_air_quality', { city: 'Ankara' });
    assert.match(air.summary, /^Ankara hava kalitesi: Makul \(AQI 31\)/);
    assert.equal(air.display.type, 'stats');
    assert.ok(air.display.items.every((s) => typeof s.value === 'number'));

    const hdr = await run('info_http_headers', { url: 'example.com' });
    assert.match(hdr.summary, /example\.com: HTTP 200/);
    assert.ok(hdr.data.missingSecurity.includes('HSTS'));
    assert.ok(!hdr.data.missingSecurity.includes('X-Content-Type-Options'));

    const moon = await run('info_moon_phase', { date: '2024-04-08' });
    assert.match(moon.summary, /Yeni Ay/);
    await assert.rejects(run('info_moon_phase', { date: 'dün değil' }), /Tarih anlaşılamadı/);
  } finally {
    m.restore();
  }
});

test('input validation rejects bad values before any request', async () => {
  const m = mockFetch([]);
  try {
    await assert.rejects(tool(info, 'info_npm_package').run({ name: 'Bad Name!' }, ctx), /Geçersiz npm/);
    await assert.rejects(tool(info, 'info_reddit').run({ subreddit: 'a b' }, ctx), /Geçersiz subreddit/);
    await assert.rejects(tool(info, 'info_ip_location').run({ ip: '192.168.1.5' }, ctx), /yerel ağ/);
    await assert.rejects(tool(info, 'info_currency_history').run({ from: 'USD', to: 'usd' }, ctx), /aynı olamaz/);
    await assert.rejects(tool(info, 'info_github_repo').run({ repo: 'yalniz' }, ctx), /sahip\/depo/);
    await assert.rejects(tool(dev, 'dev_http_request').run({ url: 'https://x.test', headers_json: '[1,2' }, ctx), /headers_json/);
    await assert.rejects(tool(dev, 'dev_port_process').run({ port: 70000 }, ctx), /1–65535/);
    await assert.rejects(tool(dev, 'dev_gitignore').run({ path: os.tmpdir(), templates: 'node;rm' }, ctx), /Şablon adları/);
    assert.equal(m.calls.length, 0);
  } finally {
    m.restore();
  }
});

/* --------------------------------------------------------------- dev */

test('cron: "*/15 9-17 * * 1-5" explained in Turkish with correct next runs', () => {
  const { text } = D.explainCron('*/15 9-17 * * 1-5');
  assert.match(text, /^Pazartesi–Cuma günleri, 09:00–17:59 arasında, her 15 dakikada bir/);
  const wed = new Date(2026, 9, 14, 8, 0); // Wednesday 08:00 local
  const fmt = (d) => `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.deepEqual(D.nextRuns('*/15 9-17 * * 1-5', wed, 5).map(fmt), ['14 09:00', '14 09:15', '14 09:30', '14 09:45', '14 10:00']);
  const friLate = new Date(2026, 9, 16, 17, 50); // Friday 17:50 → Monday 09:00
  const next = D.nextRuns('*/15 9-17 * * 1-5', friLate, 2);
  assert.equal(next[0].getDay(), 1);
  assert.deepEqual(next.map(fmt), ['19 09:00', '19 09:15']);
  const lastSlot = D.nextRuns('*/15 9-17 * * 1-5', new Date(2026, 9, 14, 17, 30), 1)[0];
  assert.equal(fmt(lastSlot), '14 17:45');
});

test('cron: other forms, macros, names and errors', () => {
  assert.equal(D.explainCron('0 9 * * *').text, 'Her gün, saat 09:00');
  assert.equal(D.explainCron('* * * * *').text, 'Her dakika');
  assert.equal(D.explainCron('0 * * * *').text, 'Her gün, her saat başı');
  assert.equal(D.explainCron('@weekly').text, 'Pazar günleri, saat 00:00');
  assert.equal(D.explainCron('30 2 1 * *').text, 'Ayın 1. günü, saat 02:30');
  assert.match(D.explainCron('5,35 */2 * jan-mar mon,wed,fri').text, /^Ocak–Mart aylarında, Pazartesi, Çarşamba ve Cuma günleri, her 2 saatte bir/);
  assert.equal(D.explainCron('0 12 * * 7').text, 'Pazar günleri, saat 12:00');
  // Day-of-month OR day-of-week when both are restricted.
  const runs = D.nextRuns('0 0 13 * 5', new Date(2026, 0, 1, 0, 0), 4);
  assert.ok(runs.every((d) => d.getDate() === 13 || d.getDay() === 5));
  assert.equal(runs[0].getDate(), 2); // Fri 2 Jan 2026
  // Leap day only.
  const leap = D.nextRuns('0 0 29 2 *', new Date(2026, 0, 1), 1)[0];
  assert.equal(leap.getFullYear(), 2028);
  assert.throws(() => D.explainCron('* * *'), /5 alan/);
  assert.throws(() => D.explainCron('61 * * * *'), /geçersiz değer/);
  assert.throws(() => D.explainCron('*/0 * * * *'), /geçersiz adım/);
  assert.throws(() => D.explainCron('@reboot'), /açılışta/);
});

test('dev_cron_explain tool returns list card with next runs', async () => {
  const r = await tool(dev, 'dev_cron_explain').run({ expression: '0 9 * * 1', count: 3 }, ctx);
  assert.match(r.summary, /^Pazartesi günleri, saat 09:00\. Sonraki çalışma: .*Pazartesi, 09:00\.$/);
  assert.equal(r.display.items.length, 3);
  assert.equal(r.data.next.length, 3);
});

test('dev output parsers: git, lsof, ss, versions, docker, json paths', () => {
  const now = 1760443200000;
  const log = D.parseGitLog(`a1b2c3d\x1fAyşe\x1f${now / 1000 - 7200}\x1fİlk özellik\nd4e5f6a\x1fMehmet\x1f${now / 1000 - 86400 * 3}\x1fFix: a\x1fb`, now);
  assert.deepEqual(log.map((c) => [c.hash, c.author, c.when]), [['a1b2c3d', 'Ayşe', '2 sa önce'], ['d4e5f6a', 'Mehmet', '3 gün önce']]);
  assert.equal(log[1].subject, 'Fix: a\x1fb');

  const ns = D.parseNumstat('10\t2\tsrc/a.js\n-\t-\tlogo.png\n0\t5\tREADME.md\n');
  assert.equal(ns.files.length, 3);
  assert.equal(ns.added, 10);
  assert.equal(ns.removed, 7);
  assert.equal(ns.files[1].binary, true);

  const br = D.parseBranches([
    `*\x1frefs/heads/main\x1f${now / 1000 - 60}\x1f[ahead 2, behind 1]\x1f\x1fSon commit`,
    ` \x1frefs/heads/feature/x\x1f${now / 1000 - 86400}\x1f\x1f\x1fWIP`,
    ` \x1frefs/remotes/origin/HEAD\x1f${now / 1000}\x1f\x1frefs/remotes/origin/main\x1f`,
    ` \x1frefs/remotes/origin/main\x1f${now / 1000 - 120}\x1f\x1f\x1fSon commit`
  ].join('\n'), now);
  assert.equal(br.current, 'main');
  assert.deepEqual(br.local.map((b) => b.name), ['main', 'feature/x']);
  assert.deepEqual(br.remote.map((b) => b.name), ['origin/main']);
  assert.equal(br.local[0].track, '2 ileride, 1 geride');
  assert.equal(br.local[0].when, '1 dk önce');

  const lsof = D.parseLsof([
    'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'node    41235 kadir   23u  IPv6 0x1234      0t0  TCP *:3000 (LISTEN)',
    'node    41235 kadir   25u  IPv6 0x1235      0t0  TCP [::1]:3000->[::1]:52344 (ESTABLISHED)',
    'Google  50001 kadir   40u  IPv6 0x1236      0t0  TCP [::1]:52344->[::1]:3000 (ESTABLISHED)'
  ].join('\n'), 3000);
  assert.deepEqual(lsof.map((p) => [p.pid, p.name, p.state]), [[41235, 'node', 'LISTEN']]);

  const ss = D.parseSs('LISTEN 0      511          0.0.0.0:5173      0.0.0.0:*    users:(("node",pid=7788,fd=21))\nESTAB 0 0 127.0.0.1:40000 127.0.0.1:5173 users:(("curl",pid=9,fd=3))', 5173);
  assert.deepEqual(ss, [{ pid: 7788, name: 'node', state: 'LISTEN', local: '0.0.0.0:5173' }]);

  assert.equal(D.parseVersion('v22.11.0'), '22.11.0');
  assert.equal(D.parseVersion('git version 2.47.1.windows.1'), '2.47.1');
  assert.equal(D.parseVersion('Picked up JAVA_TOOL_OPTIONS: -Dproxy=127.0.0.1\nopenjdk version "21.0.5" 2024-10-15'), '21.0.5');
  assert.equal(D.parseVersion('Docker version 27.3.1, build ce12230'), '27.3.1');
  assert.equal(D.parseVersion('Python 3.12.7'), '3.12.7');
  assert.equal(D.parseVersion('go version go1.23.2 windows/amd64'), '1.23.2');
  assert.equal(D.parseVersion('Python was not found'), null);

  const dk = D.parseDockerPs('{"Command":"\\"docker-entrypoint.s…\\"","CreatedAt":"2026-10-14 10:00:00 +0300 +03","ID":"abc123","Image":"postgres:16","Names":"db","Ports":"0.0.0.0:5432->5432/tcp","State":"running","Status":"Up 2 hours"}\nnot json\n{"ID":"def","Image":"redis:7","Names":"cache","Ports":"","Status":"Exited (0) 3 days ago"}');
  assert.deepEqual(dk.map((c) => [c.name, c.image, c.state]), [['db', 'postgres:16', 'running'], ['cache', 'redis:7', 'exited']]);

  assert.deepEqual(D.parsePackageScripts('{"name":"x","scripts":{"build":"tsc","test":"node --test"}}').scripts.map((s) => s.name), ['build', 'test']);
  assert.throws(() => D.parsePackageScripts('{bad'), /geçersiz JSON/);
  const obj = { data: { items: [{ name: 'a' }, { name: 'b' }] } };
  assert.equal(D.pickPath(obj, 'data.items[1].name'), 'b');
  assert.equal(D.pickPath(obj, 'data.items.0.name'), 'a');
  assert.throws(() => D.pickPath(obj, 'data.nope'), /bulunamadı/);
  assert.equal(D.describeJson([1, 2, 3]), 'dizi, 3 öğe');
  assert.match(D.describeJson({ a: 1, b: 2 }), /nesne, 2 anahtar: a, b/);
});

test('git tools work on a real temporary repository', async (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('git yok'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-git-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@e.st', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@e.st' } });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 't@e.st');
  g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'bir\niki\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'deneme', version: '1.0.0', scripts: { hello: 'node -e "console.log(\'merhaba vektor\')"', fail: 'node -e "process.exit(3)"' } }));
  g('add', '-A');
  g('commit', '-q', '-m', 'İlk commit');
  g('branch', 'ozellik');

  const run = (n, a) => tool(dev, n).run(a, ctx);
  const log = await run('dev_git_log', { path: dir });
  assert.match(log.summary, /Son 1 commit.*İlk commit.*Test/);

  const clean = await run('dev_git_diff', { path: dir });
  assert.match(clean.summary, /temiz/);
  fs.appendFileSync(path.join(dir, 'a.txt'), 'üç\n');
  fs.writeFileSync(path.join(dir, 'yeni.md'), '# yeni\n');
  const diff = await run('dev_git_diff', { path: dir });
  assert.match(diff.summary, /^1 dosya değişti \(\+1 −0 satır\), 1 yeni \(izlenmeyen\) dosya\.$/);

  const br = await run('dev_git_branches', { path: dir });
  assert.equal(br.data.current, 'main');
  assert.deepEqual([...br.data.local].sort(), ['main', 'ozellik']);

  await assert.rejects(run('dev_git_commit', { path: dir, message: 'hiçbir şey' }), /sahnelenmiş değişiklik yok/);
  const c = await run('dev_git_commit', { path: dir, message: 'İkinci commit', all: true });
  assert.match(c.summary, /^Commit [0-9a-f]{7,} oluşturuldu: “İkinci commit” \(2 dosya, \+2 −0\)\.$/);
  assert.match((await run('dev_git_log', { path: dir })).data[0], /İkinci commit/);

  const scripts = await run('dev_npm_scripts', { path: dir });
  assert.match(scripts.summary, /deneme scriptleri: hello, fail\./);
  await assert.rejects(run('dev_npm_run', { path: dir, script: 'yok' }), /“yok” scripti yok/);

  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-norepo-'));
  await assert.rejects(run('dev_git_log', { path: notRepo }), /git deposu değil/);
});

test('npm run executes a script and reports exit codes', async (t) => {
  try { execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }); } catch { t.skip('npm yok'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-npm-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'deneme', version: '1.0.0', scripts: { hello: 'node -e "console.log(123+456)"', fail: 'node -e "process.exit(3)"' } }));
  const ok = await tool(dev, 'dev_npm_run').run({ path: dir, script: 'hello' }, ctx);
  assert.equal(ok.display.type, 'terminal');
  assert.equal(ok.display.code, 0);
  assert.match(ok.display.output, /579/);
  assert.match(ok.summary, /başarıyla bitti/);
  const bad = await tool(dev, 'dev_npm_run').run({ path: dir, script: 'fail' }, ctx);
  assert.notEqual(bad.display.code, 0);
  assert.match(bad.summary, /hata ile bitti/);
});

test('gitignore writes the fetched template; http request pretty-prints JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-gi2-'));
  const m = mockFetch([
    [/toptal\.com\/developers\/gitignore\/api\/node,windows$/, { body: '# Created by https://www.toptal.com/developers/gitignore/api/node,windows\n\n### Node ###\nnode_modules/\nnpm-debug.log*\n\n### Windows ###\nThumbs.db\n', headers: { 'content-type': 'text/plain' } }],
    [/toptal\.com\/developers\/gitignore\/api\/nodee$/, { status: 404, body: '\n#!! ERROR: nodee is undefined. Use list command to see defined gitignore types !!#\n', headers: { 'content-type': 'text/plain' } }],
    [/api\.test\/items/, (u, o) => ({ status: o.method === 'POST' ? 201 : 200, body: { ok: true, method: o.method, echo: o.body ? JSON.parse(o.body) : null } })]
  ]);
  try {
    const r = await tool(dev, 'dev_gitignore').run({ path: dir, templates: 'node, windows' }, ctx);
    assert.equal(r.data.rules, 3);
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /node_modules\//);
    assert.match(r.summary, /oluşturuldu/);
    await assert.rejects(tool(dev, 'dev_gitignore').run({ path: dir, templates: 'nodee' }, ctx), /Tanımsız şablon: nodee/);

    const post = await tool(dev, 'dev_http_request').run({ url: 'https://api.test/items', method: 'POST', body: '{"ad":"Vektör"}' }, ctx);
    assert.equal(post.data.status, 201);
    assert.match(post.data.body, /"ad": "Vektör"/);
    assert.equal(m.calls.at(-1).opts.headers['Content-Type'], 'application/json');
    const j = await tool(dev, 'dev_fetch_json').run({ url: 'https://api.test/items', pick: 'echo' }, ctx);
    assert.match(j.summary, /api\.test → echo: object|api\.test → echo/);
  } finally {
    m.restore();
  }
});
