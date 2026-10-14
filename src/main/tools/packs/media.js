'use strict';

/*
 * Media pack: relative volume, stop, Spotify / radio / podcast shortcuts, text-to-speech,
 * now-playing detection and a sleep timer. Play/pause/next/previous live in desktop.js.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isWin, isMac, ToolError, run, ps, psJson, psStr, openUri, linkResult, listResult, asArray, truncate } = require('./kit');
const { winNative, osa, hasBin, linuxFirst, fetchWithTimeout } = require('../util');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/* ------------------------------------------------------------- volume */

async function readLevel() {
  if (isMac) return Number((await osa('output volume of (get volume settings)')).trim());
  if (await hasBin('pactl')) return Number(((await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'])).match(/(\d+)%/) || [])[1]);
  return Number(((await run('amixer', ['get', 'Master'])).match(/\[(\d+)%\]/) || [])[1]);
}

/** Changes the volume by `delta` percent; returns the new level when it can be read. */
async function stepVolume(delta) {
  const up = delta > 0;
  const n = Math.abs(delta);
  if (isWin) {
    // Media volume keys move 2% each and show the Windows volume flyout.
    const presses = Math.max(1, Math.round(n / 2));
    const out = await winNative(`1..${presses} | ForEach-Object { [Vektor.Input]::Combo('${up ? 0xAF : 0xAE}'); Start-Sleep -Milliseconds 15 }; [Vektor.Audio]::GetVolume()`);
    const level = Number(out.trim().split('\n').pop());
    return Number.isFinite(level) ? level : null;
  }
  if (isMac) {
    const out = await osa(`set v to (output volume of (get volume settings)) ${up ? '+' : '-'} ${n}\nif v < 0 then set v to 0\nif v > 100 then set v to 100\nset volume output volume v\n${up ? 'set volume without output muted\n' : ''}return v`);
    return Number(out.trim());
  }
  await linuxFirst([
    ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${up ? '+' : '-'}${n}%`]],
    ['amixer', ['-q', 'sset', 'Master', `${n}%${up ? '+' : '-'}`]]
  ]);
  const level = await readLevel().catch(() => null);
  return Number.isFinite(level) ? Math.min(level, 150) : null;
}

function volumeTool(name, title, description, sign) {
  return {
    name,
    category: 'media',
    title,
    description,
    params: { step: { type: 'integer', description: 'Kaç puan (yüzde) değişsin, 1–100. Varsayılan 10.' } },
    run: async (a) => {
      const step = clampInt(a.step, 1, 100, 10);
      const level = await stepVolume(sign * step);
      const verb = sign > 0 ? 'artırıldı' : 'azaltıldı';
      if (level == null) return { summary: `Ses %${step} ${verb}.`, display: { type: 'value', label: 'Ses', value: `${sign > 0 ? '+' : '-'}${step}`, icon: 'volume' }, data: { step } };
      return { summary: `Ses %${step} ${verb}; şu an %${level}.`, display: { type: 'level', label: 'Ses', value: level, icon: 'volume' }, data: { step, level } };
    }
  };
}

/* ------------------------------------------------------- stop playback */

/** Stops (pauses) whatever is playing. Returns a short description of what was done. */
async function stopPlayback() {
  if (isWin) {
    await winNative(`[Vektor.Input]::Combo('${0xB2}')`);
    return 'Durdur tuşu gönderildi';
  }
  if (isMac) {
    const procs = (await osa('tell application "System Events" to get name of every process whose background only is false')).split(/,\s*/).map((s) => s.trim());
    const stopped = [];
    for (const app of ['Spotify', 'Music']) {
      if (!procs.includes(app)) continue;
      await osa(`tell application "${app}" to pause`).then(() => stopped.push(app)).catch(() => {});
    }
    if (!stopped.length) throw new ToolError('Durdurulacak bir Spotify ya da Müzik oynatıcısı bulunamadı.', 'Tarayıcıdaki videoyu durdurmak için media_play_pause kullan.');
    return `${stopped.join(' ve ')} duraklatıldı`;
  }
  if (await hasBin('playerctl')) {
    await run('playerctl', ['-a', 'pause']);
    return 'Tüm oynatıcılar duraklatıldı';
  }
  await linuxFirst([['xdotool', ['key', 'XF86AudioStop']]]);
  return 'Durdur tuşu gönderildi';
}

/* ------------------------------------------------------------- Spotify */

async function hasSpotifyApp() {
  try {
    if (isWin) {
      const out = await ps("if ((Test-Path 'Registry::HKEY_CLASSES_ROOT\\spotify') -or (Get-AppxPackage -Name '*Spotify*' -ErrorAction SilentlyContinue)) { '1' } else { '0' }", { timeout: 15000 });
      return out.trim() === '1';
    }
    if (isMac) return ['/Applications/Spotify.app', path.join(os.homedir(), 'Applications', 'Spotify.app')].some((p) => fs.existsSync(p));
    return !!(await run('xdg-mime', ['query', 'default', 'x-scheme-handler/spotify'], { timeout: 5000 })).trim();
  } catch {
    return false;
  }
}

/** Opens a Spotify search in the desktop app when installed, otherwise on the web player. */
async function openSpotifySearch(ctx, query, kind) {
  const q = String(query || '').trim();
  if (!q) throw new ToolError('Aranacak bir şey söylemelisin.');
  if (await hasSpotifyApp()) {
    const uri = `spotify:search:${encodeURIComponent(q)}`;
    await openUri(ctx, uri);
    return { app: true, url: uri };
  }
  const url = `https://open.spotify.com/search/${encodeURIComponent(q)}${kind ? '/' + kind : ''}`;
  await openUri(ctx, url);
  return { app: false, url };
}

/* ------------------------------------------------------------- YouTube */

/** Finds the first video for a search (optionally live only) and returns its watch URL, or the results page. */
async function youtubeFirst(query, live) {
  const results = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${live ? '&sp=EgJAAQ%253D%253D' : ''}`;
  try {
    const res = await fetchWithTimeout(results, { headers: { 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' } }, 12000);
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/) || html.match(/"videoId":"([\w-]{11})"/);
      const t = html.match(/"videoRenderer":\{"videoId":"[\w-]{11}".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
      if (m) return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: t ? JSON.parse(`"${t[1]}"`) : null, direct: true };
    }
  } catch { /* fall back to the results page */ }
  return { url: results, title: null, direct: false };
}

async function playYoutube(ctx, query, live, label) {
  const hit = await youtubeFirst(query, live);
  await openUri(ctx, hit.url);
  const r = linkResult(hit.url, hit.title || label);
  r.summary = hit.direct
    ? `${label} YouTube'da açıldı${hit.title ? `: ${hit.title}` : ''}.`
    : `${label} için YouTube araması açıldı; listeden bir video seçilmeli (click_button ile ilk sonuca tıklanabilir).`;
  r.data = { url: hit.url, title: hit.title, direct: hit.direct };
  return r;
}

/* --------------------------------------------------------------- radio */

const STATIONS = {
  'trt-fm': { label: 'TRT FM', url: 'https://www.trtdinle.com/' },
  'trt-radyo-1': { label: 'TRT Radyo 1', url: 'https://www.trtdinle.com/' },
  'power-fm': { label: 'Power FM', url: 'https://www.powerapp.com.tr/' },
  'kral-pop': { label: 'Kral Pop', url: 'https://www.kralmuzik.com.tr/' },
  'joy-turk': { label: 'Joy Türk', url: 'https://www.joyturk.com.tr/' },
  'best-fm': { label: 'Best FM', url: 'https://www.bestfm.com.tr/' },
  'virgin-radio': { label: 'Virgin Radio Türkiye', url: 'https://www.virginradio.com.tr/' },
  'radyo-fenomen': { label: 'Radyo Fenomen', url: 'https://www.radyofenomen.com/' },
  lofi: { label: 'Lofi Girl (7/24 lofi)', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' }
};

/* ----------------------------------------------------------------- TTS */

async function speak(text, rate) {
  if (isWin) {
    const script = 'Add-Type -AssemblyName System.Speech;'
      + '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;'
      + "$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'tr*' } | Select-Object -First 1;"
      + 'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) };'
      + `$s.Rate = ${rate};`
      + `$s.Speak(${psStr(text)});`
      + '$n = $s.Voice.Name; $s.Dispose(); $n';
    return (await ps(script, { timeout: 170000 })).trim();
  }
  const file = path.join(os.tmpdir(), `vektor-tts-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, text, 'utf8');
  try {
    if (isMac) {
      const voices = await run('say', ['-v', '?']).catch(() => '');
      const tr = (voices.split('\n').find((l) => /\btr[_-]TR\b/.test(l)) || '').match(/^(.+?)\s{2,}/);
      const args = ['-r', String(185 + rate * 25), '-f', file];
      if (tr) args.unshift('-v', tr[1].trim());
      await run('say', args, { timeout: 170000 });
      return tr ? tr[1].trim() : 'varsayılan ses';
    }
    if (await hasBin('spd-say')) {
      // speech-dispatcher keeps talking in the background, so no long wait is needed.
      await run('spd-say', ['-l', 'tr', '-r', String(rate * 20), '--', text]);
      return 'spd-say';
    }
    if (await hasBin('espeak-ng') || await hasBin('espeak')) {
      const bin = (await hasBin('espeak-ng')) ? 'espeak-ng' : 'espeak';
      await run(bin, ['-v', 'tr', '-s', String(175 + rate * 20), '-f', file], { timeout: 170000 });
      return bin;
    }
    throw new ToolError('Sesli okuma için spd-say ya da espeak gerekli.', 'sudo apt install speech-dispatcher espeak-ng');
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

/* ---------------------------------------------------------- now playing */

async function nowPlaying() {
  if (isWin) {
    const script = '$r = @();'
      + "Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -notmatch '^Spotify( Premium| Free)?$' } | ForEach-Object { $r += [pscustomobject]@{ app = 'Spotify'; title = $_.MainWindowTitle } };"
      + "Get-Process chrome, msedge, firefox, brave, opera -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match ' - YouTube( Music)?' } | ForEach-Object { $r += [pscustomobject]@{ app = $_.ProcessName; title = $_.MainWindowTitle } };"
      + '$r';
    return asArray(await psJson(script)).map((x) => {
      const yt = String(x.title).match(/^(?:\(\d+\)\s*)?(.*?)\s+-\s+(YouTube(?: Music)?)\b/);
      return yt ? { app: `${yt[2]} (${x.app})`, title: yt[1] } : { app: x.app, title: String(x.title) };
    });
  }
  if (isMac) {
    const procs = (await osa('tell application "System Events" to get name of every process whose background only is false')).split(/,\s*/).map((s) => s.trim());
    const out = [];
    for (const app of ['Spotify', 'Music']) {
      if (!procs.includes(app)) continue;
      const line = await osa(`tell application "${app}"\nif player state is playing then return (name of current track) & " — " & (artist of current track)\nreturn ""\nend tell`).catch(() => '');
      if (line.trim()) out.push({ app: app === 'Music' ? 'Müzik' : app, title: line.trim() });
    }
    return out;
  }
  if (!(await hasBin('playerctl'))) throw new ToolError('Çalan şarkıyı okumak için playerctl gerekli.', 'sudo apt install playerctl');
  const raw = await run('playerctl', ['-a', 'metadata', '--format', '{{playerName}}\t{{status}}\t{{artist}} - {{title}}']).catch(() => '');
  return raw.split('\n').filter(Boolean).map((l) => l.split('\t')).filter((p) => p[1] === 'Playing').map((p) => ({ app: p[0], title: p[2].replace(/^ - /, '') }));
}

/* --------------------------------------------------------- sleep timer */

let sleepTimer = null;

/* ---------------------------------------------------------------- tools */

module.exports = [
  volumeTool('media_volume_up', 'Sesi artır', 'Sistem sesini belirtilen yüzde kadar artırır (varsayılan 10). "Sesi biraz aç" gibi göreli isteklerde kullan.', 1),
  volumeTool('media_volume_down', 'Sesi azalt', 'Sistem sesini belirtilen yüzde kadar azaltır (varsayılan 10). "Sesi biraz kıs" gibi göreli isteklerde kullan.', -1),
  {
    name: 'media_stop',
    category: 'media',
    title: 'Medyayı durdur',
    description: 'Çalan müziği ya da videoyu durdurur (medya "durdur" tuşu). Devam ettirmek için media_play_pause kullanılır.',
    params: {},
    run: async () => {
      const what = await stopPlayback();
      return { summary: `${what}.`, display: { type: 'value', label: 'Medya', value: 'Durduruldu', detail: what, icon: 'stop' } };
    }
  },
  {
    name: 'media_spotify_search',
    category: 'media',
    title: 'Spotify\'da ara',
    description: 'Spotify\'da şarkı, sanatçı, albüm ya da çalma listesi arar. Uygulama kuruluysa uygulamada, değilse web oynatıcıda açar.',
    params: { query: { type: 'string', description: 'Aranacak şarkı, sanatçı ya da albüm.', required: true } },
    run: async (a, ctx) => {
      const r = await openSpotifySearch(ctx, a.query);
      return {
        summary: `Spotify${r.app ? '' : ' web'}'da "${a.query}" araması açıldı.`,
        display: { type: 'link', url: r.url, title: `Spotify: ${a.query}`, host: r.app ? 'Spotify' : 'open.spotify.com' },
        data: r
      };
    }
  },
  {
    name: 'media_spotify_play',
    category: 'media',
    title: 'Spotify\'da çal',
    description: 'Spotify\'da şarkı ya da sanatçıyı arayıp sonuçları açar. Çalmayı kendisi başlatamazsa ekrandaki "Oynat" düğmesine basılması için ipucu döndürür.',
    params: { query: { type: 'string', description: 'Çalınacak şarkı ya da sanatçı, ör. "Tarkan Kuzu Kuzu".', required: true } },
    run: async (a, ctx) => {
      const r = await openSpotifySearch(ctx, a.query);
      await wait(2500);
      return {
        summary: `Spotify${r.app ? '' : ' web'}'da "${a.query}" sonuçları açıldı. Çalma henüz başlamamış olabilir: başlamadıysa click_button ile "Oynat" ya da "Play" düğmesine bas (üstteki ilk sonuç).`,
        display: { type: 'link', url: r.url, title: `Spotify: ${a.query}`, host: r.app ? 'Spotify' : 'open.spotify.com' },
        data: { ...r, playing: 'unknown', next: 'click_button Oynat/Play' }
      };
    }
  },
  {
    name: 'media_radio',
    category: 'media',
    title: 'Radyo aç',
    description: 'Bir Türk radyo istasyonunun resmi canlı yayın sitesini tarayıcıda açar; ya da 7/24 lofi yayını.',
    params: {
      station: { type: 'string', enum: Object.keys(STATIONS), description: 'İstasyon. Varsayılan trt-fm.' }
    },
    run: async (a, ctx) => {
      const key = a.station && STATIONS[a.station] ? a.station : 'trt-fm';
      const s = STATIONS[key];
      await openUri(ctx, s.url);
      const r = linkResult(s.url, s.label);
      r.summary = `${s.label} canlı yayın sayfası açıldı.${key === 'lofi' ? '' : ' Yayın kendiliğinden başlamazsa sayfadaki çalma düğmesine basılmalı.'}${key.startsWith('trt') ? ` TRT Dinle'de ${s.label} seçilmeli.` : ''}`;
      r.data = { station: key, url: s.url };
      return r;
    }
  },
  {
    name: 'media_podcast_search',
    category: 'media',
    title: 'Podcast ara',
    description: 'Spotify ya da Apple Podcasts\'te podcast arar.',
    params: {
      query: { type: 'string', description: 'Podcast adı ya da konu.', required: true },
      source: { type: 'string', enum: ['spotify', 'apple'], description: 'Nerede aransın. Varsayılan spotify.' }
    },
    run: async (a, ctx) => {
      const q = String(a.query || '').trim();
      if (!q) throw new ToolError('Aranacak podcast adını ya da konusunu söylemelisin.');
      if (a.source === 'apple') {
        const url = `https://podcasts.apple.com/tr/search?term=${encodeURIComponent(q)}`;
        await openUri(ctx, url);
        return { ...linkResult(url, `Apple Podcasts: ${q}`), summary: `Apple Podcasts'te "${q}" araması açıldı.` };
      }
      const r = await openSpotifySearch(ctx, q, 'podcasts');
      return {
        summary: `Spotify${r.app ? '' : ' web'}'da "${q}" podcast araması açıldı.${r.app ? ' Sonuçlarda "Podcast\'ler" sekmesine geçilebilir.' : ''}`,
        display: { type: 'link', url: r.url, title: `Podcast: ${q}`, host: r.app ? 'Spotify' : 'open.spotify.com' },
        data: r
      };
    }
  },
  {
    name: 'media_speak',
    category: 'media',
    title: 'Metni sesli oku',
    description: 'Verilen metni bilgisayarın kendi konuşma sentezleyicisiyle sesli okur (kuruluysa Türkçe ses). Uzun metinleri bilgisayara okutmak için.',
    params: {
      text: { type: 'string', description: 'Okunacak metin (en fazla 5000 karakter).', required: true },
      rate: { type: 'integer', description: 'Konuşma hızı -5 (yavaş) ile 5 (hızlı) arası. Varsayılan 0.' }
    },
    timeout: 180000,
    run: async (a) => {
      const text = String(a.text || '').trim();
      if (!text) throw new ToolError('Okunacak bir metin vermelisin.');
      if (text.length > 5000) throw new ToolError('Metin çok uzun (en fazla 5000 karakter).', 'Metni parçalara bölüp sırayla okut.');
      const rate = clampInt(a.rate, -5, 5, 0);
      const voice = await speak(text, rate);
      return {
        summary: `Metin sesli okundu (${text.length} karakter${voice ? `, ses: ${voice}` : ''}).`,
        display: { type: 'code', title: 'Sesli okundu', text: truncate(text, 1500) },
        data: { voice, chars: text.length, rate }
      };
    }
  },
  {
    name: 'media_white_noise',
    category: 'media',
    title: 'Beyaz gürültü',
    description: 'Uyku ya da odak için uzun bir beyaz / pembe / kahverengi gürültü ya da yağmur sesi videosunu YouTube\'da açar.',
    params: { kind: { type: 'string', enum: ['white', 'pink', 'brown', 'rain', 'ocean'], description: 'Ses türü. Varsayılan white (beyaz gürültü).' } },
    run: async (a, ctx) => {
      const kinds = {
        white: ['white noise 10 hours black screen', 'Beyaz gürültü'],
        pink: ['pink noise 10 hours black screen', 'Pembe gürültü'],
        brown: ['brown noise 10 hours black screen', 'Kahverengi gürültü'],
        rain: ['rain sounds 10 hours black screen', 'Yağmur sesi'],
        ocean: ['ocean waves sounds 10 hours', 'Dalga sesi']
      };
      const [query, label] = kinds[a.kind] || kinds.white;
      return playYoutube(ctx, query, false, label);
    }
  },
  {
    name: 'media_focus_music',
    category: 'media',
    title: 'Odak müziği',
    description: 'Çalışırken dinlemek için canlı lofi / odak müziği yayınını YouTube\'da açar.',
    params: { style: { type: 'string', enum: ['lofi', 'jazz', 'classical', 'ambient'], description: 'Tarz. Varsayılan lofi.' } },
    run: async (a, ctx) => {
      const styles = {
        lofi: ['lofi hip hop radio beats to relax study', 'Lofi odak müziği'],
        jazz: ['jazz study music live', 'Caz odak müziği'],
        classical: ['classical music for studying live', 'Klasik odak müziği'],
        ambient: ['ambient focus music live', 'Ambient odak müziği']
      };
      const [query, label] = styles[a.style] || styles.lofi;
      return playYoutube(ctx, query, true, label);
    }
  },
  {
    name: 'media_now_playing',
    category: 'media',
    title: 'Çalan şarkı',
    description: 'Spotify\'da (macOS\'ta Müzik\'te de) ya da tarayıcıdaki YouTube sekmesinde şu an ne çaldığını söyler.',
    params: {},
    run: async () => {
      const list = await nowPlaying();
      if (!list.length) return { summary: 'Şu an çalan bir şarkı ya da YouTube videosu bulunamadı.', display: { type: 'value', label: 'Çalan', value: 'Hiçbir şey', icon: 'music' }, data: { playing: [] } };
      return listResult(
        `Şu an çalan: ${list.map((x) => `${x.title} (${x.app})`).join('; ')}.`,
        'Şu an çalıyor',
        list.map((x) => ({ title: x.title, subtitle: x.app, icon: 'music' })),
        { playing: list }
      );
    }
  },
  {
    name: 'media_sleep_timer',
    category: 'media',
    title: 'Uyku zamanlayıcısı',
    description: 'Belirtilen dakika sonra çalan müziği / videoyu durdurur. Yeni bir çağrı öncekinin yerini alır; cancel=true iptal eder.',
    params: {
      minutes: { type: 'integer', description: 'Kaç dakika sonra durdurulsun (1–600).' },
      cancel: { type: 'boolean', description: 'true ise kurulu uyku zamanlayıcısını iptal eder.' }
    },
    run: async (a, ctx) => {
      if (a.cancel) {
        if (!sleepTimer) return { summary: 'Kurulu bir uyku zamanlayıcısı yok.', display: { type: 'power', action: 'cancel', label: 'Uyku zamanlayıcısı yok' } };
        clearTimeout(sleepTimer.timer);
        sleepTimer = null;
        return { summary: 'Uyku zamanlayıcısı iptal edildi.', display: { type: 'power', action: 'cancel', label: 'Uyku zamanlayıcısı iptal edildi' } };
      }
      if (a.minutes == null) throw new ToolError('Kaç dakika sonra durdurulacağını söylemelisin.');
      const minutes = clampInt(a.minutes, 1, 600, 30);
      const replaced = !!sleepTimer;
      if (sleepTimer) clearTimeout(sleepTimer.timer);
      const endsAt = Date.now() + minutes * 60000;
      const timer = setTimeout(() => {
        sleepTimer = null;
        stopPlayback().catch((e) => ctx?.log?.('sleep-timer', e.message));
      }, minutes * 60000);
      timer.unref?.();
      sleepTimer = { timer, endsAt };
      const clock = new Date(endsAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      return {
        summary: `${replaced ? 'Önceki zamanlayıcı değiştirildi. ' : ''}Medya ${minutes} dakika sonra (${clock}) durdurulacak.`,
        display: { type: 'value', label: 'Uyku zamanlayıcısı', value: clock, detail: `${minutes} dk sonra müzik durdurulacak`, icon: 'moon' },
        data: { minutes, endsAt, replaced }
      };
    }
  }
];

module.exports.STATIONS = STATIONS;
module.exports.youtubeFirst = youtubeFirst;
module.exports._sleepTimer = () => sleepTimer;
