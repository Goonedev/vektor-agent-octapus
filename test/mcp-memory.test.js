'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tools = require('../src/main/tools');
const { McpManager, parseConfig } = require('../src/main/mcp');
const { History } = require('../src/main/history');
const { Store } = require('../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-mm-'));

test('MCP config accepts the Claude Desktop shape and rejects bad input', () => {
  const list = parseConfig('{"mcpServers":{"a":{"command":"node","args":["x.js"]},"b":{"url":"https://e.com/mcp","disabled":true}}}');
  assert.equal(list.length, 2);
  assert.equal(list[1].disabled, true);
  assert.deepEqual(parseConfig(''), []);
  assert.throws(() => parseConfig('{bad'), /JSON/);
  assert.throws(() => parseConfig('{"mcpServers":{"a":{}}}'), /command/);
});

test('an MCP server over stdio joins the library and its tools run through approvals', async () => {
  const mgr = new McpManager({ setDynamic: tools.setDynamic });
  const config = JSON.stringify({ mcpServers: { 'Yankı Test': { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'mcp-echo-server.js')] } } });
  try {
    const status = await mgr.apply(config);
    assert.equal(status[0].state, 'connected', JSON.stringify(status));
    assert.equal(status[0].tools, 3);
    const echo = tools.TOOLS.find((t) => t.name === 'mcp_yanki_test_echo');
    assert.ok(echo, tools.TOOLS.filter((t) => t.source === 'mcp').map((t) => t.name).join(','));
    assert.equal(echo.danger, false);
    assert.ok(tools.packIndex().includes('mcp_yanki_test_increment'));
    assert.ok(!tools.declarations().some((d) => d.name.startsWith('mcp_')));

    const r = await tools.execute('use_tool', { name: 'mcp_yanki_test_echo', args_json: '{"text":"merhaba"}' }, {});
    assert.ok(r.ok, r.summary);
    assert.equal(r.summary, 'yankı: merhaba');

    let asked = 0;
    const denied = await tools.execute('mcp_yanki_test_increment', { by: 2 }, { confirm: async () => { asked++; return false; } });
    assert.equal(asked, 1);
    assert.equal(denied.denied, true);
    const inc = await tools.execute('mcp_yanki_test_increment', { by: 2 }, { confirm: async () => true });
    assert.equal(inc.summary, '2');

    const bad = await tools.execute('mcp_yanki_test_fail', {}, { confirm: async () => true });
    assert.equal(bad.ok, false);
    assert.match(bad.summary, /olmadı/);

    const found = await tools.execute('find_tools', { query: 'yankı' }, {});
    assert.ok(found.data.tools.some((t) => t.name === 'mcp_yanki_test_echo'));
  } finally {
    await mgr.closeAll();
  }
  assert.ok(!tools.TOOLS.some((t) => t.source === 'mcp'));
});

test('a broken MCP server reports an error instead of throwing', async () => {
  const mgr = new McpManager({ setDynamic: tools.setDynamic });
  const status = await mgr.apply(JSON.stringify({ mcpServers: { yok: { command: 'vektor-no-such-binary-xyz' } } }));
  assert.equal(status[0].state, 'error');
  assert.ok(status[0].error);
  await mgr.closeAll();
});

test('memory: remember, recall, refuse secrets, forget', async () => {
  const store = new Store(path.join(tmp(), 's.json'), { memory: [], skills: [] });
  const ctx = { store, confirm: async () => true };
  assert.ok((await tools.execute('remember', { text: 'Kullanıcının adı Kadir.' }, ctx)).ok);
  assert.match((await tools.execute('remember', { text: 'kullanıcının adı kadir.' }, ctx)).summary, /zaten/);
  const secret = await tools.execute('remember', { text: 'Gmail şifrem 1234' }, ctx);
  assert.equal(secret.ok, false);
  assert.equal(store.get('memory').length, 1);
  assert.match((await tools.execute('recall', { query: 'adı' }, ctx)).summary, /Kadir/);
  const f = await tools.execute('forget', { query: 'kadir' }, ctx);
  assert.ok(f.ok, f.summary);
  assert.equal(store.get('memory').length, 0);
});

test('skills: save validates steps, run goes through run_steps and approvals', async () => {
  const store = new Store(path.join(tmp(), 's.json'), { memory: [], skills: [] });
  let asked = 0;
  const ctx = { store, confirm: async () => { asked++; return false; } };
  const badTool = await tools.execute('skill_save', { name: 'x', steps: [{ tool: 'nope' }] }, ctx);
  assert.equal(badTool.ok, false);
  const nested = await tools.execute('skill_save', { name: 'x', steps: [{ tool: 'run_steps' }] }, ctx);
  assert.equal(nested.ok, false);
  const saved = await tools.execute('skill_save', {
    name: 'Hesap modu',
    steps: [{ tool: 'calc_roman', args_json: '{"value":"12"}' }, { tool: 'forget', args_json: '{"all":true}' }]
  }, ctx);
  assert.ok(saved.ok, saved.summary);
  const run = await tools.execute('skill_run', { name: 'hesap modu' }, ctx);
  assert.equal(run.ok, false); // the second step needs approval and was refused
  assert.equal(asked, 1);
  assert.match(run.summary, /1 tanesi yapıldı/);
  assert.equal(store.get('skills')[0].runs, 1);
  assert.match((await tools.execute('skill_list', {}, ctx)).summary, /Hesap modu/);
});

test('history appends, searches Turkish-insensitively and trims', () => {
  const h = new History(path.join(tmp(), 'h.jsonl'));
  h.add({ role: 'user', text: 'İstanbul hava durumu', session: 's1' });
  h.add({ role: 'model', text: 'İstanbul 18 derece.', session: 's1' });
  h.add({ role: 'tool', text: 'Hava durumu', tool: 'get_weather', session: 's1' });
  h.add({ role: 'user', text: '   ' });
  assert.equal(h.all().length, 3);
  assert.equal(h.search({ query: 'istanbul' }).length, 2);
  assert.equal(h.search({ query: 'istanbul' })[0].role, 'model');
  assert.equal(h.recent(5).length, 2);
  h.clear();
  assert.equal(h.all().length, 0);
});
