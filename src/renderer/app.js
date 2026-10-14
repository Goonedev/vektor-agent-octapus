import { icon } from './icons.js';
import { Orb } from './orb.js';
import { LiveAgent, MODELS, VOICES } from './live.js';
import { cardShell, fillCard, esc, CATEGORY_STYLE } from './cards.js';

const api = window.vektor;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  settings: null,
  info: { platform: api.platform },
  catalog: { categories: [], tools: [] },
  toolByName: new Map(),
  activity: [],
  runningTools: new Map(),
  cardCount: 0,
  error: null,
  view: 'assistant',
  libraryCat: 'all'
};

const PHASE_TEXT = {
  offline: 'Başlamak için küreye dokun',
  connecting: 'Bağlanıyor',
  idle: 'Bağlı · mikrofon kapalı',
  listening: 'Dinliyorum',
  hearing: 'Seni duyuyorum',
  thinking: 'Düşünüyorum',
  speaking: 'Konuşuyor',
  tool: 'Çalışıyor',
  confirm: 'Onayını bekliyorum',
  error: 'Bir sorun oluştu'
};
const ANIMATED = new Set(['connecting', 'thinking', 'tool']);

const SUGGESTIONS = [
  ['cloud-sun', 'Bugün hava nasıl?'],
  ['folder', 'İndirilenler klasörünü düzenle'],
  ['display', 'Ekranımda ne var?'],
  ['volume', 'Sesi yüzde otuz yap'],
  ['timer', '25 dakikalık odak zamanlayıcısı kur'],
  ['cpu', 'Bilgisayarım nasıl, kaynak durumu?'],
  ['newspaper', 'Güncel manşetleri özetle'],
  ['currency', '100 dolar kaç TL?']
];

/* ---------------------------------------------------------------- utilities */

function hydrateIcons(root = document) {
  for (const el of $$('[data-icon]', root)) {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.icon);
  }
}

function toast(message, kind = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'warning' : kind === 'success' ? 'check-circle' : 'info')}<span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}

function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function shortModel(id) {
  return MODELS.find((m) => m.id === id)?.label.replace('Gemini ', '') || id;
}

/* ---------------------------------------------------------------- the agent */

const agent = new LiveAgent();
const orb = new Orb($('#orb'));
const brandOrb = new Orb($('#brand-orb'), { compact: true });
orb.start();
brandOrb.start();

agent.toolRunner = (name, args, callId) => runTool(name, args, 'model', callId);

agent.addEventListener('phase', (e) => {
  const phase = e.detail;
  document.body.dataset.phase = phase;
  renderPhase();
  const pill = $('#conn-pill');
  const online = !['offline', 'connecting', 'error'].includes(phase);
  pill.dataset.phase = online ? 'online' : phase;
  $('#conn-label').textContent = online ? 'Bağlı' : phase === 'connecting' ? 'Bağlanıyor' : phase === 'error' ? 'Hata' : 'Çevrimdışı';
  $('#conn-model').textContent = online ? shortModel(state.settings.model) : '';
  $('#power-btn').classList.toggle('on', online);
});

agent.addEventListener('connected', (e) => {
  state.error = null;
  if (state.settings.chime) agent.player.chime('connect');
  if (!e.detail.resumed) addSystemMessage(`${MODELS.find((m) => m.id === e.detail.model)?.label || e.detail.model} ile bağlantı kuruldu.`);
});
agent.addEventListener('reconnecting', () => addSystemMessage('Bağlantı yenileniyor…'));
agent.addEventListener('disconnected', () => addSystemMessage('Bağlantı kapatıldı.'));
agent.addEventListener('error', (e) => {
  state.error = e.detail.message;
  renderPhase();
  toast(e.detail.message, 'error', 6500);
  if (e.detail.code === 'no-key') openView('settings', () => $('[name=apiKey]').focus());
});
agent.addEventListener('notice', (e) => addSystemMessage(e.detail.message));
agent.addEventListener('mic', (e) => {
  $('#mic-btn').classList.toggle('on', e.detail);
  $('#mic-btn').innerHTML = icon(e.detail ? 'mic' : 'mic-off');
});
agent.addEventListener('user-text', (e) => upsertMessage('user', e.detail.text, e.detail.final));
agent.addEventListener('model-text', (e) => upsertMessage('model', e.detail.text, e.detail.final, e.detail.interrupted));

async function connect({ mic = true } = {}) {
  if (!state.settings.apiKey) {
    toast('Önce Gemini API anahtarını ekle.', 'error');
    openView('settings', () => $('[name=apiKey]').focus());
    return false;
  }
  agent.wantMic = mic;
  await agent.connect(state.settings, state.info);
  return agent.connected;
}

async function toggleMic() {
  if (!agent.connected) return connect({ mic: true });
  if (agent.mic.active) agent.stopMic();
  else await agent.startMic();
}

function renderPhase() {
  const phase = agent.phase;
  let text = PHASE_TEXT[phase] || '';
  if (phase === 'tool') {
    const running = [...state.runningTools.values()].pop();
    if (running) text = `${running.title}…`;
  }
  if (phase === 'error' && state.error) text = state.error;
  if (phase === 'offline' && state.error) text = state.error;
  $('#phase-line').innerHTML = `${esc(text)}${ANIMATED.has(phase) ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}`;
}

/* ------------------------------------------------------- conversation stream */

let partial = { user: null, model: null };

function scrollConvo() {
  const c = $('#convo');
  c.scrollTop = c.scrollHeight;
}

function upsertMessage(role, text, final, interrupted) {
  if (!text) return;
  $('#suggestions').hidden = true;
  let el = partial[role];
  if (!el) {
    el = document.createElement('div');
    el.className = `msg ${role}`;
    $('#convo').append(el);
    partial[role] = el;
  }
  el.textContent = text;
  el.classList.toggle('partial', !final);
  if (interrupted) el.classList.add('interrupted');
  if (final) partial[role] = null;
  setCaption(role === 'model' ? text : `“${text}”`);
  scrollConvo();
}

function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  $('#convo').append(el);
  scrollConvo();
}

function addToolMessage(tool) {
  const el = document.createElement('div');
  el.className = 'msg tool';
  el.style.setProperty('--tone', CATEGORY_STYLE[tool.category]?.color || 'var(--accent)');
  el.innerHTML = `${icon(tool.icon || CATEGORY_STYLE[tool.category]?.icon || 'cube')}<span>${esc(tool.title)}</span>`;
  // Tool chips sit before an in-progress model bubble so the reply reads after the action.
  if (partial.model) partial.model.before(el); else $('#convo').append(el);
  scrollConvo();
  return el;
}

let captionTimer;
function setCaption(text) {
  const el = $('#caption');
  el.textContent = text.length > 160 ? '…' + text.slice(-160) : text;
  el.style.opacity = 1;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { el.style.opacity = 0; }, 6000);
}

function renderSuggestions() {
  $('#suggestions').innerHTML = SUGGESTIONS.map(([ic, text]) => `<button type="button" data-say="${esc(text)}">${icon(ic)}${esc(text)}</button>`).join('');
}

async function say(text) {
  text = text.trim();
  if (!text) return;
  upsertMessage('user', text, true);
  if (!agent.connected && !(await connect({ mic: false }))) return;
  agent.sendText(text);
}

/* --------------------------------------------------------------- tool cards */

async function runTool(name, args, source, callId) {
  // use_tool runs a library tool by name; the card shows that tool rather than the wrapper.
  const inner = name === 'use_tool' ? state.toolByName.get(args?.name) : null;
  const tool = inner || state.toolByName.get(name) || { name, title: name, category: 'dev' };
  const id = callId || `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  state.runningTools.set(id, tool);
  renderPhase();

  $('#live-empty')?.remove();
  let shownArgs = args;
  if (inner) { try { shownArgs = JSON.parse(args.args_json || '{}'); } catch { shownArgs = {}; } }
  const card = cardShell({ id, tool, args: shownArgs, source });
  $('#live-feed').prepend(card);
  trimFeed();
  state.cardCount++;
  $('#live-count').textContent = `${state.cardCount} işlem bu oturumda`;
  if (source === 'model') addToolMessage(tool);

  const entry = { id, at: Date.now(), name, tool, args, source, state: 'running' };
  state.activity.unshift(entry);
  renderActivity();
  publishState(true);

  let result;
  try {
    result = await api.tools.execute(name, args, source, id);
  } catch (e) {
    result = { ok: false, summary: e.message, ms: 0, model: { ok: false, summary: e.message } };
  }
  state.runningTools.delete(id);
  fillCard(card, result);
  hydrateIcons(card);
  Object.assign(entry, { state: result.denied ? 'denied' : result.ok ? 'ok' : 'error', ms: result.ms, summary: result.summary });
  renderActivity();
  renderPhase();
  publishState(true);
  if (source === 'manual' && !result.ok) toast(result.summary, 'error');
  return result;
}

function trimFeed() {
  const cards = $$('#live-feed .card');
  for (const c of cards.slice(40)) c.remove();
}

function onFeedClick(e) {
  const cancel = e.target.closest('[data-cancel-timer]');
  if (cancel) { api.schedule.cancel(cancel.dataset.cancelTimer); cancel.closest('.card')?.classList.add('cancelled'); return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const text = copy.closest('.codebox')?.querySelector('pre')?.innerText || '';
    navigator.clipboard.writeText(text).then(() => toast('Kopyalandı', 'success', 1600));
    return;
  }
  // The innermost target wins: a file tile reveals, its "open" button opens.
  const target = e.target.closest('[data-open], [data-reveal]');
  if (!target) return;
  if (target.dataset.open) api.shell.open(target.dataset.open);
  else api.shell.reveal(target.dataset.reveal);
}

/* ------------------------------------------------------------ timers strip */

let schedule = [];

function renderTimers() {
  $('#timers-strip').innerHTML = schedule.map((t) => `
    <div class="chip-timer" title="${esc(t.label)}">
      <svg class="mini-ring ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="ring-track" stroke-width="3"/><circle cx="12" cy="12" r="10" class="ring-fill" stroke="var(--yellow)" stroke-width="3" stroke-dasharray="62.83" data-ring-ends="${t.endsAt}" data-ring-total="${t.total}"/></svg>
      <b data-countdown="${t.endsAt}"></b><small>${esc(t.label)}</small>
    </div>`).join('');
  tickCountdowns();
}

function tickCountdowns() {
  const now = Date.now();
  for (const el of $$('[data-countdown]')) {
    const left = Number(el.dataset.countdown) - now;
    el.textContent = left > 0 ? fmtCountdown(left) : 'Bitti';
  }
  for (const el of $$('[data-ring-ends]')) {
    const total = Number(el.dataset.ringTotal) || 1;
    const left = Math.max(0, Number(el.dataset.ringEnds) - now);
    el.style.strokeDashoffset = String(62.83 * (1 - left / total));
  }
  for (const t of $$('.timer[data-ends]')) {
    const total = Number(t.dataset.total) || 1;
    const left = Math.max(0, Number(t.dataset.ends) - now);
    const fill = t.querySelector('.ring-fill');
    if (fill) {
      const c = Number(fill.getAttribute('stroke-dasharray'));
      fill.style.strokeDashoffset = String(c * (1 - left / total));
    }
    t.classList.toggle('done', left <= 0);
  }
}
setInterval(tickCountdowns, 250);

/* --------------------------------------------------------------- confirm */

let confirmCurrent = null;

function showConfirm(req) {
  confirmCurrent = req;
  agent.awaitingConfirm = true;
  $('#confirm-title').textContent = req.title;
  $('#confirm-desc').textContent = req.description;
  const rows = Object.entries(req.args || {});
  $('#confirm-args').innerHTML = rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd></div>`).join('')}</dl>` : '';
  $('#confirm').hidden = false;
  hydrateIcons($('#confirm'));
  const bar = $('#confirm-bar');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `transform ${req.timeoutMs}ms linear`;
    bar.style.transform = 'scaleX(0)';
  }));
  $('#confirm-yes').focus();
  publishState(true);
  if (state.settings.chime) agent.player.chime('notify');
}

function closeConfirm(id) {
  if (!confirmCurrent || (id && confirmCurrent.id !== id)) return;
  confirmCurrent = null;
  agent.awaitingConfirm = false;
  $('#confirm').hidden = true;
  publishState(true);
}

function answerConfirm(ok) {
  if (!confirmCurrent) return;
  api.confirm.respond(confirmCurrent.id, ok);
  closeConfirm();
}

/* -------------------------------------------------------------- library view */

function renderLibrary() {
  const { categories, tools } = state.catalog;
  $('#tools-lead').textContent = `Vektör'ün bilgisayarında yapabildiği ${tools.length} iş. Sesle iste ya da bir araca dokunup elle çalıştır.`;
  $('#tool-cats').innerHTML = [`<button data-cat="all" class="${state.libraryCat === 'all' ? 'active' : ''}">Tümü <span>${tools.length}</span></button>`,
    ...categories.map((c) => `<button data-cat="${c.id}" class="${state.libraryCat === c.id ? 'active' : ''}">${esc(c.title)} <span>${c.count}</span></button>`)].join('');
  const q = $('#tool-search').value.trim().toLocaleLowerCase('tr');
  const list = tools.filter((t) => (state.libraryCat === 'all' || t.category === state.libraryCat) &&
    (!q || `${t.title} ${t.description} ${t.name}`.toLocaleLowerCase('tr').includes(q)));
  $('#tool-grid').innerHTML = list.map((t) => {
    const st = CATEGORY_STYLE[t.category] || {};
    return `<button class="tool-card glass" data-tool="${t.name}" style="--tone:${st.color}">
      <span class="card-icon">${icon(t.icon || st.icon || 'cube')}</span>
      ${t.danger ? '<span class="pill tone-warning badge">Onaylı</span>' : ''}
      <b>${esc(t.title)}</b><p>${esc(t.description)}</p><code>${esc(t.name)}</code>
    </button>`;
  }).join('') || '<p class="lead">Eşleşen araç yok.</p>';
}

function openRunner(name) {
  const t = state.toolByName.get(name);
  if (!t) return;
  const st = CATEGORY_STYLE[t.category] || {};
  $('#runner-icon').innerHTML = icon(t.icon || st.icon || 'cube');
  $('#runner-icon').style.setProperty('--tone', st.color);
  $('#runner-title').textContent = t.title;
  $('#runner-desc').textContent = t.description;
  $('#runner-form').dataset.tool = name;
  $('#runner-fields').innerHTML = t.params.length ? t.params.map((p) => {
    const label = `<span>${esc(p.key)}${p.required ? ' *' : ''}</span>`;
    let input;
    if (p.enum) input = `<select name="${p.key}"><option value="">—</option>${p.enum.map((v) => `<option>${esc(v)}</option>`).join('')}</select>`;
    else if (p.type === 'boolean') input = `<select name="${p.key}"><option value="">—</option><option value="true">evet</option><option value="false">hayır</option></select>`;
    else input = `<input name="${p.key}" ${p.type === 'number' || p.type === 'integer' ? 'type="number" step="any"' : ''} ${p.required ? 'required' : ''} placeholder="${p.type === 'array' ? 'virgülle ayır' : ''}">`;
    return `<label class="field">${label}${input}<small>${esc(p.description || '')}</small></label>`;
  }).join('') : '<p class="lead">Bu aracın parametresi yok.</p>';
  $('#runner').hidden = false;
  $('#runner-fields input, #runner-fields select')?.focus();
}

/* ------------------------------------------------------------ activity view */

function renderActivity() {
  if (state.view !== 'activity') return;
  const el = $('#activity');
  if (!state.activity.length) { el.innerHTML = '<p class="act-empty">Henüz bir şey çalışmadı.</p>'; return; }
  el.innerHTML = `<div class="act-row head"><span>Saat</span><span></span><span>Araç</span><span>Sonuç</span><span>Süre</span><span>Durum</span></div>` +
    state.activity.slice(0, 200).map((a) => {
      const st = CATEGORY_STYLE[a.tool.category] || {};
      const pill = a.state === 'running' ? '<span class="pill">Çalışıyor</span>' : a.state === 'ok' ? '<span class="pill tone-success">Tamam</span>' : a.state === 'denied' ? '<span class="pill tone-warning">Reddedildi</span>' : '<span class="pill tone-danger">Hata</span>';
      return `<div class="act-row" style="--tone:${st.color}">
        <time>${new Date(a.at).toLocaleTimeString('tr-TR')}</time>
        <span class="card-icon">${icon(a.tool.icon || st.icon || 'cube')}</span>
        <span><b>${esc(a.tool.title)}</b><br><small class="ms">${a.source === 'manual' ? 'Elle' : a.source === 'system' ? 'Sistem' : 'Sesli'}</small></span>
        <span class="sum" title="${esc(a.summary || '')}">${esc(a.summary || '…')}</span>
        <span class="ms">${a.ms != null ? `${a.ms} ms` : ''}</span>
        ${pill}
      </div>`;
    }).join('');
}

/* --------------------------------------------------------------- notes view */

async function renderNotes() {
  const [notes, todos, timers] = await Promise.all([api.store.get('notes'), api.store.get('todos'), api.schedule.list()]);
  $('#note-list').innerHTML = (notes || []).map((n) => `
    <div class="note-item"><b>${esc(n.title)}</b>${n.text !== n.title ? `<p>${esc(n.text)}</p>` : ''}<time>${new Date(n.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</time>
    <button class="icon-btn" data-del-note="${n.id}" title="Sil">${icon('trash')}</button></div>`).join('') || '<p class="empty-note">Henüz not yok. “Vektör, not al: …” demen yeterli.</p>';
  $('#todo-list').innerHTML = (todos || []).map((t) => `
    <li class="${t.done ? 'done' : ''}" data-todo="${t.id}">${icon(t.done ? 'checkbox-on' : 'checkbox')}<span>${esc(t.text)}</span>${t.due ? `<small>${esc(t.due)}</small>` : ''}<button class="icon-btn del" data-del-todo="${t.id}" title="Sil">${icon('x')}</button></li>`).join('') || '<li class="empty">Görev yok</li>';
  $('#timer-list').innerHTML = (timers || []).map((t) => `
    <li><span class="row-icon">${icon(t.kind === 'alarm' ? 'bell' : 'timer')}</span><span class="row-main"><b>${esc(t.label)}</b><small>${new Date(t.endsAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</small></span><span class="row-meta" data-countdown="${t.endsAt}"></span><button class="icon-btn" data-cancel-timer="${t.id}">${icon('x')}</button></li>`).join('') || '<li class="empty">Aktif zamanlayıcı yok</li>';
  tickCountdowns();
}

/* ------------------------------------------------------------ settings view */

function fillSettings() {
  const s = state.settings;
  const f = $('#settings-form');
  $('#model-select').innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('') + '<option value="__custom">Özel…</option>';
  $('#voice-select').innerHTML = VOICES.map((v) => `<option>${v}</option>`).join('');
  f.apiKey.value = s.apiKey || '';
  const known = MODELS.some((m) => m.id === s.model);
  f.model.value = known ? s.model : '__custom';
  f.modelCustom.value = known ? '' : s.model;
  f.modelCustom.hidden = known;
  f.voice.value = s.voice;
  f.persona.value = s.persona || '';
  f.miniIsland.checked = !!s.miniIsland;
  f.confirmDanger.checked = !!s.confirmDanger;
  f.autoConnect.checked = !!s.autoConnect;
  f.chime.checked = !!s.chime;
  f.shortcut.value = s.shortcut || '';
  for (const r of f.theme) r.checked = r.value === s.theme;
}

function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function shortcutLabel(accel) {
  if (!accel) return '';
  const mac = state.info.platform === 'darwin';
  return accel.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').replace('Alt', mac ? '⌥' : 'Alt').replace('Space', 'Space').replace(/\+/g, mac ? '' : '+');
}

/* ------------------------------------------------------------------ updates */

let updateToastShown = false;

function renderUpdate(st) {
  if (!st) return;
  $('#update-title').textContent = `Vektör ${st.current || ''}`.trim();
  const unsupported = st.supported === false;
  const msg = unsupported
    ? 'Uygulama içi güncelleme, kurulum dosyasıyla (Vektor-Setup.exe) kurulan sürümde çalışır.'
    : st.state === 'downloading' ? `Vektör ${st.version || ''} indiriliyor… %${st.percent || 0}`
      : st.message || 'Vektör açıkken güncellemeleri kendisi denetler.';
  $('#update-msg').textContent = msg;
  $('#update-check').hidden = st.state === 'ready';
  $('#update-check').disabled = unsupported || st.state === 'checking' || st.state === 'downloading';
  $('#update-install').hidden = st.state !== 'ready';
  $('#update-bar-wrap').hidden = st.state !== 'downloading';
  $('#update-bar').style.width = `${st.percent || 0}%`;
  $('#update-dot').hidden = st.state !== 'ready';
  if (st.state === 'ready' && !updateToastShown) {
    updateToastShown = true;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon('sparkles')}<span>Vektör ${esc(st.version)} hazır.</span><button type="button">Yeniden başlat</button>`;
    el.querySelector('button').addEventListener('click', () => api.update.install());
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 15000);
  }
}

/* --------------------------------------------------------------- navigation */

function openView(view, after) {
  state.view = view;
  $$('.rail button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'tools') renderLibrary();
  if (view === 'activity') renderActivity();
  if (view === 'notes') renderNotes();
  if (view === 'settings') fillSettings();
  after?.();
}

/* ------------------------------------------------------------- mini island */

let lastPublish = 0;
function publishState(force) {
  const now = performance.now();
  if (!force && now - lastPublish < 70) return;
  lastPublish = now;
  const running = [...state.runningTools.values()].pop();
  api.state.update({
    phase: agent.phase,
    label: agent.phase === 'tool' && running ? running.title : agent.phase === 'error' && state.error ? state.error : PHASE_TEXT[agent.phase],
    level: Math.round(agent.level * 100) / 100,
    caption: $('#caption').style.opacity === '0' ? '' : $('#caption').textContent,
    tool: running ? { title: running.title, category: running.category, icon: CATEGORY_STYLE[running.category]?.icon } : null,
    mic: agent.mic.active,
    connected: agent.connected,
    timers: schedule.length
  });
}

function loop() {
  const level = agent.level;
  orb.set(agent.phase === 'offline' && state.error ? 'error' : agent.phase === 'offline' ? 'offline' : agent.phase, level);
  brandOrb.set(agent.phase === 'offline' ? 'idle' : agent.phase, level);
  $('#mic-btn').style.setProperty('--lv', level.toFixed(2));
  publishState();
  requestAnimationFrame(loop);
}

/* -------------------------------------------------------------------- wiring */

function wire() {
  $('#rail').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) openView(b.dataset.view); });
  $('#orb-hit').addEventListener('click', toggleMic);
  $('#mic-btn').addEventListener('click', toggleMic);
  $('#power-btn').addEventListener('click', () => (agent.connected || agent.phase === 'connecting' ? agent.disconnect() : connect({ mic: true })));
  $('#conn-pill').addEventListener('click', () => (agent.connected ? openView('assistant') : connect({ mic: true })));
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#composer-input');
    say(input.value);
    input.value = '';
  });
  $('#suggestions').addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (b) say(b.dataset.say); });

  $('#live-feed').addEventListener('click', onFeedClick);
  $('#timer-list').addEventListener('click', onFeedClick);
  $('#live-clear').addEventListener('click', () => {
    $$('#live-feed .card').forEach((c) => c.remove());
    state.cardCount = 0;
    $('#live-count').textContent = 'Temizlendi';
  });

  // Library
  $('#tool-search').addEventListener('input', renderLibrary);
  $('#tool-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { state.libraryCat = b.dataset.cat; renderLibrary(); } });
  $('#tool-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) openRunner(b.dataset.tool); });
  $('#runner').addEventListener('click', (e) => { if (e.target.id === 'runner' || e.target.closest('[data-close]')) $('#runner').hidden = true; });
  $('#runner-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.currentTarget.dataset.tool;
    const args = {};
    for (const el of $$('#runner-fields [name]')) if (el.value !== '') args[el.name] = el.value;
    $('#runner').hidden = true;
    runTool(name, args, 'manual');
  });

  // Activity & notes
  $('#activity-clear').addEventListener('click', () => { state.activity = []; renderActivity(); });
  $('#note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#note-input').value.trim();
    if (!text) return;
    $('#note-input').value = '';
    await runTool('add_note', { text }, 'manual');
  });
  $('#todo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#todo-input').value.trim();
    if (!text) return;
    $('#todo-input').value = '';
    await runTool('add_todo', { text }, 'manual');
  });
  $('#note-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-note]');
    if (!b) return;
    const notes = (await api.store.get('notes')).filter((n) => n.id !== b.dataset.delNote);
    await api.store.set('notes', notes);
  });
  $('#todo-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-todo]');
    const li = e.target.closest('[data-todo]');
    const todos = await api.store.get('todos');
    if (del) await api.store.set('todos', todos.filter((t) => t.id !== del.dataset.delTodo));
    else if (li) await api.store.set('todos', todos.map((t) => (t.id === li.dataset.todo ? { ...t, done: !t.done, doneAt: Date.now() } : t)));
  });
  api.store.onChange(() => state.view === 'notes' && renderNotes());

  // Settings
  const f = $('#settings-form');
  f.model.addEventListener('change', () => { f.modelCustom.hidden = f.model.value !== '__custom'; });
  $('#key-toggle').addEventListener('click', () => {
    const show = f.apiKey.type === 'password';
    f.apiKey.type = show ? 'text' : 'password';
    $('#key-toggle').textContent = show ? 'Gizle' : 'Göster';
  });
  $$('[data-open]', f).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); api.shell.open(a.dataset.open); }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const model = f.model.value === '__custom' ? f.modelCustom.value.trim() : f.model.value;
    const patch = {
      apiKey: f.apiKey.value.trim(),
      model: model || MODELS[0].id,
      voice: f.voice.value,
      persona: f.persona.value.trim(),
      miniIsland: f.miniIsland.checked,
      confirmDanger: f.confirmDanger.checked,
      autoConnect: f.autoConnect.checked,
      chime: f.chime.checked,
      shortcut: f.shortcut.value.trim(),
      theme: [...f.theme].find((r) => r.checked)?.value || 'dark'
    };
    const needsReconnect = agent.connected && ['apiKey', 'model', 'voice', 'persona'].some((k) => patch[k] !== state.settings[k]);
    state.settings = await api.settings.set(patch);
    applyTheme(state.settings.theme);
    $('#shortcut-hint').textContent = shortcutLabel(state.settings.shortcut);
    $('#settings-saved').classList.add('show');
    setTimeout(() => $('#settings-saved').classList.remove('show'), 1800);
    if (needsReconnect) {
      agent.disconnect();
      agent.resumeHandle = null;
      setTimeout(() => connect({ mic: true }), 300);
      toast('Yeni ayarlarla yeniden bağlanılıyor.');
    }
  });
  api.settings.onChange((s) => { state.settings = s; if (state.view === 'settings') fillSettings(); });

  // Updates
  $('#update-check').addEventListener('click', async () => renderUpdate(await api.update.check()));
  $('#update-install').addEventListener('click', () => api.update.install());
  api.update.onStatus(renderUpdate);

  // Confirm
  api.confirm.onRequest(showConfirm);
  api.confirm.onClosed(({ id }) => closeConfirm(id));
  $('#confirm-yes').addEventListener('click', () => answerConfirm(true));
  $('#confirm-no').addEventListener('click', () => answerConfirm(false));

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (!$('#confirm').hidden) {
      if (e.key === 'Enter') { e.preventDefault(); answerConfirm(true); }
      if (e.key === 'Escape') { e.preventDefault(); answerConfirm(false); }
      return;
    }
    if (e.key === 'Escape' && !$('#runner').hidden) $('#runner').hidden = true;
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openView('tools', () => $('#tool-search').focus()); }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openView('settings'); }
  });

  // Window controls (Linux draws its own)
  $('#win-controls').addEventListener('click', (e) => { const b = e.target.closest('[data-win]'); if (b) api.window.control(b.dataset.win); });

  // From the main process: global shortcut, tray and mini island
  api.voice.onToggle(toggleMic);
  api.voice.onStop(() => agent.interrupt());

  // Schedule
  api.schedule.onChange((list) => { schedule = list; renderTimers(); if (state.view === 'notes') renderNotes(); });
  api.schedule.onFire((item) => {
    const kind = { timer: 'Zamanlayıcı bitti', alarm: 'Alarm', reminder: 'Hatırlatma' }[item.kind] || 'Vektör';
    if (state.settings.chime) agent.player.chime(item.kind === 'alarm' ? 'alarm' : 'notify');
    toast(`${kind}: ${item.label}`, 'success', 8000);
    $$(`.timer[data-timer="${item.id}"]`).forEach((t) => t.classList.add('done'));
    if (agent.connected) agent.sendEvent(`${kind}: “${item.label}”. Kullanıcıya bunu kısaca ve doğal bir şekilde söyle.`);
  });
  api.tools.onEvent((ev) => { if (ev.type === 'timer-cancel') $$(`.timer[data-timer="${ev.id}"]`).forEach((t) => t.closest('.card')?.classList.add('cancelled')); });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(state.settings.theme));
}

/* ---------------------------------------------------------------------- boot */

async function boot() {
  document.body.classList.add({ darwin: 'mac', win32: 'win', linux: 'linux' }[api.platform] || 'linux');
  hydrateIcons();
  renderSuggestions();
  const [settings, catalog, info, sched] = await Promise.all([api.settings.get(), api.tools.catalog(), api.app.info(), api.schedule.list()]);
  state.settings = settings;
  state.catalog = catalog;
  state.info = info;
  state.toolByName = new Map(catalog.tools.map((t) => [t.name, t]));
  schedule = sched;
  applyTheme(settings.theme);
  $('#shortcut-hint').textContent = shortcutLabel(settings.shortcut);
  renderTimers();
  renderPhase();
  wire();
  api.update.status().then(renderUpdate);
  loop();
  agent.dispatchEvent(new CustomEvent('phase', { detail: 'offline' }));
  if (!settings.apiKey) {
    addSystemMessage('Merhaba! Başlamak için Ayarlar\'dan Gemini API anahtarını ekle. Araçları sol menüden elle de deneyebilirsin.');
  } else if (settings.autoConnect) {
    connect({ mic: true });
  }
}

boot();
