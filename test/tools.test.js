'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tools = require('../src/main/tools');
const { evaluate, convertUnits } = require('../src/main/tools/calc');
const { norm, resolvePath, ToolError } = require('../src/main/tools/util');
const { nextClock, parseWhen } = require('../src/main/tools/productivity');
const { parseRss, tzFor } = require('../src/main/tools/utility');
const { htmlToText } = require('../src/main/tools/web');
const { parseCombo } = require('../src/main/tools/desktop');
const { Store } = require('../src/main/store');
const { Scheduler } = require('../src/main/scheduler');

test('the registry has at least 100 uniquely named tools in known categories', () => {
  assert.ok(tools.TOOLS.length >= 100);
  const names = new Set(tools.TOOLS.map((t) => t.name));
  assert.equal(names.size, tools.TOOLS.length);
  const cats = new Set(tools.CATEGORIES.map((c) => c.id));
  for (const t of tools.TOOLS) {
    assert.ok(cats.has(t.category), `${t.name} has unknown category ${t.category}`);
    assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/);
    assert.ok(t.title && t.description, `${t.name} needs a title and description`);
    assert.equal(typeof t.run, 'function');
  }
});

test('function declarations use Gemini schema types and list real required keys', () => {
  const allowed = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT']);
  for (const d of tools.declarations()) {
    if (!d.parameters) continue;
    assert.equal(d.parameters.type, 'OBJECT');
    for (const [key, p] of Object.entries(d.parameters.properties)) {
      assert.ok(allowed.has(p.type), `${d.name}.${key} has type ${p.type}`);
      if (p.type === 'ARRAY') assert.ok(allowed.has(p.items.type));
    }
    for (const r of d.parameters.required) assert.ok(r in d.parameters.properties, `${d.name} requires missing ${r}`);
  }
});

test('calculator handles precedence, percent and functions without eval', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('200 + 10%'), 220);
  assert.equal(evaluate('1500 * 18%'), 270);
  assert.equal(evaluate('-3^2'), -9);
  assert.equal(evaluate('2*-3'), -6);
  assert.equal(evaluate('sqrt(16) + fact(5)'), 124);
  assert.equal(evaluate('10 % 3'), 1);
  assert.equal(evaluate('3,5 * 2'), 7);
  assert.ok(Math.abs(evaluate('sin(30)') - 0.5) < 1e-12);
  assert.throws(() => evaluate('process.exit()'));
  assert.throws(() => evaluate('1/0'));
});

test('unit conversion covers temperature and table units', () => {
  assert.ok(Math.abs(convertUnits(100, 'c', 'f') - 212) < 1e-9);
  assert.ok(Math.abs(convertUnits(1, 'mi', 'km') - 1.609344) < 1e-9);
  assert.equal(convertUnits(1, 'gb', 'mb'), 1024);
  assert.throws(() => convertUnits(1, 'kg', 'km'));
});

test('Turkish matching ignores case, dotted/dotless i and accents', () => {
  assert.equal(norm('İndirilenler'), 'indirilenler');
  assert.equal(norm('Indirilenler'), 'indirilenler');
  assert.equal(norm('MÜZİK'), 'muzik');
  assert.equal(tzFor('Istanbul'), 'Europe/Istanbul');
  assert.equal(tzFor('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(tzFor('Atlantis'), null);
});

test('paths resolve aliases, home and relative names', () => {
  assert.equal(resolvePath('~'), os.homedir());
  assert.equal(resolvePath('Masaüstü/a.txt'), path.join(os.homedir(), 'Desktop', 'a.txt'));
  assert.equal(resolvePath('indirilenler'), path.join(os.homedir(), 'Downloads'));
  assert.equal(resolvePath('notlar.txt'), path.join(os.homedir(), 'notlar.txt'));
  assert.throws(() => resolvePath(''), ToolError);
});

test('clock and date parsing for alarms and reminders', () => {
  const t = nextClock('07:30');
  assert.ok(t > Date.now() && t - Date.now() <= 86400000);
  assert.equal(new Date(t).getHours(), 7);
  assert.equal(nextClock('25:00'), null);
  assert.ok(parseWhen('2099-01-02 09:00') > Date.now());
  assert.equal(parseWhen('yarın gibi'), null);
});

test('argument coercion fixes common model mistakes', () => {
  const params = { n: { type: 'integer' }, x: { type: 'number' }, b: { type: 'boolean' }, list: { type: 'array' } };
  assert.deepEqual(tools.coerce({ n: '4.6', x: '2,5', b: 'evet', list: 'a, b', extra: 1 }, params), { n: 5, x: 2.5, b: true, list: ['a', 'b'] });
});

test('execute reports missing parameters, denial and errors without throwing', async () => {
  const missing = await tools.execute('calculate', {}, {});
  assert.equal(missing.ok, false);
  assert.match(missing.summary, /expression/);

  const denied = await tools.execute('run_command', { command: 'echo hi' }, { confirm: async () => false });
  assert.equal(denied.ok, false);
  assert.equal(denied.denied, true);

  const bad = await tools.execute('calculate', { expression: '2+' }, {});
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /Hesaplanamadı/);

  const good = await tools.execute('calculate', { expression: '6*7' }, {});
  assert.equal(good.ok, true);
  assert.equal(good.data.result, 42);

  assert.equal((await tools.execute('nope', {}, {})).ok, false);
});

test('only text reaches the model; images and card markup stay in the UI', () => {
  const out = tools.forModel({ ok: true, summary: 's', data: { a: 1 }, display: { type: 'image', src: 'data:...' }, vision: { data: 'x' } });
  assert.deepEqual(out, { ok: true, summary: 's', data: { a: 1 } });
});

test('write_text_file asks before overwriting an existing file only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-test-'));
  const file = path.join(dir, 'a.txt');
  let asked = 0;
  const ctx = { confirm: async () => { asked++; return true; } };
  await tools.execute('write_text_file', { path: file, content: 'one' }, ctx);
  assert.equal(asked, 0);
  await tools.execute('write_text_file', { path: file, content: 'two' }, ctx);
  assert.equal(asked, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  fs.rmSync(dir, { recursive: true });
});

test('organize_folder sorts files into kind folders', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-org-'));
  for (const f of ['a.pdf', 'b.jpg', 'c.zip', 'd.unknown']) fs.writeFileSync(path.join(dir, f), 'x');
  const r = await tools.execute('organize_folder', { path: dir }, { confirm: async () => true });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'Belgeler', 'a.pdf')));
  assert.ok(fs.existsSync(path.join(dir, 'Resimler', 'b.jpg')));
  assert.ok(fs.existsSync(path.join(dir, 'Arşivler', 'c.zip')));
  assert.ok(fs.existsSync(path.join(dir, 'Diğer', 'd.unknown')));
  fs.rmSync(dir, { recursive: true });
});

test('parsers: RSS, HTML and key combos', () => {
  const rss = '<rss><channel><item><title>Başlık - Kaynak</title><link>https://x</link><source url="y">Kaynak</source><pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  assert.deepEqual(parseRss(rss)[0], { title: 'Başlık', link: 'https://x', date: 'Tue, 14 Oct 2026 10:00:00 GMT', source: 'Kaynak' });
  assert.equal(htmlToText('<p>Merhaba&nbsp;<b>dünya</b></p><script>x()</script>'), 'Merhaba dünya');
  assert.deepEqual(parseCombo('Ctrl + Shift + T'), ['ctrl', 'shift', 't']);
  assert.throws(() => parseCombo(''));
});

test('store and scheduler persist alarms and fire due items', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-store-'));
  const file = path.join(dir, 's.json');
  const store = new Store(file, { schedule: [] });
  const sched = new Scheduler(store);
  const fired = new Promise((resolve) => sched.once('fire', resolve));
  sched.add({ kind: 'timer', label: 'Çay', endsAt: Date.now() + 50 });
  const alarm = sched.add({ kind: 'alarm', label: 'Sabah', endsAt: Date.now() + 3600e3 });
  assert.equal(sched.find('çay').label, 'Çay');
  assert.equal((await fired).label, 'Çay');
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schedule[0].id, alarm.id);
  assert.equal(sched.remove(alarm.id), true);
  fs.rmSync(dir, { recursive: true });
});

test('YouTube results parse to the first real video', () => {
  const { parseYouTube } = require('../src/main/tools/actions');
  const html = '..."adSlotRenderer":{}..."videoRenderer":{"videoId":"dQw4w9WgXcQ","thumbnail":{},"title":{"runs":[{"text":"Rick Astley \\u0026 Friends"}]}}...';
  assert.deepEqual(parseYouTube(html, 'x'), { id: 'dQw4w9WgXcQ', title: 'Rick Astley & Friends' });
  assert.equal(parseYouTube('"videoId":"abcdefghijk"', 'q').id, 'abcdefghijk');
  assert.throws(() => parseYouTube('<html></html>', 'q'));
});

test('install and Claude Code tools ask before running', async () => {
  let asked = 0;
  const deny = { confirm: async () => { asked++; return false; } };
  assert.equal((await tools.execute('steam_install', { game: 'x' }, deny)).denied, true);
  assert.equal((await tools.execute('ask_claude_code', { prompt: 'x', project_path: '~' }, deny)).denied, true);
  assert.equal(asked, 2);
});

test('run_steps runs tools in order and stops at the first failure or refusal', async () => {
  const ok = await tools.execute('run_steps', { steps: [
    { tool: 'calculate', args_json: '{"expression":"6*7"}' },
    { tool: 'calculate', args_json: '{"expression":"2+2"}', wait_ms: 10 }
  ] }, {});
  assert.deepEqual(ok.data.map((d) => d.data.result), [42, 4]);

  const stopped = await tools.execute('run_steps', { steps: [
    { tool: 'calculate', args_json: '{"expression":"1+"}' },
    { tool: 'calculate', args_json: '{"expression":"1"}' }
  ] }, {});
  assert.equal(stopped.data.length, 1);
  assert.match(stopped.summary, /1\. adımda/);

  let asked = 0;
  const refused = await tools.execute('run_steps', { steps: [{ tool: 'run_command', args_json: '{"command":"echo x"}' }] }, { confirm: async () => { asked++; return false; } });
  assert.equal(asked, 1);
  assert.equal(refused.data[0].denied, true);

  const nested = await tools.execute('run_steps', { steps: [{ tool: 'run_steps', args_json: '{}' }] }, {});
  assert.equal(nested.data[0].ok, false);
});

test('array parameters accept a JSON string from the model', () => {
  const out = tools.coerce({ steps: '[{"tool":"calculate"}]' }, { steps: { type: 'array', items: { type: 'object' } } });
  assert.deepEqual(out.steps, [{ tool: 'calculate' }]);
});

test('the full library has 500+ tools; only core tools are declared to the live model', () => {
  assert.ok(tools.TOOLS.length >= 500, `only ${tools.TOOLS.length} tools`);
  const declared = tools.declarations().map((d) => d.name);
  assert.ok(declared.length < 140, `${declared.length} declarations is too many for a live session`);
  for (const n of ['find_tools', 'use_tool', 'find_a_way', 'run_steps', 'open_app']) assert.ok(declared.includes(n), n);
  assert.ok(!declared.some((n) => /^(settings|site|search|key|text|calc|info|sys|files|dev)_/.test(n) && !['search_files'].includes(n)));
  const index = tools.packIndex();
  for (const t of tools.TOOLS.filter((x) => x.pack)) assert.ok(index.includes(t.name), `${t.name} missing from the pack index`);
});

test('find_tools ranks library tools by Turkish keywords', async () => {
  const r = await tools.execute('find_tools', { query: 'bluetooth ayarları' }, {});
  assert.ok(r.ok);
  assert.ok(r.data.tools.some((t) => /bluetooth/.test(t.name)), JSON.stringify(r.data.tools.map((t) => t.name)));
  const none = await tools.execute('find_tools', { query: 'zzqx' }, {});
  assert.ok(none.ok);
  assert.equal(none.data.tools.length, 0);
});

test('use_tool runs a library tool, reports failures and refuses nesting', async () => {
  const ok = await tools.execute('use_tool', { name: 'calc_factorial', args_json: '{"n":5}' }, {});
  assert.ok(ok.ok, ok.summary);
  assert.match(ok.summary, /120/);
  const missing = await tools.execute('use_tool', { name: 'calc_factorial', args_json: '{}' }, {});
  assert.equal(missing.ok, false);
  assert.ok(missing.data.params);
  const unknown = await tools.execute('use_tool', { name: 'nope_tool' }, {});
  assert.equal(unknown.ok, false);
  const nested = await tools.execute('use_tool', { name: 'run_steps', args_json: '{}' }, {});
  assert.equal(nested.ok, false);
});

test('use_tool still routes dangerous library tools through confirmation', async () => {
  const danger = tools.TOOLS.find((t) => t.pack && t.danger === true && Object.values(t.params || {}).every((p) => !p.required));
  assert.ok(danger, 'expected at least one dangerous pack tool without required params');
  let asked = 0;
  const r = await tools.execute('use_tool', { name: danger.name, args_json: '{}' }, { confirm: async () => { asked++; return false; } });
  assert.equal(asked, 1);
  assert.equal(r.ok, false);
  assert.equal(r.denied, true);
});
