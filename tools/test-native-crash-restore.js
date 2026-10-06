const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const net = require('net')

async function main() {
  const id = process.argv[2] || '1'
  const workers = path.join(process.env.LOCALAPPDATA, 'VirtualBrowser', 'Workers', id)
  const prefPath = path.join(workers, 'Default', 'Preferences')
  const sessDir = path.join(workers, 'Default', 'Sessions')

  function freePort() {
    return new Promise((resolve, reject) => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port
        s.close(() => resolve(p))
      })
      s.on('error', reject)
    })
  }

  function httpJson(method, url) {
    return new Promise((resolve, reject) => {
      const u = new URL(url)
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: 3000 },
        res => {
          let d = ''
          res.on('data', c => (d += c))
          res.on('end', () => {
            try { resolve(JSON.parse(d || 'null')) } catch { resolve(d) }
          })
        }
      )
      req.on('error', reject)
      req.end()
    })
  }

  async function waitPort(port, ms = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try {
        const list = await httpJson('GET', `http://127.0.0.1:${port}/json/list`)
        if (Array.isArray(list)) return list
      } catch {}
      await new Promise(r => setTimeout(r, 400))
    }
    throw new Error('cdp timeout')
  }

  const pref = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
  pref.profile = pref.profile || {}
  pref.profile.exit_type = 'Crashed'
  pref.profile.exited_cleanly = false
  pref.session = pref.session || {}
  delete pref.session.startup_urls
  pref.session.restore_on_startup = 0
  fs.writeFileSync(prefPath, JSON.stringify(pref))
  console.log('prefs prepared', {
    exit_type: pref.profile.exit_type,
    restore_on_startup: pref.session.restore_on_startup,
    sessions: fs.existsSync(sessDir) ? fs.readdirSync(sessDir) : []
  })

  const exe = 'C:\\Program Files\\VirtualBrowser\\VirtualBrowser\\151.0.7922.47\\VirtualBrowser.exe'
  const port = await freePort()
  const child = spawn(
    exe,
    [`--worker-id=${id}`, `--user-data-dir=${workers}`, `--remote-debugging-port=${port}`],
    { detached: true, stdio: 'ignore', windowsHide: false }
  )
  child.unref()
  console.log('spawned', child.pid, 'port', port)

  const list = await waitPort(port)
  console.log('pages', JSON.stringify(list.map(p => ({ type: p.type, url: p.url, title: p.title })), null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
