const http = require('http')
const fs = require('fs')
const WebSocket = require('C:/workspace/VirtualBrowser/tools/node_modules/ws')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

async function main() {
  const pages = await getJson('http://127.0.0.1:9229/json/list')
  const page = pages.find(p => p.type === 'page')
  console.log('page', page.title)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  function send(method, params = {}) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  }
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(Object.assign(new Error('cdp'), { detail: msg.error }))
      else resolve(msg.result)
    }
  })
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })

  async function ev(expression, awaitPromise = false) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    console.log('RAW', JSON.stringify(r).slice(0, 500))
    if (r.exceptionDetails) {
      console.log('EXC', JSON.stringify(r.exceptionDetails))
      return null
    }
    return r.result && r.result.value
  }

  const state = await ev(`({
    hasUI: !!window.__vbLocalSyncUI,
    hasBridge: !!window.vbLocalSyncBridge,
    hasOpen: typeof window.vbLocalSyncOpen === 'function',
    sidebar: !!document.querySelector('.vb-ls-sidebar-item'),
    sidebarText: document.querySelector('.vb-ls-sidebar-item') ? document.querySelector('.vb-ls-sidebar-item').textContent : null,
    bodyChildren: document.body ? document.body.children.length : -1
  })`)
  console.log('state', state)

  const ipc = await ev(`(async () => {
    try {
      if (!window.vbLocalSyncBridge) return { err: 'no bridge', keys: Object.keys(window).filter(k => /sync|sandbox|electron|ipc/i.test(k)) }
      const s = await window.vbLocalSyncBridge.invoke('vb-local-sync:get-settings')
      const local = await window.vbLocalSyncBridge.invoke('vb-local-sync:list-local')
      const synced = await window.vbLocalSyncBridge.invoke('vb-local-sync:list-synced')
      return { s, local, synced }
    } catch (e) { return { err: String(e) } }
  })()`, true)
  console.log('ipc', JSON.stringify(ipc, null, 2))

  await ev('window.vbLocalSyncOpen && window.vbLocalSyncOpen()')
  await new Promise(r => setTimeout(r, 2000))
  const pageState = await ev(`({
    open: !!(document.querySelector('.vb-ls-root') && document.querySelector('.vb-ls-root').classList.contains('open')),
    path: document.querySelector('#vb-ls-path') && document.querySelector('#vb-ls-path').value,
    status: document.querySelector('#vb-ls-status') && document.querySelector('#vb-ls-status').textContent,
    localRows: document.querySelectorAll('#vb-ls-local tbody tr').length,
    syncedRows: document.querySelectorAll('#vb-ls-synced tbody tr').length,
    toast: document.querySelector('.vb-ls-toast') && document.querySelector('.vb-ls-toast').textContent
  })`)
  console.log('pageState', pageState)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('C:/workspace/VirtualBrowser/tools/local-sync-test.png', Buffer.from(shot.data, 'base64'))
  console.log('screenshot ok', shot.data.length)

  // find cloud sync menu texts
  const menus = await ev(`Array.from(document.querySelectorAll('.el-menu-item, .submenu-title, li, .router-link-active, span'))
    .map(el => (el.textContent||'').replace(/\\s+/g,' ').trim())
    .filter(t => t && t.length < 30 && /(同步|设置|代理|环境|插件|API)/.test(t))
    .filter((t,i,a) => a.indexOf(t)===i)
    .slice(0,40)`)
  console.log('menus', menus)

  ws.close()
}
main().catch(e => { console.error('FAIL', e.detail || e); process.exit(1) })
