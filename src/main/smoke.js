'use strict';

/*
 * `npm run smoke`: boots the real app, runs every tool that is safe to run unattended
 * (nothing that deletes, types, clicks, changes volume or power), captures both windows
 * and exits non-zero if a tool that should work everywhere failed.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SAFE = [
  ['system_overview', {}], ['cpu_usage', {}], ['memory_usage', {}], ['battery_status', {}], ['disk_space', {}],
  ['network_info', {}], ['list_displays', {}], ['current_datetime', {}],
  ['calculate', { expression: '(1250*12)*0.82 + 10%' }], ['convert_units', { value: 72, from: 'f', to: 'c' }],
  ['world_clock', { places: ['Tokyo', 'New York', 'Istanbul'] }], ['generate_password', { length: 16 }],
  ['random_pick', { mode: 'dice' }],
  ['set_timer', { minutes: 0.05, label: 'Smoke' }], ['list_timers', {}],
  ['add_note', { text: 'Smoke test notu' }], ['list_notes', {}], ['add_todo', { text: 'Smoke görevi' }], ['complete_todo', { query: 'Smoke' }],
  ['clipboard_write', { text: 'Vektör pano testi' }], ['clipboard_read', {}], ['clipboard_history', {}],
  ['take_screenshot', {}],
  ['list_directory', { path: '~' }], ['create_folder', { path: path.join(os.tmpdir(), 'vektor-smoke') }],
  ['write_text_file', { path: path.join(os.tmpdir(), 'vektor-smoke', 'a.txt'), content: 'merhaba' }],
  ['append_text_file', { path: path.join(os.tmpdir(), 'vektor-smoke', 'a.txt'), content: 'dünya' }],
  ['read_text_file', { path: path.join(os.tmpdir(), 'vektor-smoke', 'a.txt') }],
  ['copy_path', { source: path.join(os.tmpdir(), 'vektor-smoke', 'a.txt'), destination: path.join(os.tmpdir(), 'vektor-smoke', 'b.txt') }],
  ['move_path', { source: path.join(os.tmpdir(), 'vektor-smoke', 'b.txt'), destination: path.join(os.tmpdir(), 'vektor-smoke', 'c.txt') }],
  ['file_info', { path: path.join(os.tmpdir(), 'vektor-smoke') }],
  ['search_files', { query: '*.txt', path: path.join(os.tmpdir(), 'vektor-smoke') }],
  ['recent_files', { path: path.join(os.tmpdir(), 'vektor-smoke') }],
  ['compress_zip', { path: path.join(os.tmpdir(), 'vektor-smoke', 'a.txt') }],
  ['check_port', { port: 9 }],
  ['list_running_apps', { limit: 5 }],
  ['git_status', { path: process.cwd() }]
];

// Network-dependent tools are reported but never fail the run.
const NETWORK = [
  ['dns_lookup', { domain: 'google.com' }], ['check_website', { url: 'example.com' }], ['get_weather', { city: 'Ankara' }],
  ['convert_currency', { amount: 100, from: 'USD', to: 'TRY' }], ['wikipedia_summary', { topic: 'Mustafa Kemal Atatürk' }],
  ['get_news', {}], ['public_ip', {}], ['read_webpage', { url: 'example.com' }]
];

async function runSmoke({ tools, ctx, windows, app, outDir }) {
  fs.rmSync(path.join(os.tmpdir(), 'vektor-smoke'), { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  let failed = 0;
  for (const [list, strict] of [[SAFE, true], [NETWORK, false]]) {
    for (const [name, args] of list) {
      const r = await tools.execute(name, args, ctx);
      report.push(`${r.ok ? 'OK  ' : strict ? 'FAIL' : 'SKIP'} ${name.padEnd(20)} ${r.ms}ms  ${String(r.summary).replace(/\s+/g, ' ').slice(0, 110)}`);
      if (!r.ok && strict) failed++;
      windows.main?.webContents.send('tool:event', { type: 'smoke', name, ok: r.ok });
    }
  }
  await new Promise((res) => setTimeout(res, 1200));
  for (const [key, win] of Object.entries(windows)) {
    if (!win || win.isDestroyed()) continue;
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${key}.png`), img.toPNG());
  }
  console.log(['', '── Vektör smoke test ──', ...report, `── ${report.length} araç, ${failed} başarısız ──`, ''].join('\n'));
  app.exit(failed ? 1 : 0);
}

module.exports = { runSmoke };
