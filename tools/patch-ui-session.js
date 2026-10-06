const fs = require('fs')
const p = 'C:/workspace/VirtualBrowser/local-sync-ext/ui-inject.js'
let s = fs.readFileSync(p, 'utf8')
if (s.includes('restorePreviousSession')) {
  console.log('already patched')
  process.exit(0)
}

const insert = `
  // ---- session restore (relaunch envs + chromium tabs) ----
  function chromeCall(name, ...params) {
    return new Promise((resolve, reject) => {
      if (!window.chrome || !window.chrome.send) return reject(new Error('no chrome.send'))
      window.cr = window.cr || {}
      window.cr.__callbacks = window.cr.__callbacks || {}
      const cb = 'vb_ls_' + Math.random().toString(36).slice(2)
      const timer = setTimeout(() => reject(new Error('timeout ' + name)), 8000)
      window.cr.__callbacks[cb] = data => {
        clearTimeout(timer)
        resolve(data)
      }
      window.chrome.send(name, [cb, ...params])
    })
  }

  let lastRunningKey = ''
  let restoreStarted = false

  async function trackRunningSession() {
    try {
      const running = await chromeCall('getRuningBrowser')
      const ids = (Array.isArray(running) ? running : (running && running.data) || []).map(String)
      const key = ids.slice().sort().join(',')
      if (key !== lastRunningKey) {
        lastRunningKey = key
        await invoke('vb-local-sync:save-session', { runningIds: ids })
        console.log('[local-sync] session saved', ids)
      }
    } catch (e) {}
  }

  async function restorePreviousSession() {
    if (restoreStarted) return
    restoreStarted = true
    try {
      const cfg = await invoke('vb-local-sync:get-settings')
      if (cfg.restoreSession === false) return
      const st = await invoke('vb-local-sync:get-session')
      const ids = (st && st.runningIds) || []
      if (!ids.length) {
        console.log('[local-sync] nothing to restore')
        return
      }
      const current = await chromeCall('getRuningBrowser').catch(() => [])
      const curSet = new Set((Array.isArray(current) ? current : []).map(String))
      await invoke('vb-local-sync:prepare-session', ids)
      console.log('[local-sync] restoring', ids)
      for (let i = 0; i < ids.length; i++) {
        const id = String(ids[i])
        if (curSet.has(id)) continue
        try {
          await chromeCall('launchBrowser', id)
          console.log('[local-sync] launched', id)
        } catch (e) {
          console.warn('[local-sync] launch failed', id, e)
        }
        await new Promise(r => setTimeout(r, 1500))
      }
      showToast('已恢复上次运行的 ' + ids.length + ' 个环境')
    } catch (e) {
      console.warn('[local-sync] restore failed', e)
    }
  }

  setInterval(trackRunningSession, 3000)
  setTimeout(trackRunningSession, 1500)
  setTimeout(restorePreviousSession, 4000)
  window.addEventListener('beforeunload', () => { trackRunningSession() })
  window.vbLocalSyncSession = true
`

if (!s.includes('window.vbLocalSyncOpen = openPage')) {
  throw new Error('anchor missing')
}
s = s.replace(
  /window\.vbLocalSyncOpen = openPage\s*\n\s*console\.log\('\[local-sync\] UI ready[^']*'\)/,
  'window.vbLocalSyncOpen = openPage\n' + insert + "\n  console.log('[local-sync] UI ready (auto+session)')"
)
fs.writeFileSync(p, s)
console.log('ok', s.includes('restorePreviousSession'))
