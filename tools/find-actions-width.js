const fs=require('fs')
const s=fs.readFileSync('C:/workspace/VirtualBrowser/_asar_extract/dist/server/static/js/chunk-4bd85d25.js','utf8')
const key="small-padding\\x20fixed-width"
let i=0,c=0
while((i=s.indexOf(key,i))>=0 && c<5){
  console.log('---',i)
  console.log(s.slice(i-150,i+300))
  i++; c++
}
