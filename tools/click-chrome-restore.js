const http = require('http')
const crypto = require('crypto')
const port = process.argv[2] || '61335'

function httpJson(method, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: 3000 },
      res => {
        let d = ''
        res.on('data', c => (d += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(d || 'null'))
          } catch {
            resolve(d)
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function cdpWs(wsUrl) {
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
      function sendFrame(payload) {
        const data = Buffer.from(payload)
        const len = data.length
        const header = Buffer.alloc(2)
        header[0] = 0x81
        header[1] = 0x80 | len
        const mask = crypto.randomBytes(4)
        const masked = Buffer.alloc(len)
        for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4]
        socket.write(Buffer.concat([header, mask, masked]))
      }
      let buf = Buffer.alloc(0)
      const pending = new Map()
      let nextId = 1
      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 2) {
          let len = buf[1] & 0x7f
          let offset = 2
          if (len === 126) {
            if (buf.length < 4) return
            len = buf.readUInt16BE(2)
            offset = 4
          }
          const maskBit = buf[1] & 0x80
          const maskLen = maskBit ? 4 : 0
          if (buf.length < offset + maskLen + len) return
          let payload = buf.slice(offset + maskLen, offset + maskLen + len)
          if (maskBit) {
            const m = buf.slice(offset, offset + 4)
            const out = Buffer.alloc(len)
            for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i % 4]
            payload = out
          }
          buf = buf.slice(offset + maskLen + len)
          try {
            const msg = JSON.parse(payload.toString())
            if (msg.id && pending.has(msg.id)) {
              const { res, rej } = pending.get(msg.id)
              pending.delete(msg.id)
              msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
            }
          } catch {}
        }
      })
      resolve({
        send(method, params) {
          const id = nextId++
          return new Promise((res, rej) => {
            pending.set(id, { res, rej })
            sendFrame(JSON.stringify({ id, method, params: params || {} }))
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id)
                rej(new Error('timeout'))
              }
            }, 5000)
          })
        },
        close() {
          socket.end()
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

;(async () => {
  const list = await httpJson('GET', `http://127.0.0.1:${port}/json/list`)
  const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl)
  console.log('page', page && page.url)
  const c = await cdpWs(page.webSocketDebuggerUrl)
  const expr = `(() => {
    const bar = document.getElementById('vb-chrome-restore-bar');
    const btns = bar ? [...bar.querySelectorAll('button')].map(b => b.textContent) : [];
    const restore = [...document.querySelectorAll('button')].find(b => b.textContent === '恢复');
    if (restore) { restore.click(); return { ok: true, btns }; }
    return { ok: false, btns, hasBar: !!bar };
  })()`
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log('click', JSON.stringify(r, null, 2))
  c.close()
})().catch(e => {
  console.error(e)
  process.exit(1)
})
