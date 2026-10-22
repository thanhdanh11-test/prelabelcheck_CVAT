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
    let fitting=null,drag=null,zoomFrame=5,activeFrame=5,keyboardView=${view},nudgeKey=null;
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
test('expanded Top/Side/Front zoom in/out keeps the pointed spot, pans freely and widens the needed crop',()=>{
  const context=vm.createContext({});
  vm.runInContext(geometry+views+`
    let orthoZoom=VIEWS.map(()=>({k:1,u:0,w:0})),draws=0,zoomFrame=5;const scheduleDraw=()=>draws++;
    const viewReach=(p)=>Math.max(...VIEWS.map((v)=>viewRange(p,v)))*Math.SQRT2;
    const viewRange=(p,v)=>Math.max(p[6+v.a],p[6+v.b])/2*1.35+.5;
  `+source.slice(source.indexOf('  function viewWindow('),source.indexOf('  // The keyframe at a frame'))+
    source.slice(source.indexOf('  function pointerLocal('),source.indexOf('  function hitTest('))+
    source.slice(source.indexOf('  function setOrthoWindow('),source.indexOf('  // Wheel zooms')),context);
  const run=code=>vm.runInContext(code,context);
  run(`var p=[0,0,0,0,0,0,4,2,1.5],cv={width:800,height:800,getBoundingClientRect:()=>({left:0,top:0,width:800,height:800})}`);
  const base=run('viewRange(p,VIEWS[0])');
  assert.deepEqual(JSON.parse(run('JSON.stringify(viewWindow(p,0,true))')),{range:base,cu:0,cw:0});
  // zoom in to half about a pixel: the same world spot stays under it
  const before=JSON.parse(run('JSON.stringify(pointerLocal(cv,{clientX:600,clientY:300},viewWindow(p,0,true)))'));
  run(`{const w=viewWindow(p,0,true),[u,v]=pointerLocal(cv,{clientX:600,clientY:300},w),k=.5,r=viewRange(p,VIEWS[0])*k;
        setOrthoWindow(0,p,k,u-(u-w.cu)/w.range*r,v-(v-w.cw)/w.range*r);}`);
  const after=JSON.parse(run('JSON.stringify(pointerLocal(cv,{clientX:600,clientY:300},viewWindow(p,0,true)))'));
  close(after[0],before[0]);close(after[1],before[1]);
  assert.equal(run('viewWindow(p,0,true).range'),base/2);
  assert.deepEqual(JSON.parse(run('JSON.stringify(viewWindow(p,0,false))')),{range:base,cu:0,cw:0});
  // Pan is independent of zoom, including the default scale.
  run('setOrthoWindow(0,p,.5,100,-100)');
  const w=JSON.parse(run('JSON.stringify(viewWindow(p,0,true))'));
  close(w.cu,100);close(w.cw,-100);
  run('setOrthoWindow(0,p,1,5,5)');
  assert.deepEqual(JSON.parse(run('JSON.stringify(viewWindow(p,0,true))')),{range:base,cu:5,cw:5});
  // zoom out to 30x: the spot under the pointer stays even well beyond the old 3x cap
  const o0=JSON.parse(run('JSON.stringify(pointerLocal(cv,{clientX:200,clientY:650},viewWindow(p,0,true)))'));
  run(`{const w=viewWindow(p,0,true),[u,v]=pointerLocal(cv,{clientX:200,clientY:650},w),k=30,r=viewRange(p,VIEWS[0])*k;
        setOrthoWindow(0,p,k,u-(u-w.cu)/w.range*r,v-(v-w.cw)/w.range*r);}`);
  const o1=JSON.parse(run('JSON.stringify(pointerLocal(cv,{clientX:200,clientY:650},viewWindow(p,0,true)))'));
  close(o1[0],o0[0]);close(o1[1],o0[1]);
  assert.equal(run('viewWindow(p,0,true).range'),base*30);
  run('setOrthoWindow(0,p,3,100,0)');close(run('viewWindow(p,0,true).cu'),100);
  // the expanded frame asks for a crop that covers the zoomed-out window; other frames keep the default
  const reach=run('frameReach(5,p)'), zw=JSON.parse(run('JSON.stringify(viewWindow(p,0,true))'));
  assert.ok(reach>=(zw.range+Math.hypot(zw.cu,zw.cw))*Math.SQRT2-1e-9);
  assert.equal(run('frameReach(4,p)'),run('viewReach(p)'));
});

test('collapsed frame arrows edit the selected frame and share the existing Undo behavior',()=>{
  const run=keyboard(1);
  run("zoomFrame=null; nudgeFrame({key:'ArrowUp'})");
  assert.equal(run('undoStack.length'),1);
  assert.equal(run('plan.manual.has(5)'),true);
  run('undo()'); assert.equal(run('keyAt(5)'),undefined);
  run("activeFrame=null; nudgeFrame({key:'ArrowRight'})");
  assert.equal(run('undoStack.length'),0);
});
test('comma and period route rotation to selected frame/view, ignore typing and modified keys',()=>{
  let handler;
  const calls=[];
  const ctx=vm.createContext({root:{addEventListener:(type,fn)=>handler=fn},calls});
  vm.runInContext(`let plan={},editor={hidden:false},zoomFrame=null,activeFrame=7,keyboardView=1,nudgeKey=null,fitting=null,drag=null,frameFit=null;
    const VIEWS=['top','side','front']; const rotateFrame=(...args)=>calls.push(args);
  `+source.slice(source.indexOf('  root.addEventListener("keydown", (e) => {',source.indexOf('// Keys reach')),source.indexOf('  root.addEventListener("keyup",')),ctx);
  const event=(key,extra={})=>({key,target:{closest:()=>false},preventDefault(){},...extra});
  handler(event(',')); handler(event('.')); handler(event('>',{shiftKey:true}));
  assert.deepEqual(calls.map(c=>Array.from(c)),[[7,'side',-1],[7,'side',1],[7,'side',15]]);
  handler(event('.',{ctrlKey:true}));handler(event('.',{target:{closest:()=>true}}));
  vm.runInContext('fitting={}',ctx);handler(event('.'));
  assert.equal(calls.length,3);
  vm.runInContext('fitting=null;zoomFrame=8;keyboardView=3',ctx);handler(event('.'));
  assert.deepEqual(Array.from(calls[3]),[8,'top',1]);
});

test('expanded fit confirmation appears during a proposal and hides after it is cleared',()=>{
  const controls={};
  const ctx=vm.createContext({controls});
  vm.runInContext(`const $=s=>controls[s]||(controls[s]={});let frameFit=null,frameFitNote=null,zoomFrame=5,fitting=null,plan={};
    const stateAt=()=>({outside:false}),scheduleDraw=()=>{},frameFitSummary=()=> 'result';
  `+source.slice(source.indexOf('  function renderFrameFit('),source.indexOf('  function cancelFrameFit(')),ctx);
  const run=code=>vm.runInContext(code,ctx);
  run('renderFrameFit()');assert.equal(controls['.fit-confirm'].hidden,true);
  run('frameFit={f:5,pending:true};renderFrameFit()');
  assert.equal(controls['.fit-confirm'].hidden,false);assert.equal(controls['.fit-accept'].disabled,true);
  run('frameFit={f:5,pending:false};renderFrameFit()');
  assert.equal(controls['.fit-confirm'].hidden,false);assert.equal(controls['.fit-accept'].disabled,false);
  run('frameFit=null;renderFrameFit()');assert.equal(controls['.fit-confirm'].hidden,true);
});

test('wheel zoom goes past 3x in every expanded view and keeps the pointer anchored',()=>{
  for(let i=0;i<3;i++) {
    const handlers={};
    const ctx=vm.createContext({editor:{addEventListener:(type,fn)=>handlers[type]=fn}});
    vm.runInContext(geometry+views+`
      const p=[0,0,0,0,0,0,4,2,1.5],plan={},stateAt=()=>({points:p}),scheduleDraw=()=>{};
      let zoomFrame=5,drag=null,regionDrag=null,orthoZoom=VIEWS.map(()=>({k:1,u:0,w:0}));
      const cv={dataset:{v:${i}},width:800,height:800,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0,width:800,height:800})};
    `+source.slice(source.indexOf('  const viewRange ='),source.indexOf('  // The keyframe at a frame'))+
      source.slice(source.indexOf('  function pointerLocal('),source.indexOf('  function hitTest('))+
      source.slice(source.indexOf('  function setOrthoWindow('),source.indexOf('  // Where the box should go')),ctx);
    const run=code=>vm.runInContext(code,ctx),cv=run('cv');
    run(`setOrthoWindow(${i},p,1,100,-80)`);
    const before=run(`pointerLocal(cv,{clientX:600,clientY:200},viewWindow(p,${i},true))`);
    for(let step=0;step<8;step++)handlers.wheel({target:{closest:()=>cv},clientX:600,clientY:200,deltaY:500,deltaMode:0,preventDefault(){}});
    assert.ok(run(`orthoZoom[${i}].k`)>100, run(`JSON.stringify(orthoZoom[${i}])`));
    const after=run(`pointerLocal(cv,{clientX:600,clientY:200},viewWindow(p,${i},true))`);
    before.forEach((n,j)=>close(n,after[j]));
    const saved=run(`JSON.stringify(orthoZoom[${i}])`);
    run(`setOrthoWindow(${i},p,Infinity,0,0);setOrthoWindow(${i},p,1,NaN,0)`);
    assert.equal(run(`JSON.stringify(orthoZoom[${i}])`),saved);
    run(`setOrthoWindow(${i},p,1,0,0)`);
    assert.deepEqual(JSON.parse(run(`JSON.stringify(orthoZoom[${i}])`)),{k:1,u:0,w:0});
    assert.deepEqual(Array.from(run('p')),[0,0,0,0,0,0,4,2,1.5]);
  }
});
