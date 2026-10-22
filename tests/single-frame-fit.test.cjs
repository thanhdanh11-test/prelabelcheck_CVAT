const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cvat-resize-extension/content.js', 'utf8');
const section = (a,b) => source.slice(source.indexOf(a), source.indexOf(b));
const geometry = section('  function sizeOf', '  // Where loading time');
const math = section('  const FIT =', '  function renderFrameFit(');
const ctx = vm.createContext({});
vm.runInContext(geometry + math, ctx);
const fit = (...args) => ctx.fitCurrentPoints(...args);
const original = [0,0,1,0,0,0,4,2,2,99];
function cloud(dx=.15, dy=.1, yaw=0) {
  const out=[];
  for(let i=0;i<60;i++) for(let j=0;j<5;j++) {
    const z=.4+j*.3;
    for(const [x,y] of [[-2,-1+i/30],[2,-1+i/30],[-2+i/15,-1],[-2+i/15,1]])
      out.push(dx+Math.cos(yaw)*x-Math.sin(yaw)*y,dy+Math.sin(yaw)*x+Math.cos(yaw)*y,z);
  }
  return out;
}
test('single-frame fit corrects a known translation without changing height, angles, size or tail',()=>{
  const p=original.slice(), q=cloud(), before=q.slice(), r=fit(q,p);
  assert.ok(r.changed); assert.ok(Math.abs(r.points[0]-.15)<.02); assert.ok(Math.abs(r.points[1]-.1)<.02);
  assert.deepEqual(Array.from(r.points.slice(2)),p.slice(2));
  assert.deepEqual(p,original); assert.deepEqual(q,before);
});
test('optional yaw stays within 15 degrees and center within 50 cm',()=>{
  const r=fit(cloud(.1,.05,Math.PI/18),original,true);
  assert.ok(r.changed); assert.ok(Math.abs(r.angle)<=15+1e-8); assert.ok(r.distance<=.5);
  assert.ok(Math.abs(r.angle-10)<1);
  assert.deepEqual(Array.from(r.points.slice(6)),original.slice(6));
});
test('far clutter does not influence the proposal; sparse and tilted boxes are rejected',()=>{
  const q=cloud(), a=fit(q,original), b=fit(q.concat(Array(300).fill(100)),original);
  assert.deepEqual(a.points,b.points);
  assert.throws(()=>fit([],original),/ít nhất 30/);
  const tilted=original.slice();tilted[3]=.02;
  assert.throws(()=>fit(q,tilted),/thẳng đứng/);
  assert.throws(()=>fit(q,[]),/không hợp lệ/);
});
function harness() {
  let release;
  const pending=new Promise(resolve=>release=resolve);
  const context=vm.createContext({pending});
  vm.runInContext(geometry+`
    let fitting=null,saving=false,zoomFrame=5,frameFit=null,frameFitEpoch=0;
    let plan={track:{id:1,label_id:2,attributes:[]},shapes:[
      {frame:0,type:'cuboid',points:[0,0,1,0,0,0,4,2,2],outside:false,attributes:[{spec_id:1,value:'a'}]},
      {frame:10,type:'cuboid',points:[10,0,1,0,0,.2,4,2,2],outside:false,attributes:[{spec_id:1,value:'b'}]}
    ],manual:new Set(),flagged:new Set([5])};
    const controls={},$=s=>controls[s]||(controls[s]={checked:false}),root={querySelectorAll:()=>[]},editor={focus:()=>{}};
    const job={stop_frame:10},undoStack=[],stateAt=f=>positionAt(plan.shapes,f),keyAt=f=>plan.shapes.find(s=>s.frame===f);
    const scheduleDraw=()=>{},endDrag=()=>{},modelChanged=()=>cancelFrameFit(),nearCloud=()=>pending;
    const anchor=()=>'bottom';
    let fitCurrentPoints=(q,p)=>({points:p.map((v,i)=>i===0?v+.2:v),distance:.2,angle:0,beforeCount:100,afterCount:100,changed:true});
  `+section('  function ensureKey(', '  // Locked size:')+
    section('  function setGeometry(', '  // Hides or shows only this frame')+
    section('  function renderFrameFit(', '  async function fitFrame('),context);
  return {context,release,run:code=>vm.runInContext(code,context)};
}
test('proposal and cancellation do not mutate draft; acceptance changes only one frame and one Undo restores all keys',async()=>{
  const h=harness(); const before=h.run('JSON.stringify(plan.shapes)');
  const states=JSON.parse(h.run('JSON.stringify(Array.from({length:11},(_,f)=>stateAt(f)))'));
  const wait=h.run('proposeFrameFit()');h.release([]);await wait;
  assert.equal(h.run('JSON.stringify(plan.shapes)'),before);assert.equal(h.run('undoStack.length'),0);
  h.run('cancelFrameFit()');assert.equal(h.run('JSON.stringify(plan.shapes)'),before);
  await h.run('proposeFrameFit()');h.run('acceptFrameFit()');
  assert.equal(h.run('undoStack.length'),1);assert.equal(h.run('frameFit'),null);
  for(let f=0;f<=10;f++) if(f!==5) assert.deepEqual(JSON.parse(h.run(`JSON.stringify(stateAt(${f}))`)),states[f]);
  assert.equal(h.run('stateAt(5).points[0]'),5.2);
  h.run('undo()');assert.equal(h.run('JSON.stringify(plan.shapes)'),before);
});
test('cancel or navigation discards pending result; stale draft cannot accept old proposal',async()=>{
  for(const change of ['cancelFrameFit()', 'zoomFrame=6;cancelFrameFit()', 'plan={...plan};cancelFrameFit()']) {
    const h=harness(), wait=h.run('proposeFrameFit()');h.run(change);h.release([]);await wait;
    assert.equal(h.run('frameFit'),null);assert.equal(h.run('undoStack.length'),0);
  }
  const h=harness(), wait=h.run('proposeFrameFit()');h.release([]);await wait;
  h.run('plan.shapes[0].points[0]=.5;acceptFrameFit()');
  assert.equal(h.run('undoStack.length'),0);assert.equal(h.run('frameFit'),null);
});
test('outside frame never requests a proposal',async()=>{
  const h=harness();h.run('plan.shapes[0].outside=true');await h.run('proposeFrameFit()');
  assert.equal(h.run('frameFit'),null);assert.match(h.run('controls[".frame-fit-msg"].textContent'),/outside/);
});
test('first and last frame edits stay inside job bounds and preserve every other frame',async()=>{
  for(const frame of [0,10]) {
    const h=harness();h.run(`zoomFrame=${frame}`);
    const before=JSON.parse(h.run('JSON.stringify(Array.from({length:11},(_,f)=>stateAt(f)))'));
    const wait=h.run('proposeFrameFit()');h.release([]);await wait;h.run('acceptFrameFit()');
    for(let f=0;f<=10;f++) if(f!==frame) assert.deepEqual(JSON.parse(h.run(`JSON.stringify(stateAt(${f}))`)),before[f]);
    assert.equal(h.run('plan.shapes.every(s=>s.frame>=0&&s.frame<=10)'),true);
    assert.equal(h.run('undoStack.length'),1);
  }
});
test('draft edited while cloud loads discards result without an Undo entry',async()=>{
  const h=harness(), wait=h.run('proposeFrameFit()');
  h.run('plan.shapes[0].points[0]=.1');h.release([]);await wait;
  assert.equal(h.run('frameFit'),null);assert.equal(h.run('undoStack.length'),0);
});
function carOnRoad(road=.1, roof=1.75) {
  const out=cloud();
  for(let x=-3;x<=3.001;x+=.1) for(let y=-2;y<=2.001;y+=.1) {
    if(Math.abs(x)<2.3&&Math.abs(y)<1.3) continue;
    out.push(.15+x,.1+y,road);
  }
  for(let x=-1.8;x<=1.8;x+=.1) for(let y=-.8;y<=.8;y+=.1) out.push(.15+x,.1+y,roof);
  return out;
}
test('six-face fit puts the floor on the road, the top on the roof and keeps matching ends and sides',()=>{
  const r=fit(carOnRoad(),original,false,true);
  assert.ok(r.changed);
  const floor=r.points[2]-r.points[8]/2, top=r.points[2]+r.points[8]/2;
  assert.ok(Math.abs(floor-.1)<.02,`floor ${floor}`); assert.ok(Math.abs(top-1.75)<.02,`top ${top}`);
  assert.ok(Math.abs(r.floorShift-.1)<.02); assert.ok(Math.abs(r.sizeChange[2]+.35)<.03);
  assert.ok(Math.abs(r.points[0]-.15)<.02); assert.deepEqual(Array.from(r.points.slice(3,6)),original.slice(3,6));
  assert.ok(Math.abs(r.points[6]-4)<.03,`L ${r.points[6]}`); assert.ok(Math.abs(r.points[7]-2)<.03,`W ${r.points[7]}`);
});
test('ground/roof fit keeps floor and height when the road or roof is out of range or missing',()=>{
  const far=fit(carOnRoad(-.9,1.75),original,false,true);
  assert.ok(Math.abs(far.points[2]-far.points[8]/2)<1e-9); assert.ok(far.notes.some(n=>/mặt đường/.test(n)));
  const noRoad=fit(cloud(),original,false,true);
  assert.ok(Math.abs(noRoad.points[2]-noRoad.points[8]/2)<1e-9); assert.ok(Math.abs(noRoad.points[8]-1.6)<.02); assert.ok(noRoad.notes.some(n=>/mặt đường/.test(n)));
  const tall=fit(carOnRoad(.1,2.75),original,false,true);
  assert.ok(Math.abs(tall.points[8]-original[8])<1e-9); assert.ok(tall.notes.some(n=>/nóc/.test(n)));
});
test('a fit proposed from a small view (no expanded frame) can be accepted; a height change follows the size lock',async()=>{
  const h=harness();
  h.run('zoomFrame=null;controls[".lock"]={checked:true};fitCurrentPoints=(q,p)=>({points:p.map((v,i)=>i===2?v-.1:i===8?v-.2:v),distance:0,angle:0,floorShift:0,sizeChange:[0,0,-.2],notes:[],beforeCount:90,afterCount:95,changed:true})');
  const wait=h.run('proposeFrameFit(5)');h.release([]);await wait;
  assert.equal(h.run('frameFit.f'),5);
  h.run('acceptFrameFit()');
  assert.equal(h.run('undoStack.length'),1);
  assert.ok(Math.abs(h.run('stateAt(5).points[8]')-1.8)<1e-9);
  assert.equal(h.run('plan.shapes.every(s=>Math.abs(s.points[8]-1.8)<1e-9)'),true);
  h.run('undo()');assert.equal(h.run('plan.shapes.every(s=>s.points[8]===2)'),true);
});

// Only the faces the LiDAR sees: one end (x=+2) and one side (y=-1) of a 4 x 2 object at the origin.
function lShape(extra=[]) {
  const out=[];
  for(let i=0;i<=40;i++) for(let j=0;j<5;j++) { const z=.4+j*.3; out.push(2,-1+i/20,z, -2+i/10,-1,z); }
  for(let x=-3;x<=3.001;x+=.1) for(let y=-2;y<=2.001;y+=.1) if(Math.abs(x)>=2.4||Math.abs(y)>=1.4) out.push(x,y,0);
  return out.concat(extra);
}
test('six-face fit puts seen faces on the points, keeps the size when the opposite face is unseen',()=>{
  // box 4.6 x 2.4, 30 cm too long and 20 cm too wide on each face
  const box=[0,0,1,0,0,0,4.6,2.4,2], r=fit(lShape(),box,false,true);
  const F=p=>({x0:p[0]-p[6]/2,x1:p[0]+p[6]/2,y0:p[1]-p[7]/2,y1:p[1]+p[7]/2});
  const a=F(r.points);
  assert.ok(Math.abs(a.x1-2)<.03,`front ${a.x1}`); assert.ok(Math.abs(a.y0+1)<.03,`side ${a.y0}`);
  // only one end and one side are seen: the length and width cannot be measured, so they stay
  assert.ok(Math.abs(a.x0+2.6)<.03,`unseen back ${a.x0}`); assert.ok(Math.abs(a.y1-1.4)<.03,`unseen side ${a.y1}`);
  assert.ok(Math.abs(r.sizeChange[0])<.03 && Math.abs(r.sizeChange[1])<.03);
  // with both ends and both sides seen, the size follows the object
  const both=fit(carOnRoad(),[.15,.1,1,0,0,0,4.6,2.4,2],false,true);
  assert.ok(Math.abs(both.points[6]-4)<.05,`L ${both.points[6]}`); assert.ok(Math.abs(both.points[7]-2)<.05,`W ${both.points[7]}`);
});
test('six-face fit grows to connected points but not across a gap to a neighbor; faces move at most 50 cm',()=>{
  const short=[-.2,0,1,0,0,0,3.6,2,2], grown=fit(lShape(),short,false,true);
  assert.ok(Math.abs(grown.points[0]+grown.points[6]/2-2)<.03,`front ${grown.points[0]+grown.points[6]/2}`);
  const neighbor=[]; for(let y=-1;y<=1;y+=.05) for(const z of [.4,.7,1,1.3]) neighbor.push(2.45,y,z);
  const r=fit(lShape(neighbor),[0,0,1,0,0,0,4,2,2],false,true);
  assert.ok(r.points[0]+r.points[6]/2<2.05,`front ${r.points[0]+r.points[6]/2}`);
  const far=fit(lShape(),[1,0,1,0,0,0,2,2,2],false,true);
  assert.ok(far.points[6]-2<=.5+1e-9);
});
