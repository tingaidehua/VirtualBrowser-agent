const fs = require('fs')
const path = require('path')

const corePath = 'C:/workspace/VirtualBrowser/local-sync-ext/sync-core.js'
let core = fs.readFileSync(corePath, 'utf8')

if (!core.includes('backupWorkerSessions')) {
  const helpers = `
function sessionBackupRoot() {
  return path.join(userDataRoot(), 'session-backups')
}

function extractUrlsFromBuffer(buf) {
  const s = buf.toString('binary')
  const raw = [...s.matchAll(/https?:\\\\/\\\\/[^\\\\0-\\\\x1f\\\\s"'<>\\\\\\\\]{5,500}/g)].map(m => m[0])
  const out = []
  const seen = new Set()
  for (const u of raw) {
    let url = u
    // trim trailing junk often found in SNSS blobs
    url = url.replace(/[\\\\x00-\\\\x1f]+.*$/, '')
    url = url.replace(/[\\\\]\\}\\\\].*$/, '')
    if (!/^https?:\\\\/\\\\//i.test(url)) continue
    if (/^(chrome|chrome-extension|about|data):/i.test(url)) continue
    if (url.includes('google.com/complete') || url.includes('suggesteventid')) continue
    // normalize strip obvious binary tails
    const m = url.match(/^https?:\\\\/\\\\/[^\\\\s\\\\"'<>\\\\x00-\\\\x1f]+/)
    if (!m) continue
    url = m[0].replace(/[\\\\)\\],;]+$/, '')
    if (url.length < 12 || url.length > 500) continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

function captureTabsFromDisk(localId) {
  const global = loadGlobal()
  const workers = workersRoot(global)
  const sessDir = path.join(workers, String(localId), 'Default', 'Sessions')
  if (!fs.existsSync(sessDir)) return []
  const files = fs.readdirSync(sessDir)
    .filter(f => /^(Tabs_|Session_)/.test(f))
    .map(f => {
      const p = path.join(sessDir, f)
      try {
        const st = fs.statSync(p)
        return { f, p, mtime: st.mtimeMs, size: st.size }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)

  let urls = []
  for (const file of files.slice(0, 3)) {
    try {
      const buf = fs.readFileSync(file.p)
      const got = extractUrlsFromBuffer(buf)
      if (got.length) {
        urls = got
        break
      }
    } catch (e) {
      // locked while running — skip
    }
  }
  // keep last up to 12 unique, prefer later entries
  return urls.slice(-12)
}

async function backupWorkerSessions(localId) {
  const global = loadGlobal()
  const workers = workersRoot(global)
  const src = path.join(workers, String(localId), 'Default', 'Sessions')
  const dst = path.join(sessionBackupRoot(), String(localId), 'Sessions')
  const tabs = captureTabsFromDisk(localId)
  const meta = {
    id: String(localId),
    tabs,
    savedAt: Date.now()
  }
  writeJson(path.join(sessionBackupRoot(), String(localId), 'tabs.json'), meta)

  if (!fs.existsSync(src)) return meta
  ensureDir(dst)
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f)
    const d = path.join(dst, f)
    try {
      fs.copyFileSync(s, d)
    } catch (e) {
      if (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) continue
      // ignore other copy races
    }
  }
  return meta
}

async function backupAllRunningSessions(ids) {
  const list = ids || (loadSessionState().runningIds || [])
  const out = []
  for (const id of list) out.push(await backupWorkerSessions(id))
  // also persist tabs map into session-restore.json
  const st = loadSessionState()
  st.tabs = st.tabs || {}
  for (const m of out) {
    if (m.tabs && m.tabs.length) st.tabs[m.id] = m.tabs
  }
  saveSessionState(st)
  return out
}

function restoreWorkerSessionFiles(localId) {
  const global = loadGlobal()
  const workers = workersRoot(global)
  const dst = path.join(workers, String(localId), 'Default', 'Sessions')
  const src = path.join(sessionBackupRoot(), String(localId), 'Sessions')
  const tabsMeta = readJson(path.join(sessionBackupRoot(), String(localId), 'tabs.json'), null)
  const st = loadSessionState()
  const tabs = (st.tabs && st.tabs[String(localId)]) || (tabsMeta && tabsMeta.tabs) || []

  if (fs.existsSync(src)) {
    ensureDir(dst)
    for (const f of fs.readdirSync(src)) {
      try {
        fs.copyFileSync(path.join(src, f), path.join(dst, f))
      } catch {}
    }
  }

  // Patch preferences AFTER browsers are dead (startup path)
  const prefPath = path.join(workers, String(localId), 'Default', 'Preferences')
  let pref = {}
  try {
    if (fs.existsSync(prefPath)) pref = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
  } catch {}
  pref.profile = pref.profile || {}
  pref.profile.exit_type = 'Crashed'
  pref.profile.exited_cleanly = false
  pref.session = pref.session || {}
  if (tabs.length) {
    // 4 = open specific URLs (most reliable with VirtualBrowser launcher)
    pref.session.restore_on_startup = 4
    pref.session.startup_urls = tabs
  } else {
    pref.session.restore_on_startup = 1
  }
  writeJson(prefPath, pref)
  return { id: String(localId), tabs, ok: true, mode: tabs.length ? 'startup_urls' : 'last_session' }
}

function prepareSessionRestore(ids) {
  const list = (ids && ids.length ? ids : loadSessionState().runningIds) || []
  return list.map(id => restoreWorkerSessionFiles(id))
}
`

  // Replace old prepare functions with new ones
  core = core.replace(/function prepareWorkerSessionRestore\\([\\s\\S]*?function prepareSessionRestore\\([\\s\\S]*?\\n\\}/, '')
  // If old functions still there, remove individually
  core = core.replace(/function prepareWorkerSessionRestore\\([\\s\\S]*?\\n\\}\\n\\nfunction prepareSessionRestore\\([\\s\\S]*?\\n\\}/, '')

  if (core.includes('function prepareSessionRestore')) {
    // remove from prepareWorker through prepareSessionRestore
    core = core.replace(/function prepareWorkerSessionRestore\\([\\s\\S]*?(?=\\nmodule\\.exports)/, '')
  }

  core = core.replace('module.exports = {', helpers + '\\nmodule.exports = {')
  // exports
  if (!core.includes('backupWorkerSessions')) {
    core = core.replace(
      'prepareSessionRestore\\n}',
      'prepareSessionRestore,\\n  backupWorkerSessions,\\n  backupAllRunningSessions,\\n  captureTabsFromDisk,\\n  restoreWorkerSessionFiles\\n}'
    )
  }
  // Fix: ensure exports list updated even if pattern different
  if (!core.includes('backupAllRunningSessions')) {
    core = core.replace(
      'prepareSessionRestore\\n}',
      'prepareSessionRestore,\\n  backupWorkerSessions,\\n  backupAllRunningSessions,\\n  captureTabsFromDisk,\\n  restoreWorkerSessionFiles\\n}'
    )
  }
  fs.writeFileSync(corePath, core)
  console.log('core helpers inserted', core.includes('backupWorkerSessions'), core.includes('function prepareSessionRestore'))
} else {
  console.log('core already has backupWorkerSessions')
}
