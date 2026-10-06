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
    function call(name,...params){return new Promise((resolve,reject)=>{const cb='cb_'+Math.random().toString(36).slice(2); window.cr=window.cr||{}; window.cr.__callbacks=window.cr.__callbacks||{}; const t=setTimeout(()=>reject(new Error('timeout '+name)),5000); window.cr.__callbacks[cb]=d=>{clearTimeout(t);resolve(d)}; try{window.chrome.send(name,[cb,...params])}catch(e){clearTimeout(t);reject(e)}})}
    const out={}
    try{ out.global=await call('getGlobalData'); out.globalParsed=JSON.parse(out.global.data||out.global||'{}') }catch(e){out.globalErr=String(e)}
    // stop then set homepage then launch
    try{ out.stop=await call('stopBrowser','1') }catch(e){ try{ out.stop=await call('closeBrowser','1') }catch(e2){ out.stop=String(e.message||e)+' / '+String(e2.message||e2)} }
    await new Promise(r=>setTimeout(r,1500))
    const list=await call('getBrowserList')
    const users=(list.data&&list.data.users)||[]
    const u=users.find(x=>String(x.id)==='1')
    if(u){
      u.homepage={mode:1,value:'https://mail.163.com/register/index.htm?from=163navi&regPage=163#/pn'}
      out.set=await call('setBrowserList',{users})
    }
    out.launch=await call('launchBrowser','1')
    await new Promise(r=>setTimeout(r,4000))
    out.running=await call('getRuningBrowser')
    return out
  })()`,returnByValue:true,awaitPromise:true})
  console.log(JSON.stringify(r.result&&r.result.value,null,2).slice(0,3000))
  ws.close()
  // check window title
})().catch(e=>{console.error(e);process.exit(1)})
