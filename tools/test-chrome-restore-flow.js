const core = require('../local-sync-ext/sync-core')
const rl = require('../local-sync-ext/restore-launch')
const http = require('http')
const crypto = require('crypto')

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let d = ''
        res.on('data', c => (d += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(d || 'null'))
          } catch {
            resolve(d)
          }
        })
      })
      .on('error', reject)
  })
}

function setRestoreAction(wsUrl, action) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl)
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key
        }
      },
      () => {}
    )
    req.on('upgrade', (res, socket) => {
      const expr = 'window.__vbLsRestoreAction = ' + JSON.stringify(action)
      const payload = JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true }
      })
      const data = Buffer.from(payload)
      const header = Buffer.alloc(2)
      header[0] = 0x81
      header[1] = 0x80 | data.length
      const mask = crypto.randomBytes(4)
      const masked = Buffer.alloc(data.length)
      for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4]
      socket.write(Buffer.concat([header, mask, masked]))
      setTimeout(() => {
        socket.end()
        resolve(true)
      }, 600)
    })
    req.on('error', reject)
    req.end()
  })
}

;(async () => {
  const pending = rl.launchWithChromeRestorePrompt('1')

  setTimeout(async () => {
    try {
      const st = core.loadSessionState()
      const port = st.ports && st.ports['1']
      if (!port) {
        console.log('no port yet')
        return
      }
      const list = await httpJson('http://127.0.0.1:' + port + '/json/list')
      const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl)
      if (!page) {
        console.log('no page')
        return
      }
      await setRestoreAction(page.webSocketDebuggerUrl, 'restore')
      console.log('auto-set restore on port', port)
    } catch (e) {
      console.error('auto click fail', e)
    }
  }, 4000)

  const r = await pending
  console.log('RESULT', JSON.stringify(r, null, 2))
  process.exit(r && r.action === 'restore' ? 0 : 2)
})().catch(e => {
  console.error(e)
  process.exit(1)
})
