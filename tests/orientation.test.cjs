const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source=fs.readFileSync('cvat-resize-extension/content.js','utf8');
const geometry=source.slice(source.indexOf('  function sizeOf'),source.indexOf('  // Where loading time'));
const views=source.slice(source.indexOf('  const VIEWS ='),source.indexOf('  const CELL_PX'));
const rotation=source.slice(source.indexOf('  const mul ='),source.indexOf('  function rotateFrame('));
const context=vm.createContext({});
vm.runInContext(geometry+views+rotation+'\nthis.lib={boxFrame,rotatedInView,orientationInView,matMul,VIEWS};',context);
const {boxFrame,rotatedInView,orientationInView,matMul,VIEWS}=context.lib;
const points=[5,6,7,0,0,0,4,2,3,0,0,0,0,0,0,0];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const sameMatrix=(a,b)=>a.forEach((row,i)=>row.forEach((value,j)=>close(value,b[i][j])));

test('each view rotates in its displayed plane: Top Z, Side -Y, Front X',()=>{
  const expected=[[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,-1],[0,1,0],[1,0,0]],[[1,0,0],[0,0,-1],[0,1,0]]];
  VIEWS.forEach((v,i)=>sameMatrix(boxFrame(rotatedInView(points,v,Math.PI/2)).R,expected[i]));
});
test('rotations compose in cuboid local coordinates even for tilted boxes',()=>{
  for(const angles of [[.3,-.7,1.1],[Math.PI/2,0,Math.PI/2],[0,Math.PI/2,0],[0,-Math.PI/2,0]]) {
    const p=points.slice();p.splice(3,3,...angles);
    for(const v of VIEWS) {
      const delta=boxFrame(rotatedInView(points,v,.37)).R;
      sameMatrix(boxFrame(rotatedInView(p,v,.37)).R,matMul(boxFrame(p).R,delta));
    }
  }
});
test('rotation preserves center, size, extra CVAT coordinates and original input',()=>{
  for(const v of VIEWS) {
    const original=points.slice(),result=rotatedInView(original,v,.42);
    assert.deepEqual(Array.from(result.slice(0,3)),points.slice(0,3));
    assert.deepEqual(Array.from(result.slice(6)),points.slice(6));
    assert.deepEqual(original,points);
  }
});
test('180-degree flip twice restores orientation in every view',()=>{
  const p=points.slice();p.splice(3,3,.4,.6,-.8);
  for(const v of VIEWS) sameMatrix(boxFrame(rotatedInView(rotatedInView(p,v,Math.PI),v,Math.PI)).R,boxFrame(p).R);
});
test('orientation arrows project box axes and distinguish end-on direction',()=>{
  for(const v of VIEWS) {
    const a=orientationInView(points,points,v,v.a),b=orientationInView(points,points,v,v.b),c=orientationInView(points,points,v,v.c);
    close(a.u,1);close(a.w,0);close(b.u,0);close(b.w,1);close(c.u,0);close(c.w,0);
    close(c.depth,v.axis==='Y'?-1:1);
    const turned=rotatedInView(points,v,Math.PI/2),projected=orientationInView(turned,points,v,v.a);
    close(projected.u,0);close(projected.w,1);
  }
});
test('all three view handles are hittable without replacing resize/move hit areas',()=>{
  const ctx=vm.createContext({});
  vm.runInContext('const dotOf=()=>.6;'+source.slice(source.indexOf('  function hitTest('),source.indexOf('  const canvasFrame')),ctx);
  for(const v of VIEWS) {
    const cv={width:300},range=4,hb=points[6+v.b]/2,ha=points[6+v.a]/2;
    assert.equal(ctx.hitTest(cv,points,v,0,hb+14*.6/(150/range),range).mode,'rotate');
    assert.equal(ctx.hitTest(cv,points,v,0,hb,range).mode,'size');
    assert.equal(ctx.hitTest(cv,points,v,ha,0,range).mode,'size');
    assert.equal(ctx.hitTest(cv,points,v,0,0,range).mode,'move');
  }
});
test('rotate button creates one key/undo, keeps other frames and size lock intact',()=>{
  const ctx=vm.createContext({points:points.slice()});
  vm.runInContext(geometry+views+rotation+`
    const shapes=[{frame:0,type:'cuboid',points:points.slice(),outside:false,attributes:[]},
      {frame:10,type:'cuboid',points:points.slice(),outside:false,attributes:[]}];
    const original=JSON.stringify(shapes),inputs=[{value:'4'},{value:'2'},{value:'3'}];
    const plan={shapes,manual:new Set(),flagged:new Set(),track:{label_id:1,attributes:[]}};
    let fitting=null,active=null,updates=0;
    const undoStack=[],root={querySelectorAll:()=>inputs},$=()=>({checked:true});
    const stateAt=f=>positionAt(plan.shapes,f),keyAt=f=>plan.shapes.find(s=>s.frame===f);
    const endDrag=()=>{},modelChanged=()=>updates++,setActive=f=>active=f,anchor=()=> 'bottom';
  `+source.slice(source.indexOf('  function ensureKey('),source.indexOf('  // Locked size:'))+
    source.slice(source.indexOf('  function setGeometry('),source.indexOf('  // Hides or shows only this frame'))+
    source.slice(source.indexOf('  function rotateFrame('),source.indexOf('  const stateAt =')),ctx);
  vm.runInContext('rotateFrame(5,VIEWS[1],5)',ctx);
  assert.equal(vm.runInContext('plan.shapes.length',ctx),3);
  assert.equal(vm.runInContext('undoStack.length',ctx),1);
  assert.equal(vm.runInContext('active',ctx),5);
  close(vm.runInContext('keyAt(5).points[4]',ctx),-5*Math.PI/180);
  assert.equal(vm.runInContext('keyAt(0).points[4]',ctx),0);
  assert.equal(vm.runInContext('keyAt(10).points[4]',ctx),0);
  assert.equal(vm.runInContext('plan.manual.has(5)',ctx),true);
  vm.runInContext('undo()',ctx);
  assert.equal(vm.runInContext('JSON.stringify(plan.shapes)===original',ctx),true);
});

test('orientation is always drawn without end-on footer labels; rotation handle remains available',()=>{
  const texts=[],arcs=[];
  const canvasContext={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:()=>{},
    beginPath:()=>{},stroke:()=>{},fill:()=>{},setLineDash:()=>{},
    moveTo:(...values)=>values.forEach(v=>assert.ok(Number.isFinite(v))),
    lineTo:(...values)=>values.forEach(v=>assert.ok(Number.isFinite(v))),
    arc:(...values)=>arcs.push(values),fillText:text=>texts.push(text)};
  const cv={width:120,height:120,getContext:()=>canvasContext};
  const controls={'.orient-x':{checked:true},'.orient-y':{checked:true},'.orient-z':{checked:true}};
  const ctx=vm.createContext({controls,cv,points,cloud:new Float32Array()});
  vm.runInContext(geometry+views+rotation+'const $=s=>controls[s],dotOf=()=>.6;'+
    source.slice(source.indexOf('  function drawView('),source.indexOf('  function updateSummary(')),ctx);
  for(let i=0;i<3;i++) {
    texts.length=0;arcs.length=0;
    vm.runInContext(`drawView(cv,cloud,{points,outside:false},points,4,VIEWS[${i}],null)`,ctx);
    assert.equal(texts.length,2); assert.equal(arcs.length,1);
    assert.ok(texts.every(text=>text.startsWith("+")));
    assert.ok(!texts.some(text=>text.includes(VIEWS[i].axis)));
    assert.ok(arcs[0].every(Number.isFinite));
  }
  Object.values(controls).forEach(control=>control.checked=false);
  texts.length=0;arcs.length=0;
  vm.runInContext('drawView(cv,cloud,{points,outside:false},points,4,VIEWS[0],null)',ctx);
  assert.equal(texts.length,2); assert.equal(arcs.length,1);
});

test('drag rotation follows each view and Shift snaps to 15-degree increments',()=>{
  for(let i=0;i<3;i++) for(const snap of [false,true]) {
    let handler;
    const ctx=vm.createContext({points,editor:{addEventListener:(type,fn)=>{handler=fn;}}});
    vm.runInContext(geometry+views+rotation+`
      const cv={width:1000,height:1000,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
      let drag={cv,f:5,vi:${i},pointerId:1,ref:points,u0:0,w0:2,ranges:[4,4,4],mode:'rotate'},result;
      const setGeometry=(f,p)=>result=p,scheduleDraw=()=>{};
    `+source.slice(source.indexOf('  function pointerLocal('),source.indexOf('  function hitTest('))+
      source.slice(source.indexOf('  editor.addEventListener("pointermove"'),source.indexOf('  // Every way a drag')),ctx);
    const angle=23*Math.PI/180,u=-2*Math.sin(angle),w=2*Math.cos(angle);
    handler({target:{closest:()=>null},pointerId:1,clientX:500+u*125,clientY:500-w*125,shiftKey:snap});
    sameMatrix(boxFrame(vm.runInContext('result',ctx)).R,boxFrame(rotatedInView(points,VIEWS[i],(snap?30:23)*Math.PI/180)).R);
  }
});
