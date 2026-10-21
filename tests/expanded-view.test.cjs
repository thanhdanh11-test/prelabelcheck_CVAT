const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('cvat-resize-extension/content.js','utf8');
const geometry=source.slice(source.indexOf('  function sizeOf'),source.indexOf('  // Where loading time'));
const views=source.slice(source.indexOf('  const VIEWS ='),source.indexOf('  const CELL_PX'));
const math=source.slice(source.indexOf('  const mul ='),source.indexOf('  function rotateFrame('));
function keyboard(view=0) {
  const context=vm.createContext({});
  vm.runInContext(geometry+views+math+`
    const initial=[1,2,3,.2,.4,.6,4,2,1.5,0,0,0,0,0,0,0];
    const plan={shapes:[{frame:0,type:'cuboid',points:initial.slice(),outside:false},{frame:10,type:'cuboid',points:initial.slice(),outside:false}],manual:new Set(),flagged:new Set(),track:{}};
    let fitting=null,drag=null,zoomFrame=5,keyboardView=${view},nudgeKey=null;
    const undoStack=[],inputs=[{value:'4'},{value:'2'},{value:'1.5'}];
    const root={querySelectorAll:()=>inputs},$=()=>({checked:true}),anchor=()=> 'center';
    const stateAt=f=>positionAt(plan.shapes,f),keyAt=f=>plan.shapes.find(s=>s.frame===f);
    const endDrag=()=>{},modelChanged=()=>{},lidar={screenDelta:(x,y)=>[x,0,y]};
  `+source.slice(source.indexOf('  function ensureKey('),source.indexOf('  // Locked size:'))+
  source.slice(source.indexOf('  function setGeometry('),source.indexOf('  // Hides or shows only this frame'))+
  source.slice(source.indexOf('  function nudgeFrame('),source.indexOf('  editor.addEventListener("pointerdown", e =>')),context);
  return code=>vm.runInContext(code,context);
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('arrows move in each tilted cuboid view, preserving rotation, size and neighboring keys',()=>{
  for(let view=0;view<3;view++) for(const key of ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown']) {
    const run=keyboard(view);run(`nudgeFrame({key:'${key}'})`);
    const delta=run('mulT(boxFrame(initial).R,stateAt(5).points.slice(0,3).map((p,i)=>p-initial[i]))');
    const axis=run(`VIEWS[keyboardView].${key==='ArrowRight'||key==='ArrowLeft'?'a':'b'}`);
    delta.forEach((value,i)=>close(value,i===axis?(key==='ArrowLeft'||key==='ArrowDown'?-.05:.05):0));
    run('keyAt(5).points.slice(3).map((p,i)=>p-initial[i+3])').forEach(n=>close(n,0));
    assert.equal(run('JSON.stringify(keyAt(0).points)===JSON.stringify(initial)'),true);
    assert.equal(run('JSON.stringify(keyAt(10).points)===JSON.stringify(initial)'),true);
    assert.equal(run('plan.manual.has(5)'),true);
  }
});
test('Shift is 1 cm, Alt is 20 cm, PageUp uses world Z and 3D arrows use camera plane',()=>{
  for(const [key,mod,expected] of [['PageUp','shiftKey',[0,0,.01]],['PageDown','altKey',[0,0,-.2]],['ArrowUp','shiftKey',[0,0,.01]],['ArrowRight','altKey',[.2,0,0]]]) {
    const run=keyboard(3);run(`nudgeFrame({key:'${key}',${mod}:true})`);
    run('stateAt(5).points.slice(0,3).map((p,i)=>p-initial[i])').forEach((n,i)=>close(n,expected[i]));
  }
});
test('held arrow is one Undo; separate presses are distinct; fitting and drag block nudges',()=>{
  const run=keyboard();run("nudgeFrame({key:'ArrowRight'}); nudgeFrame({key:'ArrowRight',repeat:true}); nudgeFrame({key:'ArrowRight',repeat:true})");
  assert.equal(run('undoStack.length'),1);run('undo()');assert.equal(run('keyAt(5)'),undefined);
  run("nudgeFrame({key:'ArrowRight'}); nudgeFrame({key:'ArrowRight'})");assert.equal(run('undoStack.length'),2);
  run("fitting={}; nudgeFrame({key:'ArrowRight'})");assert.equal(run('undoStack.length'),2);
  run("fitting=null; drag={}; nudgeFrame({key:'ArrowRight'})");assert.equal(run('undoStack.length'),2);
});
test('camera basis stays orthonormal through orbit angles',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('cvat-resize-extension/lidar-view.js','utf8'),context);
  for(const yaw of [-4,-1,0,2,8]) for(const pitch of [-1.5,-.5,0,.5,1.5]) {
    const b=Object.values(context.CvatLidarView.basis(yaw,pitch));
    b.forEach((a,i)=>b.forEach((c,j)=>close(a.reduce((s,n,k)=>s+n*c[k],0),i===j?1:0)));
  }
});
test('late 3D cloud cannot overwrite a newer frame or reopen a closed preview',async()=>{
  const context=vm.createContext({});
  vm.runInContext(`
    let lidarRequest=0,zoomFrame=1,lidar=null,lidarCamera=null,plan={track:{uiId:7}};
    const pending={},clouds=[],messages={textContent:''};
    const $=selector=>selector==='.lidar-message'?messages:{checked:true};
    const stateAt=()=>({points:[1,2,3],outside:false}),boxFrame=p=>p;
    const loadCloud=f=>new Promise(resolve=>pending[f]=resolve);
    globalThis.CvatLidarView={create:()=>({clear(){},getCamera(){return null;},setBox(){},restoreCamera(){},resize(){},setCloud(x){clouds.push(x)}})};
  `+source.slice(source.indexOf('  async function loadLidar('),source.indexOf('  function selectKeyboardView(')),context);
  const run=code=>vm.runInContext(code,context);
  const first=run('loadLidar(1)');run('zoomFrame=2');const second=run('loadLidar(2)');
  run('pending[2]([1,2,3])');await second;run('pending[1]([4,5,6])');await first;
  assert.equal(run('clouds.length'),1);assert.equal(run('clouds[0][0]'),1);
  run('zoomFrame=3');const third=run('loadLidar(3)');run('lidarRequest++;zoomFrame=null;pending[3]([7,8,9])');await third;
  assert.equal(run('clouds.length'),1);
});
