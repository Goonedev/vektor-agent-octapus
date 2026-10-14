'use strict';

const { ToolError } = require('./util');

const CATEGORIES = [
  { id: 'web', title: 'Web', icon: 'globe' },
  { id: 'apps', title: 'Uygulamalar', icon: 'grid' },
  { id: 'files', title: 'Dosyalar', icon: 'folder' },
  { id: 'system', title: 'Sistem bilgisi', icon: 'cpu' },
  { id: 'control', title: 'Sistem kontrolü', icon: 'sliders' },
  { id: 'media', title: 'Medya', icon: 'music' },
  { id: 'clipboard', title: 'Pano', icon: 'clipboard' },
  { id: 'input', title: 'Klavye ve fare', icon: 'keyboard' },
  { id: 'windows', title: 'Pencereler', icon: 'window' },
  { id: 'productivity', title: 'Verimlilik', icon: 'timer' },
  { id: 'utility', title: 'Araçlar', icon: 'calculator' },
  { id: 'network', title: 'Ağ', icon: 'wifi' },
  { id: 'dev', title: 'Geliştirici', icon: 'terminal' }
];

const TOOLS = [
  ...require('./web'),
  ...require('./apps'),
  ...require('./files'),
  ...require('./system'),
  ...require('./desktop'),
  ...require('./productivity'),
  ...require('./utility'),
  ...require('./actions'),
  ...require('./ui'),
  ...require('./steps'),
  ...require('./research')
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* Per-tool glyphs for cards and the library; anything not listed uses its category's glyph. */
const ICONS = {
  open_url: 'link', web_search: 'search', youtube_search: 'play', open_maps: 'globe', translate_text: 'chat', compose_email: 'send',
  wikipedia_summary: 'book', read_webpage: 'doc', check_website: 'activity', download_file: 'arrows',
  close_app: 'x', kill_process: 'danger', open_system_settings: 'gear', open_terminal: 'terminal', open_task_manager: 'activity',
  read_text_file: 'doc', write_text_file: 'note', append_text_file: 'note', move_to_trash: 'trash', search_files: 'search',
  recent_files: 'history', file_info: 'info', compress_zip: 'archive', extract_zip: 'archive', organize_folder: 'sparkles',
  memory_usage: 'layers', battery_status: 'bolt', disk_space: 'archive', network_info: 'wifi', public_ip: 'globe',
  list_displays: 'display', current_datetime: 'timer',
  get_volume: 'volume', set_volume: 'volume', set_mute: 'volume-off', set_brightness: 'sun', lock_screen: 'lock',
  sleep_computer: 'moon', shutdown_computer: 'power', restart_computer: 'power', cancel_shutdown: 'x', empty_trash: 'trash',
  set_dark_mode: 'moon', set_wallpaper: 'photo',
  media_play_pause: 'play', media_next: 'next', media_previous: 'previous', take_screenshot: 'camera', screenshot_to_clipboard: 'camera', open_camera: 'camera',
  mouse_move: 'pointer', mouse_click: 'pointer', mouse_scroll: 'pointer', show_desktop: 'display',
  set_alarm: 'bell', set_reminder: 'bell', show_notification: 'bell', add_note: 'note', list_notes: 'note', delete_note: 'trash',
  add_todo: 'checkbox', list_todos: 'checkbox-on', complete_todo: 'checkbox-on',
  convert_units: 'arrows', convert_currency: 'currency', get_weather: 'cloud-sun', get_news: 'newspaper', world_clock: 'globe',
  generate_password: 'key', random_pick: 'dice', ping_host: 'activity', dns_lookup: 'globe', check_port: 'plug',
  git_status: 'code', open_in_vscode: 'code',
  play_youtube: 'play', steam_install: 'arrows', steam_launch: 'play', ask_claude_code: 'sparkles',
  click_button: 'pointer', list_buttons: 'window', run_steps: 'layers',
  deep_research: 'search', find_download_link: 'arrows', download_from_web: 'arrows'
};

/* ------------------------------------------------------------ schema */

const TYPE = { string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', array: 'ARRAY', object: 'OBJECT' };

function paramSchema(p) {
  const s = { type: TYPE[p.type] };
  if (p.description) s.description = p.description;
  if (p.enum) s.enum = p.enum;
  if (p.type === 'array') s.items = paramSchema(p.items || { type: 'string' });
  if (p.type === 'object' && p.properties) {
    s.properties = Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, paramSchema(v)]));
    if (p.required?.length) s.required = p.required;
  }
  return s;
}

/** Function declarations in the shape the Gemini Live API expects. */
function declarations() {
  return TOOLS.map((t) => {
    const keys = Object.keys(t.params || {});
    const decl = {
      name: t.name,
      description: `${t.title}. ${t.description}${t.danger ? ' Kullanıcı onayı ister; onay penceresi otomatik çıkar, ayrıca sözlü onay isteme.' : ''}`
    };
    if (keys.length) {
      decl.parameters = {
        type: 'OBJECT',
        properties: Object.fromEntries(keys.map((k) => [k, paramSchema(t.params[k])])),
        required: keys.filter((k) => t.params[k].required)
      };
    }
    return decl;
  });
}

/** A serialisable catalogue for the renderer's tool library. */
function catalog() {
  return {
    categories: CATEGORIES.map((c) => ({ ...c, count: TOOLS.filter((t) => t.category === c.id).length })),
    tools: TOOLS.map((t) => ({
      name: t.name,
      category: t.category,
      title: t.title,
      description: t.description,
      danger: !!t.danger,
      icon: ICONS[t.name] || null,
      params: Object.entries(t.params || {}).map(([key, p]) => ({ key, ...p }))
    }))
  };
}

/* --------------------------------------------------------- execution */

function coerce(args, params) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    const p = params?.[k];
    if (!p || v === null || v === undefined || v === '') continue;
    if ((p.type === 'number' || p.type === 'integer') && typeof v === 'string') {
      const n = Number(v.replace(',', '.'));
      out[k] = Number.isFinite(n) ? (p.type === 'integer' ? Math.round(n) : n) : v;
    } else if (p.type === 'integer' && typeof v === 'number') out[k] = Math.round(v);
    else if (p.type === 'boolean' && typeof v === 'string') out[k] = /^(true|1|evet|yes)$/i.test(v);
    else if (p.type === 'array' && typeof v === 'string') {
      // Arrays of objects may arrive as a JSON string; plain lists as "a, b, c".
      let parsed = null;
      if (/^\s*\[/.test(v)) { try { parsed = JSON.parse(v); } catch { /* not JSON */ } }
      out[k] = Array.isArray(parsed) ? parsed : v.split(',').map((s) => s.trim()).filter(Boolean);
    }
    else out[k] = v;
  }
  return out;
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new ToolError('İşlem zaman aşımına uğradı.')), ms); })
  ]).finally(() => clearTimeout(t));
}

/**
 * Runs one tool. Never throws: the result always carries ok/summary so the model can
 * explain a failure to the user instead of the session breaking.
 */
async function execute(name, rawArgs, ctx) {
  const tool = BY_NAME.get(name);
  const started = Date.now();
  if (!tool) return { ok: false, summary: `Bilinmeyen araç: ${name}`, ms: 0 };

  const args = coerce(rawArgs, tool.params);
  const missing = Object.entries(tool.params || {}).filter(([k, p]) => p.required && args[k] === undefined).map(([k]) => k);
  if (missing.length) return { ok: false, summary: `Eksik parametre: ${missing.join(', ')}`, ms: 0 };

  const needsConfirm = typeof tool.danger === 'function' ? tool.danger(args) : !!tool.danger;
  if (needsConfirm && ctx.confirm) {
    const approved = await ctx.confirm({ name, title: tool.title, description: tool.description, args });
    if (!approved) return { ok: false, denied: true, summary: 'Kullanıcı bu işlemi onaylamadı; yapılmadı.', ms: Date.now() - started };
  }

  try {
    const result = await withTimeout(Promise.resolve(tool.run(args, ctx)), tool.timeout || 180000);
    return { ok: true, ...result, ms: Date.now() - started };
  } catch (e) {
    const known = e instanceof ToolError;
    return {
      ok: false,
      summary: known ? e.message : `Beklenmeyen hata: ${e.message}`,
      hint: e.hint,
      ms: Date.now() - started
    };
  }
}

/** What goes back to the model: small and text-only. Images and card markup stay in the UI. */
function forModel(result) {
  const out = { ok: result.ok, summary: result.summary };
  if (result.data !== undefined) out.data = result.data;
  if (result.hint) out.hint = result.hint;
  if (result.denied) out.denied = true;
  return out;
}

module.exports = { TOOLS, CATEGORIES, declarations, catalog, execute, forModel, coerce };
