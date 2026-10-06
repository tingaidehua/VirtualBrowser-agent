const fs = require('fs')
const path = require('path')
const base = 'C:/Users/dcsco/AppData/Local/VirtualBrowser/Workers/1/Default'
const pref = JSON.parse(fs.readFileSync(path.join(base, 'Preferences'), 'utf8'))
console.log('prefs', {
  exit_type: pref.profile && pref.profile.exit_type,
  exited_cleanly: pref.profile && pref.profile.exited_cleanly,
  restore_on_startup: pref.session && pref.session.restore_on_startup,
  startup_urls: pref.session && pref.session.startup_urls,
  session_keys: pref.session && Object.keys(pref.session)
})
for (const sub of ['Sessions', 'Session Storage']) {
  const d = path.join(base, sub)
  console.log('dir', sub, fs.existsSync(d) ? fs.readdirSync(d) : 'MISSING')
}
const sessDir = path.join(base, 'Sessions')
if (fs.existsSync(sessDir)) {
  for (const f of fs.readdirSync(sessDir)) {
    const b = fs.readFileSync(path.join(sessDir, f))
    const s = b.toString('binary')
    const urls = [...s.matchAll(/https?:\/\/[^\0-\x1f\s"'<>\\]{5,300}/g)].map(m => m[0])
    console.log(f, 'size', b.length, 'unique urls', [...new Set(urls)].slice(0, 30))
  }
}
// Current Session / Tabs
for (const f of fs.readdirSync(base)) {
  if (/session|tabs|current|last/i.test(f)) console.log('file', f, fs.statSync(path.join(base, f)).size)
}
const sr = 'C:/Users/dcsco/AppData/Local/VirtualBrowser/session-restore.json'
console.log('session-restore', fs.existsSync(sr) ? fs.readFileSync(sr, 'utf8') : 'missing')
