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

test('the registry has exactly 100 uniquely named tools in known categories', () => {
  assert.equal(tools.TOOLS.length, 100);
  const names = new Set(tools.TOOLS.map((t) => t.name));
  assert.equal(names.size, 100);
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
