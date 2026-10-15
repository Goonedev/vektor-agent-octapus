'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('vektor', {
  platform: process.platform,

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: on('settings:changed')
  },

  tools: {
    catalog: () => ipcRenderer.invoke('tools:catalog'),
    declarations: () => ipcRenderer.invoke('tools:declarations'),
    packIndex: () => ipcRenderer.invoke('tools:packIndex'),
    execute: (name, args, source, callId) => ipcRenderer.invoke('tools:execute', { name, args, source, callId }),
    onStart: on('tool:start'),
    onEnd: on('tool:end'),
    onEvent: on('tool:event'),
    onChanged: on('tools:changed')
  },

  history: {
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    search: (opts) => ipcRenderer.invoke('history:search', opts),
    recent: (n) => ipcRenderer.invoke('history:recent', n),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  mcp: {
    status: () => ipcRenderer.invoke('mcp:status'),
    reload: () => ipcRenderer.invoke('mcp:reload'),
    onStatus: on('mcp:status')
  },

  confirm: {
    onRequest: on('confirm:request'),
    onClosed: on('confirm:closed'),
    respond: (id, approved) => ipcRenderer.send('confirm:respond', { id, approved })
  },

  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    onChange: on('store:changed')
  },

  schedule: {
    list: () => ipcRenderer.invoke('schedule:list'),
    cancel: (id) => ipcRenderer.invoke('schedule:cancel', id),
    onChange: on('schedule:changed'),
    onFire: on('schedule:fire')
  },

  voice: {
    onToggle: on('voice:toggle'),
    onStop: on('voice:stop')
  },

  state: {
    update: (state) => ipcRenderer.send('state:update', state),
    onState: on('state')
  },

  mini: {
    command: (cmd) => ipcRenderer.send('mini:command', cmd),
    hover: (inside) => ipcRenderer.send('mini:hover', inside),
    size: (height) => ipcRenderer.send('mini:size', { height })
  },

  window: {
    control: (action) => ipcRenderer.send('window:control', action)
  },

  shell: {
    open: (target) => ipcRenderer.invoke('shell:open', target),
    reveal: (target) => ipcRenderer.invoke('shell:reveal', target)
  },

  app: {
    info: () => ipcRenderer.invoke('app:info')
  },

  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: on('update:status')
  }
});
