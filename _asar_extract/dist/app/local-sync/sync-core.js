const fs = require('fs')
const path = require('path')

function expandHome(p) {
  if (!p) return p
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.USERPROFILE || process.env.HOME || '', p.slice(2) || '')
  }
  return p
}

function defaultSyncRoot() {
  const od = process.env.OneDrive || path.join(process.env.USERPROFILE || '', 'OneDrive')
  return path.join(od, 'VirtualBrowser')
}

function userDataRoot() {
  return path.join(process.env.LOCALAPPDATA || '', 'VirtualBrowser')
}

function profilesPath() {
  return path.join(userDataRoot(), 'User Data', 'virtual.dat')
}

function globalPath() {
  return path.join(userDataRoot(), 'User Data', 'global.dat')
}

function workersRoot(globalData) {
  if (globalData && globalData.cacheDirectory) return globalData.cacheDirectory
  return path.join(userDataRoot(), 'Workers')
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function loadSettings() {
  const cfgFile = path.join(userDataRoot(), 'local-sync-settings.json')
  const defaults = {
    syncPath: defaultSyncRoot(),
    enabled: true,
    autoLoad: true,
    autoUploadOnExit: true,
    autoSyncIntervalSec: 1800,
    restoreSession: false
  }
  const cfg = Object.assign({}, defaults, readJson(cfgFile, {}))
  cfg.syncPath = expandHome(cfg.syncPath)
  if (cfg.enabled == null) cfg.enabled = true
  if (cfg.autoLoad == null) cfg.autoLoad = true
  if (cfg.autoUploadOnExit == null) cfg.autoUploadOnExit = true
  // 30min default; never below 10min
  cfg.autoSyncIntervalSec = Math.max(600, Number(cfg.autoSyncIntervalSec) || 1800)
  cfg.restoreSession = false
  return { cfg, cfgFile }
}

function saveSettings(partial) {
  const { cfg, cfgFile } = loadSettings()
  const next = Object.assign({}, cfg, partial || {})
  if (next.syncPath) next.syncPath = expandHome(next.syncPath)
  writeJson(cfgFile, next)
  return next
}

function syncLayout(syncPath) {
  const root = expandHome(syncPath || loadSettings().cfg.syncPath)
  return {
    root,
    manifest: path.join(root, 'manifest.json'),
    envs: path.join(root, 'environments'),
    globalCopy: path.join(root, 'global.dat'),
    virtualCopy: path.join(root, 'virtual.dat')
  }
}

function loadManifest(syncPath) {
  const layout = syncLayout(syncPath)
  ensureDir(layout.envs)
  const man = readJson(layout.manifest, { version: 1, environments: [] })
  if (!Array.isArray(man.environments)) man.environments = []
  return { layout, man }
}

function saveManifest(layout, man) {
  writeJson(layout.manifest, man)
}

function loadProfiles() {
  return readJson(profilesPath(), { users: [] })
}

function saveProfiles(data) {
  ensureDir(path.dirname(profilesPath()))
  try {
    if (fs.existsSync(profilesPath())) fs.copyFileSync(profilesPath(), profilesPath() + '.bak')
  } catch {}
  writeJson(profilesPath(), data)
}

function loadGlobal() {
  return readJson(globalPath(), {})
}

/**
 * Only sync login-valuable paths. Opening tabs / history / cache must NOT dirty sync.
 * - Cookies + Login Data: session / password persistence
 * - Local Storage: SPA tokens (copied, but fingerprint ignores noisy subfiles via cookie-centric fp)
 */
const VALUABLE_REL_PATHS = [
  // Chromium cookies (modern)
  path.join('Default', 'Network', 'Cookies'),
  path.join('Default', 'Network', 'Cookies-journal'),
  // Legacy cookies path
  path.join('Default', 'Cookies'),
  path.join('Default', 'Cookies-journal'),
  // Saved passwords
  path.join('Default', 'Login Data'),
  path.join('Default', 'Login Data-journal'),
  path.join('Default', 'Login Data For Account'),
  path.join('Default', 'Login Data For Account-journal'),
  // Site auth tokens (directories)
  path.join('Default', 'Local Storage'),
  path.join('Default', 'IndexedDB')
]

/** Paths that define "login changed" — browsing History/Sessions must not flip this. */
const FINGERPRINT_REL_PATHS = [
  path.join('Default', 'Network', 'Cookies'),
  path.join('Default', 'Cookies'),
  path.join('Default', 'Login Data'),
  path.join('Default', 'Login Data For Account')
]

function collectFileStats(root, relPaths) {
  let total = 0
  let newest = 0
  const walkFile = p => {
    try {
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
          if (ent.name === 'LOCK' || ent.name === 'LOG' || ent.name === 'LOG.old') continue
          walkFile(path.join(p, ent.name))
        }
      } else {
        total += st.size
        if (st.mtimeMs > newest) newest = st.mtimeMs
      }
    } catch {}
  }
  for (const rel of relPaths) walkFile(path.join(root, rel))
  return { size: total, mtimeMs: newest }
}

function valuableStats(workerDir) {
  return collectFileStats(workerDir, VALUABLE_REL_PATHS)
}

function loginFingerprintStats(workerDir) {
  return collectFileStats(workerDir, FINGERPRINT_REL_PATHS)
}

function dirStats(dir) {
  // kept for callers; now = valuable only
  return valuableStats(dir)
}

function dirSize(dir) {
  return valuableStats(dir).size
}

function fingerprintEnv(user, workerDir, stOpt) {
  const st = stOpt || loginFingerprintStats(workerDir)
  const name = user && user.name != null ? user.name : ''
  const remark = user && user.remark != null ? user.remark : ''
  const group = JSON.stringify((user && user.group) || [])
  return `${st.size}:${Math.floor(st.mtimeMs)}:${name}:${remark}:${group}`
}

async function copyPathRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0
  let copied = 0
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    ensureDir(dest)
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      if (ent.name === 'LOCK' || ent.name === 'LOG' || ent.name === 'LOG.old') continue
      copied += await copyPathRecursive(path.join(src, ent.name), path.join(dest, ent.name))
    }
    return copied
  }
  ensureDir(path.dirname(dest))
  try {
    fs.copyFileSync(src, dest)
    return 1
  } catch (e) {
    if (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) return 0
    throw e
  }
}

/** Copy only login-valuable files (whitelist). Never History / Sessions / Cache. */
async function copyValuable(srcRoot, destRoot) {
  if (!fs.existsSync(srcRoot)) return { copied: 0 }
  ensureDir(destRoot)
  let copied = 0
  for (const rel of VALUABLE_REL_PATHS) {
    const s = path.join(srcRoot, rel)
    if (!fs.existsSync(s)) continue
    copied += await copyPathRecursive(s, path.join(destRoot, rel))
  }
  return { copied }
}

/** @deprecated use copyValuable — kept name for any external callers */
async function copyDir(src, dest) {
  return copyValuable(src, dest)
}

async function removeDir(dir) {
  if (!fs.existsSync(dir)) return
  await fs.promises.rm(dir, { recursive: true, force: true })
}

function syncIdFor(user) {
  return String(user.localSyncId || user.cloud_id || user.cloudId || ('local-' + user.id))
}

function ensureLocalSyncId(user) {
  if (!user.localSyncId) {
    user.localSyncId = 'local-' + user.id + '-' + Date.now().toString(36)
  }
  user.localSyncEnabled = true
  return user
}

async function listLocalEnvironments() {
  const profiles = loadProfiles()
  const global = loadGlobal()
  const workers = workersRoot(global)
  const { layout } = loadManifest()
  return (profiles.users || []).map(u => {
    const workerDir = path.join(workers, String(u.id))
    const syncId = u.localSyncId ? String(u.localSyncId) : null
    const syncedMeta = syncId && fs.existsSync(path.join(layout.envs, syncId, 'meta.json'))
      ? readJson(path.join(layout.envs, syncId, 'fp.json'), null)
      : null
    const st = loginFingerprintStats(workerDir)
    const fp = fingerprintEnv(u, workerDir, st)
    return {
      id: u.id,
      name: u.name || String(u.id),
      remark: u.remark || '',
      group: u.group || [],
      cloud_id: u.cloud_id || u.cloudId || null,
      localSyncId: u.localSyncId || null,
      syncEnabled: true,
      synced: !!syncedMeta,
      dirty: !syncedMeta || syncedMeta.fp !== fp,
      size: valuableStats(workerDir).size,
      updatedAt: u.updatedAt || u.createdAt || null,
      workerExists: fs.existsSync(workerDir)
    }
  })
}

async function listSyncedEnvironments(syncPath) {
  const { layout, man } = loadManifest(syncPath)
  const diskIds = fs.existsSync(layout.envs)
    ? fs.readdirSync(layout.envs, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    : []
  const byId = new Map(man.environments.map(e => [String(e.syncId), e]))
  for (const id of diskIds) {
    if (!byId.has(id)) {
      const meta = readJson(path.join(layout.envs, id, 'meta.json'), null)
      byId.set(id, {
        syncId: id,
        localId: meta && meta.id,
        name: (meta && meta.name) || id,
        remark: (meta && meta.remark) || '',
        updatedAt: meta && (meta.updatedAt || null),
        size: dirSize(path.join(layout.envs, id, 'worker'))
      })
    } else {
      const e = byId.get(id)
      e.size = dirSize(path.join(layout.envs, id, 'worker'))
    }
  }
  const environments = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const prev = JSON.stringify(man.environments || [])
  const next = JSON.stringify(environments)
  if (prev !== next) {
    man.environments = environments
    saveManifest(layout, man)
  }
  return { syncPath: layout.root, environments }
}

async function uploadEnvironment(localId, syncPath) {
  const profiles = loadProfiles()
  const user = (profiles.users || []).find(u => String(u.id) === String(localId))
  if (!user) throw new Error('本地环境不存在: ' + localId)

  const hadSyncId = !!user.localSyncId
  ensureLocalSyncId(user)
  if (!hadSyncId) {
    user.updatedAt = Date.now()
    saveProfiles(profiles)
  }

  const global = loadGlobal()
  const workers = workersRoot(global)
  const workerSrc = path.join(workers, String(user.id))
  const { layout, man } = loadManifest(syncPath)
  const syncId = syncIdFor(user)
  const destEnv = path.join(layout.envs, syncId)
  const destWorker = path.join(destEnv, 'worker')
  const fp = fingerprintEnv(user, workerSrc)
  const prevFp = readJson(path.join(destEnv, 'fp.json'), null)
  if (prevFp && prevFp.fp === fp && fs.existsSync(destWorker)) {
    return {
      syncId,
      localId: user.id,
      name: user.name || String(user.id),
      remark: user.remark || '',
      updatedAt: prevFp.updatedAt || Date.now(),
      size: dirSize(destWorker),
      skipped: true
    }
  }

  // Replace sync copy with whitelist only (drops old History/Cache junk from prior full syncs)
  await removeDir(destWorker)
  ensureDir(destEnv)
  writeJson(path.join(destEnv, 'meta.json'), user)
  writeJson(path.join(destEnv, 'fp.json'), {
    fp,
    updatedAt: Date.now(),
    mode: 'login-valuable'
  })
  if (fs.existsSync(workerSrc)) await copyValuable(workerSrc, destWorker)
  else ensureDir(destWorker)

  try { fs.copyFileSync(profilesPath(), layout.virtualCopy) } catch {}
  try { fs.copyFileSync(globalPath(), layout.globalCopy) } catch {}

  const entry = {
    syncId,
    localId: user.id,
    name: user.name || String(user.id),
    remark: user.remark || '',
    updatedAt: Date.now(),
    size: dirSize(destWorker)
  }
  const idx = man.environments.findIndex(e => e.syncId === syncId)
  if (idx >= 0) man.environments[idx] = entry
  else man.environments.push(entry)
  saveManifest(layout, man)
  return entry
}

async function downloadEnvironment(syncId, syncPath, { bindLocalId } = {}) {
  const { layout } = loadManifest(syncPath)
  const envDir = path.join(layout.envs, String(syncId))
  const metaPath = path.join(envDir, 'meta.json')
  if (!fs.existsSync(metaPath)) throw new Error('同步环境不存在: ' + syncId)
  const meta = readJson(metaPath, null)
  if (!meta) throw new Error('meta.json 无效')

  const profiles = loadProfiles()
  const global = loadGlobal()
  const workers = workersRoot(global)
  ensureDir(workers)

  let user = null
  if (bindLocalId != null) user = (profiles.users || []).find(u => String(u.id) === String(bindLocalId))
  if (!user && meta.localSyncId) user = (profiles.users || []).find(u => u.localSyncId === meta.localSyncId)
  if (!user && meta.id != null) user = (profiles.users || []).find(u => String(u.id) === String(meta.id))

  if (!user) {
    const maxId = Math.max(0, ...(profiles.users || []).map(u => Number(u.id) || 0))
    user = Object.assign({}, meta, {
      id: maxId + 1,
      localSyncId: meta.localSyncId || String(syncId),
      localSyncEnabled: true,
      updatedAt: Date.now()
    })
    delete user.cloud_id
    delete user.cloudId
    profiles.users = profiles.users || []
    profiles.users.push(user)
  } else {
    const keepId = user.id
    Object.assign(user, meta, {
      id: keepId,
      localSyncId: meta.localSyncId || String(syncId),
      localSyncEnabled: true,
      updatedAt: Date.now()
    })
  }
  saveProfiles(profiles)

  const workerDest = path.join(workers, String(user.id))
  const workerSrc = path.join(envDir, 'worker')
  // Overlay valuable files only — never wipe local History/Cache/Sessions
  ensureDir(workerDest)
  if (fs.existsSync(workerSrc)) await copyValuable(workerSrc, workerDest)

  return { localId: user.id, syncId: String(syncId), name: user.name }
}

async function deleteSyncedEnvironment(syncId, syncPath) {
  const { layout, man } = loadManifest(syncPath)
  await removeDir(path.join(layout.envs, String(syncId)))
  man.environments = man.environments.filter(e => e.syncId !== String(syncId))
  saveManifest(layout, man)
  return { ok: true }
}

async function enableLocalSync(localIds) {
  const profiles = loadProfiles()
  const set = new Set((localIds || []).map(String))
  let count = 0
  for (const u of profiles.users || []) {
    if (!localIds || !localIds.length || set.has(String(u.id))) {
      ensureLocalSyncId(u)
      count++
    }
  }
  saveProfiles(profiles)
  return { count }
}

async function disableLocalSync() {
  // kept for API compatibility; auto mode ignores per-env disable
  return { count: 0 }
}

async function uploadAll(syncPath) {
  const profiles = loadProfiles()
  const results = []
  for (const u of profiles.users || []) {
    results.push(await uploadEnvironment(u.id, syncPath))
  }
  return results
}

async function uploadEnabled(syncPath) {
  // now means upload all (auto mode)
  return uploadAll(syncPath)
}

async function uploadChanged(syncPath) {
  const local = await listLocalEnvironments()
  const results = []
  for (const u of local) {
    if (u.dirty || !u.synced) {
      results.push(await uploadEnvironment(u.id, syncPath))
    }
  }
  return results
}

async function autoLoadFromSync(syncPath) {
  const { cfg } = loadSettings()
  if (!cfg.autoLoad && !cfg.enabled) return { skipped: true }
  const { environments } = await listSyncedEnvironments(syncPath || cfg.syncPath)
  const profiles = loadProfiles()
  const restored = []
  for (const e of environments) {
    const hasLocal = (profiles.users || []).some(u => String(u.localSyncId) === String(e.syncId))
    if (!hasLocal) {
      restored.push(await downloadEnvironment(e.syncId, syncPath || cfg.syncPath))
    }
  }
  try {
    const layout = syncLayout(syncPath || cfg.syncPath)
    if (fs.existsSync(layout.globalCopy)) {
      const remoteGlobal = readJson(layout.globalCopy, {})
      const localGlobal = loadGlobal()
      if ((!localGlobal.group || localGlobal.group.length === 0) && remoteGlobal.group) {
        localGlobal.group = remoteGlobal.group
        writeJson(globalPath(), localGlobal)
      }
    }
  } catch {}
  return { restored }
}

function fileSig(p) {
  try {
    const st = fs.statSync(p)
    return `${st.size}:${Math.floor(st.mtimeMs)}`
  } catch {
    return '0'
  }
}

/** Cheap token: profiles/global + per-env cookie/login mtimes (not History/Sessions). */
function localChangeToken() {
  const parts = [fileSig(profilesPath()), fileSig(globalPath())]
  try {
    const workers = workersRoot(loadGlobal())
    if (fs.existsSync(workers)) {
      for (const ent of fs.readdirSync(workers, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        const st = loginFingerprintStats(path.join(workers, ent.name))
        parts.push(`${ent.name}:${st.size}:${Math.floor(st.mtimeMs)}`)
      }
    }
  } catch {}
  return parts.join('|')
}

function copyIfChanged(src, dest) {
  if (!fs.existsSync(src)) return false
  try {
    if (fs.existsSync(dest)) {
      const a = fs.statSync(src)
      const b = fs.statSync(dest)
      if (a.size === b.size && Math.floor(a.mtimeMs) === Math.floor(b.mtimeMs)) return false
    }
  } catch {}
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
  try {
    const st = fs.statSync(src)
    fs.utimesSync(dest, st.atime, st.mtime)
  } catch {}
  return true
}

let _lastAutoToken = null
let _lastPullAt = 0

async function autoSyncNow(syncPath, opts) {
  const { cfg } = loadSettings()
  if (!cfg.enabled) return { skipped: true }
  const target = syncPath || cfg.syncPath
  ensureDir(target)
  const force = !!(opts && opts.force)
  const token = localChangeToken()
  const now = Date.now()
  // Skip full work when nothing local changed; still pull remote at most every 30min
  const needPull = force || !_lastPullAt || now - _lastPullAt > 30 * 60 * 1000
  if (!force && _lastAutoToken === token && !needPull) {
    return { skipped: true, reason: 'unchanged', pulled: 0, uploaded: 0, uploadedItems: [] }
  }

  let pulled = { restored: [] }
  if (needPull) {
    pulled = await autoLoadFromSync(target)
    _lastPullAt = now
  }

  let uploaded = []
  if (force || _lastAutoToken !== token) {
    uploaded = (await uploadChanged(target)).filter(x => !x.skipped)
  }
  _lastAutoToken = token

  // Mirror virtual/global only when content/mtime actually differs (avoids waking OneDrive)
  let mirrored = 0
  try {
    const layout = syncLayout(target)
    if (copyIfChanged(profilesPath(), layout.virtualCopy)) mirrored++
    if (copyIfChanged(globalPath(), layout.globalCopy)) mirrored++
  } catch {}
  return {
    pulled: (pulled.restored || []).length,
    uploaded: uploaded.length,
    uploadedItems: uploaded.map(x => ({ id: x.localId, name: x.name, syncId: x.syncId })),
    mirrored
  }
}

function sessionStatePath() {
  return path.join(userDataRoot(), 'session-restore.json')
}

function sessionBackupRoot() {
  return path.join(userDataRoot(), 'session-backups')
}

function loadSessionState() {
  return readJson(sessionStatePath(), { runningIds: [], tabs: {}, savedAt: null })
}

function saveSessionState(partial) {
  const cur = loadSessionState()
  const next = Object.assign({}, cur, partial || {}, { savedAt: Date.now() })
  if (!Array.isArray(next.runningIds)) next.runningIds = []
  next.runningIds = [...new Set(next.runningIds.map(String))]
  if (!next.tabs || typeof next.tabs !== 'object') next.tabs = {}
  writeJson(sessionStatePath(), next)
  return next
}

function extractUrlsFromBuffer(buf) {
  const s = buf.toString('binary')
  const raw = [...s.matchAll(/https?:\/\/[^\0-\x1f\s"'<>\\]{5,500}/g)].map(m => m[0])
  const out = []
  const seen = new Set()
  for (let url of raw) {
    const m = url.match(/^https?:\/\/[^\s"'<>\0-\x1f]+/)
    if (!m) continue
    url = m[0].replace(/[)\],;]+$/g, '')
    if (url.length < 12 || url.length > 500) continue
    if (/google\.com\/complete|suggesteventid|chrome-extension:/i.test(url)) continue
    let key = url
    try {
      const u = new URL(url)
      u.hash = ''
      key = u.origin + u.pathname.replace(/\/$/, '') + u.search
    } catch {}
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

function captureTabsFromDisk(localId) {
  const global = loadGlobal()
  const workers = workersRoot(global)
  const sessDir = path.join(workers, String(localId), 'Default', 'Sessions')
  if (!fs.existsSync(sessDir)) return []
  const files = fs
    .readdirSync(sessDir)
    .filter(f => /^(Tabs_|Session_)/.test(f))
    .map(f => {
      const p = path.join(sessDir, f)
      try {
        const st = fs.statSync(p)
        return { p, mtime: st.mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)

  for (const file of files.slice(0, 4)) {
    try {
      const urls = extractUrlsFromBuffer(fs.readFileSync(file.p))
      if (urls.length) return urls.slice(-8)
    } catch {}
  }
  return []
}

async function backupWorkerSessions(localId) {
  const global = loadGlobal()
  const workers = workersRoot(global)
  const src = path.join(workers, String(localId), 'Default', 'Sessions')
  const dst = path.join(sessionBackupRoot(), String(localId), 'Sessions')
  const tabs = captureTabsFromDisk(localId)
  const meta = { id: String(localId), tabs, savedAt: Date.now() }
  writeJson(path.join(sessionBackupRoot(), String(localId), 'tabs.json'), meta)

  if (fs.existsSync(src)) {
    ensureDir(dst)
    for (const f of fs.readdirSync(src)) {
      try {
        fs.copyFileSync(path.join(src, f), path.join(dst, f))
      } catch (e) {
        if (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) continue
      }
    }
  }
  return meta
}

async function backupAllRunningSessions(ids) {
  const list = ids || loadSessionState().runningIds || []
  const out = []
  for (const id of list) out.push(await backupWorkerSessions(id))
  const st = loadSessionState()
  st.tabs = st.tabs || {}
  for (const m of out) {
    if (m.tabs && m.tabs.length) st.tabs[m.id] = m.tabs
  }
  if (list.length) st.runningIds = list.map(String)
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
  let tabs = (st.tabs && st.tabs[String(localId)]) || (tabsMeta && tabsMeta.tabs) || []
  if (!tabs.length) tabs = captureTabsFromDisk(localId)

  if (fs.existsSync(src)) {
    ensureDir(dst)
    for (const f of fs.readdirSync(src)) {
      try {
        fs.copyFileSync(path.join(src, f), path.join(dst, f))
      } catch {}
    }
  }

  const prefPath = path.join(workers, String(localId), 'Default', 'Preferences')
  let pref = {}
  try {
    if (fs.existsSync(prefPath)) pref = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
  } catch {}
  pref.profile = pref.profile || {}
  // Mark unclean exit so Chromium's own SessionCrashedBubble can appear if not suppressed.
  // VirtualBrowser forces chrome://virtual-worker/, which usually blocks that bubble;
  // the in-browser restore bar (CDP) is the reliable fallback inside the Chrome window.
  pref.profile.exit_type = 'Crashed'
  pref.profile.exited_cleanly = false
  pref.session = pref.session || {}
  // Keep DEFAULT startup (0) — do NOT force startup_urls (that bypasses Chrome restore UX)
  pref.session.restore_on_startup = 0
  if (pref.session.startup_urls) delete pref.session.startup_urls
  writeJson(prefPath, pref)
  return {
    id: String(localId),
    tabs,
    ok: true,
    mode: 'chrome_crash_restore'
  }
}

function prepareWorkerSessionRestore(localId) {
  return restoreWorkerSessionFiles(localId)
}

function prepareSessionRestore(ids) {
  const list = (ids && ids.length ? ids : loadSessionState().runningIds) || []
  return list.map(id => restoreWorkerSessionFiles(id))
}

module.exports = {
  expandHome,
  defaultSyncRoot,
  loadSettings,
  saveSettings,
  listLocalEnvironments,
  listSyncedEnvironments,
  uploadEnvironment,
  downloadEnvironment,
  deleteSyncedEnvironment,
  enableLocalSync,
  disableLocalSync,
  uploadEnabled,
  uploadAll,
  uploadChanged,
  autoLoadFromSync,
  autoSyncNow,
  localChangeToken,
  userDataRoot,
  syncLayout,
  profilesPath,
  globalPath,
  sessionStatePath,
  loadSessionState,
  saveSessionState,
  prepareWorkerSessionRestore,
  prepareSessionRestore,
  backupWorkerSessions,
  backupAllRunningSessions,
  captureTabsFromDisk,
  restoreWorkerSessionFiles
}
