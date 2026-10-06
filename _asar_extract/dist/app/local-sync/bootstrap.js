const path = require('path')
const fs = require('fs')

function log(...args) {
  try {
    const dir = path.join(process.env.APPDATA || '', 'virtual-browser', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'local-sync.log'),
      `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
    )
  } catch {}
  console.log('[local-sync]', ...args)
}

function install() {
  let electron
  try {
    electron = require('electron')
  } catch (e) {
    log('electron not available yet', String(e))
    return
  }

  const { app, ipcMain, dialog, BrowserWindow } = electron
  const { execFile } = require('child_process')
  if (!app || !ipcMain) {
    log('missing app/ipcMain')
    return
  }

  if (global.__vbLocalSyncInstalled) return
  global.__vbLocalSyncInstalled = true

  const core = require('./sync-core')
  let syncing = false
  let intervalTimer = null
  let watchTimer = null
  let watchers = []

  const wrap = fn => async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      log('handler error', String(e && e.stack || e))
      return { ok: false, error: String(e && e.message || e) }
    }
  }

  async function runAutoSync(reason) {
    const { cfg } = core.loadSettings()
    if (!cfg.enabled) {
      log('auto sync disabled, skip', reason)
      return { skipped: true }
    }
    if (syncing) {
      log('auto sync busy, skip', reason)
      return { busy: true }
    }
    syncing = true
    try {
      log('auto sync start', reason)
      const r = await core.autoSyncNow(cfg.syncPath)
      log('auto sync done', reason, r)
      return r
    } catch (e) {
      log('auto sync failed', reason, String(e && e.stack || e))
      return { error: String(e && e.message || e) }
    } finally {
      syncing = false
    }
  }

  function clearWatchers() {
    for (const w of watchers) {
      try { w.close() } catch {}
    }
    watchers = []
  }

  function setupWatchers() {
    clearWatchers()
    const files = [core.profilesPath(), core.globalPath()]
    for (const f of files) {
      try {
        const dir = path.dirname(f)
        if (!fs.existsSync(dir)) continue
        const w = fs.watch(dir, { persistent: false }, (_evt, filename) => {
          if (!filename) return
          const base = String(filename)
          if (base !== path.basename(f) && base !== path.basename(f) + '.bak') return
          clearTimeout(watchTimer)
          watchTimer = setTimeout(() => {
            runAutoSync('watch:' + base)
          }, 5000)
        })
        watchers.push(w)
      } catch (e) {
        log('watch failed', f, String(e))
      }
    }
  }

  function setupInterval() {
    if (intervalTimer) clearInterval(intervalTimer)
    const { cfg } = core.loadSettings()
    const sec = Math.max(30, Number(cfg.autoSyncIntervalSec) || 60)
    intervalTimer = setInterval(() => {
      runAutoSync('interval')
    }, sec * 1000)
    log('interval set', sec + 's')
  }

  ipcMain.handle('vb-local-sync:get-settings', wrap(async () => core.loadSettings().cfg))
  ipcMain.handle('vb-local-sync:save-settings', wrap(async partial => {
    const next = core.saveSettings(partial)
    setupInterval()
    setupWatchers()
    if (next.enabled) setTimeout(() => runAutoSync('settings-changed'), 1000)
    return next
  }))
  ipcMain.handle('vb-local-sync:list-local', wrap(async () => core.listLocalEnvironments()))
  ipcMain.handle('vb-local-sync:list-synced', wrap(async syncPath => core.listSyncedEnvironments(syncPath)))
  ipcMain.handle('vb-local-sync:upload', wrap(async (localId, syncPath) => core.uploadEnvironment(localId, syncPath)))
  ipcMain.handle('vb-local-sync:download', wrap(async (syncId, syncPath, opts) => core.downloadEnvironment(syncId, syncPath, opts || {})))
  ipcMain.handle('vb-local-sync:delete', wrap(async (syncId, syncPath) => core.deleteSyncedEnvironment(syncId, syncPath)))
  ipcMain.handle('vb-local-sync:enable', wrap(async ids => core.enableLocalSync(ids)))
  ipcMain.handle('vb-local-sync:disable', wrap(async ids => core.disableLocalSync(ids)))
  ipcMain.handle('vb-local-sync:upload-enabled', wrap(async syncPath => core.uploadAll(syncPath)))
  ipcMain.handle('vb-local-sync:auto-load', wrap(async syncPath => core.autoLoadFromSync(syncPath)))
  ipcMain.handle('vb-local-sync:sync-now', wrap(async () => runAutoSync('manual')))
  ipcMain.handle('vb-local-sync:pick-directory', wrap(async () => {
    const win = BrowserWindow.getFocusedWindow()
    const { cfg } = core.loadSettings()
    const res = await dialog.showOpenDialog(win || undefined, {
      title: '选择本地同步目录',
      defaultPath: cfg.syncPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return null
    const next = core.saveSettings({ syncPath: res.filePaths[0] })
    setTimeout(() => runAutoSync('path-changed'), 1000)
    return next
  }))

  function workerFocusScript(localId) {
    const id = String(localId || '').replace(/[^\w.-]/g, '')
    return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class VbWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$pids = @()
Get-CimInstance Win32_Process -Filter "Name = 'VirtualBrowser.exe'" | ForEach-Object {
  if ($_.CommandLine -match '--worker-id=${id}(\\D|$)') { $pids += [int]$_.ProcessId }
}
if (-not $pids.Count) { Write-Output 'NO_PROCESS'; exit 2 }
$found = New-Object System.Collections.Generic.List[IntPtr]
$cb = [VbWin+EnumProc]{
  param($h, $l)
  [uint32]$pid = 0
  [void][VbWin]::GetWindowThreadProcessId($h, [ref]$pid)
  if ($pids -contains [int]$pid -and [VbWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][VbWin]::GetWindowText($h, $sb, 512)
    if ($sb.ToString().Length -gt 0) { $found.Add($h) }
  }
  return $true
}
[void][VbWin]::EnumWindows($cb, [IntPtr]::Zero)
if (-not $found.Count) { Write-Output 'NO_WINDOW'; exit 3 }
foreach ($h in $found) {
  if ([VbWin]::IsIconic($h)) { [void][VbWin]::ShowWindow($h, 9) } else { [void][VbWin]::ShowWindow($h, 5) }
  [void][VbWin]::BringWindowToTop($h)
  [void][VbWin]::SetForegroundWindow($h)
}
Write-Output ('OK ' + $found.Count)
`
  }

  function runPs(script) {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 8000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error((stderr || stdout || err.message || String(err)).toString().trim()))
          resolve(String(stdout || '').trim())
        }
      )
    })
  }

  ipcMain.handle('vb-local-sync:focus-worker', wrap(async localId => {
    const out = await runPs(workerFocusScript(localId))
    log('focus-worker', localId, out)
    return out
  }))

  const uiPath = path.join(__dirname, 'ui-inject.js')
  const uiSource = () => fs.readFileSync(uiPath, 'utf8')

  async function probeTable(win) {
    try {
      const info = await win.webContents.executeJavaScript(`(() => {
        const rows = document.querySelectorAll('.el-table__body tr')
        const styleOk = !!document.getElementById('vb-ls-style')
        const first = rows[0]
        if (!first) return { styleOk, rows: 0 }
        const cells = [...first.querySelectorAll('td')].map((td, i) => {
          const cell = td.querySelector('.cell') || td
          const btns = [...cell.querySelectorAll('button, .el-button')].map(b => ({
            text: (b.textContent||'').trim(),
            tag: b.tagName,
            cls: b.className,
            display: getComputedStyle(b).display,
            parent: b.parentElement && b.parentElement.className
          }))
          return {
            i,
            cls: td.className,
            w: Math.round(td.getBoundingClientRect().width),
            h: Math.round(td.getBoundingClientRect().height),
            text: (cell.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40),
            btns,
            cellHtml: (cell.innerHTML||'').slice(0,180)
          }
        })
        return {
          styleOk,
          rows: rows.length,
          rowH: Math.round(first.getBoundingClientRect().height),
          cells
        }
      })()`, true)
      log('table-probe', info)
      return info
    } catch (e) {
      log('table-probe failed', String(e))
      return null
    }
  }

  const injectUi = async win => {
    try {
      await win.webContents.executeJavaScript(uiSource(), true)
      log('ui injected', win.id)
      setTimeout(() => probeTable(win), 2500)
    } catch (e) {
      log('ui inject failed', String(e))
    }
  }

  const hookWindow = win => {
    if (!win || win.__vbLocalSyncHooked) return
    win.__vbLocalSyncHooked = true
    win.webContents.on('did-finish-load', () => injectUi(win))
    win.webContents.on('dom-ready', () => injectUi(win))
    // page may already be loaded when we hook late
    try {
      if (!win.webContents.isLoading()) injectUi(win)
    } catch {}
  }

  try {
    core.saveSettings({
      enabled: true,
      autoLoad: true,
      autoUploadOnExit: true,
      restoreSession: false
    })
  } catch {}

  app.on('browser-window-created', (_e, win) => hookWindow(win))
  app.whenReady().then(async () => {
    log('ready, auto sync only (session restore disabled)')
    BrowserWindow.getAllWindows().forEach(hookWindow)
    setupWatchers()
    setupInterval()
    // keep trying in case first window appears late
    const hookTimer = setInterval(() => {
      BrowserWindow.getAllWindows().forEach(hookWindow)
    }, 1000)
    setTimeout(() => clearInterval(hookTimer), 30000)
    await runAutoSync('startup')
    BrowserWindow.getAllWindows().forEach(hookWindow)
  }).catch(e => log('whenReady error', String(e)))

  app.on('before-quit', () => {
    try {
      const { cfg } = core.loadSettings()
      if (cfg.enabled && cfg.autoUploadOnExit) {
        Promise.resolve(core.uploadChanged(cfg.syncPath))
          .then(r => log('exit upload', { count: (r || []).length }))
          .catch(err => log('exit upload fail', String(err)))
      }
    } catch (err) {
      log('before-quit error', String(err))
    }
  })

  log('bootstrap installed (sync only)')
}

try {
  install()
} catch (e) {
  console.error('[local-sync] bootstrap failed', e)
}

