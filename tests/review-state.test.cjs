const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('cvat-resize-extension/review-state.js','utf8'),ctx);
const create=ctx.CvatReviewState.create;
function disk(){const map=new Map();return {map,getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};}
test('saved IDs persist across reload and UI ID changes; jobs remain independent',()=>{
  const storage=disk(),a=create(storage),track={id:49,clientID:1};
  a.set(97,track,true);const b=create(storage);
  assert.equal(b.has(97,{id:49,clientID:88}),true);assert.equal(b.has(98,track),false);
  assert.equal(b.has(97,{id:50,clientID:1}),false);
  b.set(97,track,false);assert.equal(a.has(97,track),false);
});
test('unsaved IDs never persist or mark a saved track with the same number',()=>{
  const storage=disk(),a=create(storage),track={clientID:49};
  assert.equal(a.set(97,track,true).persistent,false);assert.equal(a.has(97,track),true);
  assert.equal(a.has(97,{id:49,clientID:49}),false);assert.equal(create(storage).has(97,track),false);
  assert.equal(storage.map.size,0);
});
test('sequential updates from two tabs merge without erasing unrelated reviews',()=>{
  const storage=disk(),a=create(storage),b=create(storage);
  a.set(97,{id:1},true);b.set(97,{id:2},true);a.set(97,{id:1},false);
  assert.equal(b.has(97,{id:1}),false);assert.equal(a.has(97,{id:2}),true);
});
test('blocked storage falls back to tab state and malformed data cannot create marks',()=>{
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}},a=create(blocked);
  assert.equal(a.set(97,{id:1},true).persistent,false);assert.equal(a.has(97,{id:1}),true);
  a.set(97,{id:1},false);assert.equal(a.has(97,{id:1}),false);
  const storage=disk(),b=create(storage);storage.setItem(b.key(97),'broken');assert.equal(b.has(97,{id:1}),false);
  storage.setItem(b.key(97),JSON.stringify({version:1,ids:['1',null,-1,2]}));
  assert.equal(b.has(97,{id:1}),false);assert.equal(b.has(97,{id:2}),true);
});
test('next unchecked uses actual track IDs, skips reviewed/unsupported entries and wraps',async()=>{
  const source=fs.readFileSync('cvat-resize-extension/content.js','utf8'),storage=disk();
  const c=vm.createContext({reviews:create(storage)});
  vm.runInContext(`
    const jobId=97,annotations={tracks:[{id:10,uiId:1,shapes:[{type:'cuboid'}]},{id:20,uiId:2,shapes:[{type:'cuboid'}]},{id:30,uiId:3,shapes:[{type:'polygon'}]},{id:40,uiId:4,shapes:[{type:'cuboid'}]}]};
    let selected=1;const selectedTrack=()=>annotations.tracks.find(t=>t.uiId===selected),switchTrack=async id=>selected=id;
  `+source.slice(source.indexOf('  async function nextUncheckedItem('),source.indexOf('  // A setting changed:')),c);
  vm.runInContext('reviews.set(97,annotations.tracks[1],true)',c);
  await vm.runInContext('nextUncheckedItem()',c);assert.equal(vm.runInContext('selected',c),4);
  await vm.runInContext('nextUncheckedItem()',c);assert.equal(vm.runInContext('selected',c),1);
});
