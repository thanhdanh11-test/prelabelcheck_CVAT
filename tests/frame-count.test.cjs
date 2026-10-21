const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('cvat-resize-extension/content.js','utf8');
function setup() {
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('  function sizeOf'),source.indexOf('  // Where loading time'))+
    source.slice(source.indexOf('  const cropCovers ='),source.indexOf('  const nearCached ='))+`
    let jobId=97,crop=null;
    const plan={track:{clientID:1},flagged:new Set()},counted=new Map();
    const nearCached=()=>crop,loadState=new Map(),keyAt=()=>true,isFirstKey=()=>true;
    const classHtml=()=>'',ICON={eye:'',eyeOff:'',key:''};
    const points=[0,0,0,0,0,0,2,2,2];
  `+source.slice(source.indexOf('  function previewPointCount('),source.indexOf('  function setHead(')),ctx);
  return code=>vm.runInContext(code,ctx);
}
test('frame counts distinguish unavailable cloud, load error and a real zero',()=>{
  const run=setup();
  assert.match(run('headHtml(0,{points},"")'),/… điểm trong box/);
  run('loadState.set(0,new Error("download failed"))');
  assert.match(run('headHtml(0,{points},"")'),/— điểm trong box/);
  run('loadState.clear();crop={center:[0,0,0],half:20,xyz:new Float32Array()}');
  assert.match(run('headHtml(0,{points},"")'),/0 điểm trong box/);
});
test('count follows current geometry and Undo, reusing unchanged geometry counts',()=>{
  const run=setup();run('crop={center:[0,0,0],half:20,xyz:new Float32Array([0,0,0,.5,0,0,3,0,0])}');
  assert.equal(run('previewPointCount(0,points)'),2);
  run('const moved=points.slice();moved[0]=3');assert.equal(run('previewPointCount(0,moved)'),1);
  run('crop=null');assert.equal(run('previewPointCount(0,points)'),2);
  assert.equal(run('counted.size'),2);
});
test('partial crops cannot publish an undercount; cached counts are isolated by frame/job/item',()=>{
  const run=setup();run('crop={center:[0,0,0],half:.5,xyz:new Float32Array([0,0,0])}');
  assert.equal(run('previewPointCount(0,points)'),null);
  run('crop.half=20');assert.equal(run('previewPointCount(0,points)'),1);
  run('crop=null');assert.equal(run('previewPointCount(1,points)'),null);
  run('jobId=98');assert.equal(run('previewPointCount(0,points)'),null);
  run('jobId=97;plan.track.clientID=2');assert.equal(run('previewPointCount(0,points)'),null);
});
