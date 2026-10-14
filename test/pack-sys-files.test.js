'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sysinfo = require('../src/main/tools/packs/sysinfo');
const fileops = require('../src/main/tools/packs/fileops');
const { TOOLS } = require('../src/main/tools');

const P = sysinfo.parsers;
const H = fileops.helpers;
const CATS = new Set('web apps files system control media clipboard input windows productivity utility network dev settings sites shortcuts text info'.split(' '));
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array']);
const byName = (list, n) => list.find((t) => t.name === n);
const S = (n) => byName(sysinfo, n);
const F = (n) => byName(fileops, n);

const created = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vektor-pack-sf-'));
  created.push(d);
  return d;
}
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });
function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

/* ---------------------------------------------------------------- shape */

for (const [label, list, count, prefix, category] of [['sysinfo', sysinfo, 42, 'sys_', 'system'], ['fileops', fileops, 15, 'files_', 'files']]) {
  test(`${label} exports ${count} well-formed tools`, () => {
    assert.ok(Array.isArray(list));
    assert.equal(list.length, count);
    for (const t of list) {
      assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/);
      assert.ok(t.name.startsWith(prefix), `${t.name} must use ${prefix}`);
      assert.equal(t.category, category, `${t.name} category`);
      assert.ok(CATS.has(t.category));
      assert.equal(typeof t.title, 'string');
      assert.ok(t.title.length > 2);
      assert.equal(typeof t.description, 'string');
      assert.ok(t.description.length > 10);
      assert.equal(typeof t.run, 'function');
      assert.ok(t.danger === undefined || typeof t.danger === 'boolean' || typeof t.danger === 'function');
      if (t.timeout !== undefined) assert.ok(Number.isInteger(t.timeout) && t.timeout > 0);
      for (const [k, p] of Object.entries(t.params || {})) {
        assert.ok(TYPES.has(p.type), `${t.name}.${k} type ${p.type}`);
        assert.equal(typeof p.description, 'string', `${t.name}.${k} description`);
        assert.ok(p.required === undefined || p.required === true, `${t.name}.${k} required flag`);
        if (p.enum) assert.ok(Array.isArray(p.enum) && p.enum.length);
        if (p.type === 'array') assert.ok(TYPES.has(p.items?.type));
      }
    }
  });
}

test('pack tool names are unique and do not collide with the registry', () => {
  const names = [...sysinfo, ...fileops].map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  // The registry copies pack tools, so recognise ours by their run function.
  const mine = new Set([...sysinfo, ...fileops].map((t) => t.run));
  const existing = new Set(TOOLS.filter((t) => !mine.has(t.run)).map((t) => t.name));
  for (const n of names) assert.ok(!existing.has(n), `${n} already exists`);
});

test('dangerous tools are flagged; preview rename and fresh merge are not', () => {
  for (const n of ['sys_restart_service', 'sys_set_default_printer', 'sys_flush_dns', 'sys_clean_temp', 'sys_set_power_plan', 'sys_restart_explorer', 'sys_winget_install', 'sys_winget_upgrade']) {
    assert.equal(S(n).danger, true, n);
  }
  for (const n of ['sys_installed_programs', 'sys_wifi_profiles', 'sys_env_vars', 'sys_hosts_file']) assert.ok(!S(n).danger, n);
  assert.equal(F('files_find_replace').danger, true);
  const rename = F('files_bulk_rename').danger;
  assert.equal(rename({ preview: true }), false);
  assert.equal(rename({ preview: false }), true);
  assert.equal(rename({}), true);
  const dir = tmp();
  const merge = F('files_merge_text').danger;
  assert.equal(merge({ output: path.join(dir, 'yok.txt') }), false);
  assert.equal(merge({ output: put(dir, 'var.txt', 'x') }), true);
  assert.equal(merge({}), false);
});

/* -------------------------------------------------------------- parsers */

test('winget table parser reads positional columns and skips spinners/footers', () => {
  const row = (...c) => c[0].padEnd(28) + c[1].padEnd(30) + c[2].padEnd(12) + c[3].padEnd(12) + c[4];
  const text = [
    '   - \r   \\ \r',
    row('Name', 'Id', 'Version', 'Available', 'Source'),
    '-'.repeat(90),
    row('Mozilla Firefox (x64 tr)', 'Mozilla.Firefox', '130.0', '131.0.2', 'winget'),
    row('Visual Studio Code', 'Microsoft.VisualStudioCode', '1.93.1', '1.94.2', 'winget'),
    '2 upgrades available.',
    '',
    'The following packages have an upgrade available, but require explicit targeting for upgrade:'
  ].join('\r\n');
  const rows = P.parseWingetTable(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Mozilla Firefox (x64 tr)', id: 'Mozilla.Firefox', version: '130.0', extra: ['131.0.2'], source: 'winget' });
  assert.equal(rows[1].id, 'Microsoft.VisualStudioCode');

  const search = [
    'Ad'.padEnd(10) + 'Kimlik'.padEnd(20) + 'Sürüm'.padEnd(10) + 'Kaynak',
    '-'.repeat(46),
    'VLC'.padEnd(10) + 'VideoLAN.VLC'.padEnd(20) + '3.0.21'.padEnd(10) + 'winget'
  ].join('\n');
  assert.deepEqual(P.parseWingetTable(search), [{ name: 'VLC', id: 'VideoLAN.VLC', version: '3.0.21', extra: [], source: 'winget' }]);
  assert.deepEqual(P.parseWingetTable('No package found matching input criteria.'), []);
  assert.equal(P.wingetTail('a\n-\r\\\r\n  ██████▒▒ 50%\nBaşarıyla yüklendi\n'), 'a\nBaşarıyla yüklendi');
});

test('netsh network parser handles English and Turkish output', () => {
  const en = `
Interface name : Wi-Fi
There are 2 networks currently visible.

SSID 1 : HomeNet
    Network type            : Infrastructure
    Authentication          : WPA2-Personal
    Encryption              : CCMP
    BSSID 1                 : aa:bb:cc:dd:ee:01
         Signal             : 54%
         Channel            : 6
    BSSID 2                 : aa:bb:cc:dd:ee:02
         Signal             : 91%
         Channel            : 36

SSID 2 :
    Network type            : Infrastructure
    Authentication          : Open
    BSSID 1                 : aa:bb:cc:dd:ee:03
         Signal             : 20%
`;
  const nets = P.parseNetshNetworks(en);
  assert.equal(nets.length, 2);
  assert.deepEqual(nets[0], { ssid: 'HomeNet', signal: 91, auth: 'WPA2-Personal', channel: '6', bssids: 2 });
  assert.equal(nets[1].ssid, '(gizli ağ)');
  assert.equal(nets[1].auth, 'Open');

  const tr = 'SSID 1 : Kafe\r\n    Ağ türü                 : Altyapı\r\n    Kimlik doğrulama        : WPA3-Kişisel\r\n    BSSID 1                 : 11:22:33:44:55:66\r\n         Sinyal             : %72\r\n         Kanal              : 11\r\n';
  assert.deepEqual(P.parseNetshNetworks(tr), [{ ssid: 'Kafe', signal: 72, auth: 'WPA3-Kişisel', channel: '11', bssids: 1 }]);
});

test('netsh profile and interface parsers', () => {
  const profiles = `
Profiles on interface Wi-Fi:

Group policy profiles (read only)
---------------------------------
    <None>

User profiles
-------------
    All User Profile     : HomeNet
    All User Profile     : Ofis: 5G
    Tüm Kullanıcı Profili : Kafe
`;
  assert.deepEqual(P.parseNetshProfiles(profiles), ['HomeNet', 'Ofis: 5G', 'Kafe']);

  const iface = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201 160MHz
    State                  : connected
    SSID                   : HomeNet
    AP BSSID               : aa:bb:cc:dd:ee:02
    Radio type             : 802.11ax
    Authentication         : WPA2-Personal
    Channel                : 36
    Receive rate (Mbps)    : 1201
    Transmit rate (Mbps)   : 960.5
    Signal                 : 91%
`;
  const w = P.parseWlanInterface(iface);
  assert.equal(w.ssid, 'HomeNet');
  assert.equal(w.bssid, 'aa:bb:cc:dd:ee:02');
  assert.equal(w.signal, 91);
  assert.equal(w.receive, '1201');
  assert.equal(w.transmit, '960.5');
  assert.equal(w.channel, '36');
  assert.equal(w.radio, '802.11ax');
  const trIface = '    Ad                     : Wi-Fi\n    Durum                  : bağlı\n    SSID                   : Kafe\n    Alma hızı (Mbps)       : 300\n    İletim hızı (Mbps)     : 150\n    Sinyal                 : %64\n';
  const t = P.parseWlanInterface(trIface);
  assert.deepEqual([t.ssid, t.signal, t.receive, t.transmit, t.state], ['Kafe', 64, '300', '150', 'bağlı']);
  assert.equal(P.parseWlanInterface('There is no wireless interface on the system.').ssid, '');
});

test('powercfg, ps, ss, lpstat, os-release and nmcli parsers', () => {
  const list = `
Existing Power Schemes (* Active)
-----------------------------------
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *
Power Scheme GUID: 8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C  (Yüksek performans)
`;
  assert.deepEqual(P.parsePowerSchemes(list), [
    { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced', active: true },
    { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'Yüksek performans', active: false }
  ]);

  const procs = P.parsePs('  101  12.5  2048 /usr/bin/node\n  102   3.0  1024 node\n  7 0,5 512 /Applications/Safari.app/Contents/MacOS/Safari\nbad line\n');
  assert.equal(procs.length, 3);
  assert.deepEqual(procs[0], { pid: 101, cpu: 12.5, mem: 2048 * 1024, name: 'node' });
  assert.equal(procs[2].cpu, 0.5);
  const g = P.groupProcs([...procs, { name: 'chrome.exe', cpu: 1, mem: 10 }, { name: 'chrome', cpu: 2, mem: 20 }]);
  const node = g.find((x) => x.name === 'node');
  assert.deepEqual([node.count, node.cpu, node.mem], [2, 15.5, 3072 * 1024]);
  assert.deepEqual(g.find((x) => x.name === 'chrome'), { name: 'chrome', cpu: 3, mem: 30, count: 2 });

  const ss = P.parseSs('LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=612,fd=14))\nLISTEN 0 511 [::]:8080 [::]:*\n');
  assert.deepEqual(ss, [
    { address: '127.0.0.53', port: 53, process: 'systemd-resolve', pid: 612 },
    { address: '[::]', port: 8080, process: '', pid: null }
  ]);

  const lp = P.parseLpstat('printer HP_LaserJet is idle.  enabled since Mon\nprinter Canon disabled since Tue -\n\treason unknown\nsystem default destination: HP_LaserJet\n');
  assert.deepEqual(lp, { printers: [{ name: 'HP_LaserJet', status: 'Hazır' }, { name: 'Canon', status: 'Devre dışı' }], default: 'HP_LaserJet' });

  assert.deepEqual(P.parseOsRelease('NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n# c\n'), { NAME: 'Ubuntu', VERSION_ID: '24.04', PRETTY_NAME: 'Ubuntu 24.04.1 LTS' });
  assert.deepEqual(P.splitNmcli('yes:Ofis\\:5G:78:130 Mbit/s'), ['yes', 'Ofis:5G', '78', '130 Mbit/s']);
});

/* ------------------------------------------------------- portable sys tools */

test('uptime, env vars and hosts work on any OS', async () => {
  const up = await S('sys_uptime').run({}, {});
  assert.equal(up.display.type, 'value');
  assert.ok(up.data.seconds >= 0);

  process.env.VEKTOR_TEST_API_KEY = 'gizli-deger-123';
  process.env.VEKTOR_TEST_PLAIN = 'merhaba-dunya';
  try {
    const env = await S('sys_env_vars').run({ filter: 'vektor_test' }, {});
    assert.equal(env.display.items.length, 2);
    assert.equal(env.data.VEKTOR_TEST_PLAIN, 'merhaba-dunya');
    assert.ok(!JSON.stringify(env).includes('gizli-deger-123'));
    const none = await S('sys_env_vars').run({ filter: 'gizli-deger' }, {});
    assert.equal(none.display.items.length, 0);
  } finally {
    delete process.env.VEKTOR_TEST_API_KEY;
    delete process.env.VEKTOR_TEST_PLAIN;
  }

  if (fs.existsSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts')) {
    const hosts = await S('sys_hosts_file').run({}, {});
    assert.equal(hosts.display.type, 'code');
    assert.ok(Array.isArray(hosts.data.entries));
  }
});

test('temp size and temp cleanup only remove files older than a day', { skip: process.platform === 'win32' }, async () => {
  const sandbox = tmp();
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = sandbox;
  try {
    assert.equal(os.tmpdir(), sandbox);
    const old = Date.now() / 1000 - 3 * 86400;
    const oldFile = put(sandbox, 'eski.log', 'x'.repeat(1000));
    const oldNested = put(sandbox, 'eski-klasor/a.tmp', 'y'.repeat(500));
    const fresh = put(sandbox, 'yeni.log', 'z'.repeat(200));
    const keep = put(sandbox, 'vektor-native/VektorNative.dll', 'dll');
    for (const f of [oldFile, oldNested, keep]) fs.utimesSync(f, old, old);
    fs.utimesSync(path.join(sandbox, 'eski-klasor'), old, old);

    const size = await S('sys_temp_size').run({}, {});
    assert.equal(size.data.bytes, 1700);
    assert.equal(size.data.files, 3);

    const clean = await S('sys_clean_temp').run({}, {});
    assert.equal(clean.data.freedBytes, 1500);
    assert.equal(clean.data.deleted, 2);
    assert.ok(!fs.existsSync(oldFile));
    assert.ok(!fs.existsSync(path.join(sandbox, 'eski-klasor')));
    assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(keep));
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Windows-only tools fail with a readable unsupported error elsewhere', { skip: process.platform === 'win32' }, async () => {
  for (const n of ['sys_ram_modules', 'sys_restart_explorer', 'sys_winget_search', 'sys_battery_report', 'sys_drivers']) {
    await assert.rejects(() => S(n).run({ query: 'vlc' }, {}), /desteklenmiyor/, n);
  }
  await assert.rejects(() => S('sys_set_power_plan').run({ plan: 'turbo' }, {}), /Geçerli planlar/);
  await assert.rejects(() => S('sys_service_status').run({ name: '--help' }, {}), /"-" ile başlayamaz/);
});

/* ------------------------------------------------------------ file tools */

function fixture() {
  const dir = tmp();
  put(dir, 'a.txt', 'merhaba dünya\nikinci satır\n');
  put(dir, 'b.md', '# başlık\n');
  put(dir, 'alt/kopya1.bin', Buffer.alloc(4096, 7));
  put(dir, 'alt/derin/kopya2.bin', Buffer.alloc(4096, 7));
  put(dir, 'alt/farkli.bin', Buffer.alloc(4096, 8));
  put(dir, 'buyuk/video.mp4', Buffer.alloc(3 * 1024 * 1024, 1));
  put(dir, 'buyuk/orta.zip', Buffer.alloc(1024 * 1024 + 10, 2));
  fs.mkdirSync(path.join(dir, 'bos/ic/icic'), { recursive: true });
  put(dir, 'bos/ic/desktop.ini', '[x]');
  fs.mkdirSync(path.join(dir, 'tek-bos'));
  return dir;
}

test('folder size totals files and ranks subfolders', async () => {
  const dir = fixture();
  const r = await F('files_folder_size').run({ path: dir }, {});
  const expected = Buffer.byteLength('merhaba dünya\nikinci satır\n') + Buffer.byteLength('# başlık\n') + 3 * 4096 + 3 * 1024 * 1024 + 1024 * 1024 + 10 + 3;
  assert.equal(r.data.bytes, expected);
  assert.equal(r.data.files, 8);
  assert.equal(r.display.items[0].title, 'buyuk');
  assert.equal(r.display.items[0].path, path.join(dir, 'buyuk'));
  assert.ok(r.display.items.some((i) => i.title === '(bu klasördeki dosyalar)'));
  await assert.rejects(() => F('files_folder_size').run({ path: path.join(dir, 'a.txt') }, {}), /klasör değil/);
  await assert.rejects(() => F('files_folder_size').run({ path: path.join(dir, 'yok') }, {}), /bulunamadı/);
});

test('big file finder honours min_mb and top', async () => {
  const dir = fixture();
  const r = await F('files_find_large').run({ path: dir, min_mb: 1 }, {});
  assert.equal(r.data.count, 2);
  assert.deepEqual(r.display.items.map((i) => i.title), ['video.mp4', 'orta.zip']);
  const one = await F('files_find_large').run({ path: dir, min_mb: 1, top: 1 }, {});
  assert.equal(one.display.items.length, 1);
  const none = await F('files_find_large').run({ path: dir }, {});
  assert.equal(none.data.count, 0);
});

test('duplicate finder groups identical content only', async () => {
  const dir = fixture();
  const r = await F('files_find_duplicates').run({ path: dir }, {});
  assert.equal(r.data.groups, 1);
  assert.equal(r.data.wastedBytes, 4096);
  assert.deepEqual(r.data.top[0].files.sort(), [path.join('alt', 'derin', 'kopya2.bin'), path.join('alt', 'kopya1.bin')].sort());
  assert.ok(fs.existsSync(path.join(dir, 'alt/kopya1.bin')) && fs.existsSync(path.join(dir, 'alt/derin/kopya2.bin')));
});

test('count by type groups extensions', async () => {
  const dir = fixture();
  put(dir, 'README', 'x');
  const r = await F('files_count_by_type').run({ path: dir }, {});
  const types = Object.fromEntries(r.data.types.map((t) => [t.ext, t.count]));
  assert.equal(types.bin, 3);
  assert.equal(types.txt, 1);
  assert.equal(types['(uzantısız)'], 1);
  assert.equal(r.data.files, 9);
  assert.equal(r.display.items[0].title, '.bin');
});

test('bulk rename previews without touching files, then applies', async () => {
  const dir = tmp();
  for (const n of ['IMG_001.jpg', 'IMG_002.jpg', 'notlar.txt', 'tatil_001.jpg']) put(dir, n, n);
  const pv = await F('files_bulk_rename').run({ path: dir, find: 'IMG_', replace: 'tatil_', preview: true }, {});
  assert.equal(pv.data.preview, true);
  assert.equal(pv.data.count, 1);
  assert.equal(pv.data.skipped, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['IMG_001.jpg', 'IMG_002.jpg', 'notlar.txt', 'tatil_001.jpg']);

  const ap = await F('files_bulk_rename').run({ path: dir, find: 'IMG_', replace: 'tatil_' }, {});
  assert.equal(ap.data.renamed, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['IMG_001.jpg', 'notlar.txt', 'tatil_001.jpg', 'tatil_002.jpg']);
  assert.equal(fs.readFileSync(path.join(dir, 'tatil_002.jpg'), 'utf8'), 'IMG_002.jpg');
  assert.equal(fs.readFileSync(path.join(dir, 'tatil_001.jpg'), 'utf8'), 'tatil_001.jpg');

  const rx = await F('files_bulk_rename').run({ path: dir, find: '^(\\w+)_(\\d+)\\.jpg$', replace: '$2-$1.jpg', regex: true }, {});
  assert.equal(rx.data.renamed, 3);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['001-IMG.jpg', '001-tatil.jpg', '002-tatil.jpg', 'notlar.txt']);

  // A chain where a target is freed by another rename in the same batch.
  const chain = tmp();
  put(chain, 'b.txt', 'B'); put(chain, 'bb.txt', 'BB');
  const c = await F('files_bulk_rename').run({ path: chain, find: 'b', replace: 'bb' }, {});
  assert.equal(c.data.renamed, 2);
  assert.deepEqual(fs.readdirSync(chain).sort(), ['bb.txt', 'bbbb.txt']);
  assert.equal(fs.readFileSync(path.join(chain, 'bb.txt'), 'utf8'), 'B');
  assert.equal(fs.readFileSync(path.join(chain, 'bbbb.txt'), 'utf8'), 'BB');

  await assert.rejects(() => F('files_bulk_rename').run({ path: dir, find: '(', regex: true, preview: true }, {}), /Geçersiz düzenli ifade/);
  const bad = await F('files_bulk_rename').run({ path: dir, find: 'notlar', replace: 'a/b', preview: true }, {});
  assert.equal(bad.data.skipped, 1);
});

test('find-replace counts and rewrites text, refuses binaries', async () => {
  const dir = tmp();
  const p = put(dir, 'metin.txt', 'kedi köpek kedi\nKEDİ kuş kedi\n');
  const r = await F('files_find_replace').run({ path: p, find: 'kedi', replace: 'aslan' }, {});
  assert.equal(r.data.replaced, 3);
  assert.equal(fs.readFileSync(p, 'utf8'), 'aslan köpek aslan\nKEDİ kuş aslan\n');
  const none = await F('files_find_replace').run({ path: p, find: 'zürafa', replace: 'x' }, {});
  assert.equal(none.data.replaced, 0);
  const ci = await F('files_find_replace').run({ path: p, find: 'KÖPEK', replace: 'kurt', ignore_case: true }, {});
  assert.equal(ci.data.replaced, 1);
  const rx = await F('files_find_replace').run({ path: p, find: '(aslan) (kurt)', replace: '$2 $1', regex: true }, {});
  assert.equal(rx.data.replaced, 1);
  assert.ok(fs.readFileSync(p, 'utf8').startsWith('kurt aslan aslan\n'));
  const bin = put(dir, 'x.bin', Buffer.from([1, 0, 2, 0]));
  await assert.rejects(() => F('files_find_replace').run({ path: bin, find: 'a', replace: 'b' }, {}), /metin dosyası değil/);
});

test('hash matches known digests and checks expected values', async () => {
  const dir = tmp();
  const p = put(dir, 'abc.txt', 'abc');
  const sha = await F('files_hash').run({ path: p }, {});
  assert.equal(sha.data.hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const md5 = await F('files_hash').run({ path: p, algorithm: 'md5' }, {});
  assert.equal(md5.data.hash, '900150983cd24fb0d6963f7d28e17f72');
  const sha1 = await F('files_hash').run({ path: p, algorithm: 'sha1', expected: 'A9993E364706816ABA3E25717850C26C9CD0D89D' }, {});
  assert.equal(sha1.data.match, true);
  const bad = await F('files_hash').run({ path: p, algorithm: 'sha1', expected: 'deadbeef' }, {});
  assert.equal(bad.data.match, false);
  assert.match(bad.summary, /eşleşmiyor/);
});

test('compare reports identical files and the first differing line', async () => {
  const dir = tmp();
  const a = put(dir, 'a.txt', 'bir\niki\nüç\n');
  const b = put(dir, 'b.txt', 'bir\niki\nüç\n');
  const c = put(dir, 'c.txt', 'bir\nİKİ\nüç\n');
  const d = put(dir, 'd.txt', 'bir\r\niki\r\nüç\r\n');
  assert.equal((await F('files_compare').run({ first: a, second: b }, {})).data.identical, true);
  const diff = await F('files_compare').run({ first: a, second: c }, {});
  assert.equal(diff.data.identical, false);
  assert.equal(diff.data.firstDiffLine, 2);
  assert.equal(diff.data.line2, 'İKİ');
  const eol = await F('files_compare').run({ first: a, second: d }, {});
  assert.equal(eol.data.identical, false);
  assert.match(eol.summary, /satır sonları/);
  const bin1 = put(dir, 'x.bin', Buffer.from([0, 1, 2])), bin2 = put(dir, 'y.bin', Buffer.from([0, 1, 2, 3]));
  const binr = await F('files_compare').run({ first: bin1, second: bin2 }, {});
  assert.equal(binr.data.identical, false);
  assert.equal(binr.data.firstDiffLine, undefined);
});

test('tree draws an ASCII tree with depth and skips node_modules', async () => {
  const dir = tmp();
  put(dir, 'src/main/app.js', '');
  put(dir, 'src/index.js', '');
  put(dir, 'node_modules/x/y.js', '');
  put(dir, '.gizli', '');
  put(dir, 'README.md', '');
  const r = await F('files_tree').run({ path: dir, depth: 2 }, {});
  const lines = r.display.text.split('\n');
  assert.equal(lines[0], path.basename(dir));
  assert.deepEqual(lines.slice(1), ['├── node_modules/ …', '├── src/', '│   ├── main/', '│   └── index.js', '└── README.md']);
  const deep = await F('files_tree').run({ path: dir, depth: 3, dirs_only: true, hidden: true }, {});
  assert.ok(deep.display.text.endsWith('└── src/\n    └── main/'));
  assert.ok(!deep.display.text.includes('.gizli'));
  const hid = await F('files_tree').run({ path: dir, depth: 1, hidden: true }, {});
  assert.ok(hid.display.text.includes('.gizli'));
});

test('merge joins text files in order, optionally with headers', async () => {
  const dir = tmp();
  const a = put(dir, '1.txt', '\uFEFFbirinci\n');
  const b = put(dir, '2.txt', 'ikinci');
  const out = path.join(dir, 'cikti', 'hepsi.txt');
  const r = await F('files_merge_text').run({ inputs: [a, b], output: out }, {});
  assert.equal(r.data.files, 2);
  assert.equal(fs.readFileSync(out, 'utf8'), 'birinci\nikinci\n');
  await F('files_merge_text').run({ inputs: [b, a], output: out, headers: true }, {});
  assert.equal(fs.readFileSync(out, 'utf8'), '===== 2.txt =====\nikinci\n\n===== 1.txt =====\nbirinci\n');
  await assert.rejects(() => F('files_merge_text').run({ inputs: [a], output: out }, {}), /en az iki/);
  await assert.rejects(() => F('files_merge_text').run({ inputs: [a, out], output: out }, {}), /girdilerden biri/);
});

test('empty folder finder reports the outermost empty folders', async () => {
  const dir = fixture();
  const r = await F('files_find_empty_dirs').run({ path: dir }, {});
  assert.deepEqual(r.data.dirs.sort(), ['bos', 'tek-bos']);
  assert.ok(fs.existsSync(path.join(dir, 'bos/ic/icic')));
  const e = tmp();
  const self = await F('files_find_empty_dirs').run({ path: e }, {});
  assert.equal(self.data.rootEmpty, true);
});

test('copy path writes to the clipboard stub', async () => {
  const dir = tmp();
  const p = put(dir, 'dosya adı.txt', 'x');
  let clip = null;
  const ctx = { clip: { writeText: async (s) => { clip = s; } } };
  await F('files_copy_path').run({ path: p }, ctx);
  assert.equal(clip, p);
  await F('files_copy_path').run({ path: p, kind: 'name' }, ctx);
  assert.equal(clip, 'dosya adı.txt');
  await F('files_copy_path').run({ path: p, kind: 'folder' }, ctx);
  assert.equal(clip, dir);
  const r = await F('files_copy_path').run({ path: p, kind: 'url' }, ctx);
  assert.ok(clip.startsWith('file://') && clip.includes('dosya%20ad'));
  assert.equal(r.display.type, 'value');
  await assert.rejects(() => F('files_copy_path').run({ path: path.join(dir, 'yok.txt') }, ctx), /bulunamadı/);
});

test('image header sniffing and aspect-preserving sizes (no Electron needed)', async () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1');
  png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(H.imageHeader(png), { format: 'PNG', width: 640, height: 480 });

  const gif = Buffer.from('GIF89a\x20\x03\x58\x02\x00\x00\x00', 'latin1');
  assert.deepEqual(H.imageHeader(gif), { format: 'GIF', width: 800, height: 600 });

  // SOI, APP0 (len 16), SOF0 with 1920x1080
  const jpg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03]), Buffer.alloc(12)
  ]);
  assert.deepEqual(H.imageHeader(jpg), { format: 'JPEG', width: 1920, height: 1080 });
  assert.equal(H.imageHeader(Buffer.from('merhaba dünya')), null);

  assert.deepEqual(H.fitSize(4000, 3000, 800), { width: 800, height: 600 });
  assert.deepEqual(H.fitSize(4000, 3000, undefined, 300), { width: 400, height: 300 });
  assert.deepEqual(H.fitSize(4000, 3000, 1000, 1000), { width: 1000, height: 750 });
  assert.throws(() => H.fitSize(100, 100), /en az birini/);

  const dir = tmp();
  const p = put(dir, 'resim.png', png);
  const info = await F('files_image_info').run({ path: p }, {});
  assert.deepEqual([info.data.format, info.data.width, info.data.height], ['PNG', 640, 480]);
  assert.match(info.summary, /640×480/);
  await assert.rejects(() => F('files_resize_image').run({ path: p, width: 100 }, {}), /kullanılamıyor/);
});

test('hashFile helper agrees with crypto on a larger stream', async () => {
  const dir = tmp();
  const buf = crypto.randomBytes(300000);
  const p = put(dir, 'r.bin', buf);
  assert.equal(await H.hashFile(p, 'sha256'), crypto.createHash('sha256').update(buf).digest('hex'));
});
