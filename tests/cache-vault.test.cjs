const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const ctx=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Float32Array,btoa,atob});
vm.runInContext(fs.readFileSync('cvat-resize-extension/cache-vault.js','utf8'),ctx);
const {create,HEADER}=ctx.CvatCacheVault;
const PASSWORD='correct horse battery staple';
function fixture() {
 const data=new Map(); let tail=Promise.resolve();
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i],get length(){return data.size;}};
 const locks={request:(_,fn)=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
 const vault=()=>create({storage,locks,crypto:webcrypto,origin:'https://company.example'});
 return {data,storage,locks,vault};
}
function memoryStore() {
 const data=new Map();return {data,get:async(k,meta)=>meta?data.has(k):data.get(k),put:async(k,s,v)=>{data.set(k,v);return true;},count:async()=>data.size,clear:async()=>data.clear()};
}
test('encrypted point cloud survives reopen; stored bytes contain no XYZ plaintext and reload starts locked',async()=>{
 const f=fixture(),v=f.vault(),raw=memoryStore(),xyz=new Float32Array([1234.5,-8,99]);
 const locked=v.wrapStore(raw);assert.equal(await locked.put('frame:1','job',xyz),false);
 await v.unlock(PASSWORD);await locked.put('frame:1','job',xyz);
 const stored=raw.data.get('frame:1');assert.notDeepEqual(Buffer.from(stored),Buffer.from(xyz.buffer));
 assert.equal(new TextDecoder().decode(stored).includes('1234.5'),false);
 assert.deepEqual([...await locked.get('frame:1')],[...xyz]);
 const second=f.vault(),adapter=second.wrapStore(raw);assert.equal(await adapter.get('frame:1'),null);
 await assert.rejects(second.unlock('wrong password long'),/Sai mật khẩu/);
 assert.equal(second.unlocked,false);assert.equal(raw.data.size,1);
 await second.unlock(PASSWORD);assert.deepEqual([...await adapter.get('frame:1')],[...xyz]);
 assert.equal([...f.data.values()].some(s=>s.includes(PASSWORD)),false);
});
test('GCM rejects tampering, wrong record context and cross-origin use; IVs differ',async()=>{
 const f=fixture(),v=f.vault();await v.unlock(PASSWORD);
 const a=await v.seal('one',new TextEncoder().encode('private')),b=await v.seal('one',new TextEncoder().encode('private'));
 assert.notDeepEqual(a.iv,b.iv);
 await assert.rejects(v.open('two',a));
 const changed=JSON.parse(JSON.stringify(a));changed.data=(changed.data[0]==='A'?'B':'A')+changed.data.slice(1);
 await assert.rejects(v.open('one',changed));
 const other=create({storage:f.storage,locks:f.locks,crypto:webcrypto,origin:'https://other.example'});
 await assert.rejects(other.unlock(PASSWORD),/Sai mật khẩu/);
});
test('locking during encryption and changing header reject late results',async()=>{
 const f=fixture(),v=f.vault();await v.unlock(PASSWORD);
 const pending=v.seal('a',new Uint8Array(1024*1024));v.lock();await assert.rejects(pending);
 await v.unlock(PASSWORD);f.storage.setItem(HEADER,'{}');
 await assert.rejects(v.seal('a',new Uint8Array(3)));assert.equal(v.unlocked,false);
});
test('concurrent initialization serializes, does not overwrite header with another password',async()=>{
 const f=fixture(),a=f.vault(),b=f.vault();
 const result=await Promise.allSettled([a.unlock(PASSWORD),b.unlock('different password long')]);
 assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');
 const reopened=f.vault();await reopened.unlock(PASSWORD);assert.equal(reopened.unlocked,true);
});
test('origin migration preserves exact JSON across all jobs and removes only verified plaintext',async()=>{
 const f=fixture(),v=f.vault();
 const name='cvat-track-origins:v1:97',plain=JSON.stringify({version:1,links:[{geometry:[23.5,9,8]}]});
 f.storage.setItem(name,plain);f.storage.setItem('cvat-track-origins:v1:98','{"links":[]}');f.storage.setItem('unrelated','keep');
 await v.unlock(PASSWORD);await v.migrateOrigins();
 assert.equal(f.storage.getItem(name),null);assert.equal(f.storage.getItem('unrelated'),'keep');
 assert.equal(await v.readOrigins(name),plain);
 assert.equal(f.storage.getItem('cvat-encrypted-origins:v1:97').includes('geometry'),false);
 await v.migrateOrigins();assert.equal(await v.readOrigins(name),plain);
});
test('migration quota and conflicting old tab preserve original records; reset is scoped',async()=>{
 const f=fixture(),v=f.vault(),name='cvat-track-origins:v1:97';
 f.storage.setItem(name,'old');await v.unlock(PASSWORD);
 const write=f.storage.setItem;f.storage.setItem=()=>{throw Error('quota');};
 await assert.rejects(v.migrateOrigins(),/quota/);assert.equal(f.storage.getItem(name),'old');f.storage.setItem=write;
 await v.writeOrigins(name,'newer');await assert.rejects(v.migrateOrigins(),/khác nhau/);
 assert.equal(f.storage.getItem(name),'old');assert.equal(await v.readOrigins(name),'newer');
 f.storage.setItem('unrelated','keep');await v.reset();assert.equal(v.unlocked,false);
 assert.equal(f.storage.getItem(HEADER),null);assert.equal(f.storage.getItem(name),null);assert.equal(f.storage.getItem('unrelated'),'keep');
});
test('clear while encryption is pending cannot repopulate cloud storage',async()=>{
 const f=fixture(),v=f.vault(),raw=memoryStore();await v.unlock(PASSWORD);
 const adapter=v.wrapStore(raw),pending=adapter.put('a','job',new Float32Array(300000));
 await adapter.clear();assert.equal(await pending,false);assert.equal(raw.data.size,0);
});
test('unsupported crypto/locks and malformed KDF parameters fail without plaintext fallback',async()=>{
 const f=fixture(),v=create({storage:f.storage,crypto:webcrypto,origin:'x',locks:null});
 await assert.rejects(v.unlock(PASSWORD),/Web Locks/);assert.equal(f.data.size,0);
 f.storage.setItem(HEADER,JSON.stringify({version:1,iterations:1,id:'x',salt:Array(16).fill(0)}));
 await assert.rejects(f.vault().unlock(PASSWORD),/không hợp lệ/);
 assert.equal(JSON.parse(f.storage.getItem(HEADER)).iterations,1);
});
test('serialized origin mutations preserve both writers and reset finishes clearing before new unlock',async()=>{
 const f=fixture(),a=f.vault(),b=f.vault();await a.unlock(PASSWORD);await b.unlock(PASSWORD);
 const name='cvat-track-origins:v1:1';
 const append=(v,value)=>v.withLock(async()=>{const list=JSON.parse(await v.readOrigins(name)||'[]');list.push(value);await v.writeOrigins(name,JSON.stringify(list));});
 await Promise.all([append(a,'A'),append(b,'B')]);assert.deepEqual(JSON.parse(await a.readOrigins(name)),['A','B']);
 let finishClear,started;const clearing=new Promise(r=>finishClear=r),entered=new Promise(r=>started=r);
 const reset=a.reset(async()=>{started();await clearing;});await entered;
 let unlocked=false;const next=b.unlock(PASSWORD).then(()=>{unlocked=true;});
 await new Promise(r=>setImmediate(r));assert.equal(unlocked,false);finishClear();await reset;await next;assert.equal(unlocked,true);
});
test('reading locked UI status while deriving a key does not cancel unlock',async()=>{
 const f=fixture(),v=f.vault(),pending=v.unlock(PASSWORD);
 for(let i=0;i<10;i++)assert.equal(v.unlocked,false);
 await pending;assert.equal(v.unlocked,true);
});
test('popup prepares a proof without touching page storage; receiver imports a nonextractable usable key',async()=>{
 const f=fixture(),v=f.vault();
 const proof=await ctx.CvatCacheVault.prepareUnlock(PASSWORD,null,'https://company.example',{crypto:webcrypto});
 assert.equal(f.data.size,0);assert.equal(proof.rawKey.length,32);
 await v.acceptUnlock(proof,null,null);assert.equal(v.unlocked,true);assert.ok(proof.rawKey.every(n=>n===0));
 await v.writeOrigins('cvat-track-origins:v1:1','private');v.lock();
 const header=f.storage.getItem(HEADER);
 const reopened=await ctx.CvatCacheVault.prepareUnlock(PASSWORD,header,'https://company.example',{crypto:webcrypto});
 await v.acceptUnlock(reopened,header,null);assert.equal(await v.readOrigins('cvat-track-origins:v1:1'),'private');
});
test('popup proof is bound to origin/header and a global lock invalidates all tabs and pending imports',async()=>{
 const f=fixture(),a=f.vault(),b=f.vault();await a.unlock(PASSWORD);await b.unlock(PASSWORD);
 await a.writeOrigins('cvat-track-origins:v1:1','private');
 const state=a.describe(),proof=await ctx.CvatCacheVault.prepareUnlock(PASSWORD,state.header,'https://company.example',{crypto:webcrypto});
 a.lockAll();assert.equal(b.unlocked,false);await assert.rejects(b.readOrigins('cvat-track-origins:v1:1'));
 await assert.rejects(b.acceptUnlock(proof,state.header,state.lockToken));assert.ok(proof.rawKey.every(n=>n===0));
 const wrongOrigin=await ctx.CvatCacheVault.prepareUnlock(PASSWORD,null,'https://wrong.example',{crypto:webcrypto});
 const empty=fixture();await assert.rejects(empty.vault().acceptUnlock(wrongOrigin,null,null));assert.equal(empty.data.size,0);
});
test('lock during popup proof import cannot leave a usable key or initialize a new header',async()=>{
 const f=fixture(),v=f.vault(),proof=await ctx.CvatCacheVault.prepareUnlock(PASSWORD,null,'https://company.example',{crypto:webcrypto});
 const importing=v.acceptUnlock(proof,null,null);v.lockAll();await assert.rejects(importing);assert.equal(v.unlocked,false);assert.equal(f.storage.getItem(HEADER),null);
});

test('reset of an empty vault revokes a pending creation proof across tabs',async()=>{
 const f=fixture(),a=f.vault(),b=f.vault();
 const proof=await ctx.CvatCacheVault.prepareUnlock(PASSWORD,null,'https://company.example',{crypto:webcrypto});
 await a.reset();
 await assert.rejects(b.acceptUnlock(proof,null,null));
 assert.equal(b.unlocked,false);assert.equal(f.storage.getItem(HEADER),null);
 assert.ok(proof.rawKey.every(n=>n===0));
});
