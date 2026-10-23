// Bounded adversarial probes on synthetic records only. No network or real user storage.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const ctx=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Float32Array,btoa,atob});
vm.runInContext(fs.readFileSync('cvat-resize-extension/cache-vault.js','utf8'),ctx);
const data=new Map();let tail=Promise.resolve();
const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i],get length(){return data.size;}};
const locks={request:(_,fn)=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
const make=()=>ctx.CvatCacheVault.create({storage,locks,crypto:webcrypto,origin:'https://synthetic.invalid'});
(async()=>{
 const results=[],name='cvat-track-origins:v1:1',slot='cvat-encrypted-origins:v1:1';
 const a=make();await a.unlock('audit strong dummy password');await a.writeOrigins(name,'synthetic revision 1');
 const old=data.get(slot);await a.writeOrigins(name,'synthetic revision 2');const current=data.get(slot);
 const cold=make();await assert.rejects(cold.readOrigins(name));results.push({probe:'locked read without password',blocked:true});
 await assert.rejects(cold.unlock('incorrect dummy password'));results.push({probe:'wrong password',blocked:true});
 const changed=JSON.parse(current);changed.data=(changed.data[0]==='A'?'B':'A')+changed.data.slice(1);data.set(slot,JSON.stringify(changed));
 await assert.rejects(a.readOrigins(name));results.push({probe:'ciphertext tamper',blocked:true});data.set(slot,current);
 data.set('cvat-encrypted-origins:v1:2',current);await assert.rejects(a.readOrigins('cvat-track-origins:v1:2'));results.push({probe:'cross-record substitution',blocked:true});
 data.set(slot,old);assert.equal(await a.readOrigins(name),'synthetic revision 1');results.push({probe:'authenticated stale-record replay',accepted:true,impact:'integrity, not plaintext disclosure'});
 const b=make();await b.unlock('audit strong dummy password');a.lock();assert.equal(await b.readOrigins(name),'synthetic revision 1');results.push({probe:'lock first instance',secondInstanceDecrypts:true});
 // Demonstrate only a known weak test password, bounded to three guesses; no real credentials.
 data.clear();const weak=make();await weak.unlock('123456789012');await weak.writeOrigins(name,'synthetic canary');weak.lock();
 const copy=JSON.parse(data.get('cvat-cache-vault:v1'));let recovered=false,attempts=0;
 for(const candidate of ['wrongpassword1','wrongpassword2','123456789012']){
  attempts++;
  const material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(candidate),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:new Uint8Array(copy.salt),iterations:copy.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
  try{
   const plaintext=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(copy.verifier.iv),tagLength:128,additionalData:new TextEncoder().encode(JSON.stringify(['cvat-cache',1,'https://synthetic.invalid',copy.id,'verifier']))},key,Uint8Array.from(atob(copy.verifier.data),c=>c.charCodeAt(0)));
   recovered=new TextDecoder().decode(plaintext)==='CVAT cache vault v1';if(recovered)break;
  }catch{}
 }
 assert.equal(recovered,true);results.push({probe:'offline guesses against deliberately weak synthetic password',attempts,recovered,impact:'weak-password limit; not a general password crack'});
 console.log(JSON.stringify({syntheticOnly:true,networkRequests:0,probes:results.length,results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
