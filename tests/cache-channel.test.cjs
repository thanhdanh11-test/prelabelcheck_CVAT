const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('cvat-resize-extension/cache-channel.js','utf8');
function fixture(){
 const ctx=vm.createContext({});vm.runInContext(source,ctx);let receive,time=0,issued=0,unlocks=0,locks=0;
 const state={jobId:97,origin:'https://company.example',header:'old',lockToken:null,unlocked:false,busy:false};
 const runtime={id:'ours',getURL:p=>'chrome-extension://ours/'+p,onMessage:{addListener:fn=>receive=fn}};
 const channel=ctx.CvatCacheChannel.install({runtime,getState:()=>({...state}),unlock:async()=>{unlocks++;return 'unlocked';},lockAll:async()=>{locks++;state.lockToken='locked';return 'locked';},randomUUID:()=>String(++issued),now:()=>time});
 const sender={id:'ours',url:'chrome-extension://ours/cache-popup.html'};
 const send=(type,extra={},from=sender)=>new Promise(resolve=>{const accepted=receive({channel:'cvat-cache-private-v1',type,...extra},from,resolve);if(!accepted)resolve(null);});
 return {send,state,channel,sender,get unlocks(){return unlocks;},get locks(){return locks;},expire:()=>time=120001};
}
test('channel only accepts own extension popup, never page/other extension/other extension page',async()=>{
 const f=fixture();for(const sender of [
  {id:'ours',url:'https://company.example/jobs/97',tab:{id:1}},
  {id:'other',url:'chrome-extension://ours/cache-popup.html'},
  {id:'ours',url:'chrome-extension://ours/options.html'},
  {id:'ours',url:'chrome-extension://ours/cache-popup.html',tab:{id:1}},
  {url:'https://company.example'}]) assert.equal(await f.send('status',{},sender),null);
 assert.equal((await f.send('status')).ok,true);
});
test('unlock challenge is one-use, expires and cannot survive job/header/lock changes',async()=>{
 const f=fixture(),first=await f.send('status');assert.equal((await f.send('unlock',{nonce:first.nonce})).ok,true);
 assert.equal((await f.send('unlock',{nonce:first.nonce})).ok,false);assert.equal(f.unlocks,1);
 for(const field of ['jobId','header','lockToken']){
  const p=await f.send('status');f.state[field]='changed-'+field;
  assert.equal((await f.send('unlock',{nonce:p.nonce})).ok,false);
 }
 const p=await f.send('status');f.expire();assert.equal((await f.send('unlock',{nonce:p.nonce})).ok,false);
});
test('global lock is allowed during work and revokes pending popup challenge',async()=>{
 const f=fixture(),p=await f.send('status');f.state.busy=true;
 assert.equal((await f.send('lock-all')).ok,true);assert.equal(f.locks,1);
 f.state.busy=false;assert.equal((await f.send('unlock',{nonce:p.nonce})).ok,false);assert.equal(f.unlocks,0);
});
test('production manifest isolates popup; content has no password inputs or window unlock channel',()=>{
 const manifest=JSON.parse(fs.readFileSync('cvat-resize-extension/manifest.json','utf8'));
 assert.equal(manifest.action.default_popup,'cache-popup.html');assert.deepEqual(manifest.permissions,['activeTab']);
 assert.equal(manifest.externally_connectable,undefined);
 assert.equal(manifest.web_accessible_resources.some(v=>v.resources.some(p=>p.includes('popup')||p==='*')),false);
 const content=fs.readFileSync('cvat-resize-extension/content.js','utf8');assert.doesNotMatch(content,/type="password"|vault-password|vault-confirm/);
 assert.doesNotMatch(source,/postMessage|addEventListener\(['"]message/);
 const popup=fs.readFileSync('cvat-resize-extension/cache-popup.js','utf8');assert.doesNotMatch(popup,/localStorage|fetch\(|console\./);
});
