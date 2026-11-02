const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('setup', {
  init: () => ipcRenderer.invoke('init'),
  pickDir: (cur) => ipcRenderer.invoke('pick-dir', cur),
  install: (opts) => ipcRenderer.invoke('install', opts),
  openUrl: (u) => ipcRenderer.invoke('open-url', u),
  quit: () => ipcRenderer.invoke('quit'),
  onEvent: (cb) => ipcRenderer.on('event', (_e, ev) => cb(ev)),
})
