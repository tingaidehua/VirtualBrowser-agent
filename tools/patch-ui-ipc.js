const fs = require('fs')
const p = 'C:/workspace/VirtualBrowser/local-sync-ext/ui-inject.js'
let s = fs.readFileSync(p, 'utf8')
const repl = `function ipc() {
    const api = (window.vbLocalSyncBridge) ||
      (window.sandboxAPI && window.sandboxAPI.ipcRenderer) ||
      (window.electron && window.electron.ipcRenderer) ||
      (window.require && window.require('electron').ipcRenderer) ||
      null
    return api
  }`
const next = s.replace(/function ipc\(\) \{[\s\S]*?return api\n  \}/, repl)
if (next === s) {
  console.log('WARN: pattern not found, trying alternate')
  const next2 = s.replace(/function ipc\(\) \{[\s\S]*?return api\r?\n  \}/, repl)
  if (next2 === s) throw new Error('failed to patch ipc()')
  s = next2
} else s = next
fs.writeFileSync(p, s)
fs.copyFileSync(p, 'C:/workspace/VirtualBrowser/_asar_extract/dist/app/local-sync/ui-inject.js')
fs.copyFileSync(p, 'C:/workspace/VirtualBrowser/_asar_extract/dist/app/local-sync/ui-inject.js')
console.log('ok', s.includes('vbLocalSyncBridge'))
