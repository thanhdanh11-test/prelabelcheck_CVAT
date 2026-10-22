const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('cvat-resize-extension/track-path.js','utf8'),ctx);
const {trace,toCsv}=ctx.CvatTrackPath;
const key=(frame,x,y=0,z=0,outside=false,yaw=0)=>({frame,outside,type:'cuboid',points:[x,y,z,0,0,yaw,4,2,2]});
const track=shapes=>({shapes});
const plain=value=>JSON.parse(JSON.stringify(value));
const frames=r=>plain(r.points.map(p=>p.frame));

test('lists visible frames from the finish back to the beginning and interpolates between keyframes',()=>{
  const r=trace(track([key(0,0),key(4,8)]),0,4);
  assert.deepEqual(frames(r),[4,3,2,1,0]);
  assert.deepEqual(plain(r.points.map(p=>p.x)),[8,6,4,2,0]);
  assert.deepEqual(plain(r.points.map(p=>p.key)),[true,false,false,false,true]);
  assert.equal(r.summary.finishFrame,4);
  assert.equal(r.summary.beginFrame,0);
  assert.equal(r.summary.length,8);
  assert.equal(r.summary.net,8);
  assert.equal(r.points[0].step,null);
  assert.equal(r.points[1].step,2);
});

test('a visible last keyframe runs to the job end; an outside one stops the path',()=>{
  assert.equal(trace(track([key(0,0),key(2,2)]),0,5).summary.finishFrame,5);
  assert.equal(trace(track([key(0,0),key(2,2,0,0,true)]),0,5).summary.finishFrame,1);
  assert.deepEqual(frames(trace(track([key(3,0),key(5,2)]))),[5,4,3]);
});

test('path length counts the curve, net distance counts only the ends',()=>{
  const r=trace(track([key(0,0,0),key(3,3,0),key(6,3,3)]),0,6);
  assert.equal(r.summary.length,6);
  assert.equal(r.summary.lengthXY,6);
  assert.ok(Math.abs(r.summary.net-Math.hypot(3,3))<1e-9);
  assert.equal(r.summary.maxStep.step,1);
});

test('height counts in 3D length but not in XY length',()=>{
  const r=trace(track([key(0,0,0,0),key(2,0,0,2)]),0,2);
  assert.equal(r.summary.length,2);
  assert.equal(r.summary.lengthXY,0);
});

test('hidden frames split runs, report the jump and are not counted in the length',()=>{
  const r=trace(track([key(0,0),key(2,2),key(3,2,0,0,true),key(6,10),key(8,12)]),0,8);
  assert.deepEqual(frames(r),[8,7,6,2,1,0]);
  assert.equal(r.runs.length,2);
  assert.deepEqual(plain(r.runs),[{last:8,first:6,length:2},{last:2,first:0,length:2}]);
  assert.deepEqual(plain(r.gaps),[{hiddenFrom:3,hiddenTo:5,jump:8}]);
  assert.equal(r.summary.length,4);
  assert.equal(r.points[3].step,null);
});

test('yaw turns the short way round and stays within ±π',()=>{
  const r=trace(track([key(0,0,0,0,false,3),key(2,0,0,0,false,-3)]),0,2);
  const mid=r.points.find(p=>p.frame===1).yaw;
  assert.ok(Math.abs(Math.abs(mid)-Math.PI)<0.01,String(mid));
});

test('job range clips the path but keeps the interpolation of earlier keyframes',()=>{
  const r=trace(track([key(0,0),key(10,10)]),4,7);
  assert.deepEqual(plain(r.points.map(p=>[p.frame,p.x])),[[7,7],[6,6],[5,5],[4,4]]);
});

test('rectangles use their centre in pixels and have no yaw',()=>{
  const rect=(frame,x)=>({frame,outside:false,type:'rectangle',points:[x,10,x+10,30]});
  const r=trace(track([rect(0,0),rect(2,4)]),0,2);
  assert.equal(r.unit,'px');
  assert.deepEqual(plain(r.points.map(p=>[p.x,p.y])),[[9,20],[7,20],[5,20]]);
  assert.equal(r.points[0].yaw,null);
});

test('rejects empty tracks, duplicate frames and unsupported shapes',()=>{
  assert.throws(()=>trace(track([])),/keyframe/);
  assert.throws(()=>trace(track([key(1,0),key(1,2)])),/trùng/);
  assert.throws(()=>trace(track([{frame:0,outside:false,type:'polygon',points:[0,0]}])),/polygon/);
});

test('input track is never changed',()=>{
  const t=track([key(5,5),key(0,0)]), before=JSON.stringify(t);
  trace(t,0,5);
  assert.equal(JSON.stringify(t),before);
});

test('CSV lists frames finish first with a header',()=>{
  const lines=toCsv(trace(track([key(0,0),key(1,1.5)]),0,1)).split('\n');
  assert.equal(lines[0],'frame,x,y,z,yaw_deg,step,keyframe');
  assert.equal(lines[1],'1,1.5,0,0,0,,1');
  assert.equal(lines[2],'0,0,0,0,0,1.5,1');
});
