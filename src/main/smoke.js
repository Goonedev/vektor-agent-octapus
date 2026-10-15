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
  ['git_status', { path: process.cwd() }],
  // Library tools, through the same paths the model uses.
  ['find_tools', { query: 'bluetooth ayarları' }], ['use_tool', { name: 'calc_number_words', args_json: '{"number":"2026"}' }],
  ['text_upper', { text: 'istanbul' }], ['calc_roman', { value: '1994' }], ['calc_timezone', { time: '14:30', to: 'Tokyo' }],
  ['info_moon_phase', {}], ['dev_cron_explain', { expression: '*/15 9-17 * * 1-5' }], ['dev_versions', {}],
  ['sys_uptime', {}], ['sys_top_memory', {}],
  ['files_folder_size', { path: path.join(os.tmpdir(), 'vektor-smoke') }], ['files_tree', { path: path.join(os.tmpdir(), 'vektor-smoke') }],
  ['files_hash', { path: path.join(os.tmpdir(), 'vektor-smoke', 'a.txt') }], ['files_count_by_type', { path: path.join(os.tmpdir(), 'vektor-smoke') }],
  ['remember', { text: 'Smoke testi: kullanıcı kısa cevap sever.' }], ['recall', {}],
  ['skill_save', { name: 'Smoke modu', description: 'Test rutini', steps: [{ tool: 'calc_roman', args_json: '{"value":"2026"}' }, { tool: 'current_datetime', args_json: '{}' }] }],
  ['skill_run', { name: 'smoke modu' }], ['skill_list', {}], ['search_history', {}]
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
  // The other views of the main window, for a visual check.
  const main = windows.main;
  if (main && !main.isDestroyed()) {
    for (const view of ['tools', 'memory', 'history', 'settings']) {
      await main.webContents.executeJavaScript(`document.querySelector('.rail [data-view="${view}"]')?.click()`).catch(() => {});
      // Offscreen (CI) windows hand back the previous frame on the first capture after a change.
      await new Promise((res) => setTimeout(res, 900));
      await main.webContents.capturePage();
      await new Promise((res) => setTimeout(res, 600));
      fs.writeFileSync(path.join(outDir, `view-${view}.png`), (await main.webContents.capturePage()).toPNG());
    }
  }
  console.log(['', '── Vektör smoke test ──', ...report, `── ${report.length} araç, ${failed} başarısız ──`, ''].join('\n'));
  app.exit(failed ? 1 : 0);
}

module.exports = { runSmoke };
