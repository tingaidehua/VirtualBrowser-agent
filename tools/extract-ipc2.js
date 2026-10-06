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
  console.log('==', path.basename(f), 'len', s.length, '==')
  for (const needle of ['ipcRenderer', 'cloudSyncUpload', 'cloudSyncDownload', 'cloudSyncListBackups', 'chrome.send', 'require(\"electron\")', 'window.require', 'contextBridge']) {
    let idx = 0, n = 0
    while ((idx = s.indexOf(needle, idx)) !== -1 && n < 3) {
      console.log(needle, '@', idx, '::', JSON.stringify(s.slice(Math.max(0,idx-40), idx+needle.length+80)))
      idx += needle.length
      n++
    }
    if (n === 0) console.log(needle, ': NOT FOUND')
  }
}
