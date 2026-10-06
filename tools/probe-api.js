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
    function call(name,...params){return new Promise((resolve,reject)=>{const cb='cb_'+Math.random().toString(36).slice(2); window.cr=window.cr||{}; window.cr.__callbacks=window.cr.__callbacks||{}; const t=setTimeout(()=>reject(new Error('timeout '+name)),4000); window.cr.__callbacks[cb]=d=>{clearTimeout(t);resolve(d)}; try{window.chrome.send(name,[cb,...params])}catch(e){clearTimeout(t);reject(e)}})}
    const names=[
      'getApiServerStatus','startApiServer','getApiPort','getApiKey','checkApiServerStatus',
      'getBrowserDebuggingPort','getWorkerDebuggingPort','getRunningBrowserInfo','getBrowserInfo',
      'launchBrowser','getRuningBrowser'
    ]
    const out={}
    for(const n of names){
      try{ out[n]=await call(n, n==='launchBrowser'?'1':undefined) }catch(e){ out[n]=String(e.message||e) }
    }
    // launchBrowser return when already running
    try{ out.launchInfo=await call('launchBrowser','1') }catch(e){out.launchInfo=String(e)}
    return out
  })()`,returnByValue:true,awaitPromise:true})
  console.log(JSON.stringify(r.result&&r.result.value,null,2))
  ws.close()
})().catch(e=>{console.error(e);process.exit(1)})
