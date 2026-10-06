const http = require('http')
const fs = require('fs')
const WebSocket = require('./node_modules/ws')
function getJson(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)})}
function withTimeout(p, ms, label){
  return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout '+label)), ms))])
}
async function main(){
  const pages=await getJson('http://127.0.0.1:9229/json/list')
  const page=pages.find(p=>p.type==='page')
  if(!page) throw new Error('no page')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  let id=0; const pending=new Map()
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))})
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString()); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id); msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result)}})
  await withTimeout(new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject)}), 5000, 'ws')
  await send('Runtime.evaluate',{expression:'window.vbLocalSyncOpen&&window.vbLocalSyncOpen()',returnByValue:true})
  await new Promise(r=>setTimeout(r,800))
  const shot=await withTimeout(send('Page.captureScreenshot',{format:'png',fromSurface:true}), 10000, 'shot')
  fs.writeFileSync('C:/workspace/VirtualBrowser/tools/local-sync-test.png', Buffer.from(shot.data,'base64'))
  console.log('OK screenshot', (shot.data.length/1024).toFixed(1),'KB base64')
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error('FAIL', e.message||e); process.exit(1)})
