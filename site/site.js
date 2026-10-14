// Reads releases from the GitHub API so the page always points at the newest installer.
// Without network or before the first release, the static links to the Releases page remain.

const REPO = 'Goonedev/vektor-agent-octapus';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (n) => `${(n / 1024 / 1024).toFixed(0)} MB`;
const date = (iso) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const installer = (r) => r.assets.find((a) => /\.exe$/i.test(a.name));

function platformOf(name) {
  if (/\.exe$/i.test(name)) return 'Windows';
  if (/\.(dmg|zip)$/i.test(name) && /mac|arm64|x64/i.test(name)) return 'macOS';
  if (/\.AppImage$/i.test(name)) return 'Linux';
  return null;
}

function renderRelease(r, latest) {
  const assets = r.assets.filter((a) => platformOf(a.name));
  const notes = (r.body || '').replace(/\r/g, '').trim();
  return `<article class="glass release">
    <header><h3>${esc(r.name || r.tag_name)}</h3>${latest ? '<span class="pill">En yeni</span>' : ''}<time>${date(r.published_at)}</time></header>
    ${notes ? `<p class="notes">${esc(notes.length > 600 ? notes.slice(0, 600) + '…' : notes)}</p>` : '<p class="notes"></p>'}
    <div class="assets">${assets.map((a) => `<a class="asset" href="${esc(a.browser_download_url)}">${esc(platformOf(a.name))} <small>${esc(a.name)} · ${mb(a.size)}</small></a>`).join('') || `<a class="asset" href="${esc(r.html_url)}">GitHub'da aç</a>`}</div>
  </article>`;
}

async function load() {
  const list = document.getElementById('release-list');
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=8`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(res.status);
    const releases = (await res.json()).filter((r) => !r.draft && !r.prerelease);
    if (!releases.length) {
      list.innerHTML = `<div class="glass release placeholder"><p>İlk sürüm çok yakında. O zamana kadar <a href="https://github.com/${REPO}#kurulum">kaynak koddan kurabilirsin</a>.</p></div>`;
      return;
    }
    list.innerHTML = releases.map((r, i) => renderRelease(r, i === 0)).join('');
    const exe = installer(releases[0]);
    if (exe) {
      document.getElementById('download').href = exe.browser_download_url;
      document.getElementById('download-label').textContent = `Windows için indir · ${releases[0].tag_name}`;
      document.getElementById('download-meta').textContent = `${exe.name} · ${mb(exe.size)} · Windows 10 ve 11 · Uygulama içinden kendini günceller`;
    }
  } catch {
    list.innerHTML = `<div class="glass release placeholder"><p>Sürümler yüklenemedi. <a href="https://github.com/${REPO}/releases">GitHub Releases</a> sayfasına göz at.</p></div>`;
  }
}

load();
