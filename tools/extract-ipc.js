const fs = require('fs')
const path = require('path')
const files = [
  'C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/chunk-2daf3ee0.js',
  'C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/chunk-4bd85d25.js',
  'C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/chunk-38974a06.js',
  'C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/app.js'
]
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const keys = [...s.matchAll(/ipcRenderer\.(invoke|send|on)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] + ':' + m[2])
  const chrome = [...s.matchAll(/chrome\.send\(\s*['"]([^'"]+)['"]/g)].map(m => 'chrome:' + m[1])
  const unique = [...new Set([...keys, ...chrome])].filter(x => /sync|webdav|cloud|path|dir|cache|global|browser|setting|vip|upload|download|backup|dialog|select/i.test(x))
  console.log('==', path.basename(f), '==')
  unique.sort().forEach(x => console.log(x))
}
