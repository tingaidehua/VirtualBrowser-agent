(function () {
  // allow CSS refresh on re-inject; skip full UI rebuild if already mounted
  const already = !!window.__vbLocalSyncUI
  window.__vbLocalSyncUI = true

  function ipc() {
    const api = (window.vbLocalSyncBridge) ||
      (window.sandboxAPI && window.sandboxAPI.ipcRenderer) ||
      (window.electron && window.electron.ipcRenderer) ||
      (window.require && window.require('electron').ipcRenderer) ||
      null
    return api
  }

  async function invoke(channel, ...args) {
    const r = ipc()
    if (!r || !r.invoke) throw new Error('ipcRenderer 不可用，本地同步无法连接主进程')
    const res = await r.invoke(channel, ...args)
    if (res && res.ok === false) throw new Error(res.error || 'unknown error')
    return res && 'data' in res ? res.data : res
  }

  const css = `
  .vb-ls-root {
    display:none; position:absolute; inset:0; z-index:5;
    background:#f5f7fa; flex-direction:column;
    font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
  }
  .vb-ls-root.open { display:flex !important; }
  .vb-ls-shell { flex:1; min-height:0; display:flex; flex-direction:column; background:#f5f7fa; }
  .vb-ls-top { height:48px; flex:0 0 auto; background:#fff; border-bottom:1px solid #ebeef5; display:flex; align-items:center; padding:0 20px; gap:12px; }
  .vb-ls-top h1 { font-size:16px; margin:0; font-weight:600; color:#303133; }
  .vb-ls-top .sp { flex:1; }
  .vb-ls-body { flex:1; min-height:0; overflow:auto; padding:16px 20px; }
  .vb-ls-nest-menu .el-menu-item { height:50px !important; line-height:50px !important; }
  /* keep sidebar labels readable after we toggle active state */
  .sidebar-container .nest-menu .el-menu-item { color: #bfcbd9 !important; }
  .sidebar-container .nest-menu .el-menu-item.is-active { color: #409eff !important; }
  .sidebar-container .nest-menu .el-menu-item i,
  .sidebar-container .nest-menu .el-menu-item .svg-icon { color: inherit !important; fill: currentColor; }
  .vb-ls-card { background:#fff; border-radius:8px; padding:16px; margin-bottom:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .vb-ls-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  .vb-ls-input { flex:1; min-width:280px; height:32px; border:1px solid #dcdfe6; border-radius:4px; padding:0 10px; }
  .vb-ls-btn { height:32px; padding:0 14px; border:1px solid #dcdfe6; background:#fff; border-radius:4px; cursor:pointer; color:#606266; }
  .vb-ls-btn:hover { border-color:#c0c4cc; color:#409eff; }
  .vb-ls-btn.primary { background:#409eff; border-color:#409eff; color:#fff; }
  .vb-ls-btn.primary:hover { background:#66b1ff; }
  .vb-ls-btn.danger { color:#f56c6c; border-color:#fbc4c4; }
  .vb-ls-grid { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
  @media (max-width: 1100px) { .vb-ls-grid { grid-template-columns: 1fr; } }
  .vb-ls-table { width:100%; border-collapse:collapse; font-size:13px; }
  .vb-ls-table th, .vb-ls-table td { border-bottom:1px solid #ebeef5; padding:10px 8px; text-align:left; color:#606266; }
  .vb-ls-table th { background:#fafafa; color:#909399; font-weight:500; }
  .vb-ls-muted { color:#909399; font-size:12px; }
  .vb-ls-tag { display:inline-block; padding:2px 6px; border-radius:3px; font-size:12px; background:#ecf5ff; color:#409eff; }
  .vb-ls-tag.off { background:#f4f4f5; color:#909399; }
  .vb-ls-tag.warn { background:#fdf6ec; color:#e6a23c; }
  .vb-ls-toast { position:fixed; top:20px; right:20px; z-index:100000; background:#303133; color:#fff; padding:10px 16px; border-radius:4px; display:none; max-width:420px; }
  .vb-ls-toast.show { display:block; }
  .vb-ls-toast.err { background:#f56c6c; }
  .vb-ls-check { margin-right:8px; }
  /* compact env list: row just taller than buttons */
  .el-table { font-size: 12px !important; }
  .el-table .el-table__cell { padding: 0 !important; }
  .el-table td.el-table__cell, .el-table th.el-table__cell { padding: 0 !important; height: 30px !important; }
  .el-table .cell {
    padding: 4px 4px !important; line-height: 22px !important; min-height: 30px !important;
    box-sizing: border-box !important; white-space: nowrap !important;
  }
  .el-table .vb-ls-btn-row {
    display: flex !important; flex-direction: row !important; align-items: center !important;
    flex-wrap: nowrap !important; gap: 4px !important;
  }
  .el-table .el-button,
  .el-table .el-button--mini,
  .el-table .el-button--small {
    display: inline-flex !important; align-items: center !important; justify-content: center !important;
    padding: 0 8px !important; height: 22px !important; min-height: 22px !important;
    line-height: 22px !important; font-size: 12px !important; margin: 0 3px 0 0 !important;
    vertical-align: middle !important; float: none !important;
  }
  .el-table .el-button + .el-button { margin-left: 0 !important; }
  .el-table .el-checkbox { transform: scale(.8); height: 18px; margin: 0 !important; }
  .el-table__body tr, .el-table__header tr { height: 30px !important; }
  .el-table .cell > div { display: inline !important; }
  .el-table .cell br { display: none !important; }
  /* 编辑/删除/启动/打开/关闭 一律横排 */
  .el-table td.actions-cell .cell,
  .el-table td.fixed-width .cell,
  .el-table td.status-col .cell,
  .el-table .vb-ls-btns {
    display: flex !important; flex-direction: row !important; align-items: center !important;
    justify-content: center !important; flex-wrap: nowrap !important; gap: 4px !important;
    white-space: nowrap !important; overflow: visible !important;
  }
  /* packed UI wraps 编辑/删除 in .action-vertical — force horizontal */
  .el-table .action-vertical,
  .el-table .action-vertical > div {
    display: flex !important; flex-direction: row !important; align-items: center !important;
    flex-wrap: nowrap !important; gap: 4px !important; width: auto !important;
  }
  .el-table td.status-col,
  .el-table th.status-col {
    min-width: 200px !important; width: 200px !important; overflow: visible !important;
  }
  /* hide caret / loading triangle inside 启动/已启动 */
  .el-table td.status-col .el-button > i,
  .el-table td.status-col .el-button > .el-icon,
  .el-table td.status-col .el-button .el-icon-arrow-down,
  .el-table td.status-col .el-button .el-icon-arrow-up,
  .el-table td.status-col .el-button .el-icon-loading,
  .el-table td.status-col .el-button .el-icon-more,
  .el-table td.status-col .el-dropdown__caret-button {
    display: none !important;
  }
  .el-table td.actions-cell,
  .el-table th.actions-cell,
  .el-table colgroup col.vb-ls-col-actions {
    min-width: 120px !important; width: 120px !important;
  }
  .el-table__body, .el-table__header { table-layout: fixed !important; }
  .el-table__body tr { height: 32px !important; }
  .el-table__body td { height: 32px !important; padding-top: 0 !important; padding-bottom: 0 !important; }
  .vb-ls-date-main { display: inline; }
  .vb-ls-date-extra { display: none !important; }
  .vb-ls-open-btn, .vb-ls-stop-btn {
    display: inline-flex !important; align-items: center; justify-content: center;
    height: 22px; padding: 0 8px; border-radius: 3px; margin: 0 !important;
    font-size: 12px; cursor: pointer; border: 1px solid #dcdfe6; background: #fff; color: #606266;
  }
  .vb-ls-open-btn { color: #67c23a; border-color: #c2e7b0; background: #f0f9eb; }
  .vb-ls-open-btn:hover { background: #e1f3d8; }
  .vb-ls-stop-btn { color: #f56c6c; border-color: #fbc4c4; background: #fef0f0; }
  .vb-ls-stop-btn:hover { background: #fde2e2; }
  `
  let style = document.getElementById('vb-ls-style')
  if (!style) {
    style = document.createElement('style')
    style.id = 'vb-ls-style'
    document.documentElement.appendChild(style)
  }
  style.textContent = css
  if (already) {
    try { if (window.vbLocalSyncEnhanceTable) window.vbLocalSyncEnhanceTable() } catch (e) {}
    return
  }

  const toast = document.createElement('div')
  toast.className = 'vb-ls-toast'
  document.documentElement.appendChild(toast)
  let toastTimer = null
  function showToast(msg, isErr) {
    toast.textContent = msg
    toast.className = 'vb-ls-toast show' + (isErr ? ' err' : '')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.className = 'vb-ls-toast' }, 2800)
  }

  const root = document.createElement('div')
  root.className = 'vb-ls-root'
  root.innerHTML = `
    <div class="vb-ls-shell">
      <div class="vb-ls-top">
        <h1>本地同步</h1>
        <span class="vb-ls-muted">环境数据自动同步到本地目录（OneDrive 等）</span>
        <div class="sp"></div>
        <button class="vb-ls-btn primary" data-act="sync-now">立即同步</button>
        <button class="vb-ls-btn" data-act="refresh">刷新</button>
      </div>
      <div class="vb-ls-body">
        <div class="vb-ls-card">
          <div class="vb-ls-row">
            <strong>同步位置</strong>
            <input class="vb-ls-input" id="vb-ls-path" readonly />
            <button class="vb-ls-btn" data-act="pick">选择目录</button>
            <label class="vb-ls-muted"><input type="checkbox" id="vb-ls-enabled" class="vb-ls-check"/>启用自动同步</label>
            <label class="vb-ls-muted"><input type="checkbox" id="vb-ls-autoload" class="vb-ls-check"/>启动时自动加载</label>
            <label class="vb-ls-muted"><input type="checkbox" id="vb-ls-autoupload" class="vb-ls-check"/>退出时自动上传</label>
            <button class="vb-ls-btn primary" data-act="save-settings">保存设置</button>
          </div>
          <div class="vb-ls-muted" style="margin-top:10px" id="vb-ls-status">自动同步已开启</div>
        </div>
        <div class="vb-ls-card">
          <div class="vb-ls-grid">
            <div>
              <h3 style="margin:0 0 8px;font-size:14px">本地环境（自动同步）</h3>
              <table class="vb-ls-table" id="vb-ls-local"><thead><tr>
                <th>名称</th><th>ID</th><th>状态</th><th>大小</th>
              </tr></thead><tbody></tbody></table>
            </div>
            <div>
              <h3 style="margin:0 0 8px;font-size:14px">同步库</h3>
              <table class="vb-ls-table" id="vb-ls-synced"><thead><tr>
                <th>名称</th><th>Sync ID</th><th>更新时间</th><th>大小</th>
              </tr></thead><tbody></tbody></table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
  const state = { settings: null, local: [], synced: [], busy: false, host: null, open: false }

  function findContentHost() {
    return document.querySelector('.app-main .app-container')
      || document.querySelector('.app-container')
      || document.querySelector('.app-main')
      || document.querySelector('.main-container')
  }

  function mountIntoContent() {
    const host = findContentHost()
    if (!host) return null
    const cs = window.getComputedStyle(host)
    if (cs.position === 'static') host.style.position = 'relative'
    if (root.parentElement !== host) host.appendChild(root)
    state.host = host
    return host
  }

  function hideHostSiblings(host) {
    if (!host) return
    ;[...host.children].forEach(ch => {
      if (ch === root) return
      if (ch.dataset.vbLsHidden === '1') return
      ch.dataset.vbLsHidden = '1'
      ch.dataset.vbLsPrevDisplay = ch.style.display || ''
      ch.style.display = 'none'
    })
  }

  function restoreHostSiblings(host) {
    if (!host) return
    ;[...host.querySelectorAll('[data-vb-ls-hidden="1"]')].forEach(ch => {
      ch.style.display = ch.dataset.vbLsPrevDisplay || ''
      delete ch.dataset.vbLsHidden
      delete ch.dataset.vbLsPrevDisplay
    })
  }

  function setBreadcrumbLocal() {
    const bar = document.querySelector('.navbar .el-breadcrumb, .navbar')
    if (!bar) return
    const items = bar.querySelectorAll('.el-breadcrumb__inner, .no-redirect, span')
    for (const el of items) {
      const t = (el.textContent || '').trim()
      if (/云同步|环境列表|常用环境|分组管理|Cloud Sync|Settings|设置/.test(t) && t.length < 20) {
        el.dataset.vbLsPrevText = el.dataset.vbLsPrevText || t
        el.textContent = '本地同步'
      }
    }
  }

  const SIDEBAR_TEXT = 'rgb(191, 203, 217)'
  const SIDEBAR_ACTIVE = 'rgb(64, 158, 255)'

  function paintMenuItem(li, active) {
    if (!li) return
    if (active) {
      li.classList.add('is-active')
      li.style.setProperty('color', SIDEBAR_ACTIVE, 'important')
    } else {
      li.classList.remove('is-active')
      li.style.setProperty('color', SIDEBAR_TEXT, 'important')
    }
  }

  function clearMenuActive() {
    document.querySelectorAll('.sidebar-container .nest-menu .el-menu-item').forEach(li => {
      if (li.closest('.vb-ls-nest-menu')) return
      paintMenuItem(li, false)
    })
    document.querySelectorAll('.sidebar-container a.router-link-exact-active, .sidebar-container a.router-link-active').forEach(a => {
      if (a.closest('.vb-ls-nest-menu')) return
      a.classList.remove('router-link-exact-active', 'router-link-active')
    })
  }

  function fmtSize(n) {
    n = Number(n) || 0
    if (n < 1024) return n + ' B'
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1048576).toFixed(1) + ' MB'
  }
  function fmtTime(t) {
    if (!t) return '-'
    try { return new Date(t).toLocaleString() } catch { return String(t) }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function renderLocal() {
    const tb = root.querySelector('#vb-ls-local tbody')
    tb.innerHTML = state.local.map(u => {
      const tag = u.dirty
        ? '<span class="vb-ls-tag warn">待同步</span>'
        : '<span class="vb-ls-tag">已同步</span>'
      return `<tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${u.id}</td>
        <td>${tag}</td>
        <td>${fmtSize(u.size)}</td>
      </tr>`
    }).join('') || `<tr><td colspan="4" class="vb-ls-muted">暂无本地环境</td></tr>`
  }

  function renderSynced() {
    const tb = root.querySelector('#vb-ls-synced tbody')
    tb.innerHTML = state.synced.map(e => `
      <tr>
        <td>${escapeHtml(e.name)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.syncId)}</td>
        <td>${fmtTime(e.updatedAt)}</td>
        <td>${fmtSize(e.size)}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="vb-ls-muted">同步目录为空（创建环境后会自动上传）</td></tr>`
  }

  async function refresh() {
    state.settings = await invoke('vb-local-sync:get-settings')
    root.querySelector('#vb-ls-path').value = state.settings.syncPath || ''
    root.querySelector('#vb-ls-enabled').checked = state.settings.enabled !== false
    root.querySelector('#vb-ls-autoload').checked = !!state.settings.autoLoad
    root.querySelector('#vb-ls-autoupload').checked = !!state.settings.autoUploadOnExit
    state.local = await invoke('vb-local-sync:list-local')
    const synced = await invoke('vb-local-sync:list-synced', state.settings.syncPath)
    state.synced = (synced && synced.environments) || []
    renderLocal()
    renderSynced()
    const dirty = state.local.filter(x => x.dirty).length
    const on = state.settings.enabled !== false
    root.querySelector('#vb-ls-status').textContent = on
      ? `自动同步已开启 · 本地 ${state.local.length} 个 · 库内 ${state.synced.length} 个 · 待同步 ${dirty} 个 · 间隔 ${state.settings.autoSyncIntervalSec || 60}s`
      : '自动同步已关闭'
  }

  async function withBusy(fn) {
    if (state.busy) return
    state.busy = true
    root.querySelector('#vb-ls-status').textContent = '同步中...'
    try {
      await fn()
      await refresh()
    } catch (e) {
      showToast(String(e.message || e), true)
    } finally {
      state.busy = false
    }
  }

  function markSidebar(active) {
    const nest = document.querySelector('.vb-ls-nest-menu')
    if (!nest) return
    const a = nest.querySelector('a')
    const li = nest.querySelector('.el-menu-item, li')
    if (active) {
      clearMenuActive()
      if (a) a.classList.add('router-link-active', 'router-link-exact-active')
      paintMenuItem(li, true)
    } else {
      if (a) a.classList.remove('router-link-active', 'router-link-exact-active')
      paintMenuItem(li, false)
    }
  }

  function openPage() {
    const host = mountIntoContent()
    if (!host) {
      showToast('未找到主内容区', true)
      return
    }
    hideHostSiblings(host)
    root.classList.add('open')
    state.open = true
    markSidebar(true)
    setBreadcrumbLocal()
    try { history.replaceState(null, '', '#/vb-local-sync') } catch {}
    refresh().catch(e => showToast(String(e.message || e), true))
  }
  function closePage() {
    root.classList.remove('open')
    state.open = false
    restoreHostSiblings(state.host || findContentHost())
    markSidebar(false)
  }

  root.addEventListener('click', e => {
    const btn = e.target.closest('button')
    if (!btn) return
    const act = btn.getAttribute('data-act')
    if (act === 'refresh') return withBusy(async () => {})
    if (act === 'sync-now') {
      return withBusy(async () => {
        const r = await invoke('vb-local-sync:sync-now')
        if (r && r.skipped) showToast('自动同步已关闭')
        else showToast(`同步完成：拉取 ${r.pulled || 0}，上传 ${r.uploaded || 0}`)
      })
    }
    if (act === 'pick') {
      return withBusy(async () => {
        const next = await invoke('vb-local-sync:pick-directory')
        if (next) showToast('已选择: ' + next.syncPath)
      })
    }
    if (act === 'save-settings') {
      return withBusy(async () => {
        await invoke('vb-local-sync:save-settings', {
          syncPath: root.querySelector('#vb-ls-path').value,
          enabled: root.querySelector('#vb-ls-enabled').checked,
          autoLoad: root.querySelector('#vb-ls-autoload').checked,
          autoUploadOnExit: root.querySelector('#vb-ls-autoupload').checked,
          restoreSession: false
        })
        showToast('设置已保存，自动同步已更新')
      })
    }
  })

  function findCloudNestMenu() {
    const nests = document.querySelectorAll('.sidebar-container .nest-menu, .el-menu .nest-menu')
    for (const nest of nests) {
      const t = (nest.textContent || '').replace(/\s+/g, ' ').trim()
      if (t === '云同步' || t === 'Cloud Sync') return nest
    }
    return null
  }

  function injectSidebar() {
    // remove old wrong-level item
    document.querySelectorAll('.vb-ls-sidebar-item').forEach(n => n.remove())
    if (document.querySelector('.vb-ls-nest-menu')) return true
    const cloud = findCloudNestMenu()
    if (!cloud || !cloud.parentElement) return false
    const nest = cloud.cloneNode(true)
    nest.classList.add('vb-ls-nest-menu')
    const a = nest.querySelector('a')
    if (a) {
      a.setAttribute('href', '#/vb-local-sync')
      a.classList.remove('router-link-exact-active', 'router-link-active')
    }
    const li = nest.querySelector('.el-menu-item, li[role="menuitem"]')
    if (li) {
      li.style.backgroundColor = 'rgb(48, 65, 86)'
      paintMenuItem(li, false)
      const span = li.querySelector('span')
      if (span) span.textContent = '本地同步'
      else li.appendChild(document.createTextNode('本地同步'))
    }
    nest.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      openPage()
    }, true)
    cloud.parentElement.insertBefore(nest, cloud.nextSibling)
    return true
  }

  // leave local-sync when user navigates other sidebar routes
  window.addEventListener('hashchange', () => {
    if (!state.open) return
    const h = String(location.hash || '')
    if (h.indexOf('vb-local-sync') < 0) closePage()
  })
  document.addEventListener('click', e => {
    if (!state.open) return
    const nest = e.target.closest && e.target.closest('.vb-ls-nest-menu')
    if (nest) return
    const other = e.target.closest && e.target.closest('.sidebar-container .nest-menu a, .sidebar-container .el-menu-item')
    if (other) closePage()
  }, true)

  function enhanceSettingsPage() {
    if (document.querySelector('.vb-ls-settings-block')) return
    const labels = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.textContent || '').trim()
      return t === '云同步设置' || t === 'Cloud Sync Settings' || t === '同步提供商' || t === 'Cloud Sync Provider'
    })
    if (!labels.length) return
    const anchor = labels[0].closest('.settings-card, .settings-section, .el-card, form, section, div')
    if (!anchor || !anchor.parentElement) return
    const block = document.createElement('div')
    block.className = 'vb-ls-settings-block vb-ls-card'
    block.style.margin = '12px 0'
    block.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">本地同步（自动）</div>
      <div class="vb-ls-muted" style="margin-bottom:8px">默认自动同步到本机目录（OneDrive/VirtualBrowser），无需付费，也无需手动开启上传。</div>
      <div class="vb-ls-row">
        <input class="vb-ls-input" id="vb-ls-set-path" readonly style="max-width:420px"/>
        <button class="vb-ls-btn" type="button" id="vb-ls-set-pick">选择目录</button>
        <button class="vb-ls-btn primary" type="button" id="vb-ls-set-open">打开本地同步</button>
      </div>`
    anchor.parentElement.insertBefore(block, anchor.nextSibling)
    invoke('vb-local-sync:get-settings').then(cfg => {
      const input = document.getElementById('vb-ls-set-path')
      if (input) input.value = cfg.syncPath || ''
    }).catch(() => {})
    const pick = document.getElementById('vb-ls-set-pick')
    const open = document.getElementById('vb-ls-set-open')
    if (pick) pick.onclick = async () => {
      try {
        const next = await invoke('vb-local-sync:pick-directory')
        const input = document.getElementById('vb-ls-set-path')
        if (next && input) input.value = next.syncPath
        showToast('本地同步目录已更新')
      } catch (e) { showToast(String(e.message || e), true) }
    }
    if (open) open.onclick = () => openPage()
  }

  let tries = 0
  let enhanceBusy = false
  let enhanceTimer = null
  function scheduleEnhance(ms) {
    if (enhanceTimer) clearTimeout(enhanceTimer)
    enhanceTimer = setTimeout(() => {
      enhanceTimer = null
      if (enhanceBusy) return
      enhanceBusy = true
      try {
        injectSidebar()
        enhanceSettingsPage()
        enhanceBrowserTable()
      } finally {
        enhanceBusy = false
      }
    }, ms == null ? 120 : ms)
  }
  const timer = setInterval(() => {
    tries++
    scheduleEnhance(0)
    if (tries > 40) clearInterval(timer)
  }, 800)
  const mo = new MutationObserver(() => {
    if (enhanceBusy) return
    scheduleEnhance(250)
  })
  mo.observe(document.body || document.documentElement, { childList: true, subtree: false })

  window.vbLocalSyncOpen = openPage

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

  function rowEnvId(tr) {
    const cells = tr.querySelectorAll('td .cell')
    for (const c of cells) {
      const t = (c.textContent || '').trim()
      if (/^\d+$/.test(t)) return t
    }
    return ''
  }

  function stripLaunchDecor(launch) {
    if (!launch) return
    ;[...launch.querySelectorAll('i, svg, .el-icon, .el-icon-arrow-down, .el-icon-arrow-up, .el-icon-loading, .el-icon-more')].forEach(n => n.remove())
    // keep plain text label only
    const t = (launch.textContent || '').replace(/\s+/g, ' ').trim()
    if (t && launch.childNodes.length !== 1) launch.textContent = t
  }

  function enhanceLaunchCell(tr) {
    const btns = [...tr.querySelectorAll('button.el-button, .el-button')]
    const launch = btns.find(b =>
      /启动|已启动|Launch|Launched|Starting/i.test((b.textContent || '').trim()) &&
      !b.classList.contains('vb-ls-open-btn') &&
      !b.classList.contains('vb-ls-stop-btn')
    )
    if (!launch) return
    const id = rowEnvId(tr)
    if (!id) return
    const parent = launch.parentElement
    if (parent) {
      parent.style.display = 'flex'
      parent.style.alignItems = 'center'
      parent.style.flexWrap = 'nowrap'
      parent.style.gap = '4px'
    }
    if (!launch.dataset.vbOrig) launch.dataset.vbOrig = /已启动|Launched/i.test((launch.textContent || '').trim()) ? '启动' : ((launch.textContent || '').trim() || '启动')
    const osRun = !!(window.__vbOsRunningIds && window.__vbOsRunningIds.has(String(id)))
    const running = osRun
    let openBtn = parent && parent.querySelector('.vb-ls-open-btn')
    let stop = parent && parent.querySelector('.vb-ls-stop-btn')
    stripLaunchDecor(launch)

    if (running) {
      launch.style.display = ''
      launch.classList.remove('is-disabled')
      launch.removeAttribute('disabled')
      launch.style.pointerEvents = 'none'
      launch.style.opacity = '0.9'
      launch.style.cursor = 'default'
      launch.textContent = '已启动'
      if (!openBtn) {
        openBtn = document.createElement('button')
        openBtn.type = 'button'
        openBtn.className = 'vb-ls-open-btn'
        openBtn.textContent = '打开'
        parent.insertBefore(openBtn, launch.nextSibling)
      }
      if (!openBtn.dataset.vbBound) {
        openBtn.dataset.vbBound = '1'
        openBtn.addEventListener('click', async e => {
          e.preventDefault()
          e.stopPropagation()
          try {
            await invoke('vb-local-sync:ui-log', { act: 'open-click', id, os: [...(window.__vbOsRunningIds || [])] })
            await invoke('vb-local-sync:focus-worker', id)
            showToast('已打开环境 ' + id)
          } catch (err) {
            await invoke('vb-local-sync:ui-log', { act: 'open-fail', id, error: String(err && err.message || err) }).catch(() => {})
            showToast('打开失败: ' + (err.message || err), true)
          }
        })
      }
      if (!stop) {
        stop = document.createElement('button')
        stop.type = 'button'
        stop.className = 'vb-ls-stop-btn'
        stop.textContent = '关闭'
        parent.appendChild(stop)
      }
      if (!stop.dataset.vbBound) {
        stop.dataset.vbBound = '1'
        stop.addEventListener('click', async e => {
          e.preventDefault()
          e.stopPropagation()
          stop.disabled = true
          try {
            await invoke('vb-local-sync:ui-log', { act: 'close-click', id })
            let chromeErr = null
            try { await chromeCall('stopBrowser', String(id)) } catch (err) { chromeErr = String(err && err.message || err) }
            let kill = null
            try { kill = await invoke('vb-local-sync:stop-worker', id) } catch (err) { kill = { error: String(err && err.message || err) } }
            await pollOsRunning()
            if (window.__vbOsRunningIds) window.__vbOsRunningIds.delete(String(id))
            scheduleEnhance(0)
            await invoke('vb-local-sync:ui-log', { act: 'close-done', id, chromeErr, kill, os: [...(window.__vbOsRunningIds || [])] })
            if (window.__vbOsRunningIds && window.__vbOsRunningIds.has(String(id))) {
              throw new Error(chromeErr || (kill && kill.error) || '进程仍在运行')
            }
            showToast('已关闭环境 ' + id)
          } catch (err) {
            await invoke('vb-local-sync:ui-log', { act: 'close-fail', id, error: String(err && err.message || err) }).catch(() => {})
            showToast('关闭失败: ' + (err.message || err), true)
          } finally {
            stop.disabled = false
          }
        })
      }
    } else {
      launch.style.display = ''
      launch.style.pointerEvents = ''
      launch.style.opacity = ''
      launch.style.cursor = ''
      launch.removeAttribute('disabled')
      launch.classList.remove('is-disabled')
      if (launch.dataset.vbOrig) launch.textContent = launch.dataset.vbOrig
      if (openBtn) openBtn.remove()
      if (stop) stop.remove()
    }
  }

  function compactDateCell(cell) {
    if (!cell) return
    if (cell.querySelector('.vb-ls-date-main')) return
    const raw = cell.innerText || cell.textContent || ''
    const text = raw.replace(/\s+/g, ' ').trim()
    const dates = text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/g) || []
    if (dates.length < 2) return
    const created = dates[0]
    const last = dates[1]
    cell.title = '创建: ' + created + '\n最后启动: ' + last
    cell.innerHTML = '<span class="vb-ls-date-main">' + created + '</span>'
  }

  function horizontalActionCell(cell) {
    if (!cell) return
    const vert = cell.querySelector('.action-vertical')
    if (vert) {
      vert.style.setProperty('display', 'flex', 'important')
      vert.style.setProperty('flex-direction', 'row', 'important')
      vert.style.setProperty('align-items', 'center', 'important')
      vert.style.setProperty('flex-wrap', 'nowrap', 'important')
      vert.style.setProperty('gap', '4px', 'important')
      ;[...vert.children].forEach(ch => {
        ch.style.setProperty('display', 'inline-flex', 'important')
        ch.style.setProperty('margin', '0', 'important')
        ch.style.setProperty('width', 'auto', 'important')
      })
      // flatten: move buttons out of nested wrappers into row
      const buttons = [...vert.querySelectorAll('.el-button')]
      const directBtns = [...vert.children].filter(c => c.classList && c.classList.contains('el-button'))
      if (buttons.length >= 2 && directBtns.length < buttons.length) {
        buttons.forEach(b => vert.appendChild(b))
        ;[...vert.querySelectorAll(':scope > div')].forEach(d => { if (!d.querySelector('.el-button')) d.remove() })
      }
    }
    const all = [...cell.querySelectorAll('.el-button, .vb-ls-open-btn, .vb-ls-stop-btn')]
    if (!all.length) return
    cell.classList.add('vb-ls-btns')
    cell.style.setProperty('display', 'flex', 'important')
    cell.style.setProperty('flex-direction', 'row', 'important')
    cell.style.setProperty('align-items', 'center', 'important')
    cell.style.setProperty('flex-wrap', 'nowrap', 'important')
    all.forEach(b => {
      b.style.setProperty('display', 'inline-flex', 'important')
      b.style.setProperty('float', 'none', 'important')
      b.style.setProperty('margin', '0', 'important')
      b.style.setProperty('height', '22px', 'important')
      b.style.setProperty('min-height', '22px', 'important')
    })
    const td = cell.closest('td')
    if (td && (td.classList.contains('actions-cell') || /编辑|删除/.test(cell.textContent || ''))) {
      td.style.minWidth = '130px'
      td.style.width = '130px'
      td.style.overflow = 'visible'
    }
  }

  function shrinkColumns() {
    const table = document.querySelector('.el-table')
    if (!table) return
    // selection, 序号, 名称, 分组, 代理, 备注, 创建时间, 启动, 操作, 常用
    const widths = [36, 40, 100, 56, 36, 48, 108, 200, 110, 28]
    const labels = []
    const ths = [...table.querySelectorAll('.el-table__header-wrapper th, .el-table__header th')]
    ths.forEach((th, i) => {
      const label = (th.textContent || '').replace(/\s+/g, ' ').trim()
      labels[i] = label
      let w = widths[i]
      if (/操作/.test(label)) w = 120
      if (/启动|Launch/.test(label)) w = 200
      if (/创建时间/.test(label)) {
        w = 120
        if (!th.dataset.vbHead) {
          th.dataset.vbHead = '1'
          const cell = th.querySelector('.cell') || th
          cell.textContent = '创建时间'
          th.title = '悬停单元格可看最后启动时间'
        }
      }
      if (!w) return
      th.style.width = w + 'px'
      th.style.minWidth = w + 'px'
      th.style.maxWidth = w + 'px'
      widths[i] = w
    })
    table.querySelectorAll('colgroup').forEach(cg => {
      const cols = [...cg.querySelectorAll('col')]
      cols.forEach((col, i) => {
        const w = widths[i]
        if (!w) return
        col.setAttribute('width', String(w))
        col.style.width = w + 'px'
        col.style.minWidth = w + 'px'
        if (/操作/.test(labels[i] || '') || i === 8) col.classList.add('vb-ls-col-actions')
      })
    })
    table.querySelectorAll('td.status-col, th.status-col').forEach(td => {
      td.style.width = '200px'
      td.style.minWidth = '200px'
      td.style.overflow = 'visible'
    })
    table.querySelectorAll('td.actions-cell, th.actions-cell').forEach(td => {
      td.style.width = '120px'
      td.style.minWidth = '120px'
    })
  }

  function enhanceBrowserTable() {
    shrinkColumns()
    const rows = document.querySelectorAll('.el-table__body-wrapper tbody tr, .el-table__body tbody tr')
    rows.forEach(tr => {
      enhanceLaunchCell(tr)
      tr.querySelectorAll('td .cell').forEach(cell => {
        compactDateCell(cell)
        if (cell.querySelector('.el-button, .vb-ls-open-btn, .vb-ls-stop-btn')) {
          horizontalActionCell(cell)
        }
      })
    })
  }

  window.__vbOsRunningIds = window.__vbOsRunningIds || new Set()
  window.__vbChromeRunningIds = window.__vbChromeRunningIds || new Set()
  function asIds(r) {
    if (!r) return []
    if (Array.isArray(r)) {
      return r.map(x => {
        if (x && typeof x === 'object') return x.id || x.browserId || x.userId
        return x
      }).filter(v => v != null && v !== '')
    }
    if (typeof r === 'object') return Object.keys(r).filter(k => r[k])
    return [r]
  }
  async function pollChromeRunning() {
    try {
      const r = await chromeCall('getRuningBrowser')
      window.__vbChromeRunningIds = new Set(asIds(r).map(String))
    } catch (e) {
      try { await invoke('vb-local-sync:ui-log', { act: 'chrome-running-fail', error: String(e && e.message || e) }) } catch {}
    }
  }
  async function pollOsRunning() {
    try {
      const ids = await invoke('vb-local-sync:running-workers')
      window.__vbOsRunningIds = new Set((ids || []).map(String))
    } catch (e) {}
  }
  let lastOsKey = ''
  try {
    const r = ipc()
    if (r && r.on) {
      r.on('vb-local-sync:running', (_e, ids) => {
        const next = (ids || []).map(String)
        window.__vbOsRunningIds = new Set(next)
        const key = next.slice().sort().join(',')
        if (key !== lastOsKey) {
          lastOsKey = key
          scheduleEnhance(0)
        }
      })
    }
  } catch {}
  pollOsRunning().then(() => scheduleEnhance(0))
  setInterval(() => {
    pollOsRunning().then(() => {
      const key = [...(window.__vbOsRunningIds || [])].sort().join(',')
      if (key !== lastOsKey) {
        lastOsKey = key
        scheduleEnhance(0)
      }
    })
  }, 3000)

  window.vbLocalSyncEnhanceTable = enhanceBrowserTable
  setTimeout(() => scheduleEnhance(0), 400)
  setTimeout(() => {
    try {
      const fs = (window.require && window.require('fs')) || null
      const path = (window.require && window.require('path')) || null
      const info = {
        hideMain: document.documentElement.classList.contains('vb-ls-hide-main') || document.body.classList.contains('vb-ls-hide-main'),
        appKids: document.querySelectorAll('#app > *').length,
        tables: document.querySelectorAll('.el-table').length,
        rows: document.querySelectorAll('.el-table__body tr').length,
        actions: document.querySelectorAll('td.actions-cell, td.fixed-width').length,
        bodyText: (document.body && document.body.innerText || '').slice(0, 80)
      }
      if (fs && path) {
        fs.writeFileSync(path.join(process.env.APPDATA || '', 'virtual-browser', 'logs', 'compact-probe.json'), JSON.stringify(info, null, 2))
      }
    } catch (e) {}
  }, 2500)

  console.log('[local-sync] UI ready (list compact)')
})();

