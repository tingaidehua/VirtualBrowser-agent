const fs = require('fs')
const p = 'C:/workspace/VirtualBrowser/local-sync-ext/ui-inject.js'
let s = fs.readFileSync(p, 'utf8')

// Add CSS for chrome-like restore bar
if (!s.includes('vb-ls-restore-bar')) {
  s = s.replace(
    '.vb-ls-sidebar-item .ico { width:18px; text-align:center; }',
    `.vb-ls-sidebar-item .ico { width:18px; text-align:center; }
  .vb-ls-restore-bar { position: fixed; left: 50%; top: 56px; transform: translateX(-50%); z-index: 100001; background: #fff; border: 1px solid #dadce0; box-shadow: 0 2px 6px rgba(0,0,0,.15); border-radius: 8px; padding: 14px 16px; min-width: 420px; max-width: 640px; display: none; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  .vb-ls-restore-bar.show { display: block; }
  .vb-ls-restore-bar .title { font-size: 14px; font-weight: 600; color: #202124; margin-bottom: 6px; }
  .vb-ls-restore-bar .desc { font-size: 12px; color: #5f6368; margin-bottom: 10px; line-height: 1.5; max-height: 72px; overflow: auto; }
  .vb-ls-restore-bar .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .vb-ls-restore-bar .actions button { height: 32px; padding: 0 14px; border-radius: 4px; border: 1px solid #dadce0; background: #fff; cursor: pointer; }
  .vb-ls-restore-bar .actions button.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }`
  )
}

// Replace restorePreviousSession + timers with prompt-based flow
const oldStart = 'async function restorePreviousSession()'
const idx = s.indexOf(oldStart)
if (idx < 0) throw new Error('restorePreviousSession not found')
const endMarker = 'setInterval(trackRunningSession, 3000)'
const endIdx = s.indexOf(endMarker, idx)
if (endIdx < 0) throw new Error('timer marker not found')

const replacement = `
  // Chrome-like restore prompt
  const restoreBar = document.createElement('div')
  restoreBar.className = 'vb-ls-restore-bar'
  restoreBar.innerHTML = \`
    <div class="title">要恢复这些网页吗？</div>
    <div class="desc" id="vb-ls-restore-desc">检测到上次关闭前打开的页面。</div>
    <div class="actions">
      <button type="button" data-act="restore-dismiss">关闭</button>
      <button type="button" class="primary" data-act="restore-confirm">恢复</button>
    </div>
  \`
  document.documentElement.appendChild(restoreBar)

  let pendingRestore = null

  function hideRestoreBar() {
    restoreBar.classList.remove('show')
    pendingRestore = null
  }

  async function doRestoreNow() {
    if (!pendingRestore) return
    const st = pendingRestore
    hideRestoreBar()
    showToast('正在恢复上次网页...')
    try {
      const ids = st.runningIds || []
      for (const id of ids) {
        await invoke('vb-local-sync:restore-launch', String(id), (st.tabs && st.tabs[id]) || [])
      }
      const tabCount = Object.values(st.tabs || {}).reduce((n, arr) => n + ((arr && arr.length) || 0), 0)
      showToast('已恢复 ' + ids.length + ' 个环境' + (tabCount ? ' / ' + tabCount + ' 个网页' : ''))
    } catch (e) {
      showToast('恢复失败: ' + (e.message || e), true)
    } finally {
      window.__vbLocalSyncRestoreDone = true
    }
  }

  restoreBar.addEventListener('click', e => {
    const btn = e.target.closest('button')
    if (!btn) return
    const act = btn.getAttribute('data-act')
    if (act === 'restore-dismiss') {
      hideRestoreBar()
      window.__vbLocalSyncRestoreDone = true
      // keep runningIds empty so we don't nag every launch unless user opens browsers again
      invoke('vb-local-sync:save-session', { runningIds: [], tabs: (pendingRestore && pendingRestore.tabs) || {} }).catch(() => {})
    }
    if (act === 'restore-confirm') doRestoreNow()
  })

  async function maybeShowRestorePrompt() {
    if (restoreStarted) return
    restoreStarted = true
    try {
      const cfg = await invoke('vb-local-sync:get-settings')
      if (cfg.restoreSession === false) {
        window.__vbLocalSyncRestoreDone = true
        return
      }
      const st = await invoke('vb-local-sync:get-session')
      const ids = (st && st.runningIds) || []
      const tabMap = (st && st.tabs) || {}
      const allTabs = []
      for (const id of ids) {
        for (const u of tabMap[id] || []) allTabs.push(u)
      }
      // also try capture from disk if tabs empty but ids exist
      if (ids.length && !allTabs.length) {
        try {
          await invoke('vb-local-sync:backup-session', ids)
          const st2 = await invoke('vb-local-sync:get-session')
          for (const id of (st2.runningIds || ids)) {
            for (const u of ((st2.tabs || {})[id] || [])) allTabs.push(u)
          }
          pendingRestore = st2
        } catch {
          pendingRestore = st
        }
      } else {
        pendingRestore = st
      }

      if (!ids.length) {
        window.__vbLocalSyncRestoreDone = true
        return
      }

      const uniq = [...new Set(allTabs)].slice(0, 8)
      const desc = document.getElementById('vb-ls-restore-desc')
      if (uniq.length) {
        desc.innerHTML = '上次打开了 <b>' + uniq.length + '</b> 个网页（环境 ' + ids.join(', ') + '）：<br>' +
          uniq.map(u => '• ' + u.replace(/^https?:\\/\\//, '').slice(0, 70)).join('<br>')
      } else {
        desc.textContent = '检测到上次运行的环境 ' + ids.join(', ') + '。点击“恢复”重新打开。'
      }
      restoreBar.classList.add('show')
    } catch (e) {
      console.warn('[local-sync] restore prompt failed', e)
      window.__vbLocalSyncRestoreDone = true
    }
  }

`

s = s.slice(0, idx) + replacement + s.slice(endIdx)
// Fix timer calls
s = s.replace(
  /setInterval\(trackRunningSession, 3000\)\s*\n\s*setTimeout\(trackRunningSession, 1500\)\s*\n\s*setTimeout\(restorePreviousSession, 4000\)/,
  `setInterval(trackRunningSession, 3000)
  setTimeout(trackRunningSession, 1500)
  setTimeout(maybeShowRestorePrompt, 2500)`
)

fs.writeFileSync(p, s)
console.log('ok', s.includes('maybeShowRestorePrompt'), s.includes('要恢复这些网页吗'), s.includes('restorePreviousSession'))
