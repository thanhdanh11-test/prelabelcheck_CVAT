const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('cvat-resize-extension/content.js','utf8');
function setup() {
  const ctx=vm.createContext({structuredClone});
  vm.runInContext(`
    const controls={'.split-side-nav':{},'.split-zoom-nav':{},'.only-key':{checked:true},'.only-hid':{checked:true},'.only-bad':{checked:true}};
    const $=s=>controls[s],job={start_frame:0,stop_frame:40},events=[];
    let plan={track:{clientID:3,uiId:3},shapes:[{frame:0}],cuts:[{reappearFrame:16}]},jobId=97;
    let saving=false,fitting=null,previewRun=null,zoomFrame=null;
    const cells=new Map([[0,{}],[16,{}]]),annotations={tracks:[{clientID:3,uiId:3,id:49,shapes:[]},{clientID:4,uiId:4,shapes:[]}]};
    let fresh={annotations:structuredClone(annotations)},pending=null;
    const bridgeRequest=async()=>pending||fresh;
    const switchTrack=async id=>{events.push(['switch',id]);plan={track:annotations.tracks.find(t=>t.uiId===id)};};
    const setStatus=(text)=>events.push(['status',text]),applyFilters=()=>events.push(['filters']),setActive=f=>events.push(['active',f]);
    const openZoom=f=>events.push(['zoom',f]),reveal=f=>events.push(['reveal',f]),scheduleDraw=()=>{};
    const CvatTrackSplit={ranges:()=>[{startFrame:0,endFrame:15},{startFrame:16,endFrame:40}]};
  `+source.slice(source.indexOf('  let splitReceipt ='),source.indexOf('  function splitFrameLabel(')),ctx);
  return ctx;
}

const run=(ctx,s)=>vm.runInContext(s,ctx);
test('preview buttons target each segment start in small and expanded mode, clearing hiding filters',async()=>{
  const ctx=setup();run(ctx,'renderSplitNavigation()');
  assert.match(run(ctx,"controls['.split-side-nav'].innerHTML"),/Đoạn gốc · 0–15/);
  assert.match(run(ctx,"controls['.split-zoom-nav'].innerHTML"),/Đoạn mới 2 · 16–40/);
  await run(ctx,"navigateSplit('preview',1)");
  assert.equal(run(ctx,"controls['.only-hid'].checked"),false);
  assert.equal(run(ctx,"JSON.stringify(events)"),JSON.stringify([['filters'],['active',16],['reveal',16]]));
  run(ctx,'events.length=0;zoomFrame=16');await run(ctx,"navigateSplit('preview',0)");
  assert.equal(run(ctx,"JSON.stringify(events)"),JSON.stringify([['filters'],['active',0],['zoom',0]]));
});
test('receipt navigation uses existing draft-preserving switch path in both directions',async()=>{
  const ctx=setup();run(ctx,'splitReceipt=[{startFrame:0,endFrame:15,clientID:3,id:49},{startFrame:16,endFrame:40,clientID:4}];zoomFrame=0');
  await run(ctx,"navigateSplit('receipt',1)");
  assert.equal(run(ctx,'plan.track.clientID'),4);
  assert.match(run(ctx,'JSON.stringify(events)'),/\["switch",4\].*\["zoom",16\]/);
  await run(ctx,"navigateSplit('receipt',0)");assert.equal(run(ctx,'plan.track.clientID'),3);
});
test('missing item after Undo, missing mapping and stale job responses cannot navigate',async()=>{
  const ctx=setup();run(ctx,'splitReceipt=[{startFrame:0,clientID:3},{startFrame:16,clientID:4}];fresh.annotations.tracks.pop()');
  await run(ctx,"navigateSplit('receipt',1)");
  assert.equal(run(ctx,"events.filter(e=>e[0]==='switch').length"),0);
  assert.match(run(ctx,'events[0][1]'),/không còn khớp/);
  run(ctx,'events.length=0;splitReceipt[1].clientID=undefined;renderSplitNavigation()');
  assert.match(run(ctx,"controls['.split-side-nav'].innerHTML"),/data-split-index="1" disabled/);
  await run(ctx,"navigateSplit('receipt',1)");assert.equal(run(ctx,'events.length'),0);
  run(ctx,'splitReceipt[1].clientID=4;var resolve;pending=new Promise(r=>resolve=r)');
  const result=run(ctx,"navigateSplit('receipt',1)");
  run(ctx,'jobId=98;resolve(fresh)');await result;
  assert.equal(run(ctx,'events.length'),0);
});

test('toolbar shows yellow-origin content only for split children and the button navigates to retained parent',async()=>{
  const ctx=setup();
  run(ctx,`controls['.item-origin-label']={};var button={};controls['.item-origin']={querySelector:()=>button};
    recordSplitOrigins({clientID:1,uiId:1,id:49},[{clientID:3,id:49,startFrame:0,endFrame:15},{clientID:4,startFrame:16,endFrame:40}]);
    plan={track:annotations.tracks[1]};renderItemOrigin();`);
  assert.equal(run(ctx,"controls['.item-origin'].hidden"),false);
  assert.equal(run(ctx,"controls['.item-origin-label'].textContent"),'Tạo từ item #1 · ID server 49');
  assert.equal(run(ctx,'button.disabled'),false);
  await run(ctx,"navigateSplit('origin',0)");
  assert.equal(run(ctx,'plan.track.clientID'),3);
  run(ctx,'renderItemOrigin()');assert.equal(run(ctx,"controls['.item-origin'].hidden"),true);
});
test('origin survives later unrelated Apply and parent client-ID replacement',()=>{
  const ctx=setup();
  run(ctx,`recordSplitOrigins({clientID:1,uiId:1,id:49},[{clientID:3,startFrame:0},{clientID:4,startFrame:16}]);
    recordSplitOrigins({clientID:8},[{clientID:9,startFrame:0}]);
    recordSplitOrigins({clientID:3,id:49},[{clientID:5,id:49,startFrame:0}]);`);
  assert.equal(run(ctx,'itemOrigins.get(4).source.uiId'),1);
  assert.equal(run(ctx,'itemOrigins.get(4).target.clientID'),5);
  run(ctx,'recordSplitOrigins({clientID:4},[{clientID:6,startFrame:16}])');
  assert.equal(run(ctx,'itemOrigins.has(4)'),false);
  assert.equal(run(ctx,'itemOrigins.get(6).target.clientID'),5);
});
test('origin button refuses navigation if original segment was removed by Undo',async()=>{
  const ctx=setup();
  run(ctx,`recordSplitOrigins({clientID:1},[{clientID:3,id:49,startFrame:0},{clientID:4,startFrame:16}]);
    plan={track:annotations.tracks[1]};fresh.annotations.tracks.shift();`);
  await run(ctx,"navigateSplit('origin',0)");
  assert.equal(run(ctx,'plan.track.clientID'),4);
  assert.match(run(ctx,'events[0][1]'),/không còn khớp/);
});
