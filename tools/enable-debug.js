const http=require('http'); const WebSocket=require('./node_modules/ws')
function getJson(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)})}
;(async()=>{
  const pages=await getJson('http://127.0.0.1:9229/json/list')
  const page=pages.find(p=>p.type==='page')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  let id=0; const pending=new Map()
  const send=(m,p={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method:m,params:p}))})
  ws.on('message',raw=>{const msg=JSON.parse(raw.toString()); if(msg.id&&pending.has(msg.id)){const x=pending.get(msg.id);pending.delete(msg.id);msg.error?x.reject(new Error(JSON.stringify(msg.error))):x.resolve(msg.result)}})
  await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)})
  const r=await send('Runtime.evaluate',{expression:`(async()=>{
    function call(name,...params){return new Promise((resolve,reject)=>{const cb='cb_'+Math.random().toString(36).slice(2); window.cr=window.cr||{}; window.cr.__callbacks=window.cr.__callbacks||{}; const t=setTimeout(()=>reject(new Error('to '+name)),5000); window.cr.__callbacks[cb]=d=>{clearTimeout(t);resolve(d)}; window.chrome.send(name,[cb,...params])})}
    const g=JSON.parse((await call('getGlobalData')).data||'{}')
    g.debuggingPort = g.debuggingPort || { mode: 1, min: 9300, max: 9400 }
    g.debuggingPort.mode = 1
    g.debuggingPort.min = 9300
    g.debuggingPort.max = 9400
    g.apiPort = 9000
    g.apiServer = true
    await call('setGlobalData', JSON.stringify(g))
    const after=JSON.parse((await call('getGlobalData')).data||'{}')
    // stop and relaunch
    try{await call('stopBrowser','1')}catch{}
    await new Promise(r=>setTimeout(r,1500))
    const launch = await call('launchBrowser','1')
    await new Promise(r=>setTimeout(r,3000))
    return { after, launch, running: await call('getRuningBrowser'), apiPort: await call('getApiPort') }
  })()`,returnByValue:true,awaitPromise:true})
  console.log(JSON.stringify(r.result&&r.result.value,null,2))
  ws.close()
})().catch(e=>{console.error(e);process.exit(1)})
