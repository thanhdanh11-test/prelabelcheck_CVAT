const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cvat-resize-extension/content.js', 'utf8');
function setup() {
  const tracks = [1, 2, 3].map(uiId => ({uiId, clientID: uiId, shapes: [{type: 'cuboid', frame: 0, points: [0,0,0,0,0,0,4,2,2]}]}));
  const controls = Object.fromEntries(['track','thr','split-gap','split-outside','fit-a','fit-b','fit-ref','fit-kind','bottom','auto','lock','only-key','only-hid','only-bad','apply'].map(name => ['.'+name,{value:'',checked:false}]));
  controls['.track'].value = '1';
  const inputs = [4, 2, 2].map(value => ({value:String(value)}));
  const ctx = vm.createContext({tracks, controls, inputs});
  vm.runInContext(`
    const $ = name => controls[name], root = {querySelectorAll: () => inputs};
    const makePlan = track => ({track:structuredCopy(track),baseline:structuredCopy(track),shapes:structuredCopy(track.shapes),stale:false});
    function structuredCopy(value) { return JSON.parse(JSON.stringify(value)); }
    const selectedTrack = () => tracks.find(t => t.uiId === Number($('.track').value));
    let plan = makePlan(tracks[0]), undoStack = [{undo:1}], activeFrame = 2, zoomFrame = 2, fitting = null;
    let switchGeneration = 0, previewSettled = Promise.resolve(), built = 0, status='';
    const previews = new Map(), grid = {scrollTop:345}, cells = new Map([[0,{}],[1,{}],[2,{}]]);
    const setStatus = text => status=text, endDrag=()=>{}, renderReviewState=()=>{};
    const closePlan = () => {plan=null;undoStack=[];activeFrame=null;zoomFrame=null;grid.scrollTop=0;};
    const renderInputs = () => inputs.forEach((input,i) => input.value=String(selectedTrack().shapes[0].points[i+6]));
    const openEditor = () => {undoStack=[];activeFrame=null;zoomFrame=null;};
    const setActive = f => activeFrame=f, openZoom=f=>zoomFrame=f;
    const updateSplitPreview=()=>{$('.apply').disabled=plan.stale;};
    const preview = async () => {built++; plan=makePlan(selectedTrack());};
  ` + source.slice(source.indexOf('  function savePreview('), source.indexOf('  async function pickActive(')),ctx);
  return {ctx,controls,inputs,run:code=>vm.runInContext(code,ctx)};
}
test('A → B → A restores edits, inputs, Undo and viewport without rebuilding A', async () => {
  const app = setup();
  app.run('plan.shapes[0].points[6]=8;'); app.inputs[0].value='8'; app.controls['.auto'].checked=true;
  app.controls['.split-outside'].checked=true; app.controls['.split-gap'].value='6';
  await app.run('switchTrack(2)'); assert.equal(app.run('built'),1);
  app.controls['.auto'].checked=false;
  app.controls['.split-outside'].checked=false; app.controls['.split-gap'].value='10';
  await app.run('switchTrack(1)');
  assert.equal(app.run('built'),1); assert.equal(app.run('plan.shapes[0].points[6]'),8);
  assert.equal(app.inputs[0].value,'8'); assert.equal(app.controls['.auto'].checked,true);
  assert.equal(app.controls['.split-outside'].checked,true); assert.equal(app.controls['.split-gap'].value,'6');
  assert.equal(app.run('undoStack.length'),1); assert.equal(app.run('grid.scrollTop'),345);
  assert.equal(app.run('activeFrame'),2); assert.equal(app.run('zoomFrame'),2);
  assert.equal(app.controls['.apply'].disabled,false);
});
test('restored draft is kept but cannot Apply after source changes', async () => {
  const app=setup(); await app.run('switchTrack(2)');
  app.run('tracks[0].shapes[0].points[6]=7;'); await app.run('switchTrack(1)');
  assert.equal(app.run('plan.stale'),true); assert.equal(app.controls['.apply'].disabled,true);
  assert.equal(app.run('plan.shapes[0].points[6]'),4);
});
test('rapid selection during cancellation builds only the last selected item', async () => {
  const app=setup(); app.run('previewSettled=new Promise(resolve=>globalThis.finish=resolve);');
  const b=app.run('switchTrack(2)'), c=app.run('switchTrack(3)'); app.run('finish()'); await Promise.all([b,c]);
  assert.equal(app.run('built'),1); assert.equal(app.run('plan.track.uiId'),3);
});
test('fitting cannot mutate another item through a switch', async () => {
  const app=setup(); app.run('fitting={};'); await app.run('switchTrack(2)');
  assert.equal(app.run('plan.track.uiId'),1); assert.equal(app.run('built'),0);
  assert.match(app.run('status'),/Dừng tự khớp/);
});
