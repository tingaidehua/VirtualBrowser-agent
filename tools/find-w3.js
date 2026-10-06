const fs=require('fs')
const s=fs.readFileSync('C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/chunk-4bd85d25.js','utf8')
const m=s.match(/function a11_0x28c6\(\)\{const _0x488cbe=(\[[\s\S]*?\]);return a11_0x28c6/)
if(!m){ console.log('no array'); process.exit(1)}
const arr=eval(m[1])
function dec(x){ return arr[x-0x1e4] } // guess offset from earlier a6 pattern - try common
// From file: a11_0x95d60f=a11_0x21f7; _0x50e73d=_0x50e73d-0x1e4 for other chunk
// For this chunk find: function a11_0x21f7(_0x??){ ... - 0x???
const fn=s.match(/function a11_0x21f7\(_0x[a-f0-9]+,_0x[a-f0-9]+\)\{[^}]+return a11_0x21f7/)
console.log('fn', fn&&fn[0].slice(0,200))
const sub=s.match(/a11_0x21f7=function\(_0x[a-f0-9]+,_0x[a-f0-9]+\)\{[^;]+;_0x[a-f0-9]+=_0x[a-f0-9]+-(0x[a-f0-9]+)/)
console.log('sub', sub&&sub[1])
const offset=sub?parseInt(sub[1],16):0x1e4
console.log('offset', offset, 'arrlen', arr.length)
console.log('0x45d', arr[0x45d-offset])
console.log('0x536', arr[0x536-offset])
console.log('0x340', arr[0x340-offset])
console.log('0x417', arr[0x417-offset])
