const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

const SCRIPT = path.join(__dirname, 'ctl.ps1')
const LOG_DIR = path.join(process.env.APPDATA || '', 'virtual-browser', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'worker-ctl.log')

function ctlLog(...args) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
    )
  } catch {}
}

function parseJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return { raw }
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return { raw }
  }
}

function runCtl(action, id, timeout = 15000) {
  const envId = String(id || '').replace(/[^\w.-]/g, '')
  ctlLog('run', { action, id: envId, script: SCRIPT, exists: fs.existsSync(SCRIPT) })
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', action, '-Id', envId],
      { windowsHide: true, timeout },
      (err, stdout, stderr) => {
        const parsed = parseJson(stdout)
        const rec = {
          action,
          id: envId,
          exit: err && err.code != null ? err.code : 0,
          parsed,
          stdout: String(stdout || '').slice(0, 8000),
          stderr: String(stderr || '').slice(0, 4000),
          error: err ? String(err.message || err) : null
        }
        ctlLog('result', rec)
        if (parsed && parsed.ok) return resolve(parsed)
        const msg = (parsed && parsed.error) || rec.stderr || rec.error || rec.stdout || (action + ' failed')
        const e = new Error(msg)
        e.detail = rec
        reject(e)
      }
    )
  })
}

async function listIds() {
  try {
    const snap = await runCtl('list', '0')
    const ids = [...new Set((snap.ids || []).map(String))]
    ctlLog('list-ids', ids)
    return ids
  } catch (e) {
    ctlLog('list-ids-error', String(e && e.stack || e))
    return []
  }
}

module.exports = { runCtl, listIds, ctlLog }
