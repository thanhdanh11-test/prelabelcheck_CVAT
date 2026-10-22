const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('cvat-resize-extension/content.js','utf8');
const cut=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
const ctx=vm.createContext({});
vm.runInContext(cut('  function sizeOf','  // Where loading time')+cut('  const VIEWS =','  const CELL_PX')+cut('  const mul =','  const matMul =')+cut('  const FIT = {','  let fitting = null;')+
  cut('  const poseOf =','  const cellKey =')+cut('  function forObjectPoints(','  // Points on the template minus')+cut('  function contain(','  // n: object points of the whole frame')+
  cut('  function essentialKeys(','  function clearKeys(')+cut('  function regionShift(','  function moveToRegion('),ctx);
const run=code=>vm.runInContext(code,ctx);
const key=(frame,x,y,yaw=0,extra={})=>({frame,type:'cuboid',outside:false,attributes:[],points:[x,y,1,0,0,yaw,4,2,1.6],...extra});

test('removing spare keyframes keeps every frame where it was',()=>{
  // straight constant-speed run (spare keys), a turn, a hidden stretch and an attribute change
  const shapes=[key(0,0,0),key(5,5,0),key(10,10,0),key(15,15,0),key(20,15,5,Math.PI/2),key(25,15,10,Math.PI/2),
    key(30,15,15,Math.PI/2,{outside:true}),key(35,15,20,Math.PI/2),key(40,15,25,Math.PI/2,{attributes:[{spec_id:1,value:'x'}]}),key(45,15,30,Math.PI/2)];
  ctx.shapes=shapes;
  const kept=run('essentialKeys(shapes).map(s=>s.frame)');
  assert.ok(kept.length<shapes.length,`kept ${kept}`);
  for(const f of [0,15,20,30,35,40,45]) assert.ok(kept.includes(f),`frame ${f} must stay: ${kept}`);
  assert.ok(!kept.includes(5)&&!kept.includes(10),`spare straight keys: ${kept}`);
  ctx.kept=run('essentialKeys(shapes)');
  for(let f=0;f<=45;f++) {
    const a=run(`positionAt(shapes,${f})`),b=run(`positionAt(kept,${f})`);
    assert.equal(b.outside,a.outside,`outside at ${f}`);
    for(let j=0;j<9;j++) assert.ok(Math.abs(a.points[j]-b.points[j])<=(j>=3&&j<=5?Math.PI/180:.05)+1e-9,`frame ${f} value ${j}: ${a.points[j]} vs ${b.points[j]}`);
  }
});
test('a keyframe that bends the path is never dropped, even when it is the only one between the ends',()=>{
  ctx.shapes=[key(0,0,0),key(10,10,3),key(20,20,0)];
  assert.deepEqual(run('essentialKeys(shapes).map(s=>s.frame)'),[0,10,20]);
  ctx.shapes=[key(0,0,0),key(10,10,0.01),key(20,20,0)];
  assert.deepEqual(run('essentialKeys(shapes).map(s=>s.frame)'),[0,20]);
});

function cloudWithCar(cx,cy) {
  const out=[];
  for(let x=-10;x<=10;x+=.25) for(let y=-10;y<=10;y+=.25) out.push(x,y,.2); // road (box floor is at .2)
  for(let i=0;i<=40;i++) for(const z of [.6,1,1.4]) out.push(cx-2+i/10,cy-1,z,cx-2+i/10,cy+1,z,cx-2,cy-1+i/20,z,cx+2,cy-1+i/20,z);
  return out;
}
test('a region drawn in Top sends the box to the middle of the object points there, keeping height, yaw and size',()=>{
  ctx.xyz=cloudWithCar(5,3); ctx.p=[0,0,1,0,0,0,4,2,1.6];
  const r=run('regionShift(xyz,p,VIEWS[0],2.5,7.5,1.5,4.5)');
  assert.ok(Math.abs(r.shift[0]-5)<.05&&Math.abs(r.shift[1]-3)<.05,JSON.stringify(r));
  assert.equal(r.shift[2],0); assert.ok(r.n>100);
});
test('Side moves only along the box length; a region without object points uses its own middle',()=>{
  ctx.xyz=cloudWithCar(5,0); ctx.p=[0,0,1,0,0,0,4,2,1.6];
  const side=run('regionShift(xyz,p,VIEWS[1],2.5,7.5,-1,1)');
  assert.ok(Math.abs(side.shift[0]-5)<.05); assert.equal(side.shift[1],0); assert.equal(side.shift[2],0);
  const empty=run('regionShift(xyz,p,VIEWS[0],-9,-7,-9,-7)');
  assert.deepEqual(Array.from(empty.shift),[-8,-8,0]); assert.equal(empty.n,0);
});

test('a box longer than the visible part rests on the seen front face, not on the middle of the points',()=>{
  // only the front (x=7) and one side (y=2) of a 4 x 2 car whose middle is (5, 3); the back half is hidden
  const out=[];
  for(let x=-10;x<=10;x+=.25) for(let y=-10;y<=10;y+=.25) out.push(x,y,.2);
  for(let i=0;i<=20;i++) for(const z of [.6,1,1.4]) out.push(5+i/10,2,z, 7,2+i/10,z);
  ctx.xyz=out; ctx.p=[0,0,1,0,0,0,4,2,1.6];
  const r=run('regionShift(xyz,p,VIEWS[0],2.5,7.5,1.5,4.5)');
  assert.ok(Math.abs(r.shift[0]-5)<.05&&Math.abs(r.shift[1]-3)<.05,JSON.stringify(r)); // middle of the points would be (6, 3)
});
