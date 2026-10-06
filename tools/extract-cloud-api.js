const fs = require('fs')
const s = fs.readFileSync('C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/app.js', 'utf8')

// Find cloudSync* function definitions near webpack exports
const names = ['cloudSyncUpload','cloudSyncDownload','cloudSyncDownloadByCloudId','cloudSyncListBackups','cloudSyncTestConnection','cloudSyncDeleteByCloudId']
for (const name of names) {
  const idx = s.lastIndexOf("'" + name + "'")
  console.log('\n====', name, 'last @', idx, '====')
  if (idx >= 0) console.log(s.slice(idx, idx + 500))
}

// Find function bodies that contain ali-oss or WebDAV upload logic - search for interesting snippets
for (const needle of ['webdav', 'WebDAV', 'ali-oss', 'OSS(', 'putObject', 'getObject', 'MKCOL', 'PROPFIND', '.zip', 'adm-zip', 'Workers', 'virtual.dat']) {
  let idx = 0, n = 0
  while ((idx = s.indexOf(needle, idx)) !== -1 && n < 2) {
    console.log('\n--', needle, '@', idx)
    console.log(JSON.stringify(s.slice(Math.max(0,idx-60), idx+120)))
    idx += needle.length; n++
  }
}

// Look at sandboxAPI mock
const m = s.indexOf("sandboxAPI.ipcRenderer")
console.log('\n mock area', m)
if (m>0) console.log(s.slice(m-200, m+800))
