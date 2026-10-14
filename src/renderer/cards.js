// Live component cards: every tool call becomes a card that appears while it runs and
// then renders its result in a shape that fits it (gauges, weather, lists, images...).

import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CATEGORY_STYLE = {
  web: { color: 'var(--blue)', icon: 'globe' },
  apps: { color: 'var(--indigo)', icon: 'grid' },
  files: { color: 'var(--cyan)', icon: 'folder' },
  system: { color: 'var(--green)', icon: 'cpu' },
  control: { color: 'var(--orange)', icon: 'sliders' },
  media: { color: 'var(--pink)', icon: 'music' },
  clipboard: { color: 'var(--mint)', icon: 'clipboard' },
  input: { color: 'var(--purple)', icon: 'keyboard' },
  windows: { color: 'var(--teal)', icon: 'window' },
  productivity: { color: 'var(--yellow)', icon: 'timer' },
  utility: { color: 'var(--brown)', icon: 'calculator' },
  network: { color: 'var(--teal)', icon: 'wifi' },
  dev: { color: 'var(--gray)', icon: 'terminal' }
};

const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');

function ring(value, { size = 64, stroke = 6, tone } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : v > 85 ? 'var(--danger)' : v > 65 ? 'var(--warning)' : 'var(--accent)';
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}" style="--c:${c}"/>
  </svg>`;
}

function rows(list) {
  return `<dl class="kv">${list.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

const RENDER = {
  kv: (d) => `${d.status ? `<span class="pill tone-${d.status}">${d.status === 'success' ? 'Sorunsuz' : d.status === 'warning' ? 'Yavaş' : 'Sorun var'}</span>` : ''}${rows(d.rows || [])}`,

  list: (d) => `${d.title ? `<p class="list-title">${esc(d.title)}</p>` : ''}
    <ul class="rows">${(d.items || []).map((i) => `
      <li ${i.path ? `data-open="${esc(i.path)}"` : ''}>
        ${i.icon ? `<span class="row-icon">${icon(i.icon)}</span>` : ''}
        <span class="row-main"><b>${esc(i.title)}</b>${i.subtitle ? `<small>${esc(i.subtitle)}</small>` : ''}</span>
        ${i.countdown ? `<span class="row-meta" data-countdown="${i.countdown}"></span>` : i.meta ? `<span class="row-meta">${esc(i.meta)}</span>` : ''}
      </li>`).join('') || '<li class="empty">Boş</li>'}</ul>`,

  stats: (d) => `<div class="stats">${(d.items || []).map((s) => `
    <div class="stat">
      <div class="stat-ring">${ring(s.value, { tone: s.tone })}<span>${esc(s.value)}<small>${esc(s.unit || '')}</small></span></div>
      <div class="stat-text"><b>${esc(s.label)}</b><small>${esc(s.detail || '')}</small></div>
    </div>`).join('')}</div>`,

  value: (d) => `<div class="big-value">
      ${d.icon ? `<span class="bv-icon">${icon(d.icon)}</span>` : ''}
      <div><small>${esc(d.label || '')}</small><strong>${esc(d.value)}</strong>${d.detail ? `<em>${esc(d.detail)}</em>` : ''}</div>
    </div>`,

  level: (d) => `<div class="level">
      <span class="lv-icon">${icon(d.muted ? 'volume-off' : d.icon || 'volume')}</span>
      <div class="lv-track"><i style="width:${d.muted ? 0 : Math.max(0, Math.min(100, d.value))}%"></i></div>
      <b>${d.muted ? 'Sessiz' : `%${esc(d.value)}`}</b>
    </div>`,

  link: (d) => `<button class="link-tile" data-open="${esc(d.url)}">
      <span class="favicon">${esc((d.host || '?')[0].toUpperCase())}</span>
      <span class="row-main"><b>${esc(d.title)}</b><small>${esc(d.host)}</small></span>
      ${icon('external')}
    </button>`,

  article: (d) => `<div class="article">
      ${d.image ? `<img src="${esc(d.image)}" alt="" loading="lazy">` : ''}
      <div><b>${esc(d.title)}</b>${d.subtitle ? `<small>${esc(d.subtitle)}</small>` : ''}<p>${esc(d.text || '')}</p>
      ${d.url ? `<button class="text-btn" data-open="${esc(d.url)}">Kaynağı aç ${icon('external')}</button>` : ''}</div>
    </div>`,

  file: (d) => `<div class="file-tile" data-reveal="${esc(d.path)}">
      ${d.preview ? `<img class="file-thumb" src="${fileUrl(d.preview)}" alt="">` : `<span class="row-icon big">${icon(d.icon || 'doc')}</span>`}
      <span class="row-main"><b>${esc(d.name)}</b><small>${esc(d.meta || d.path)}</small></span>
      <span class="file-actions">
        <button class="icon-btn" title="Aç" data-open="${esc(d.path)}">${icon('external')}</button>
        <button class="icon-btn" title="Klasörde göster" data-reveal="${esc(d.path)}">${icon('reveal')}</button>
      </span>
    </div>`,

  app: (d) => `<div class="app-tile ${d.state === 'closed' ? 'closed' : ''}">
      <span class="app-glyph">${esc((d.name || '?').trim()[0]?.toUpperCase() || '?')}</span>
      <span class="row-main"><b>${esc(d.name)}</b><small>${esc(d.detail || (d.state === 'closed' ? 'Kapatıldı' : 'Açıldı'))}</small></span>
      <span class="pill ${d.state === 'closed' ? '' : 'tone-success'}">${d.state === 'closed' ? 'Kapalı' : 'Çalışıyor'}</span>
    </div>`,

  code: (d) => `<div class="codebox"><div class="codebar"><span>${esc(d.title || '')}</span><button class="icon-btn" data-copy title="Kopyala">${icon('copy')}</button></div><pre>${esc(d.text)}</pre></div>`,

  terminal: (d) => `<div class="codebox terminal"><div class="codebar"><span>${esc(d.cwd || '')}</span><span class="pill ${d.code === 0 ? 'tone-success' : 'tone-danger'}">çıkış ${esc(d.code)}</span></div><pre><span class="prompt">$ ${esc(d.command)}</span>\n${esc(d.output || '(çıktı yok)')}</pre></div>`,

  image: (d) => `<figure class="shot">
      <img src="${d.src}" alt="Ekran görüntüsü">
      <figcaption><span>${esc(d.caption || '')}</span>${d.path ? `<span><button class="icon-btn" data-open="${esc(d.path)}" title="Aç">${icon('external')}</button><button class="icon-btn" data-reveal="${esc(d.path)}" title="Klasörde göster">${icon('reveal')}</button></span>` : ''}</figcaption>
    </figure>`,

  timer: (d) => {
    const kind = { timer: 'Zamanlayıcı', alarm: 'Alarm', reminder: 'Hatırlatıcı' }[d.kind] || 'Zamanlayıcı';
    return `<div class="timer" data-timer="${esc(d.id)}" data-ends="${d.endsAt}" data-total="${d.total || 0}">
      <div class="timer-ring">${ring(100, { size: 72, stroke: 5 })}<span data-countdown="${d.endsAt}"></span></div>
      <div class="row-main"><b>${esc(d.label)}</b><small>${kind} · ${new Date(d.endsAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</small></div>
      <button class="icon-btn" data-cancel-timer="${esc(d.id)}" title="İptal et">${icon('x')}</button>
    </div>`;
  },

  media: (d) => `<div class="media-ctl">
      ${['previous', 'playpause', 'next'].map((a) => `<span class="media-key ${a === d.action || (a === 'previous' && d.action === 'previous') ? 'on' : ''}">${icon(a === 'playpause' ? 'play' : a)}</span>`).join('')}
    </div>`,

  keys: (d) => d.combo
    ? `<div class="keys">${d.combo.split('+').map((k) => `<kbd>${esc(k.length === 1 ? k.toUpperCase() : k)}</kbd>`).join('<i>+</i>')}${d.repeat > 1 ? `<small>× ${d.repeat}</small>` : ''}</div>`
    : `<div class="typed"><span class="caret"></span>${esc(d.text)}</div>`,

  pointer: (d) => `<div class="pointer-pad"><span class="cursor ${esc(d.action)}" style="left:${d.x != null ? 18 + (d.x % 240) / 3 : 50}%;top:${d.y != null ? 20 + (d.y % 180) / 3 : 50}%">${icon('pointer')}</span><small>${d.action === 'scroll' ? `${d.amount > 0 ? '↑' : '↓'} ${Math.abs(d.amount)}` : d.x != null ? `${d.x}, ${d.y}` : ''}</small></div>`,

  power: (d) => `<div class="power-tile"><span class="row-icon big">${icon({ lock: 'lock', dark: 'moon', light: 'sun', trash: 'trash', desktop: 'display', cancel: 'x' }[d.action] || 'power')}</span><b>${esc(d.label)}</b></div>`,

  note: (d) => `<div class="note-card"><b>${esc(d.title)}</b><p>${esc(d.text)}</p></div>`,

  todos: (d) => `<ul class="todo-list">${(d.items || []).map((t) => `
      <li class="${t.done ? 'done' : ''} ${t.id === d.highlight ? 'hl' : ''}">${icon(t.done ? 'checkbox-on' : 'checkbox')}<span>${esc(t.text)}</span>${t.due ? `<small>${esc(t.due)}</small>` : ''}</li>`).join('') || '<li class="empty">Görev yok</li>'}</ul>`,

  weather: (d) => `<div class="weather ${d.isDay ? 'day' : 'night'}">
      <div class="w-now">
        <div><small>${esc(d.region || '')}</small><b>${esc(d.place)}</b><strong>${esc(d.temp)}°</strong><span>${esc(d.cond)} · Hissedilen ${esc(d.feels)}°</span></div>
        <span class="w-icon">${icon(d.icon)}</span>
      </div>
      <div class="w-meta"><span>${icon('drop')} %${esc(d.humidity)}</span><span>${icon('wind')} ${esc(d.wind)} km/sa</span></div>
      <div class="w-hours">${(d.hourly || []).map((h) => `<div><small>${esc(h.time)}</small>${icon(h.icon)}<b>${esc(h.temp)}°</b></div>`).join('')}</div>
      <div class="w-days">${(d.days || []).map((x) => `<div><span>${esc(x.day)}</span>${icon(x.icon)}<small>${x.rain != null ? `%${esc(x.rain)}` : ''}</small><b>${esc(x.min)}° <i>${esc(x.max)}°</i></b></div>`).join('')}</div>
    </div>`,

  news: (d) => `<p class="list-title">${esc(d.title)}</p><ul class="rows news">${(d.items || []).map((n) => `
      <li data-open="${esc(n.url)}"><span class="row-main"><b>${esc(n.title)}</b><small>${esc(n.source)}${n.time ? ` · ${esc(n.time)}` : ''}</small></span></li>`).join('')}</ul>`,

  secret: (d) => `<div class="secret"><code class="blurred" tabindex="0">${esc(d.value)}</code><small>${esc(d.label)} · göstermek için üzerine gel</small></div>`
};

export function renderDisplay(display) {
  if (!display) return '';
  const fn = RENDER[display.type];
  try { return fn ? fn(display) : ''; } catch (e) { console.error(e); return ''; }
}

export function cardShell({ id, tool, args, source }) {
  const style = CATEGORY_STYLE[tool?.category] || { color: 'var(--gray)', icon: 'cube' };
  const argText = Object.entries(args || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  const el = document.createElement('article');
  el.className = 'card glass enter';
  el.dataset.state = 'running';
  el.dataset.id = id;
  el.style.setProperty('--tone', style.color);
  el.innerHTML = `
    <header class="card-head">
      <span class="card-icon">${icon(tool?.icon || style.icon)}</span>
      <div class="card-titles"><b>${esc(tool?.title || tool?.name || 'Araç')}</b><small>${source === 'manual' ? 'Elle' : source === 'system' ? 'Sistem' : 'Sesli komut'}${argText ? ` · ${esc(argText.slice(0, 80))}` : ''}</small></div>
      <span class="card-status"><span class="spinner"></span></span>
    </header>
    <div class="card-body"><div class="skeleton"><i></i><i></i><i></i></div></div>`;
  return el;
}

export function fillCard(el, result) {
  const state = result.denied ? 'denied' : result.ok ? 'ok' : 'error';
  el.dataset.state = state;
  const status = el.querySelector('.card-status');
  status.innerHTML = state === 'ok'
    ? `<span class="pill tone-success">${icon('check')} ${result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} sn`}</span>`
    : state === 'denied' ? '<span class="pill tone-warning">Reddedildi</span>' : `<span class="pill tone-danger">${icon('danger')} Hata</span>`;
  const body = el.querySelector('.card-body');
  const display = result.ok ? renderDisplay(result.display) : '';
  body.innerHTML = display || `<p class="card-summary">${esc(result.summary)}</p>${result.hint ? `<p class="card-hint">${icon('lightbulb')} ${esc(result.hint)}</p>` : ''}`;
  if (display && result.summary && !['value', 'weather', 'stats'].includes(result.display?.type)) {
    body.insertAdjacentHTML('beforeend', `<p class="card-foot">${esc(result.summary)}</p>`);
  }
}
