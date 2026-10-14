'use strict';

/*
 * "Finish the job" tools: instead of only opening a search page, these carry a request through
 * to the end — play the actual video, start the game's install, run the game, ask Claude Code.
 */

const fs = require('node:fs');
const { ToolError, isWin, ps, psStr, fetchWithTimeout, fetchJson, resolvePath, truncate } = require('./util');

/*
 * After steam://install, Steam shows its own "Yükle / Install" dialog — on current clients a
 * SEPARATE top-level window titled "Yükle". The user already approved the install in Vektör, so
 * we finish it with the accessibility layer (UI Automation), which can see owned dialog windows
 * that a plain window list drops, and invoke the real button by its name. Windows only.
 */
function steamConfirmScript(gameName) {
  return `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
$AE=[System.Windows.Automation.AutomationElement]
$CT=[System.Windows.Automation.ControlType]
$game=${psStr((gameName || '').toLowerCase())}
$winWords=@('yükle','install','kur','yukle')
$btnWords=@('yükle','install','kur','yukle','indir','evet','devam','next','ileri')
$deadline=(Get-Date).AddSeconds(28)
while((Get-Date) -lt $deadline){
  Start-Sleep -Milliseconds 700
  $wins=$AE::RootElement.FindAll('Children',[System.Windows.Automation.Condition]::TrueCondition)
  foreach($w in $wins){
    $wn=$w.Current.Name; if(-not $wn){continue}
    $wnl=$wn.ToLower()
    $match=($game -and $wnl.Contains($game))
    foreach($x in $winWords){ if($wnl.Contains($x)){ $match=$true } }
    if(-not $match){continue}
    $cond=New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,$CT::Button)
    foreach($b in $w.FindAll('Descendants',$cond)){
      $bn=$b.Current.Name; if(-not $bn){continue}
      $bnl=$bn.ToLower()
      $hit=$false; foreach($x in $btnWords){ if($bnl -eq $x -or $bnl.StartsWith($x)){ $hit=$true } }
      if(-not $hit){continue}
      $p=$null
      if($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){ $p.Invoke(); 'OK:'+$bn; exit }
    }
  }
}
'TIMEOUT'
`;
}

async function confirmSteamInstallDialog(gameName) {
  if (!isWin) return false;
  try {
    const out = (await ps(steamConfirmScript(gameName), { timeout: 32000 })).trim().split('\n').pop();
    return out.startsWith('OK:');
  } catch {
    return false;
  }
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
    timeout: 60000,
    params: { game: { type: 'string', description: 'Oyunun adı.', required: true } },
    run: async (a, ctx) => {
      const g = await findSteamGame(a.game);
      await ctx.electron.shell.openExternal(`steam://install/${g.appid}`);
      const confirmed = await confirmSteamInstallDialog(g.name);
      return {
        summary: confirmed
          ? `${g.name} Steam'de indirilmeye başladı.`
          : `${g.name} için Steam'in kurulum penceresi açıldı; "Yükle"ye basman gerekiyor (ücretli oyunsa önce satın alma gerekir).`,
        display: { type: 'article', title: g.name, subtitle: confirmed ? 'Steam · indiriliyor' : 'Steam · kurulum penceresi açık', text: '', image: g.image, url: `https://store.steampowered.com/app/${g.appid}` },
        data: { appid: g.appid, name: g.name }
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
