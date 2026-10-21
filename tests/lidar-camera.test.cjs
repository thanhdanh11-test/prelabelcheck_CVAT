const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function scene(){
  const handlers={},uniforms={};
  const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_,key)=>key,
    uniform3fv:(key,v)=>uniforms[key]=Array.from(v),uniform1f:(key,v)=>uniforms[key]=v},
    {get:(obj,key)=>key in obj?obj[key]:/^[A-Z_]+$/.test(key)?1:()=>({})});
  const canvas={width:500,height:400,clientWidth:500,clientHeight:400,getContext:()=>gl,addEventListener:(name,fn)=>handlers[name]=fn,
    setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){}};
  const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('cvat-resize-extension/lidar-view.js','utf8'),ctx);
  return {view:ctx.CvatLidarView.create(canvas),handlers,uniforms};
}
const box=(center=[1,2,3],half=[2,1,1])=>({center,half,R:[[1,0,0],[0,1,0],[0,0,1]]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('frame switch preserves orbit, relative zoom and pan while following new box center',()=>{
  const {view,handlers,uniforms}=scene();view.setBox(box(),false,[true,true,true]);view.reset();
  handlers.pointerdown({button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){}});
  handlers.pointermove({pointerId:1,clientX:60,clientY:25});handlers.pointerup();
  handlers.wheel({deltaY:-200,deltaMode:0,preventDefault(){}});
  handlers.pointerdown({button:2,pointerId:2,clientX:0,clientY:0,preventDefault(){}});
  handlers.pointermove({pointerId:2,clientX:20,clientY:10});handlers.pointerup();
  const camera=view.getCamera();assert.notEqual(camera.yaw,-Math.PI/4);assert.notEqual(camera.zoom,1);
  view.clear();view.setBox(box([10,20,30],[4,2,2]),false,[true,true,true]);view.restoreCamera(camera);
  const after=view.getCamera();for(const key of ['yaw','pitch','zoom'])near(after[key],camera[key]);
  after.offset.forEach((v,i)=>near(v,camera.offset[i]));
  uniforms.target.forEach((v,i)=>near(v,[10,20,30][i]+camera.offset[i]));
  view.reset();const reset=view.getCamera();near(reset.yaw,-Math.PI/4);near(reset.pitch,Math.PI/6);near(reset.zoom,1);
  reset.offset.forEach(v=>near(v,0));
});
test('first frame or invalid camera uses default view without NaNs',()=>{
  const {view}=scene();view.setBox(box(),false,[true,true,true]);
  for(const camera of [null,{yaw:NaN,pitch:0,zoom:1,offset:[0,0,0]},{yaw:0,pitch:0,zoom:-1,offset:[0,0,0]}]) {
    view.restoreCamera(camera);const next=view.getCamera();near(next.yaw,-Math.PI/4);near(next.zoom,1);
  }
});
