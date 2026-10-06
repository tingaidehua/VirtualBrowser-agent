const fs = require('fs')
const s = fs.readFileSync('C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/app.js', 'utf8')

// Find _0x10d77e definition - look around first usage of cloudSyncDownload function
const marker = "async function _0x5d1b40"
const i = s.indexOf(marker)
console.log('marker', i)
console.log(s.slice(i - 2500, i + 800))
