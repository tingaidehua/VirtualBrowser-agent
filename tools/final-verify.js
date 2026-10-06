const http = require('http')
const WebSocket = require('./node_modules/ws')
function getJson(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)})}
async function main(){
  const pages=await getJson('http://127.0.0.1:9229/json/list')
  const page=pages.find(p=>p.type==='page')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  let id=0; const pending=new Map()
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))})
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString()); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id); msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result)}})
  await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject)})
  const ev=async (expression,awaitPromise=false)=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise})
    if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result && r.result.value
  }
  const state=await ev(`({
    sidebar: !!document.querySelector('.vb-ls-sidebar-item'),
    sidebarText: (document.querySelector('.vb-ls-sidebar-item')||{}).textContent,
    bridge: !!window.vbLocalSyncBridge
  })`)
  console.log('UI', state)
  const upload = await ev(`(async()=>{
    const s = await window.vbLocalSyncBridge.invoke('vb-local-sync:get-settings')
    const settings = s.data || s
    const up = await window.vbLocalSyncBridge.invoke('vb-local-sync:upload', 1, settings.syncPath)
    const list = await window.vbLocalSyncBridge.invoke('vb-local-sync:list-synced', settings.syncPath)
    return { settings, up: up.data||up, synced: (list.data||list) }
  })()`, true)
  console.log('UPLOAD_OK', JSON.stringify(upload, null, 2))
  await ev('window.vbLocalSyncOpen()')
  const pageState = await ev(`({
    open: document.querySelector('.vb-ls-root').classList.contains('open'),
    path: document.querySelector('#vb-ls-path').value,
    status: document.querySelector('#vb-ls-status').textContent
  })`)
  console.log('PAGE', pageState)
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error(e); process.exit(1)})
