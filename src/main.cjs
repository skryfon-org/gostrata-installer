const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const core = require('./core.cjs')

let win
function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 560,
    resizable: false,
    title: 'gostrata Setup',
    icon: path.join(__dirname, 'logo.png'),
    backgroundColor: '#0a1120',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.removeMenu()
  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

let installing = false
ipcMain.handle('init', async () => {
  const d = core.defaults()
  const go = await core.detectGo(core.goBinDirs(d.goParent))
  return {
    defaults: d,
    platform: `${core.GOOS}/${core.GOARCH}`,
    go: go ? { version: go.version, ok: go.ok } : null,
    license: fs.readFileSync(path.join(__dirname, 'LICENSE.txt'), 'utf8'),
    version: app.getVersion(),
  }
})
ipcMain.handle('pick-dir', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: current })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('install', async (_e, opts) => {
  if (installing) return { ok: false, error: 'Installation already running' }
  installing = true
  try {
    const clean = {
      installDir: String(opts.installDir),
      goParent: String(opts.goParent),
      addToPath: !!opts.addToPath,
      installAir: !!opts.installAir,
      forceGo: !!opts.forceGo,
    }
    return await core.install(clean, (ev) => win && !win.isDestroyed() && win.webContents.send('event', ev))
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    installing = false
  }
})
ipcMain.handle('open-url', (_e, url) => (/^https:\/\//.test(url) ? shell.openExternal(url) : undefined))
ipcMain.handle('quit', () => app.quit())

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
