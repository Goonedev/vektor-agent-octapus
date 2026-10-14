'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const shortcuts = require('../src/main/tools/packs/shortcuts');
const media = require('../src/main/tools/packs/media');
const { parseCombo } = require('../src/main/tools/desktop');
const { ToolError } = require('../src/main/tools/util');

const CATS = new Set(['web', 'apps', 'files', 'system', 'control', 'media', 'clipboard', 'input', 'windows', 'productivity', 'utility', 'network', 'dev', 'settings', 'sites', 'shortcuts', 'text', 'info']);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array']);
const EXISTING = new Set(['media_play_pause', 'media_next', 'media_previous']);

// Mirrors desktop.js: VK names (Windows) and the keys macOS sends by key code.
const VK_KEYS = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'win', 'windows', 'cmd', 'command', 'super', 'meta',
  'enter', 'return', 'tab', 'esc', 'escape', 'space', 'backspace', 'delete', 'del', 'insert', 'home', 'end', 'pageup', 'pagedown',
  'left', 'up', 'right', 'down', 'printscreen', 'capslock', 'volumeup', 'volumedown', 'volumemute', 'playpause', 'nexttrack',
  'prevtrack', 'stop', 'plus', 'minus', 'comma', 'period', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]);
const MAC_MODS = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'win', 'super', 'meta']);
const MAC_CODES = new Set(['enter', 'return', 'tab', 'space', 'backspace', 'delete', 'del', 'esc', 'escape', 'left', 'right', 'down', 'up',
  'home', 'end', 'pageup', 'pagedown', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]);

function checkShape(t) {
  assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/, t.name);
  assert.ok(CATS.has(t.category), `${t.name} category`);
  assert.equal(typeof t.title, 'string');
  assert.ok(t.title.length > 0);
  assert.equal(typeof t.description, 'string');
  assert.ok(t.description.length > 5);
  assert.equal(typeof t.run, 'function');
  for (const [k, p] of Object.entries(t.params || {})) {
    assert.ok(TYPES.has(p.type), `${t.name}.${k} type ${p.type}`);
    assert.equal(typeof p.description, 'string');
    if ('required' in p) assert.equal(p.required, true, `${t.name}.${k} required must be true when set`);
    if (p.enum) assert.ok(Array.isArray(p.enum) && p.enum.length);
  }
  if ('danger' in t) assert.ok(typeof t.danger === 'boolean' || typeof t.danger === 'function');
}

function stubCtx() {
  const opened = [];
  return {
    opened,
    focused: 0,
    electron: { shell: { openExternal: async (u) => { opened.push(u); } } },
    clip: { readText: async () => '', writeText: async () => {} },
    yieldFocus: async function () { this.focused++; }
  };
}

test('shortcuts pack: 50 well-formed key_ tools', () => {
  assert.equal(shortcuts.length, 50);
  assert.equal(shortcuts.SHORTCUTS.length, 50);
  for (const t of shortcuts) {
    checkShape(t);
    assert.equal(t.category, 'shortcuts');
    assert.ok(t.name.startsWith('key_'));
  }
  assert.deepEqual(shortcuts.filter((t) => t.danger).map((t) => t.name), ['key_close_window']);
});

test('media pack: 12 well-formed media_ tools that avoid existing names', () => {
  assert.equal(media.length, 12);
  for (const t of media) {
    checkShape(t);
    assert.equal(t.category, 'media');
    assert.ok(t.name.startsWith('media_'));
    assert.ok(!EXISTING.has(t.name), `${t.name} collides with desktop.js`);
  }
});

test('all names are unique across both packs', () => {
  const names = [...shortcuts, ...media].map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('every Windows combo parses and uses only keys desktop.js knows', () => {
  for (const s of shortcuts.SHORTCUTS) {
    assert.equal(typeof s.win, 'string', `${s.name} needs a win combo`);
    const keys = parseCombo(s.win);
    for (const k of keys) assert.ok(VK_KEYS.has(k) || /^[a-z0-9]$/.test(k), `${s.name}: unknown key ${k}`);
    if (s.linux) for (const k of parseCombo(s.linux)) assert.ok(VK_KEYS.has(k) || /^[a-z0-9]$/.test(k), `${s.name} linux: ${k}`);
  }
});

test('every macOS combo has one main key that System Events can send', () => {
  for (const s of shortcuts.SHORTCUTS) {
    if (s.mac === null) continue;
    assert.equal(typeof s.mac, 'string', `${s.name} mac must be a combo or null`);
    const main = parseCombo(s.mac).filter((k) => !MAC_MODS.has(k));
    assert.equal(main.length, 1, `${s.name}: ${s.mac}`);
    assert.ok(MAC_CODES.has(main[0]) || main[0].length === 1, `${s.name}: mac key ${main[0]} would be typed as text`);
  }
});

test('repeat param exists only on repeatable shortcuts', () => {
  const byName = Object.fromEntries(shortcuts.map((t) => [t.name, t]));
  for (const n of ['key_undo', 'key_redo', 'key_next_tab', 'key_zoom_in', 'key_next_desktop']) assert.equal(byName[n].params.repeat.type, 'integer');
  for (const n of ['key_copy', 'key_close_window', 'key_switch_app', 'key_emoji']) assert.equal(byName[n].params.repeat, undefined);
});

test('platform without an equivalent throws a readable ToolError before sending keys', { skip: process.platform !== 'linux' }, async () => {
  const t = shortcuts.find((x) => x.name === 'key_clipboard_history');
  const ctx = stubCtx();
  await assert.rejects(t.run({}, ctx), (e) => e instanceof ToolError && /desteklenmiyor/.test(e.message));
  assert.equal(ctx.focused, 0);
  assert.equal(shortcuts.comboFor(shortcuts.SHORTCUTS.find((s) => s.name === 'key_copy')), 'ctrl+c');
  assert.equal(shortcuts.comboFor(shortcuts.SHORTCUTS.find((s) => s.name === 'key_redo')), 'ctrl+shift+z');
});

test('radio opens the chosen station page, defaulting to TRT FM', async () => {
  const t = media.find((x) => x.name === 'media_radio');
  for (const s of Object.values(media.STATIONS)) assert.match(s.url, /^https:\/\//);
  let ctx = stubCtx();
  let r = await t.run({}, ctx);
  assert.equal(ctx.opened[0], media.STATIONS['trt-fm'].url);
  assert.equal(r.display.type, 'link');
  assert.equal(r.data.station, 'trt-fm');
  ctx = stubCtx();
  r = await t.run({ station: 'lofi' }, ctx);
  assert.match(ctx.opened[0], /youtube\.com\/watch\?v=/);
  assert.match(r.summary, /Lofi/);
});

test('apple podcast search builds an encoded URL', async () => {
  const t = media.find((x) => x.name === 'media_podcast_search');
  const ctx = stubCtx();
  const r = await t.run({ query: 'Bilim & Teknik', source: 'apple' }, ctx);
  assert.equal(ctx.opened[0], 'https://podcasts.apple.com/tr/search?term=Bilim%20%26%20Teknik');
  assert.match(r.summary, /Apple Podcasts/);
  await assert.rejects(t.run({ query: '  ' }, stubCtx()), ToolError);
});

test('speak rejects empty and over-long text without speaking', async () => {
  const t = media.find((x) => x.name === 'media_speak');
  await assert.rejects(t.run({ text: '' }), ToolError);
  await assert.rejects(t.run({ text: 'a'.repeat(5001) }), ToolError);
});

test('white noise opens the first YouTube result, falling back to the results page', async () => {
  const t = media.find((x) => x.name === 'media_white_noise');
  const realFetch = global.fetch;
  try {
    global.fetch = async () => new Response('x{"videoRenderer":{"videoId":"abcDEF12345","thumbnail":{},"title":{"runs":[{"text":"White Noise \\u0026 Sleep"}]}}');
    let ctx = stubCtx();
    let r = await t.run({ kind: 'rain' }, ctx);
    assert.equal(ctx.opened[0], 'https://www.youtube.com/watch?v=abcDEF12345');
    assert.equal(r.data.title, 'White Noise & Sleep');
    assert.equal(r.data.direct, true);

    global.fetch = async () => new Response('no videos here');
    ctx = stubCtx();
    r = await media.find((x) => x.name === 'media_focus_music').run({}, ctx);
    assert.match(ctx.opened[0], /^https:\/\/www\.youtube\.com\/results\?search_query=lofi/);
    assert.match(ctx.opened[0], /sp=EgJAAQ/);
    assert.equal(r.data.direct, false);
    assert.match(r.summary, /click_button/);
  } finally {
    global.fetch = realFetch;
  }
});

test('sleep timer sets, replaces and cancels', async () => {
  const t = media.find((x) => x.name === 'media_sleep_timer');
  await assert.rejects(t.run({}, stubCtx()), ToolError);
  let r = await t.run({ minutes: 30 }, stubCtx());
  assert.equal(r.data.minutes, 30);
  assert.equal(r.data.replaced, false);
  const first = media._sleepTimer();
  assert.ok(first && first.endsAt > Date.now());
  r = await t.run({ minutes: 5 }, stubCtx());
  assert.equal(r.data.replaced, true);
  assert.notEqual(media._sleepTimer(), first);
  assert.match(r.summary, /5 dakika/);
  r = await t.run({ cancel: true }, stubCtx());
  assert.match(r.summary, /iptal/);
  assert.equal(media._sleepTimer(), null);
  r = await t.run({ cancel: true }, stubCtx());
  assert.match(r.summary, /yok/);
});
