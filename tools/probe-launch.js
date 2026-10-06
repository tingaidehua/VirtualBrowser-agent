const http = require('http')
const WebSocket = require('./node_modules/ws')
function getJson(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)})}
async function main(){
  const pages=await getJson('http://127.0.0.1:9229/json/list')
  const page=pages.find(p=>p.type==='page')
  if(!page) throw new Error('no page - is app running with 9229?')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  let id=0; const pending=new Map()
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))})
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString()); if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id); msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result)}})
  await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject)})
  const r=await send('Runtime.evaluate',{expression:`(async()=>{
    const out={ hasChrome: !!window.chrome, hasSend: !!(window.chrome&&window.chrome.send), hasCr: !!window.cr, keys: Object.keys(window).filter(k=>/chrome|sandbox|send/i.test(k)).slice(0,30) }
    function call(name, ...params){
      return new Promise((resolve,reject)=>{
        if(!window.chrome||!window.chrome.send) return reject(new Error('no chrome.send'))
        const cb='cb_'+Math.random().toString(36).slice(2)
        window.cr = window.cr || { __callbacks: {} }
        window.cr.__callbacks = window.cr.__callbacks || {}
        window.cr.__callbacks[cb]= (data)=> resolve(data)
        window.chrome.send(name, [cb, ...params])
        setTimeout(()=>reject(new Error('timeout '+name)), 3000)
      })
    }
    try { out.running = await call('getRuningBrowser') } catch(e){ out.runningErr=String(e) }
    try { out.running2 = await call('getBrowserRunningList') } catch(e){ out.running2Err=String(e) }
    return out
  })()`, returnByValue:true, awaitPromise:true})
  console.log(JSON.stringify(r.result && r.result.value, null, 2))
  if(r.exceptionDetails) console.log('exc', JSON.stringify(r.exceptionDetails))
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error(e); process.exit(1)})
