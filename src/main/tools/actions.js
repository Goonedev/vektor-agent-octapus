'use strict';

/*
 * "Finish the job" tools: instead of only opening a search page, these carry a request through
 * to the end — play the actual video, start the game's install, run the game, ask Claude Code.
 */

const fs = require('node:fs');
const { ToolError, isWin, ps, fetchWithTimeout, fetchJson, resolvePath, truncate } = require('./util');

/*
 * After steam://install, Steam shows its own "Yükle / Install" dialog as a separate window drawn
 * with Chromium. The user already approved the install in Vektör, so we finish it through the
 * accessibility layer (see uia.js): find the dialog, press "Yükle", accept a licence if one
 * follows, and check that the dialog really closed. Windows only.
 */
const STEAM_AVOID = ['satın', 'satin', 'buy', 'purchase', 'sepet', 'cart', 'iptal', 'cancel', 'kaldır', 'uninstall', 'sil', 'delete', 'steam', 'oyna', 'play'];

async function pressInSteamDialog(opts, timeoutMs) {
  const { pressScript, parsePress } = require('./uia');
  try {
    return parsePress(await ps(pressScript({ avoid: STEAM_AVOID, ...opts }), { timeout: timeoutMs }));
  } catch (e) {
    return { ok: false, reason: 'error', error: e.message };
  }
}

async function confirmSteamInstallDialog(gameName) {
  if (!isWin) return { ok: false, reason: 'platform' };
  const windows = ['yükle', 'install', 'kurulum', gameName].filter(Boolean);
  // Steam may need to start (and log in) first, so the dialog can take a while to appear.
  let r = await pressInSteamDialog({ labels: ['Yükle', 'Install', 'İleri', 'Next', 'Devam', 'Continue'], windows, timeoutSec: 90, enterAfterSec: 35 }, 110000);
  // Older multi-page dialogs: keep going while we are pressing "İleri / Next".
  for (let i = 0; i < 3 && r.ok && /^(ileri|next|devam|continue)/i.test(r.name.replace('İ', 'i')); i++) {
    r = await pressInSteamDialog({ labels: ['Yükle', 'Install', 'İleri', 'Next', 'Bitir', 'Finish', 'Devam', 'Continue'], windows, timeoutSec: 12 }, 30000);
  }
  if (!r.ok) return r;
  // Some games ask to accept a licence (EULA) right after.
  const eula = await pressInSteamDialog({ labels: ['Kabul ediyorum', 'Kabul et', 'I Agree', 'Accept', 'Onayla'], windows: [...windows, 'lisans', 'license', 'eula', 'sözleşme'], timeoutSec: 8 }, 25000);
  return { ...r, eula: eula.ok };
}

const decode = (s) => s.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\u0027/g, "'");

/** First real video on a YouTube search page (skips ads, shorts shelves and channels). */
async function findYouTube(query) {
  const res = await fetchWithTimeout(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=tr`, {
    headers: { 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }
  });
  if (!res.ok) throw new ToolError(`YouTube ${res.status} döndürdü.`);
  return parseYouTube(await res.text(), query);
}

function parseYouTube(html, query) {
  const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
  if (m) return { id: m[1], title: decode(m[2]) };
  const any = html.match(/"videoId":"([\w-]{11})"/);
  if (!any) throw new ToolError(`YouTube'da “${query}” için video bulunamadı.`);
  return { id: any[1], title: query };
}

async function findSteamGame(name) {
  const d = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=turkish&cc=TR`);
  const item = d.items?.[0];
  if (!item) throw new ToolError(`Steam'de “${name}” adında bir oyun bulunamadı.`);
  return { appid: item.id, name: item.name, image: item.tiny_image };
}

const claudeSessions = new Map(); // project folder → last Claude Code session, for "devam et"

const tools = [
  {
    name: 'play_youtube',
    category: 'media',
    title: 'YouTube\'da oynat',
    description: 'Bir şarkıyı ya da videoyu YouTube\'da bulur ve doğrudan oynatır (arama sayfasında bırakmaz). "Şarkı aç", "şu videoyu aç", "biraz müzik çal" gibi isteklerde bunu kullan.',
    params: { query: { type: 'string', description: 'Şarkı, sanatçı ya da video adı.', required: true } },
    run: async (a, ctx) => {
      const v = await findYouTube(a.query);
      const url = `https://www.youtube.com/watch?v=${v.id}`;
      await ctx.electron.shell.openExternal(url);
      return {
        summary: `“${v.title}” YouTube'da oynatılıyor.`,
        display: { type: 'article', title: v.title, subtitle: 'YouTube · oynatılıyor', text: '', image: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, url },
        data: { title: v.title, url }
      };
    }
  },
  {
    name: 'steam_install',
    category: 'apps',
    title: 'Steam\'den oyun kur',
    description: 'Bir oyunu Steam mağazasında bulur, Steam\'de kurulumu başlatır ve Steam\'in Yükle penceresini onaylayarak indirmeyi başlatır (Windows). Ücretli oyunlarda satın alma gerekir.',
    danger: true,
    timeout: 3 * 60 * 1000,
    params: { game: { type: 'string', description: 'Oyunun adı.', required: true } },
    run: async (a, ctx) => {
      const g = await findSteamGame(a.game);
      await ctx.electron.shell.openExternal(`steam://install/${g.appid}`);
      const r = await confirmSteamInstallDialog(g.name);
      const started = r.ok && r.closed;
      let summary;
      if (started) summary = `${g.name} Steam'de indirilmeye başladı.${r.eula ? ' Lisans sözleşmesi de onaylandı.' : ''}`;
      else if (r.ok) summary = `Steam'in kurulum penceresinde “${r.name}” düğmesine basıldı ama pencere hâlâ açık görünüyor. list_buttons ile pencereye bakıp gerekirse click_button ile kalan düğmeye bas.`;
      else if (r.reason === 'platform') summary = `${g.name} için Steam'in kurulum penceresi açıldı; bu sistemde "Yükle" düğmesine otomatik basılamıyor.`;
      else summary = `${g.name} için Steam'in kurulum penceresi açıldı ama "Yükle" düğmesi bulunamadı.${r.windows?.length ? ` Görülen pencereler: ${r.windows.slice(0, 6).join(', ')}.` : ''} Steam açılıyor ya da giriş bekliyor olabilir; biraz sonra click_button ile "Yükle"yi dene. Ücretli bir oyunsa önce satın alınması gerekir.`;
      return {
        ok: started || r.ok,
        summary,
        display: { type: 'article', title: g.name, subtitle: started ? 'Steam · indiriliyor' : 'Steam · kurulum penceresi açık', text: '', image: g.image, url: `https://store.steampowered.com/app/${g.appid}` },
        data: { appid: g.appid, name: g.name, pressed: r.ok ? r.name : null, method: r.method || null, dialog_closed: !!r.closed, seen_windows: r.windows, seen_controls: r.names }
      };
    }
  },
  {
    name: 'steam_launch',
    category: 'apps',
    title: 'Steam oyununu başlat',
    description: 'Steam\'de kurulu bir oyunu adıyla başlatır.',
    params: { game: { type: 'string', description: 'Oyunun adı.', required: true } },
    run: async (a, ctx) => {
      const g = await findSteamGame(a.game);
      await ctx.electron.shell.openExternal(`steam://rungameid/${g.appid}`);
      return {
        summary: `${g.name} Steam üzerinden başlatılıyor. Kurulu değilse Steam kurmayı önerir.`,
        display: { type: 'app', name: g.name, detail: 'Steam ile başlatılıyor' },
        data: { appid: g.appid, name: g.name }
      };
    }
  },
  {
    name: 'ask_claude_code',
    category: 'dev',
    title: 'Claude Code\'a yaptır',
    description: 'Kullanıcı bir projede kod işi istediğinde Claude Code\'u o proje klasöründe bir kez çalıştırır (kod yazma, analiz, hata düzeltme). Claude yalnızca o klasördeki dosyaları düzenler. "Devam et" denirse continue=true ile aynı oturumdan sürdür. Cevabı kullanıcıya kısaca özetle.',
    danger: true,
    timeout: 16 * 60 * 1000,
    params: {
      prompt: { type: 'string', description: 'Claude Code\'a verilecek net görev.', required: true },
      project_path: { type: 'string', description: 'Proje klasörü.', required: true },
      continue: { type: 'boolean', description: 'Bu projedeki son Claude Code oturumunu sürdür.' }
    },
    run: async (a) => {
      const { runOnce } = require('../claudecode');
      const cwd = resolvePath(a.project_path);
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new ToolError(`${cwd} bir klasör değil.`);
      const out = await runOnce(a.prompt, { cwd, resume: a.continue ? claudeSessions.get(cwd) : undefined });
      if (out.sessionId) claudeSessions.set(cwd, out.sessionId);
      return {
        summary: truncate(out.text || 'Claude Code bir cevap döndürmedi.', 600),
        display: { type: 'code', title: `Claude Code · ${cwd}`, text: truncate(out.text, 3000) },
        data: { result: truncate(out.text, 8000), ok: out.ok }
      };
    }
  }
];

module.exports = tools;
module.exports.parseYouTube = parseYouTube;
