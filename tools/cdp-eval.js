const http = require('http')
const fs = require('fs')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function main() {
  const pages = await getJson('http://127.0.0.1:9229/json/list')
  const page = pages.find(p => p.type === 'page')
  if (!page) throw new Error('no page')
  console.log('page', page.title, page.url)

  // Use CDP via WebSocket - use undici/ws if available, else raw
  let WebSocket
  try { WebSocket = require('ws') } catch {
    // try playwright's or install
  }
  if (!WebSocket) {
    // minimal: use chrome-remote-interface style with child_process and npx?
    const { spawnSync } = require('child_process')
    // fallback using PowerShell... better install ws
    spawnSync('npm', ['install', 'ws', '--prefix', 'C:/workspace/VirtualBrowser/tools'], { stdio: 'inherit', shell: true })
    WebSocket = require('C:/workspace/VirtualBrowser/tools/node_modules/ws')
  }

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
    const msg = JSON.parse(raw)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  const expr = `(() => ({
    hasUI: !!window.__vbLocalSyncUI,
    hasBridge: !!window.vbLocalSyncBridge,
    hasOpen: typeof window.vbLocalSyncOpen === 'function',
    sidebar: !!document.querySelector('.vb-ls-sidebar-item'),
    sidebarText: (document.querySelector('.vb-ls-sidebar-item') || {}).textContent || null,
    cloudCandidates: Array.from(document.querySelectorAll('li,a,div,span')).map(el => (el.textContent||'').trim()).filter(t => t === '云同步' || t === 'Cloud Sync' || t.includes('云同步')).slice(0,10)
  }))()`
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false })
  console.log('state', JSON.stringify(r.result.result.value, null, 2))

  // try invoke settings via bridge
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => {
      if (!window.vbLocalSyncBridge) return { err: 'no bridge' }
      const s = await window.vbLocalSyncBridge.invoke('vb-local-sync:get-settings')
      const local = await window.vbLocalSyncBridge.invoke('vb-local-sync:list-local')
      const synced = await window.vbLocalSyncBridge.invoke('vb-local-sync:list-synced')
      return { s, localCount: (local&&local.data||local||[]).length, synced }
    })()`,
    returnByValue: true,
    awaitPromise: true
  })
  console.log('ipc', JSON.stringify(r2.result.result.value, null, 2))

  // open local sync page and check DOM
  await send('Runtime.evaluate', { expression: 'window.vbLocalSyncOpen && window.vbLocalSyncOpen()', returnByValue: true })
  await new Promise(r => setTimeout(r, 1500))
  const r3 = await send('Runtime.evaluate', {
    expression: `({
      open: document.querySelector('.vb-ls-root')?.classList.contains('open'),
      path: document.querySelector('#vb-ls-path')?.value,
      status: document.querySelector('#vb-ls-status')?.textContent,
      localRows: document.querySelectorAll('#vb-ls-local tbody tr').length,
      syncedRows: document.querySelectorAll('#vb-ls-synced tbody tr').length
    })`,
    returnByValue: true
  })
  console.log('page', JSON.stringify(r3.result.result.value, null, 2))

  // screenshot
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync('C:/workspace/VirtualBrowser/tools/local-sync-test.png', Buffer.from(shot.data, 'base64'))
  console.log('screenshot written')
  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
