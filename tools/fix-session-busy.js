const fs = require('fs')

// 1) sync-core: skip locked files in copyDir
const corePath = 'C:/workspace/VirtualBrowser/local-sync-ext/sync-core.js'
let core = fs.readFileSync(corePath, 'utf8')
if (!core.includes('skipped locked')) {
  core = core.replace(
`    } else {
      ensureDir(path.dirname(d))
      fs.copyFileSync(s, d)
      copied++
    }`,
`    } else {
      ensureDir(path.dirname(d))
      try {
        fs.copyFileSync(s, d)
        copied++
      } catch (e) {
        // Cookies/LOCK etc may be busy while browser is running
        if (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) {
          // skipped locked
          continue
        }
        throw e
      }
    }`
  )
  fs.writeFileSync(corePath, core)
  console.log('copyDir patched')
} else console.log('copyDir already patched')

// 2) ui: don't wipe session with empty until restore done
const uiPath = 'C:/workspace/VirtualBrowser/local-sync-ext/ui-inject.js'
let ui = fs.readFileSync(uiPath, 'utf8')
if (!ui.includes('__vbLocalSyncRestoreDone')) {
  ui = ui.replace(
`      const ids = (Array.isArray(running) ? running : (running && running.data) || []).map(String)
      const key = ids.slice().sort().join(',')
      if (key !== lastRunningKey) {
        lastRunningKey = key
        await invoke('vb-local-sync:save-session', { runningIds: ids })
        console.log('[local-sync] session saved', ids)
      }`,
`      const ids = (Array.isArray(running) ? running : (running && running.data) || []).map(String)
      // Avoid wiping last session before restore finishes
      if (ids.length === 0 && !window.__vbLocalSyncRestoreDone) return
      const key = ids.slice().sort().join(',')
      if (key !== lastRunningKey) {
        lastRunningKey = key
        await invoke('vb-local-sync:save-session', { runningIds: ids })
        console.log('[local-sync] session saved', ids)
      }`
  )
  ui = ui.replace(
`      showToast('已恢复上次运行的 ' + ids.length + ' 个环境')
    } catch (e) {
      console.warn('[local-sync] restore failed', e)
    }
  }`,
`      showToast('已恢复上次运行的 ' + ids.length + ' 个环境')
    } catch (e) {
      console.warn('[local-sync] restore failed', e)
    } finally {
      window.__vbLocalSyncRestoreDone = true
    }
  }`
  )
  // also mark done when nothing to restore
  ui = ui.replace(
`      if (!ids.length) {
        console.log('[local-sync] nothing to restore')
        return
      }`,
`      if (!ids.length) {
        console.log('[local-sync] nothing to restore')
        window.__vbLocalSyncRestoreDone = true
        return
      }`
  )
  fs.writeFileSync(uiPath, ui)
  console.log('ui patched')
} else console.log('ui already patched')
