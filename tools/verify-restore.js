const http=require('http'); const WebSocket=require('./node_modules/ws')
function getJson(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)})}
;(async()=>{
  const pages=await getJson('http://127.0.0.1:9229/json/list')
  const page=pages.find(p=>p.type==='page')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  let id=0; const pending=new Map()
  const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method:m,params:p}))})
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString()); if(msg.id&&pending.has(msg.id)){const x=pending.get(msg.id);pending.delete(msg.id);msg.error?x.reject(msg.error):x.resolve(msg.result)}})
  await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)})
  const r=await send('Runtime.evaluate',{expression:`(async()=>{
    function call(name,...params){return new Promise((resolve,reject)=>{const cb='cb_'+Math.random().toString(36).slice(2); window.cr=window.cr||{__callbacks:{}}; window.cr.__callbacks=window.cr.__callbacks||{}; const t=setTimeout(()=>reject(new Error('to')),8000); window.cr.__callbacks[cb]=d=>{clearTimeout(t);resolve(d)}; window.chrome.send(name,[cb,...params])})}
    const running=await call('getRuningBrowser')
    const sess=await window.vbLocalSyncBridge.invoke('vb-local-sync:get-session')
    return {running, sess, restoreDone: !!window.__vbLocalSyncRestoreDone, hasSessionCode: typeof window.vbLocalSyncSession!== 'undefined'}
  })()`,returnByValue:true,awaitPromise:true})
  console.log(JSON.stringify(r.result&&r.result.value,null,2))
  ws.close(); process.exit(0)
})().catch(e=>{console.error(e);process.exit(1)})
