'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, shell,
  desktopCapturer, Notification, nativeTheme, session, systemPreferences
} = require('electron');

const { Store } = require('./store');
const { Scheduler } = require('./scheduler');
const tools = require('./tools');
const { setKnownDirs, setNativeDir } = require('./tools/util');
const clip = require('./clip');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');

if (!app.requestSingleInstanceLock()) app.quit();
app.setName('Vektör');
if (isWin) app.setAppUserModelId('com.vektor.assistant');

let mainWindow = null;
let miniWindow = null;
let tray = null;
let store, scheduler;
let quitting = false;
let lastState = { phase: 'idle', label: 'Hazır', level: 0 };

const DEFAULTS = {
  settings: {
    apiKey: '',
    model: 'gemini-3.1-flash-live-preview',
    voice: 'Kore',
    language: 'tr-TR',
    persona: '',
    theme: 'dark',
    miniIsland: true,
    shortcut: 'CommandOrControl+Shift+Space',
    autoConnect: false,
    confirmDanger: true,
    chime: true
  },
  notes: [],
  todos: [],
  schedule: []
};

/* ------------------------------------------------------------ helpers */

const send = (win, channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const broadcast = (channel, payload) => { send(mainWindow, channel, payload); send(miniWindow, channel, payload); };

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: false });
  n.on('click', showMain);
  n.show();
}

function showMain() {
  if (!mainWindow) return createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* Clipboard history: polled while Vektör runs; text only, newest first. */
const clipboardHistory = (() => {
  let items = [];
  let last = '';
  setInterval(async () => {
    const t = await clip.readText().catch(() => '');
    if (t && t !== last && t.length < 20000) {
      last = t;
      items = [{ text: t, at: Date.now() }, ...items.filter((i) => i.text !== t)].slice(0, 30);
    }
  }, 1500).unref();
  return { list: () => items, clear: () => { items = []; last = ''; } };
})();

/* ------------------------------------------------------- confirmation */

const pendingConfirms = new Map();

function confirm(request) {
  if (!store.get('settings').confirmDanger) return Promise.resolve(true);
  const id = crypto.randomUUID();
  showMain();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingConfirms.delete(id); broadcast('confirm:closed', { id }); resolve(false); }, 45000);
    pendingConfirms.set(id, (ok) => { clearTimeout(timer); pendingConfirms.delete(id); resolve(ok); });
    broadcast('confirm:request', { id, ...request, timeoutMs: 45000 });
  });
}

ipcMain.on('confirm:respond', (e, { id, approved }) => {
  pendingConfirms.get(id)?.(!!approved);
  broadcast('confirm:closed', { id });
});

/* -------------------------------------------------------------- tools */

function toolContext(source) {
  return {
    source,
    electron: { shell, desktopCapturer, screen, nativeTheme, nativeImage, app },
    store,
    scheduler,
    clip,
    clipboardHistory,
    notify,
    confirm,
    emit: (type, payload) => broadcast('tool:event', { type, ...payload }),
    log: (...a) => console.log('[vektor]', ...a),
    // Keyboard tools must not type into Vektör itself.
    yieldFocus: async () => {
      if (!mainWindow?.isFocused()) return;
      if (isMac) app.hide(); else mainWindow.minimize();
      await new Promise((r) => setTimeout(r, 450));
    }
  };
}

ipcMain.handle('tools:catalog', () => tools.catalog());
ipcMain.handle('tools:declarations', () => tools.declarations());
ipcMain.handle('tools:execute', async (e, { name, args, source = 'model', callId }) => {
  broadcast('tool:start', { name, args, source, callId, at: Date.now() });
  const result = await tools.execute(name, args, toolContext(source));
  broadcast('tool:end', { name, callId, ok: result.ok, summary: result.summary, ms: result.ms });
  return { ...result, model: tools.forModel(result) };
});

/* ----------------------------------------------------------- settings */

ipcMain.handle('settings:get', () => store.get('settings'));
ipcMain.handle('settings:set', (e, patch) => {
  const prev = store.get('settings');
  const next = store.set('settings', { ...prev, ...patch });
  if (patch.shortcut !== undefined && patch.shortcut !== prev.shortcut) registerShortcut();
  if (patch.miniIsland !== undefined) next.miniIsland ? createMiniWindow() : miniWindow?.close();
  if (patch.theme !== undefined) nativeTheme.themeSource = next.theme === 'system' ? 'system' : next.theme;
  broadcast('settings:changed', next);
  return next;
});

ipcMain.handle('store:get', (e, key) => (['notes', 'todos'].includes(key) ? store.get(key) : null));
ipcMain.handle('store:set', (e, key, value) => (['notes', 'todos'].includes(key) ? store.set(key, value) : null));
ipcMain.handle('schedule:list', () => scheduler.list());
ipcMain.handle('schedule:cancel', (e, id) => scheduler.remove(id));
ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), electron: process.versions.electron }));
ipcMain.handle('shell:open', (e, target) => {
  if (/^https?:\/\//.test(target)) return shell.openExternal(target);
  return shell.openPath(target);
});
ipcMain.handle('shell:reveal', (e, target) => shell.showItemInFolder(target));

/* --------------------------------------------------- state & windows */

ipcMain.on('state:update', (e, state) => {
  lastState = state;
  send(miniWindow, 'state', state);
  if (tray) tray.setToolTip(`Vektör — ${state.label || 'Hazır'}`);
});

ipcMain.on('mini:command', (e, cmd) => {
  if (cmd === 'toggle-mic') send(mainWindow, 'voice:toggle');
  else if (cmd === 'open') showMain();
  else if (cmd === 'stop') send(mainWindow, 'voice:stop');
});

ipcMain.on('mini:hover', (e, inside) => {
  miniWindow?.setIgnoreMouseEvents(!inside, { forward: true });
});

ipcMain.on('mini:size', (e, { height }) => {
  if (!miniWindow) return;
  const b = miniWindow.getBounds();
  if (Math.abs(b.height - height) > 1) miniWindow.setBounds({ ...b, height: Math.round(height) });
});

ipcMain.on('window:control', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.hide();
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    title: 'Vektör',
    icon: ICON,
    backgroundColor: '#05060a',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    ...(isWin ? { titleBarOverlay: { color: '#00000000', symbolColor: '#e8e8ed', height: 48 } } : {}),
    frame: isMac || isWin,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  mainWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });
  mainWindow.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createMiniWindow() {
  if (miniWindow) return;
  const { workArea, bounds } = screen.getPrimaryDisplay();
  const width = 460;
  miniWindow = new BrowserWindow({
    width,
    height: 124,
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: isMac ? bounds.y : workArea.y + 6,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  miniWindow.setAlwaysOnTop(true, 'screen-saver');
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWindow.setIgnoreMouseEvents(true, { forward: true });
  miniWindow.loadFile(path.join(ROOT, 'src', 'mini', 'mini.html'));
  miniWindow.once('ready-to-show', () => { miniWindow.showInactive(); send(miniWindow, 'state', lastState); });
  miniWindow.on('closed', () => { miniWindow = null; });
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const accel = store.get('settings').shortcut;
  if (!accel) return;
  try {
    globalShortcut.register(accel, () => send(mainWindow, 'voice:toggle'));
  } catch (e) {
    console.warn('Kısayol kaydedilemedi:', accel, e.message);
  }
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(ROOT, 'assets', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.setToolTip('Vektör');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Vektör\'ü göster', click: showMain },
    { label: 'Dinle / durdur', click: () => send(mainWindow, 'voice:toggle') },
    { type: 'separator' },
    {
      label: 'Mini ada',
      type: 'checkbox',
      checked: store.get('settings').miniIsland,
      click: (item) => {
        const next = store.set('settings', { ...store.get('settings'), miniIsland: item.checked });
        item.checked ? createMiniWindow() : miniWindow?.close();
        broadcast('settings:changed', next);
      }
    },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showMain);
}

/* ----------------------------------------------------------- lifecycle */

app.on('second-instance', showMain);

app.whenReady().then(async () => {
  setKnownDirs({
    home: app.getPath('home'), desktop: app.getPath('desktop'), downloads: app.getPath('downloads'),
    documents: app.getPath('documents'), pictures: app.getPath('pictures'), music: app.getPath('music'), videos: app.getPath('videos')
  });
  setNativeDir(path.join(app.getPath('userData'), 'native'));

  store = new Store(path.join(app.getPath('userData'), 'vektor.json'), DEFAULTS);
  store.set('settings', { ...DEFAULTS.settings, ...store.get('settings') });
  if (!store.get('settings').apiKey && process.env.GEMINI_API_KEY) {
    store.set('settings', { ...store.get('settings'), apiKey: process.env.GEMINI_API_KEY });
  }
  nativeTheme.themeSource = store.get('settings').theme === 'system' ? 'system' : store.get('settings').theme;

  store.on('change', (key) => { if (key === 'notes' || key === 'todos') broadcast('store:changed', { key, value: store.get(key) }); });

  scheduler = new Scheduler(store);
  scheduler.on('change', () => broadcast('schedule:changed', scheduler.list()));
  scheduler.on('fire', (item) => {
    const title = { timer: 'Süre doldu', alarm: 'Alarm', reminder: 'Hatırlatma' }[item.kind] || 'Vektör';
    notify(title, item.label);
    broadcast('schedule:fire', item);
  });

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'microphone', 'audioCapture', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ['media', 'microphone', 'audioCapture', 'clipboard-sanitized-write'].includes(permission));
  if (isMac) systemPreferences.askForMediaAccess('microphone').catch(() => {});

  createMainWindow();
  if (store.get('settings').miniIsland) createMiniWindow();
  createTray();
  registerShortcut();

  screen.on('display-metrics-changed', () => { miniWindow?.close(); setTimeout(() => store.get('settings').miniIsland && createMiniWindow(), 300); });

  if (process.env.VEKTOR_SMOKE) {
    const { runSmoke } = require('./smoke');
    const ctx = { ...toolContext('system'), confirm: async () => true };
    setTimeout(() => runSmoke({ tools, ctx, app, windows: { main: mainWindow, mini: miniWindow }, outDir: process.env.VEKTOR_SMOKE }), 2500);
  }
});

app.on('activate', showMain);
app.on('before-quit', () => { quitting = true; store?.flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* stays in the tray */ });
