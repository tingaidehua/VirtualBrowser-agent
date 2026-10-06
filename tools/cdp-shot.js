const http = require('http')
const fs = require('fs')
const WebSocket = require('C:/workspace/VirtualBrowser/tools/node_modules/ws')
function getJson(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)})}
async function main(){
  const pages=await getJson('http://127.0.0.1:9229/json/list')
  const page=pages.find(p=>p.type==='page')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  let id=0; const pending=new Map()
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))})
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString()); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id); msg.error?reject(msg.error):resolve(msg.result)}})
  await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject)})
  // ensure page open
  await send('Runtime.evaluate',{expression:'window.vbLocalSyncOpen&&window.vbLocalSyncOpen()',returnByValue:true})
  await new Promise(r=>setTimeout(r,1000))
  const shot=await send('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync('C:/workspace/VirtualBrowser/tools/local-sync-test.png', Buffer.from(shot.data,'base64'))
  console.log('wrote screenshot bytes', shot.data.length)
  // test download roundtrip (same env)
  const dl=await send('Runtime.evaluate',{expression:`(async()=>{
    const r=await window.vbLocalSyncBridge.invoke('vb-local-sync:download','local-1-muvorjlt')
    return r
  })()`,returnByValue:true,awaitPromise:true})
  console.log('download', JSON.stringify(dl))
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error(e);process.exit(1)})
