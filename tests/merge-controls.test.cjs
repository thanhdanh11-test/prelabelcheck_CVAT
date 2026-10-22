const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cvat-resize-extension/content.js', 'utf8');
const cut = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));

test('server-ID dropdown uses each track range rather than preview frame bounds', async () => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    let jobId=97,dataGeneration=0,job,annotations,labels;
    const sel={},frames=[100,200],$=()=>sel,setStatus=()=>{},withUiIds=()=>{},renderReviewState=()=>{},renderInputs=()=>{},prepareCache=async()=>{};
    const bridgeRequest=async()=>({job:{},labels:[],annotations:{tracks:[
      {id:49,uiId:1,shapes:[{frame:10,type:'cuboid'},{frame:20,type:'cuboid'}]},
      {id:70,uiId:2,shapes:[{frame:30,type:'cuboid'},{frame:45,type:'cuboid'}]}
    ]}});
  ` + cut('  async function loadData(', '  // New keyframes for the track:'), ctx);
  await vm.runInContext('loadData(2)', ctx);
  const html = vm.runInContext('sel.innerHTML', ctx);
  assert.match(html, /id 49 \(#1\).*frame 10–20/);
  assert.match(html, /id 70 \(#2\).*frame 30–45/);
  assert.doesNotMatch(html, /100–200|Infinity/);
  assert.equal(vm.runInContext('sel.value', ctx), '2');
});

test('expanded and collapsed drawing pass frame to trajectory while preserving zoom and proposals', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    let drag=null,regionDrag=null;
    const plan={track:{clientID:2}},frameFit={f:5,points:[9]},zoomCanvases=[{}],VIEWS=[{}],calls=[];
    const nearCached=()=>({xyz:[1]}),cropCovers=()=>true,frameReach=()=>5,ensureLoad=()=>{},loadState=new Map();
    const viewWindow=(p,i,expanded)=>({range:expanded?3:1,cu:expanded?2:0,cw:0});
    const drawView=(...args)=>calls.push(args);
  ` + cut('  function drawFrame(', '  function drawRegion('), ctx);
  vm.runInContext('drawFrame(zoomCanvases,5,{points:[0,0,0]});drawFrame([{}],5,{points:[0,0,0]})', ctx);
  const calls = vm.runInContext('calls', ctx);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][4])), { range:3,cu:2,cw:0 });
  assert.equal(calls[1][4].range, 1);
  for (const args of calls) {
    assert.equal(args[8], 5);
    assert.equal(args[7][0], 9);
  }
});
