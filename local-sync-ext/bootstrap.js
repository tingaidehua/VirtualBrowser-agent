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
  if (!app || !ipcMain) {
    log('missing app/ipcMain')
    return
  }

  if (global.__vbLocalSyncInstalled) return
  global.__vbLocalSyncInstalled = true

  const core = require('./sync-core')
  const workerCtl = require('./worker-ctl')
  let syncing = false
  let intervalTimer = null
  let watchTimer = null
  let watchers = []
  let ignoreWatchUntil = 0
  let ctlChain = Promise.resolve()

  function withCtl(fn) {
    const run = ctlChain.then(fn, fn)
    ctlChain = run.then(() => {}, () => {})
    return run
  }

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
    if (String(reason).startsWith('watch:') && Date.now() < ignoreWatchUntil) {
      return { skipped: true, reason: 'watch-cooldown' }
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
      // own writes / chrome noise should not immediately re-trigger sync
      ignoreWatchUntil = Date.now() + 45000
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
          }, 20000)
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

  ipcMain.handle('vb-local-sync:ui-log', wrap(async payload => {
    log('ui', payload)
    workerCtl.ctlLog('ui', payload)
    return true
  }))

  ipcMain.handle('vb-local-sync:running-workers', wrap(async () => workerCtl.listIds()))

  ipcMain.handle('vb-local-sync:worker-snapshot', wrap(async localId => workerCtl.runCtl('snapshot', localId)))

  ipcMain.handle('vb-local-sync:focus-worker', wrap(async localId => {
    const t0 = Date.now()
    log('focus-worker request', localId)
    try {
      const out = await workerCtl.runCtl('focus', localId)
      log('focus-worker ok', localId, { ms: Date.now() - t0, hwnd: out.hwnd, fg: out.fgAfter || out.fg })
      return out
    } catch (e) {
      log('focus-worker fail', localId, { ms: Date.now() - t0, detail: e.detail || String(e) })
      throw new Error((e && e.message) || '环境未在运行')
    }
  }))

  ipcMain.handle('vb-local-sync:stop-worker', wrap(async localId => {
    log('stop-worker request', localId)
    const out = await workerCtl.runCtl('stop', localId)
    workerCtl.invalidateCache()
    log('stop-worker ok', localId, out)
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

  async function sleep(ms) { await new Promise(r => setTimeout(r, ms)) }

  async function uiSnapshot(win) {
    return win.webContents.executeJavaScript('(function(){var row=document.querySelector(".el-table__body tr");if(!row)return {empty:true};var status=row.querySelector("td.status-col");var btns=[];var list=status?status.querySelectorAll("button,.el-button,.vb-ls-open-btn,.vb-ls-stop-btn"):[];for(var i=0;i<list.length;i++)btns.push((list[i].textContent||"").trim());return {rowText:(row.innerText||"").trim(),statusText:status?(status.innerText||"").trim():"",btns:btns,hasOpen:!!row.querySelector(".vb-ls-open-btn"),hasStop:!!row.querySelector(".vb-ls-stop-btn")};})()', false)
  }

  async function uiClick(win, which) {
    const expr = which === 'open'
      ? '(function(){var b=document.querySelector(".vb-ls-open-btn");if(!b)return {ok:false,reason:"no-btn"};b.click();return {ok:true,which:"open"};})()'
      : which === 'close'
        ? '(function(){var b=document.querySelector(".vb-ls-stop-btn");if(!b)return {ok:false,reason:"no-btn"};b.click();return {ok:true,which:"close"};})()'
        : '(function(){var nodes=document.querySelectorAll("td.status-col button,td.status-col .el-button");var b=null;for(var i=0;i<nodes.length;i++){var t=(nodes[i].textContent||"").trim();if(/启动/.test(t)&&String(nodes[i].className).indexOf("vb-ls-")<0){b=nodes[i];break;}}if(!b)return {ok:false,reason:"no-btn"};b.click();return {ok:true,which:"launch",text:(b.textContent||"").trim()};})()'
    return win.webContents.executeJavaScript(expr, false)
  }

  function checkConsistent(ui, osIds, action) {
    const running = osIds.map(String).includes('1')
    const problems = []
    if (running) {
      if (!ui.hasOpen) problems.push('running-but-no-open')
      if (!ui.hasStop) problems.push('running-but-no-close')
      if (!/已启动/.test(ui.statusText || '')) problems.push('running-but-status-not-launched')
    } else {
      if (ui.hasOpen) problems.push('stopped-but-has-open')
      if (ui.hasStop) problems.push('stopped-but-has-close')
    }
    return { ok: problems.length === 0, running, problems, action, ui, osIds }
  }

  async function stressButtons(_ignored) {
    const flag = path.join(process.env.APPDATA || '', 'virtual-browser', 'selftest-stress')
    if (global.__vbStressStarted) return
    if (!fs.existsSync(flag)) return
    global.__vbStressStarted = true
    try { fs.unlinkSync(flag) } catch {}
    const rounds = 12
    const report = []
    log('stress start', rounds)
    workerCtl.ctlLog('stress-start', { rounds })
    let win = null
    for (let t = 0; t < 20 && !win; t++) {
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          const n = await w.webContents.executeJavaScript('document.querySelectorAll(".el-table__body tr").length', false)
          log('stress probe-win', { id: w.id, n, url: w.webContents.getURL() })
          if (Number(n) > 0) { win = w; break }
        } catch (e) {
          log('stress probe-win fail', w.id, String(e))
        }
      }
      if (!win) await sleep(500)
    }
    if (!win) {
      log('stress no table window')
      workerCtl.ctlLog('stress-no-window')
      return
    }
    try {
    for (let i = 0; i < rounds; i++) {
      let osIds = []
      try { osIds = await workerCtl.listIds() } catch (e) { osIds = [] }
      const before = await uiSnapshot(win)
      const running = osIds.map(String).includes('1')
      const choices = running ? ['open', 'open', 'close', 'xclose'] : ['launch']
      const action = choices[Math.floor(Math.random() * choices.length)]
      let click = { ok: true, which: action }
      if (action === 'xclose') {
        await workerCtl.runCtl('stop', '1')
        workerCtl.invalidateCache()
        click = { ok: true, which: 'xclose' }
      } else {
        click = await uiClick(win, action)
      }
      log('stress click', { i, action, click, osIds, before })
      await sleep(action === 'launch' ? 4500 : (action === 'xclose' || action === 'close' ? 2000 : 500))
      workerCtl.invalidateCache()
      let osAfter = []
      try { osAfter = await workerCtl.listIds() } catch (e) { osAfter = [] }
      // give UI a beat to reflect OS state
      await sleep(400)
      const after = await uiSnapshot(win)
      const cons = checkConsistent(after, osAfter, action)
      if (!click || !click.ok) cons.problems.push('click-missed:' + ((click && click.reason) || 'unknown'))
      if (action === 'launch' && !osAfter.map(String).includes('1')) cons.problems.push('launch-no-process')
      if (action === 'open' && osAfter.map(String).includes('1')) {
        try {
          const snap = await workerCtl.runCtl('snapshot', '1')
          const hit = (snap.hits || [])[0]
          if (!hit) cons.problems.push('open-no-hwnd')
        } catch (e) {
          cons.problems.push('open-snapshot-fail')
        }
      }
      if (action === 'close' || action === 'xclose') {
        if (osAfter.map(String).includes('1')) cons.problems.push('close-process-left')
        if (after && (after.hasOpen || after.hasStop)) cons.problems.push('window-gone-ui-stale')
      }
      cons.ok = cons.problems.length === 0
      report.push({ i, action, click, before, after, osBefore: osIds, osAfter, cons })
      log('stress round', { i, action, ok: cons.ok, problems: cons.problems, osAfter, after })
      workerCtl.ctlLog('stress-round', report[report.length - 1])
    }
    } catch (e) {
      log('stress crashed', String(e && e.stack || e))
      workerCtl.ctlLog('stress-crashed', String(e && e.stack || e))
    }
    const failed = report.filter(r => !r.cons || !r.cons.ok)
    const summary = { rounds, ran: report.length, failed: failed.length, failedRounds: failed.map(r => ({ i: r.i, action: r.action, problems: r.cons && r.cons.problems })) }
    log('stress done', summary)
    workerCtl.ctlLog('stress-done', summary)
    try {
      fs.writeFileSync(path.join(process.env.APPDATA || '', 'virtual-browser', 'logs', 'stress-report.json'), JSON.stringify({ summary, report }, null, 2))
    } catch {}
  }

  async function probeLayout(win) {
    const flag = path.join(process.env.APPDATA || '', 'virtual-browser', 'selftest-layout')
    if (!fs.existsSync(flag)) return
    try { fs.unlinkSync(flag) } catch {}
    try {
      await win.webContents.executeJavaScript(`(() => {
        if (window.vbLocalSyncOpen) window.vbLocalSyncOpen();
        return true;
      })()`, true)
      await sleep(800)
      const info = await win.webContents.executeJavaScript(`(() => {
        function brief(el){
          if(!el) return null;
          return {
            tag: el.tagName,
            id: el.id || '',
            cls: String(el.className || '').slice(0,160),
            text: (el.textContent || '').replace(/\\s+/g,' ').trim().slice(0,48),
            rect: (function(){var r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()
          };
        }
        var cloud=null;
        document.querySelectorAll('li,.el-menu-item,span,a,div').forEach(function(el){
          var t=(el.textContent||'').replace(/\\s+/g,' ').trim();
          if(!cloud && (t==='云同步' || t==='Cloud Sync')) cloud=el;
        });
        var cloudLi = cloud && (cloud.closest('li') || cloud.closest('.el-menu-item') || cloud);
        var parent = cloudLi && cloudLi.parentElement;
        var hosts = ['.app-main','.el-main','.main-container','#app .main-container','.router-view','.app-container','[class*=\"app-main\"]','main'].map(function(s){
          return {sel:s, el:brief(document.querySelector(s))};
        });
        var banner=null;
        document.querySelectorAll('div,section,main').forEach(function(el){
          var t=(el.textContent||'').trim();
          if(!banner && t.indexOf('请登录后使用云同步')>=0 && t.length<120) banner=el;
        });
        var chain=[]; var n=banner||document.querySelector('.app-main')||document.querySelector('.el-main');
        for(var i=0;n && i<10;i++){ chain.push(brief(n)); n=n.parentElement; }
        var localNest = document.querySelector('.vb-ls-nest-menu');
        var root = document.querySelector('.vb-ls-root');
        var appContainer = document.querySelector('.app-container');
        var menuColors = [].slice.call(document.querySelectorAll('.sidebar-container .nest-menu')).map(function(n){
          var li = n.querySelector('.el-menu-item,li');
          var cs = li ? getComputedStyle(li) : null;
          return {
            text: (n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,20),
            color: cs && cs.color,
            style: li ? (li.getAttribute('style')||'').slice(0,120) : '',
            active: !!(li && li.classList.contains('is-active'))
          };
        });
        return {
          cloud: brief(cloud),
          localNest: brief(localNest),
          localNestParent: brief(localNest && localNest.parentElement),
          localNestHtml: localNest ? localNest.outerHTML.slice(0,400) : null,
          siblingsInSubmenu: localNest && localNest.parentElement ? [].slice.call(localNest.parentElement.children).map(function(c){return (c.textContent||'').replace(/\\s+/g,' ').trim().slice(0,20);}) : [],
          menuColors: menuColors,
          root: brief(root),
          rootParent: brief(root && root.parentElement),
          rootOpen: !!(root && root.classList.contains('open')),
          navbar: brief(document.querySelector('.navbar,.el-header,header,[class*=\"navbar\"]')),
          sidebar: brief(document.querySelector('.sidebar-container,.el-aside,[class*=\"sidebar\"]')),
          appContainer: brief(appContainer),
          hideMain: document.documentElement.classList.contains('vb-ls-hide-main'),
          hosts: hosts
        };
      })()`, true)
      const out = path.join(process.env.APPDATA || '', 'virtual-browser', 'logs', 'layout-probe.json')
      fs.writeFileSync(out, JSON.stringify(info, null, 2))
      log('layout-probe', info)
    } catch (e) {
      log('layout-probe failed', String(e))
    }
  }

  const injectUi = async win => {
    try {
      await win.webContents.executeJavaScript(uiSource(), true)
      log('ui injected', win.id)
      setTimeout(() => probeLayout(win), 1500)
      setTimeout(() => probeTable(win), 2500)
      setTimeout(() => stressButtons(win), 5000)
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
    try { workerCtl.ensureExe() } catch (e) { log('ensureExe', String(e)) }
    setInterval(() => {
      workerCtl.listIds().then(ids => {
        BrowserWindow.getAllWindows().forEach(w => {
          try { w.webContents.send('vb-local-sync:running', ids) } catch {}
        })
      }).catch(() => {})
    }, 2500)
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

