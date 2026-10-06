const http = require('http')
const fs = require('fs')
const path = require('path')
const net = require('net')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')
const core = require('./sync-core')

function log(...args) {
  try {
    const dir = path.join(process.env.APPDATA || '', 'virtual-browser', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'local-sync.log'),
      `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
    )
  } catch {}
  console.log('[local-sync]', ...args)
}

function findWorkerExe() {
  const root = 'C:\\Program Files\\VirtualBrowser\\VirtualBrowser'
  if (!fs.existsSync(root)) throw new Error('VirtualBrowser core not found')
  const versions = fs.readdirSync(root).filter(n => /^\d+\./.test(n)).sort().reverse()
  for (const v of versions) {
    const exe = path.join(root, v, 'VirtualBrowser.exe')
    if (fs.existsSync(exe)) return exe
  }
  throw new Error('VirtualBrowser.exe not found')
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

function httpJson(method, url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        timeout: timeoutMs
      },
      res => {
        let d = ''
        res.on('data', c => (d += c))
        res.on('end', () => {
          if (!d) return resolve(null)
          try {
            resolve(JSON.parse(d))
          } catch {
            resolve(d)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

async function waitForCdp(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      return await httpJson('GET', `http://127.0.0.1:${port}/json/version`)
    } catch {
      await new Promise(r => setTimeout(r, 250))
    }
  }
  throw new Error('CDP not ready on ' + port)
}

function killWorker(localId) {
  const script = path.join(__dirname, 'kill-worker.ps1')
  fs.writeFileSync(
    script,
    `Get-CimInstance Win32_Process -Filter "Name = 'VirtualBrowser.exe'" | Where-Object { $_.CommandLine -match '--worker-id=${localId}(\\D|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\n`
  )
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } catch {}
}

function workerUserDataDir(id) {
  let workers = path.join(process.env.LOCALAPPDATA || '', 'VirtualBrowser', 'Workers')
  try {
    const g = JSON.parse(
      fs.readFileSync(path.join(process.env.LOCALAPPDATA, 'VirtualBrowser', 'User Data', 'global.dat'), 'utf8')
    )
    if (g.cacheDirectory) workers = g.cacheDirectory
  } catch {}
  return path.join(workers, String(id))
}

function filterTabs(tabs) {
  return (tabs || []).filter(
    u =>
      u &&
      !/^chrome:\/\//i.test(u) &&
      !/virtual-worker/i.test(u) &&
      !/^https?:\/\/(www\.)?google\.com\/?$/i.test(u)
  )
}

async function openTabsOverCdp(port, tabs) {
  await waitForCdp(port)
  const opened = []
  for (const url of tabs || []) {
    try {
      const r = await httpJson('PUT', `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`)
      opened.push({ url, ok: true, id: r && r.id })
    } catch (e) {
      try {
        const r = await httpJson('GET', `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`)
        opened.push({ url, ok: true, id: r && r.id })
      } catch (e2) {
        opened.push({ url, ok: false, error: String(e2.message || e2) })
      }
    }
    await new Promise(r => setTimeout(r, 250))
  }
  try {
    const list = (await httpJson('GET', `http://127.0.0.1:${port}/json/list`)) || []
    for (const p of list) {
      if (p.type === 'page' && /chrome:\/\/virtual-worker\/?/.test(p.url || '')) {
        try {
          await httpJson('GET', `http://127.0.0.1:${port}/json/close/${p.id}`)
        } catch {}
      }
    }
  } catch {}
  return opened
}

/** Minimal WebSocket client for CDP (no external deps). */
function cdpWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl)
    const key = crypto.randomBytes(16).toString('base64')
    const extraHeaders = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key
    }
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: extraHeaders
      },
      () => {}
    )
    req.on('upgrade', (res, socket) => {
      const pending = new Map()
      let nextId = 1
      let buf = Buffer.alloc(0)
      const eventCbs = []

      function sendFrame(payload) {
        const data = Buffer.from(payload)
        const len = data.length
        let header
        if (len < 126) {
          header = Buffer.alloc(2)
          header[0] = 0x81
          header[1] = 0x80 | len
        } else if (len < 65536) {
          header = Buffer.alloc(4)
          header[0] = 0x81
          header[1] = 0x80 | 126
          header.writeUInt16BE(len, 2)
        } else {
          header = Buffer.alloc(10)
          header[0] = 0x81
          header[1] = 0x80 | 127
          header.writeUInt32BE(0, 2)
          header.writeUInt32BE(len, 6)
        }
        const mask = crypto.randomBytes(4)
        const masked = Buffer.alloc(len)
        for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4]
        socket.write(Buffer.concat([header, mask, masked]))
      }

      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 2) {
          const finOpcode = buf[0]
          const opcode = finOpcode & 0x0f
          const maskBit = buf[1] & 0x80
          let len = buf[1] & 0x7f
          let offset = 2
          if (len === 126) {
            if (buf.length < 4) return
            len = buf.readUInt16BE(2)
            offset = 4
          } else if (len === 127) {
            if (buf.length < 10) return
            const hi = buf.readUInt32BE(2)
            const lo = buf.readUInt32BE(6)
            len = hi * 0x100000000 + lo
            offset = 10
          }
          const maskLen = maskBit ? 4 : 0
          if (buf.length < offset + maskLen + len) return
          let payload = buf.slice(offset + maskLen, offset + maskLen + len)
          if (maskBit) {
            const mask = buf.slice(offset, offset + 4)
            const out = Buffer.alloc(len)
            for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4]
            payload = out
          }
          buf = buf.slice(offset + maskLen + len)
          if (opcode === 0x8) {
            socket.end()
            return
          }
          if (opcode === 0x1 || opcode === 0x2) {
            let msg
            try {
              msg = JSON.parse(payload.toString('utf8'))
            } catch {
              continue
            }
            if (msg.id && pending.has(msg.id)) {
              const { res, rej } = pending.get(msg.id)
              pending.delete(msg.id)
              if (msg.error) rej(new Error(msg.error.message || 'cdp error'))
              else res(msg.result)
            } else if (msg.method) {
              for (const cb of eventCbs) cb(msg)
            }
          }
        }
      })
      socket.on('error', () => {})
      socket.on('close', () => {})

      resolve({
        send(method, params) {
          const id = nextId++
          return new Promise((res, rej) => {
            pending.set(id, { res, rej })
            sendFrame(JSON.stringify({ id, method, params: params || {} }))
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id)
                rej(new Error('cdp timeout ' + method))
              }
            }, 8000)
          })
        },
        onEvent(cb) {
          eventCbs.push(cb)
        },
        close() {
          try {
            socket.end()
          } catch {}
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function buildChromeRestoreBarScript(tabs) {
  const urls = JSON.stringify(tabs.slice(0, 12))
  return `(() => {
  if (window.__vbChromeRestoreBar) return 'exists';
  window.__vbChromeRestoreBar = true;
  const urls = ${urls};
  const bar = document.createElement('div');
  bar.id = 'vb-chrome-restore-bar';
  bar.setAttribute('role', 'alert');
  Object.assign(bar.style, {
    position: 'fixed', left: '0', right: '0', top: '0', zIndex: '2147483647',
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 16px',
    background: '#fff', color: '#202124',
    borderBottom: '1px solid #dadce0',
    boxShadow: '0 1px 3px rgba(60,64,67,.3)',
    fontFamily: '"Segoe UI","Microsoft YaHei",system-ui,sans-serif',
    fontSize: '13px', lineHeight: '1.4'
  });
  const icon = document.createElement('div');
  icon.textContent = '!';
  Object.assign(icon.style, {
    width: '20px', height: '20px', borderRadius: '50%', background: '#1a73e8', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flex: '0 0 auto'
  });
  const text = document.createElement('div');
  text.style.flex = '1';
  text.innerHTML = '<div style="font-weight:600">要恢复这些网页吗？</div>' +
    '<div style="color:#5f6368;margin-top:2px">Chrome 未正确关机。上次打开了 ' + urls.length + ' 个网页。</div>';
  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '8px', flex: '0 0 auto' });
  function mkBtn(label, primary) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      height: '32px', padding: '0 14px', borderRadius: '4px', cursor: 'pointer',
      border: primary ? '1px solid #1a73e8' : '1px solid #dadce0',
      background: primary ? '#1a73e8' : '#fff',
      color: primary ? '#fff' : '#3c4043', fontSize: '13px'
    });
    return b;
  }
  const dismiss = mkBtn('关闭', false);
  const restore = mkBtn('恢复', true);
  dismiss.onclick = () => {
    window.__vbLsRestoreAction = 'dismiss';
    try { bar.remove(); } catch {}
  };
  restore.onclick = () => {
    window.__vbLsRestoreAction = 'restore';
    try { bar.remove(); } catch {}
  };
  actions.appendChild(dismiss);
  actions.appendChild(restore);
  bar.appendChild(icon);
  bar.appendChild(text);
  bar.appendChild(actions);
  (document.documentElement || document.body).appendChild(bar);
  return 'shown';
})()`
}

async function injectChromeRestorePrompt(port, tabs) {
  await waitForCdp(port)
  const list = (await httpJson('GET', `http://127.0.0.1:${port}/json/list`)) || []
  const page =
    list.find(p => p.type === 'page' && /virtual-worker/i.test(p.url || '')) ||
    list.find(p => p.type === 'page' && p.webSocketDebuggerUrl)
  if (!page || !page.webSocketDebuggerUrl) throw new Error('no page for restore inject')

  const client = await cdpWs(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  const expr = buildChromeRestoreBarScript(tabs)
  const injected = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: false,
    userGesture: true,
    returnByValue: true
  })
  log('chromeRestorePrompt injected', injected && injected.result)

  const t0 = Date.now()
  const timeoutMs = 10 * 60 * 1000
  try {
    while (Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, 500))
      try {
        const poll = await client.send('Runtime.evaluate', {
          expression:
            'window.__vbLsRestoreAction || (document.getElementById("vb-chrome-restore-bar") ? "waiting" : "gone")',
          returnByValue: true
        })
        const action = poll && poll.result && poll.result.value
        if (action === 'restore' || action === 'dismiss') {
          client.close()
          return { action }
        }
      } catch (e) {
        // page navigated; try re-list
        break
      }
    }
  } finally {
    try {
      client.close()
    } catch {}
  }
  return { action: 'timeout' }
}

async function spawnWorkerWithCdp(localId) {
  const id = String(localId)
  core.prepareSessionRestore([id])
  killWorker(id)
  await new Promise(r => setTimeout(r, 800))

  const exe = findWorkerExe()
  const userDataDir = workerUserDataDir(id)
  const port = await getFreePort()
  const child = spawn(
    exe,
    [`--worker-id=${id}`, `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`],
    { detached: true, stdio: 'ignore', windowsHide: false }
  )
  child.unref()
  await waitForCdp(port)
  return { id, port, pid: child.pid }
}

/**
 * Launch worker and show Chrome-style restore bar INSIDE the browser window.
 * User clicks 恢复 → open previous tabs. No Electron/main-app dialog.
 */
async function launchWithChromeRestorePrompt(localId, tabs) {
  const id = String(localId)
  const st = core.loadSessionState()
  let urlList = filterTabs(tabs && tabs.length ? tabs : (st.tabs && st.tabs[id]) || [])
  if (!urlList.length) urlList = filterTabs(core.captureTabsFromDisk(id))

  const { port, pid } = await spawnWorkerWithCdp(id)
  core.saveSessionState({
    runningIds: [...new Set([...(st.runningIds || []).map(String), id])],
    tabs: Object.assign({}, st.tabs || {}, { [id]: urlList }),
    ports: Object.assign({}, st.ports || {}, { [id]: port })
  })

  if (!urlList.length) {
    log('chromeRestorePrompt no tabs', { id, port, pid })
    return { id, port, pid, tabs: [], action: 'none' }
  }

  log('chromeRestorePrompt show bar', { id, port, tabs: urlList.length })
  // Give virtual-worker page a moment to paint
  await new Promise(r => setTimeout(r, 1200))
  let result = { action: 'timeout' }
  try {
    result = await injectChromeRestorePrompt(port, urlList)
  } catch (e) {
    log('chromeRestorePrompt inject failed', String(e && e.stack || e))
    // fallback: auto-open tabs so user still gets pages
    const opened = await openTabsOverCdp(port, urlList)
    return { id, port, pid, tabs: urlList, action: 'fallback-open', opened }
  }

  log('chromeRestorePrompt action', { id, action: result.action })
  if (result.action === 'restore') {
    const opened = await openTabsOverCdp(port, urlList)
    return { id, port, pid, tabs: urlList, action: 'restore', opened }
  }
  if (result.action === 'dismiss') {
    core.saveSessionState({ runningIds: [id], tabs: Object.assign({}, st.tabs || {}, { [id]: urlList }) })
    return { id, port, pid, tabs: urlList, action: 'dismiss' }
  }
  return { id, port, pid, tabs: urlList, action: result.action || 'timeout' }
}

async function restoreLaunchEnvironment(localId, tabs) {
  // Back-compat: still supports direct restore without prompt
  const id = String(localId)
  const st = core.loadSessionState()
  let urlList = filterTabs(tabs && tabs.length ? tabs : (st.tabs && st.tabs[id]) || [])
  if (!urlList.length) urlList = filterTabs(core.captureTabsFromDisk(id))
  const { port, pid } = await spawnWorkerWithCdp(id)
  const opened = await openTabsOverCdp(port, urlList)
  const next = core.saveSessionState({
    runningIds: [...new Set([...(st.runningIds || []).map(String), id])],
    tabs: Object.assign({}, st.tabs || {}, { [id]: urlList }),
    ports: Object.assign({}, st.ports || {}, { [id]: port })
  })
  log('restoreLaunch', { id, port, pid, tabs: urlList, opened })
  return { id, port, pid, tabs: urlList, opened, session: next }
}

async function restoreAllFromSession() {
  const st = core.loadSessionState()
  const ids = st.runningIds || []
  const out = []
  for (const id of ids) {
    out.push(await launchWithChromeRestorePrompt(id, (st.tabs && st.tabs[id]) || []))
    await new Promise(r => setTimeout(r, 500))
  }
  return out
}

module.exports = {
  restoreLaunchEnvironment,
  restoreAllFromSession,
  launchWithChromeRestorePrompt,
  findWorkerExe,
  openTabsOverCdp,
  killWorker
}
