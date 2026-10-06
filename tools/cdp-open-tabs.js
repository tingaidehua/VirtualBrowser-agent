const http = require('http')
const WebSocket = require('./node_modules/ws')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function openUrls(port, urls) {
  // Prefer Target.createTarget via browser websocket
  const ver = await getJson(`http://127.0.0.1:${port}/json/version`)
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      const x = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? x.reject(new Error(JSON.stringify(msg.error))) : x.resolve(msg.result)
    }
  })
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })

  // Close about:blank / virtual-worker first pages optionally later
  for (const url of urls) {
    try {
      const r = await send('Target.createTarget', { url })
      console.log('opened', url, r)
    } catch (e) {
      console.log('fail', url, e.message)
    }
    await new Promise(r => setTimeout(r, 300))
  }
  ws.close()
}

const urls = [
  'https://mail.163.com/register/index.htm?from=163navi&regPage=163#/pn',
  'https://www.163.com/'
]
openUrls(9333, urls).catch(e => { console.error(e); process.exit(1) })
