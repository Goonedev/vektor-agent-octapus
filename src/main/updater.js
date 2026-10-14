'use strict';

/*
 * In-app updates from GitHub Releases (see "publish" in package.json). The installed app
 * checks on start and every few hours, downloads in the background and installs on the
 * next restart — or right away when the user presses "Yeniden başlat".
 */

const { app, ipcMain } = require('electron');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let status = { state: 'idle', version: null, percent: 0, message: '' };

function setupUpdater({ broadcast, notify, log = console }) {
  const publish = (patch) => {
    status = { ...status, ...patch, current: app.getVersion() };
    broadcast('update:status', status);
  };

  ipcMain.handle('update:status', () => ({ ...status, current: app.getVersion(), supported: supported() }));

  // Portable zips and unpacked dev runs cannot replace themselves; only real installs update.
  function supported() {
    if (process.env.VEKTOR_UPDATE_TEST) return true;
    if (!app.isPackaged) return false;
    if (process.platform === 'linux') return !!process.env.APPIMAGE;
    if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR;
    return true;
  }

  if (!supported()) {
    ipcMain.handle('update:check', () => ({ ...status, current: app.getVersion(), supported: false }));
    ipcMain.handle('update:install', () => false);
    return { check: () => {} };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.env.VEKTOR_UPDATE_TEST) autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking', message: 'Güncellemeler denetleniyor…' }));
  autoUpdater.on('update-not-available', () => publish({ state: 'latest', message: 'Vektör güncel.' }));
  autoUpdater.on('update-available', (info) => publish({ state: 'downloading', version: info.version, percent: 0, message: `${info.version} indiriliyor…` }));
  autoUpdater.on('download-progress', (p) => publish({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    publish({ state: 'ready', version: info.version, percent: 100, message: `${info.version} hazır. Yeniden başlatınca kurulacak.` });
    notify('Güncelleme hazır', `Vektör ${info.version} indirildi. Yeniden başlatınca kurulacak.`);
  });
  autoUpdater.on('error', (e) => publish({ state: 'error', message: `Güncelleme denetlenemedi: ${e?.message?.split('\n')[0] || e}` }));

  // Failures surface through the 'error' event; the promises are only silenced here.
  const check = () => autoUpdater.checkForUpdates()
    .then((r) => { r?.downloadPromise?.catch(() => {}); })
    .catch(() => {});

  ipcMain.handle('update:check', async () => { await check(); return { ...status, supported: true }; });
  ipcMain.handle('update:install', () => {
    if (status.state !== 'ready') return false;
    // Let the window close cleanly first; quitAndInstall restarts into the new version.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  setTimeout(check, 8000);
  setInterval(check, CHECK_EVERY_MS).unref();
  return { check };
}

module.exports = { setupUpdater };
