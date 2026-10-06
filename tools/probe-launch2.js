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
  const r=await send('Runtime.evaluate',{expression:`(async()=>{
    function call(name, ...params){
      return new Promise((resolve,reject)=>{
        const cb='cb_'+Math.random().toString(36).slice(2)
        window.cr = window.cr || { __callbacks: {} }
        window.cr.__callbacks = window.cr.__callbacks || {}
        window.cr.__callbacks[cb]= (data)=> resolve(data)
        console.log('send', name, [cb, ...params])
        window.chrome.send(name, [cb, ...params])
        setTimeout(()=>reject(new Error('timeout '+name)), 8000)
      })
    }
    // probe names
    const names=['launchBrowser','LaunchBrowser','startBrowser','openBrowser','runBrowser']
    const out={}
    for (const n of names){
      try { out[n]=await call(n, '1') } catch(e){ out[n]=String(e) }
    }
    await new Promise(r=>setTimeout(r,2000))
    try { out.runningAfter=await call('getRuningBrowser') } catch(e){ out.runningAfter=String(e) }
    return out
  })()`, returnByValue:true, awaitPromise:true})
  console.log(JSON.stringify(r.result&&r.result.value,null,2))
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error(e);process.exit(1)})
