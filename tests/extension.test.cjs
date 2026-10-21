const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cvat-resize-extension/content.js', 'utf8');
const geometry = source.slice(source.indexOf('  function sizeOf'), source.indexOf('  // Where loading time'));
const context = vm.createContext({ TextDecoder, Float32Array, Uint8Array, DataView });
vm.runInContext(geometry + '\nthis.lib = { parsePcd, positionAt, resizedPoints, countInside };', context);
const { parsePcd, positionAt, resizedPoints, countInside } = context.lib;
const box = (frame, attributes = []) => ({ frame, type: 'cuboid', points: [frame, 0, 0, 0, 0, 0, 4, 2, 2], outside: false, occluded: false, z_order: 0, attributes });
const pcd = (data, points = 2) => new TextEncoder().encode(`FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nWIDTH ${points}\nHEIGHT 1\nPOINTS ${points}\nDATA ascii\n${data}`).buffer;

test('ASCII PCD rejects truncated input instead of adding origin points', () => {
  assert.throws(() => parsePcd(pcd('1 2 3\n')), /thiếu dữ liệu/);
});
test('ASCII PCD rejects incomplete rows', () => {
  assert.throws(() => parsePcd(pcd('1 2\n3 4 5\n')), /thiếu cột/);
});
test('PCD removes nonfinite returns and handles blank lines', () => {
  assert.deepEqual(Array.from(parsePcd(pcd('\n1 2 3\nNaN 2 3\n'))), [1, 2, 3]);
});
test('PCD rejects invalid counts before allocation', () => {
  assert.throws(() => parsePcd(pcd('', -1)), /Header/);
});
test('binary PCD validates body length', () => {
  const header = new TextEncoder().encode('FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nPOINTS 1\nDATA binary\n');
  assert.throws(() => parsePcd(header.buffer), /thiếu dữ liệu/);
  const bytes = new Uint8Array(header.length + 12); bytes.set(header);
  const view = new DataView(bytes.buffer); [1, 2, 3].forEach((v, i) => view.setFloat32(header.length + i * 4, v, true));
  assert.deepEqual(Array.from(parsePcd(bytes.buffer)), [1, 2, 3]);
});
test('rotation interpolation uses shortest turn', () => {
  const a = box(0), b = box(10); a.points[5] = 179 * Math.PI / 180; b.points[5] = -179 * Math.PI / 180;
  assert.ok(Math.abs(Math.abs(positionAt([a, b], 5).points[5]) - Math.PI) < 1e-10);
});
test('bottom anchored resize preserves floor', () => {
  const a = box(0); const p = resizedPoints(a, [5, 3, 4], 'bottom');
  assert.equal(p[2] - p[8] / 2, a.points[2] - a.points[8] / 2);
});
test('counts points in a rotated box', () => {
  const a = box(0); a.points[5] = Math.PI / 2;
  assert.equal(countInside(new Float32Array([0, 1.5, 0, 1.5, 0, 0]), a.points), 1);
});
test('new keyframe inherits attribute history without replaying old values', () => {
  const shapes = [box(0, [{ spec_id: 1, value: 'old' }]), box(5, [{ spec_id: 1, value: 'new' }])];
  const ctx = vm.createContext({ plan: { shapes } });
  vm.runInContext(`const keyAt = f => plan.shapes.find(s => s.frame === f); const stateAt = f => ({points: plan.shapes[0].points.slice(), outside: false});\n` + source.slice(source.indexOf('  function ensureKey('), source.indexOf('  const snapshot')), ctx);
  const key = vm.runInContext('ensureKey(7)', ctx);
  assert.equal(key.attributes.length, 0);
  assert.equal(shapes[1].attributes[0].value, 'new');
});

test('automatic outside inserts keys without resetting mutable attributes', async () => {
  const track = { id: 1, shapes: [box(0, [{ spec_id: 1, value: 'old' }]), box(2, [{ spec_id: 1, value: 'new' }])] };
  const controls = { '.bottom': { checked: false }, '.auto': { checked: true }, '.thr': { value: '0' } };
  const ctx = vm.createContext({ TextDecoder, Float32Array, Uint8Array, DataView, track, controls });
  vm.runInContext(geometry + `
    const selectedTrack = () => track, $ = s => controls[s];
    const root = { querySelectorAll: () => [4, 2, 2].map(value => ({value: String(value)})) };
    const job = {stop_frame: 4}, jobId = 1, planning = 0, counted = new Map();
    const nearCloud = async (id, frame) => frame === 3 ? new Float32Array() : new Float32Array([frame, 0, 0]);
    const progress = () => {};
  ` + source.slice(source.indexOf('  async function buildPlan('), source.indexOf('  function ranges(')), ctx);
  const result = await vm.runInContext('buildPlan(0)', ctx);
  assert.equal(result.shapes.find(s => s.frame === 3).outside, true);
  assert.equal(result.shapes.find(s => s.frame === 3).attributes.length, 0);
  assert.equal(result.shapes.find(s => s.frame === 4).attributes.length, 0);
  assert.equal(result.shapes.find(s => s.frame === 2).attributes[0].value, 'new');
  result.track.label_id = 9;
  assert.equal(result.baseline.label_id, undefined);
  assert.equal(result.baseline.shapes[0].outside, false);
});

test('late loadData responses cannot replace another job', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const ctx = vm.createContext({ pending });
  vm.runInContext(`
    let jobId = 1, dataGeneration = 0, job = null, annotations = null, labels = [];
    const setStatus = () => {}, bridgeRequest = () => pending;
    const withUiIds = () => { throw Error('stale response reached UI'); };
  ` + source.slice(source.indexOf('  async function loadData('), source.indexOf('  // New keyframes')), ctx);
  const load = vm.runInContext('loadData()', ctx);
  vm.runInContext('jobId = 2; dataGeneration++;', ctx);
  release({});
  await load;
  assert.equal(vm.runInContext('job', ctx), null);
  assert.equal(vm.runInContext('annotations', ctx), null);
});

test('undo restores size inputs together with geometry', () => {
  const inputs = [{value: '9'}, {value: '9'}, {value: '9'}];
  const ctx = vm.createContext({ inputs, shapes: [box(0)] });
  vm.runInContext(`
    const plan = {shapes, manual: new Set(), flagged: new Set(), track: {label_id: 1, attributes: []}};
    const root = {querySelectorAll: () => inputs};
    const undoStack = [], fitting = null, endDrag = () => {}, modelChanged = () => {};
  ` + source.slice(source.indexOf('  const snapshot ='), source.indexOf('  // Locked size:')), ctx);
  vm.runInContext(`commit(snapshot()); inputs[0].value = '12'; plan.shapes = []; undo();`, ctx);
  assert.equal(inputs[0].value, '9');
  assert.equal(vm.runInContext('plan.shapes.length', ctx), 1);
});

test('auto fit preserves manual reference, anchors and frames outside selected range', async () => {
  const plan = { shapes: [box(0), box(2), box(3), box(6)], track: {id: 1}, manual: new Set([2, 3]), flagged: new Set() };
  const controls = { '.fit-kind': {value: 'rigid'}, '.fit-a': {value: '2'}, '.fit-b': {value: '4'}, '.fit': {} };
  const ctx = vm.createContext({ plan, controls, performance });
  vm.runInContext(geometry + `
    let fitting = null; const editGen = 0, editor = {hidden: false}, frames = [0,1,2,3,4,5,6];
    const $ = s => controls[s], endDrag = () => {}, progress = () => {}, cloudStats = {};
    const checkNoop = () => {}, logCloudStats = checkNoop, modelChanged = checkNoop, cancelFrameFit = checkNoop;
    const setStatus = (text, isError) => { if (isError) throw Error(text); };
    const pickReference = async () => 2;
    const stateAt = f => positionAt(plan.shapes, f), keyAt = f => plan.shapes.find(s => s.frame === f);
    const poseOf = p => ({x:p[0], y:p[1], z:p[2], yaw:p[5]});
    const nearCloud = async () => new Float32Array(Array.from({length: 90}, (_, i) => i % 3 === 0 ? 2 : 0));
    const newTemplate = () => ({n:30}), addPoint = () => {}, FIT = {ground:0, minPts:1, learn:2};
    const targetPoints = () => [], forObjectPoints = (Q,P,size,margin,visit) => { for(let i=0;i<30;i++) visit(0,0,0); };
    const fitFrame = async () => ({ok:true, P:{x:14, y:0, z:0, yaw:0}, n:30, ratio:0});
    const reduceKeys = (range, poses, forced) => [...forced].sort((a,b)=>a-b);
    const snapshot = () => ({}), commit = () => {};
  ` + source.slice(source.indexOf('  function ensureKey('), source.indexOf('  const snapshot')) +
  source.slice(source.indexOf('  async function autoFit('), source.indexOf('  // ---- clouds for the views')), ctx);
  await vm.runInContext('autoFit()', ctx);
  assert.equal(positionAt(plan.shapes, 1).points[0], 1);
  assert.equal(positionAt(plan.shapes, 5).points[0], 5);
  assert.equal(positionAt(plan.shapes, 2).points[0], 2);
  assert.equal(positionAt(plan.shapes, 3).points[0], 3);
  assert.equal(positionAt(plan.shapes, 4).points[0], 14);
});

test('preview progress button cancels without publishing a partial plan', async () => {
  let complete;
  const deferred = new Promise(resolve => { complete = resolve; });
  const controls = { '.preview': { disabled: false, title: '' }, '.auto': { checked: true } };
  const ctx = vm.createContext({ deferred, controls, performance });
  vm.runInContext(`
    let plan = null, planning = 0, previewRun = null;
    const job = {}, cloudStats = {}, $ = s => controls[s];
    let status = '';
    const setStatus = text => status = text, confirmDrop = () => true, closePlan = () => {planning++; plan = null;};
    const progress = () => {}, logCloudStats = () => {}, buildPlan = () => deferred;
  ` + source.slice(source.indexOf('  async function preview('), source.indexOf('  async function apply(')), ctx);
  const run = vm.runInContext('preview()', ctx);
  assert.equal(controls['.preview'].disabled, false);
  assert.match(controls['.preview'].title, /dừng/);
  await vm.runInContext('preview()', ctx);
  assert.equal(controls['.preview'].disabled, true);
  complete({});
  await run;
  assert.equal(vm.runInContext('plan', ctx), null);
  assert.equal(vm.runInContext('previewRun', ctx), null);
  assert.equal(controls['.preview'].disabled, false);
  assert.match(vm.runInContext('status', ctx), /Đã dừng/);
});

test('Apply sends an immutable baseline through bridge, then refreshes without server writes/reload', async () => {
  const baseline={clientID:1,id:49,label_id:1,shapes:[box(0)]};
  const changed={...baseline,label_id:2};
  const plan={track:changed,baseline,shapes:[{...box(0),points:[0,0,0,0,0,0,5,2,2]}]};
  const controls={'.apply':{disabled:false}};
  const requests=[];
  const ctx=vm.createContext({plan,controls,requests});
  vm.runInContext(`
    let saving=false,jobId=97,fitting=null;
    const endDrag=()=>{},$=s=>controls[s],readSplitGap=()=>6;
    let status='',refreshed=false;
    const setStatus=(text)=>status=text;
    const bridgeRequest=async(action,payload)=>{requests.push({action,payload});return {applied:true,warning:''};};
    const closePlan=()=>{plan=null;},loadData=async()=>{refreshed=true;};
    const fetch=()=>{throw Error('Must not write server');};
    const location={reload:()=>{throw Error('Must not reload');}};
  `+source.slice(source.indexOf('  async function apply('),source.indexOf('  function savePreview(')),ctx);
  await vm.runInContext('apply()',ctx);
  assert.equal(requests.length,1);assert.equal(requests[0].action,'apply');
  assert.equal(requests[0].payload.baseline.label_id,1);
  assert.equal(requests[0].payload.track.label_id,2);
  assert.equal(requests[0].payload.track.shapes[0].points[6],5);
  assert.equal(requests[0].payload.splitGap,6);
  assert.equal(vm.runInContext('plan',ctx),null);
  assert.equal(vm.runInContext('refreshed',ctx),true);
  assert.equal(vm.runInContext('saving',ctx),false);
  assert.match(vm.runInContext('status',ctx),/chưa lưu server/);
});
