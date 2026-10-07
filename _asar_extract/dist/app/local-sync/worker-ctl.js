const path = require('path')
const fs = require('fs')
const { execFileSync, spawn } = require('child_process')

const EXE = path.join(__dirname, 'vb-win.exe')
const SRC = path.join(__dirname, 'VbWin.cs')
const LOG_DIR = path.join(process.env.APPDATA || '', 'virtual-browser', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'worker-ctl.log')
const hwndCache = new Map()
let cachedIds = []
let cachedAt = 0
let proc = null
let buf = ''
let waiters = []

let lastErrLog = 0
function ctlLog(...args) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    try {
      const st = fs.statSync(LOG_FILE)
      if (st.size > 2 * 1024 * 1024) {
        const keep = fs.readFileSync(LOG_FILE, 'utf8').slice(-400000)
        fs.writeFileSync(LOG_FILE, keep)
      }
    } catch {}
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    if (/list-ids-error/.test(line)) {
      const now = Date.now()
      if (now - lastErrLog < 15000) return
      lastErrLog = now
    }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line.slice(0, 2500)}\n`)
  } catch {}
}

function findCsc() {
  const roots = [
    process.env.WINDIR + '\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    process.env.WINDIR + '\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ]
  return roots.find(p => p && fs.existsSync(p))
}

function ensureExe() {
  try {
    if (fs.existsSync(EXE) && fs.existsSync(SRC) && fs.statSync(EXE).mtimeMs >= fs.statSync(SRC).mtimeMs) return true
    const csc = findCsc()
    if (!csc) return fs.existsSync(EXE)
    execFileSync(csc, ['/nologo', '/optimize+', '/out:' + EXE, SRC], { timeout: 20000, windowsHide: true })
    ctlLog('ensureExe compiled')
    return fs.existsSync(EXE)
  } catch (e) {
    ctlLog('ensureExe fail', String(e && e.message || e))
    return fs.existsSync(EXE)
  }
}

function parseJson(text) {
  const raw = String(text || '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null }
}

function ensureServe() {
  if (proc && proc.exitCode == null) return
  if (!ensureExe()) throw new Error('vb-win.exe missing')
  buf = ''
  proc = spawn(EXE, ['serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', chunk => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      const w = waiters.shift()
      if (w) w(null, line)
    }
  })
  proc.on('exit', (code) => {
    ctlLog('vb-win exit', code)
    proc = null
    const pending = waiters.splice(0)
    pending.forEach(w => w(new Error('vb-win exit')))
  })
}

function runExe(args, timeout) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process')
    execFile(EXE, args, { windowsHide: true, timeout: timeout || 3000 }, (err, stdout, stderr) => {
      const parsed = parseJson(stdout)
      if (parsed && parsed.ok) return resolve(parsed)
      const e = new Error((parsed && parsed.error) || String(stderr || '') || (err && err.message) || 'failed')
      e.detail = { parsed, err: err && err.message }
      reject(e)
    })
  })
}

function runCtl(action, id, timeout = 4000) {
  const envId = String(id || '').replace(/[^\w.-]/g, '')
  const t0 = Date.now()
  // focus must be a NEW process so Windows grants SetForegroundWindow (same as a click)
  if (action === 'focus') {
    const args = ['focus', envId]
    if (hwndCache.has(envId)) args.push(String(hwndCache.get(envId)))
    return runExe(args, timeout).then(parsed => {
        if (parsed.hwnd) hwndCache.set(envId, parsed.hwnd)
        ctlLog('focus', { id: envId, ms: Date.now() - t0, hwnd: parsed.hwnd, vis: parsed.vis, iconic: parsed.iconic, cloaked: parsed.cloaked, rect: parsed.rect, fg: parsed.fgAfter })
        if (parsed.vis === false && parsed.iconic !== true) {
          const e = new Error('窗口仍不可见')
          e.detail = parsed
          throw e
        }
        return parsed
    }).catch(e => {
      hwndCache.delete(envId)
      ctlLog('focus-fail', { id: envId, ms: Date.now() - t0, error: e.message })
      throw e
    })
  }
  ensureServe()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.indexOf(onDone)
      if (i >= 0) waiters.splice(i, 1)
      reject(new Error(action + ' timeout'))
    }, timeout)
    function onDone(err, line) {
      clearTimeout(timer)
      if (err) return reject(err)
      const ms = Date.now() - t0
      const parsed = parseJson(line)
      if (action !== 'list') ctlLog(action, { id: envId, ms, ok: !!(parsed && parsed.ok), hwnd: parsed && parsed.hwnd, error: parsed && parsed.error })
      if (parsed && parsed.ok) {
        if (parsed.hwnd) hwndCache.set(envId, parsed.hwnd)
        if (action === 'stop' || action === 'close') hwndCache.delete(envId)
        return resolve(parsed)
      }
      const e = new Error((parsed && parsed.error) || (action + ' failed'))
      e.detail = { parsed, ms, line }
      reject(e)
    }
    waiters.push(onDone)
    proc.stdin.write(action + ' ' + envId + '\n')
  })
}

async function listIds() {
  const now = Date.now()
  if (now - cachedAt < 1200 && cachedIds) return cachedIds
  try {
    const snap = await runCtl('list', '0', 2500)
    cachedIds = [...new Set((snap.ids || []).map(String))]
    cachedAt = Date.now()
    return cachedIds
  } catch (e) {
    ctlLog('list-ids-error', String(e && e.message || e))
    return cachedIds || []
  }
}

function invalidateCache() {
  cachedAt = 0
}

module.exports = { runCtl, listIds, ctlLog, ensureExe, invalidateCache }
