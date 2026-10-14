'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settings = require('../src/main/tools/packs/settings');
const sites = require('../src/main/tools/packs/sites');

const CATS = new Set('web apps files system control media clipboard input windows productivity utility network dev settings sites shortcuts text info'.split(' '));
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array']);
const PARAM_KEYS = new Set(['type', 'description', 'required', 'enum', 'items']);

function stubCtx() {
  const opened = [];
  return { opened, electron: { shell: { openExternal: async (u) => { opened.push(u); } } } };
}

function checkShape(list, category, prefixes) {
  for (const t of list) {
    assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/);
    assert.ok(prefixes.some((p) => t.name.startsWith(p)), `${t.name} uses a foreign prefix`);
    assert.equal(t.category, category);
    assert.ok(CATS.has(t.category));
    assert.equal(typeof t.title, 'string');
    assert.ok(t.title.length > 0);
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 10);
    assert.equal(typeof t.run, 'function');
    assert.equal(t.danger, undefined, `${t.name} only opens things, it must not be dangerous`);
    for (const [k, p] of Object.entries(t.params || {})) {
      assert.ok(TYPES.has(p.type), `${t.name}.${k} type`);
      for (const key of Object.keys(p)) assert.ok(PARAM_KEYS.has(key), `${t.name}.${k}.${key}`);
      if ('required' in p) assert.equal(p.required, true);
    }
  }
}

test('pack sizes, shapes and unique names', () => {
  assert.equal(settings.length, 104);
  assert.equal(sites.length, 100);
  checkShape(settings, 'settings', ['settings_', 'win_', 'folder_']);
  checkShape(sites, 'sites', ['site_', 'search_']);
  assert.equal(settings.filter((t) => t.name.startsWith('settings_')).length, 70);
  assert.equal(settings.filter((t) => t.name.startsWith('win_')).length, 24);
  assert.equal(settings.filter((t) => t.name.startsWith('folder_')).length, 10);
  assert.equal(sites.filter((t) => t.name.startsWith('site_')).length, 50);
  assert.equal(sites.filter((t) => t.name.startsWith('search_')).length, 50);
  const all = [...settings, ...sites].map((t) => t.name);
  assert.equal(new Set(all).size, all.length);
});

test('pack names do not collide with existing tools', () => {
  // core modules only: the registry itself also contains these packs (and packs built in parallel)
  const core = ['web', 'apps', 'files', 'system', 'desktop', 'productivity', 'utility', 'actions', 'ui', 'steps', 'research'];
  const existing = new Set(core.flatMap((m) => require(`../src/main/tools/${m}`)).map((t) => t.name));
  assert.ok(existing.has('search_files'));
  for (const t of [...settings, ...sites]) assert.ok(!existing.has(t.name), `${t.name} already exists`);
});

test('settings pages use real-looking ms-settings / windowsdefender / mac URIs', () => {
  assert.equal(settings.PAGES.length, 70);
  const uris = new Set();
  for (const [key, label, win, mac] of settings.PAGES) {
    assert.match(key, /^[a-z0-9_]+$/);
    assert.ok(label);
    assert.match(win, /^(ms-settings:[a-z0-9-]+|windowsdefender:)$/, `${key} → ${win}`);
    assert.ok(!uris.has(win), `${win} used twice`);
    uris.add(win);
    if (mac) assert.match(mac, /^com\.apple\./);
  }
  const byKey = Object.fromEntries(settings.PAGES.map((p) => [p[0], p[2]]));
  assert.equal(byKey.display, 'ms-settings:display');
  assert.equal(byKey.night_light, 'ms-settings:nightlight');
  assert.equal(byKey.windows_update, 'ms-settings:windowsupdate');
  assert.equal(byKey.windows_security, 'windowsdefender:');
  assert.equal(byKey.camera_privacy, 'ms-settings:privacy-webcam');
  assert.equal(byKey.graphics, 'ms-settings:display-advancedgraphics');
});

test('classic Windows tools and special folders are constant targets', () => {
  assert.equal(settings.WIN_TOOLS.length, 24);
  for (const [, , how, target] of settings.WIN_TOOLS) {
    assert.ok(['control', 'exe', 'start'].includes(how));
    if (how === 'start') assert.match(target, /^[a-z0-9]+\.(msc|exe)$/);
    else assert.ok(Array.isArray(target));
  }
  const targets = settings.WIN_TOOLS.map((w) => JSON.stringify(w[3]));
  for (const t of ['devmgmt.msc', 'services.msc', 'regedit.exe', 'osk.exe']) assert.ok(targets.includes(JSON.stringify(t)));
  assert.equal(settings.FOLDERS.length, 10);
  const tmp = settings.FOLDERS.find((f) => f[0] === 'temp');
  assert.ok(fs.existsSync(tmp[3]()));
});

test('settings tools behave per platform', async () => {
  const ctx = stubCtx();
  const t = settings.find((x) => x.name === 'settings_display');
  if (process.platform === 'win32') {
    const r = await t.run({}, ctx);
    assert.deepEqual(ctx.opened, ['ms-settings:display']);
    assert.equal(r.display.type, 'kv');
  } else if (process.platform === 'darwin') {
    await t.run({}, ctx);
    assert.match(ctx.opened[0], /^x-apple\.systempreferences:com\.apple\.Displays/);
  } else {
    await assert.rejects(t.run({}, ctx), /desteklenmiyor/);
    await assert.rejects(settings.find((x) => x.name === 'win_device_manager').run({}, ctx), /desteklenmiyor/);
    assert.equal(ctx.opened.length, 0);
  }
});

test('folder tool opens temp via shell.openPath off Windows', { skip: process.platform === 'win32' }, async () => {
  const opened = [];
  const ctx = { electron: { shell: { openPath: async (p) => { opened.push(p); return ''; } } } };
  const r = await settings.find((x) => x.name === 'folder_temp').run({}, ctx);
  assert.equal(opened.length, 1);
  assert.equal(path.resolve(opened[0]), path.resolve(require('node:os').tmpdir()));
  assert.equal(r.data.folder, 'temp');
});

test('site openers open their https URL and return a link card', async () => {
  for (const t of sites.filter((x) => x.name.startsWith('site_'))) {
    const ctx = stubCtx();
    const r = await t.run({}, ctx);
    assert.equal(ctx.opened.length, 1);
    assert.match(ctx.opened[0], /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//);
    assert.equal(r.display.type, 'link');
    assert.equal(r.display.url, ctx.opened[0]);
    assert.ok(r.summary.endsWith('açıldı.'));
  }
  const ctx = stubCtx();
  await sites.find((x) => x.name === 'site_edevlet').run({}, ctx);
  assert.equal(ctx.opened[0], 'https://www.turkiye.gov.tr/');
});

test('search tools URL-encode the query', async () => {
  const q = 'kedi maması & su?';
  const special = new Set(['search_directions', 'search_instagram_tag', 'search_unsplash', 'search_yemeksepeti', 'search_skyscanner']);
  for (const t of sites.filter((x) => x.name.startsWith('search_') && !special.has(x.name))) {
    assert.equal(t.params.query.required, true);
    const ctx = stubCtx();
    const r = await t.run({ query: q }, ctx);
    assert.equal(ctx.opened.length, 1, t.name);
    const url = ctx.opened[0];
    assert.ok(url.startsWith('https://'), t.name);
    assert.ok(url.includes(encodeURIComponent(q)), `${t.name}: ${url}`);
    assert.ok(!url.includes(' '), t.name);
    assert.doesNotThrow(() => new URL(url));
    assert.equal(r.display.type, 'link');
    assert.ok(r.summary.includes(q));
  }
});

test('search tools with special URL rules', async () => {
  const run = async (name, args) => {
    const ctx = stubCtx();
    await sites.find((x) => x.name === name).run(args, ctx);
    return ctx.opened[0];
  };
  assert.equal(await run('search_instagram_tag', { query: '#kedi maması' }), `https://www.instagram.com/explore/tags/${encodeURIComponent('kedimaması')}/`);
  assert.equal(await run('search_unsplash', { query: 'kedi maması' }), `https://unsplash.com/s/photos/${encodeURIComponent('kedi-maması')}`);
  assert.ok((await run('search_yemeksepeti', { query: 'lahmacun' })).includes(encodeURIComponent('site:yemeksepeti.com lahmacun')));
  assert.equal(await run('search_skyscanner', { query: 'IST - AMS' }), 'https://www.skyscanner.com.tr/transport/flights/ist/ams/');
  assert.ok((await run('search_skyscanner', { query: 'Roma uçuşları' })).includes(encodeURIComponent('Roma uçuşları')));
  assert.ok((await run('search_spotify', { query: 'Barış Manço' })).endsWith(`/search/${encodeURIComponent('Barış Manço')}`));

  const dir = await run('search_directions', { from: 'Kadıköy', to: 'Taksim Meydanı', mode: 'transit' });
  const u = new URL(dir);
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('destination'), 'Taksim Meydanı');
  assert.equal(u.searchParams.get('origin'), 'Kadıköy');
  assert.equal(u.searchParams.get('travelmode'), 'transit');
  assert.ok(!dir.includes('+'));
  const noFrom = new URL(await run('search_directions', { to: 'Ankara' }));
  assert.equal(noFrom.searchParams.get('origin'), null);
});

test('search tools reject empty queries', async () => {
  await assert.rejects(sites.find((x) => x.name === 'search_npm').run({ query: '  ' }, stubCtx()), /Aranacak/);
  await assert.rejects(sites.find((x) => x.name === 'search_directions').run({}, stubCtx()), /Nereye/);
  await assert.rejects(sites.find((x) => x.name === 'search_instagram_tag').run({ query: '# #' }, stubCtx()), /etiket/);
});
