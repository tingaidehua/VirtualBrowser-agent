require('bytenode');
require('./preload.jsc');
(function () {
  try {
    const { ipcRenderer, contextBridge } = require('electron');
    const api = {
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      on: (channel, listener) => ipcRenderer.on(channel, listener)
    };
    try {
      contextBridge.exposeInMainWorld('vbLocalSyncBridge', api);
    } catch (_) {}
    try {
      // nodeIntegration / no isolation
      if (typeof window !== 'undefined') {
        window.vbLocalSyncBridge = api;
        window.sandboxAPI = window.sandboxAPI || {};
        window.sandboxAPI.ipcRenderer = window.sandboxAPI.ipcRenderer || ipcRenderer;
      }
    } catch (_) {}
    process.once('loaded', () => {
      try {
        window.vbLocalSyncBridge = api;
        window.sandboxAPI = window.sandboxAPI || {};
        if (!window.sandboxAPI.ipcRenderer) window.sandboxAPI.ipcRenderer = ipcRenderer;
      } catch (_) {}
    });
  } catch (e) {
    console.error('[local-sync] preload patch failed', e);
  }
})();
