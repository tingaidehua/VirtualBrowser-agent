const fs=require('fs')
const s=fs.readFileSync('C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/chunk-4bd85d25.js','utf8')
// find a6_0x1acb array or similar string table - look for '200' near browser.actions
const m=s.match(/function a11_0x28c6\(\)\{const _0x488cbe=\[([\s\S]*?)\];return/)
// different obfuscation - extract from const array at start
const start=s.indexOf("const _0x488cbe=[")
console.log('start', start)
const arrStart=s.indexOf('[', start)
// too big - search for width values near actions
for (const k of ["'200'","'180'","'160'","'150'","'140'","'120'","'100px'","'200px'","'180px'","'160px'","'140px'","'120px'"]) {
  let idx=0,c=0
  while((idx=s.indexOf(k,idx))>=0 && c<1){
    if (Math.abs(idx-388823)<5000) console.log('near actions', k, idx)
    idx++; c++
  }
}
// decode: find a11_0x95d60f(0x45d) usage mapping - look at array index
// simpler: dump strings containing px around the column def
const slice=s.slice(388700,389200)
console.log(slice)
