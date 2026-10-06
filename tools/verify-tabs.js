const http=require('http'); const WebSocket=require('./node_modules/ws'); const fs=require('fs')
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
    function call(name,...params){return new Promise((resolve,reject)=>{const cb='cb_'+Math.random().toString(36).slice(2); window.cr=window.cr||{}; window.cr.__callbacks=window.cr.__callbacks||{}; const t=setTimeout(()=>reject(new Error('to')),8000); window.cr.__callbacks[cb]=d=>{clearTimeout(t);resolve(d)}; window.chrome.send(name,[cb,...params])})}
    const running=await call('getRuningBrowser')
    const sess=await window.vbLocalSyncBridge.invoke('vb-local-sync:get-session')
    return {running, sess: sess.data||sess, restoreDone:!!window.__vbLocalSyncRestoreDone}
  })()`,returnByValue:true,awaitPromise:true})
  console.log('control', JSON.stringify(r.result&&r.result.value,null,2))
  // Check prefs still have startup urls after launch
  const pref=JSON.parse(fs.readFileSync('C:/Users/dcsco/AppData/Local/VirtualBrowser/Workers/1/Default/Preferences','utf8'))
  console.log('after launch restore_on_startup', pref.session&&pref.session.restore_on_startup)
  console.log('after launch startup_urls', pref.session&&pref.session.startup_urls)
  ws.close()
})().catch(e=>{console.error(e);process.exit(1)})
