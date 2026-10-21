const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ structuredClone });
vm.runInContext(fs.readFileSync('cvat-resize-extension/track-split.js','utf8'),ctx);
const {cuts,split}=ctx.CvatTrackSplit;
const key=(frame,outside=false,attributes=[])=>({id:frame+100,frame,outside,type:'cuboid',points:[frame,0,0,0,0,0,4,2,2],attributes});
const track=shapes=>({id:49,clientID:1,uiId:1,frame:shapes[0].frame,label_id:2,group:0,attributes:[{spec_id:9,value:'car'}],shapes});
const plain=value=>JSON.parse(JSON.stringify(value));

test('count actual consecutive frames: five stays one object, six or seven splits',()=>{
  for(const length of [5,6,7]) {
    const result=split(track([key(0),key(10,true),key(10+length)]),6);
    assert.equal(result.tracks.length,length>=6?2:1);
    if(length>=6) {
      assert.deepEqual(plain(result.cuts),[{outsideFrame:10,reappearFrame:10+length,hiddenFrames:length}]);
      assert.equal(result.tracks[0].shapes.at(-1).frame,10);
      assert.equal(result.tracks[0].shapes.at(-1).outside,true);
      assert.equal(result.tracks[1].frame,10+length);
    }
  }
});
test('extra outside keys do not reset the gap; separate short gaps do not add up',()=>{
  assert.equal(split(track([key(0),key(10,true),key(12,true),key(16)]),6).tracks.length,2);
  assert.equal(split(track([key(0),key(2,true),key(5),key(7,true),key(10)]),6).tracks.length,1);
});
test('leading/trailing outside and all-hidden tracks create no empty object',()=>{
  for(const shapes of [[key(0,true),key(9)],[key(0),key(3,true)],[key(0,true),key(8,true)]]) {
    assert.equal(split(track(shapes),6).tracks.length,1);
  }
});
test('new segments preserve class, immutable and inherited mutable attributes',()=>{
  const original=track([key(0,false,[{spec_id:1,value:'old'},{spec_id:2,value:'keep'}]),
    key(10,true,[{spec_id:1,value:'hidden'}]), key(13,true,[{spec_id:3,value:'during-gap'}]),
    key(16,false,[{spec_id:1,value:'new'}]), key(20,true), key(26)]);
  const before=structuredClone(original),result=split(original,6);
  assert.equal(result.tracks.length,3);
  for(const part of result.tracks.slice(1)) {
    assert.equal(part.label_id,2); assert.deepEqual(part.attributes,original.attributes);
    assert.deepEqual(plain(part.shapes[0].attributes),[{spec_id:1,value:'new'},{spec_id:2,value:'keep'},{spec_id:3,value:'during-gap'}]);
    assert.equal(part.id,undefined); assert.ok(part.shapes.every(shape=>shape.id===undefined));
  }
  assert.deepEqual(original,before);
});
test('disabled splitting keeps geometry and changes no input',()=>{
  const original=track([key(0),key(1,true),key(7)]),result=split(original,0);
  assert.equal(result.tracks.length,1); assert.deepEqual(result.tracks[0].shapes,original.shapes);
});
test('split only on reappearance inside the current job',()=>{
  const original=track([key(0),key(1,true),key(7),key(10,true),key(16)]);
  assert.equal(split(original,6,5,12).tracks.length,1);
  assert.equal(split(original,6,7,16).tracks.length,2);
});
test('rectangle tracks keep their own point representation',()=>{
  const original=track([key(0),key(2,true),key(8)]);
  original.shapes.forEach(shape=>{shape.type='rectangle';shape.points=[1,2,11,22];});
  const result=split(original,6);
  assert.equal(result.tracks.length,2); assert.deepEqual(result.tracks[1].shapes[0].points,[1,2,11,22]);
});
test('visible geometry and identity coverage are preserved over many gap patterns',()=>{
  const content=fs.readFileSync('cvat-resize-extension/content.js','utf8');
  const geometry=content.slice(content.indexOf('  function sizeOf'),content.indexOf('  // Where loading time'));
  vm.runInContext(geometry+'\nthis.position=positionAt;',ctx);
  for(let pattern=0;pattern<64;pattern++) {
    const shapes=Array.from({length:7},(_,i)=>key(i*3,!!(pattern&(1<<i))));
    const result=split(track(shapes),6);
    for(let frame=0;frame<=24;frame++) {
      const before=ctx.position(shapes,frame);
      const visible=result.tracks.map(part=>ctx.position(part.shapes,frame)).filter(state=>state&&!state.outside);
      assert.equal(visible.length,before.outside?0:1,`pattern ${pattern}, frame ${frame}`);
      if(!before.outside) assert.deepEqual(plain(visible[0].points),plain(before.points));
    }
  }
});
test('reject malformed key ordering or frame thresholds',()=>{
  assert.throws(()=>cuts([key(0),key(0)],6),/Keyframe/);
  assert.throws(()=>cuts([key(2),key(1)],6),/Keyframe/);
  assert.throws(()=>cuts([key(0)],-1),/Ngưỡng/);
});

function previewUI() {
  const source=fs.readFileSync('cvat-resize-extension/content.js','utf8');
  const controls={'.split-gap':{value:'6'},'.split-outside':{checked:true},'.split-summary':{},'.apply':{}};
  const ui=vm.createContext({controls,CvatTrackSplit:ctx.CvatTrackSplit,shapes:[key(0),key(10,true),key(16)]});
  vm.runInContext(`const $=s=>controls[s],job={start_frame:0,stop_frame:40};
    let plan={shapes,stale:false},saving=false;`+
    source.slice(source.indexOf('  function readSplitGap('),source.indexOf('  const confirmDrop')),ui);
  return {ui,controls,update:()=>vm.runInContext('updateSplitPreview()',ui)};
}
test('preview split count follows manual outside edits and restoration',()=>{
  const {ui,controls,update}=previewUI(); update();
  assert.match(controls['.split-summary'].textContent,/2 object riêng/);
  assert.match(controls['.split-summary'].textContent,/frame 16/);
  vm.runInContext('plan.shapes[1].outside=false',ui); update();
  assert.match(controls['.split-summary'].textContent,/Giữ 1 object/);
  vm.runInContext('plan.shapes[1].outside=true',ui); update();
  assert.equal(vm.runInContext('plan.cuts.length',ui),1);
});
test('invalid split setting blocks Apply; disabling split or fixing it restores valid preview',()=>{
  const {ui,controls,update}=previewUI(); controls['.split-gap'].value='0'; update();
  assert.equal(controls['.apply'].disabled,true);
  controls['.split-outside'].checked=false; update(); assert.equal(controls['.apply'].disabled,false);
  controls['.split-outside'].checked=true; controls['.split-gap'].value='6'; update();
  assert.equal(controls['.apply'].disabled,false);
  vm.runInContext('plan.stale=true',ui); update(); assert.equal(controls['.apply'].disabled,true);
});
