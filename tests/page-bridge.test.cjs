const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cvat-resize-extension/page-bridge.js', 'utf8');
const clone = value => structuredClone(value);
const box = (frame = 0) => ({ id: 100 + frame, frame, type: 'cuboid', outside: false, occluded: false, rotation: 0, z_order: 0, points: [1,2,3,0,0,0,4,2,2], attributes: [] });
const track = () => ({ id: 49, clientID: 1, frame: 0, label_id: 2, source: 'manual', group: 0, attributes: [], elements: [], shapes: [box()] });

function setup(options = {}) {
  let receive, nextID = 3, calls = [], undo = [], redo = [], exports = { tracks: [track(), {...track(), id: 50, clientID: 2}], shapes: [], tags: [] };
  const state = {
    settings: { workspace: { showAllInterpolationTracks: false } },
    annotation: {
      job: { fetching: false, saving: false }, workspace: 'Standard 3D',
      canvas: {activeControl: 'cursor'}, player: {frame: {number: 0}, playing: false},
      annotations: {initialized: true, saving: {uploading: false}, filters: [], states: []},
    },
  };
  const job = {
    id: 97, startFrame: 0, stopFrame: 10, labels: [{toJSON: () => ({id: 2, name: 'car', attributes: []})}],
    annotations: {
      export: async () => clone(exports),
      get: async () => {
        if (options.refreshFailure && calls.length) throw Error('render failed');
        return exports.tracks.map(t => ({clientID: t.clientID, points: t.shapes[0].points, lock: !!options.locked}));
      },
      commit: async (added, removed, frame) => {
        calls.push(clone({added, removed, frame}));
        const before = clone(exports);
        const replacement = { ...clone(added.tracks[0]), clientID: nextID++ };
        exports.tracks = exports.tracks.filter(t => !removed.tracks.some(r => r.clientID === t.clientID)).concat(replacement);
        undo.push({before, after: clone(exports)}); redo = [];
      },
    },
    actions: { get: async () => ({undo: undo.map(() => ['Commit annotations', 0]), redo: redo.map(() => ['Commit annotations', 0])}) },
  };
  state.annotation.job.instance = job;
  const store = {getState: () => state, dispatch: action => { state.annotation.annotations.states = action.payload.states; }};
  const window = {
    addEventListener: (_, handler) => { receive = handler; },
    postMessage: message => { window.lastReply = message; },
    cvatUI: options.noPlugin ? undefined : {registerComponent: fn => fn({store})},
  };
  vm.runInNewContext(source, {window, location: {origin: 'http://localhost:8080'}, structuredClone});
  return {
    state, calls, job,
    get data() { return exports; },
    async request(action, payload) {
      window.lastReply = null;
      await receive({source: window, origin: 'http://localhost:8080', data: {channel: 'cvat-track-resizer-v2', direction:'request', id:'test', action, payload}});
      return clone(window.lastReply);
    },
    undo() { const item=undo.pop(); exports=clone(item.before); redo.push(item); },
    redo() { const item=redo.pop(); exports=clone(item.after); undo.push(item); },
  };
}

test('snapshot reads in-memory unsaved tracks and actual client IDs', async () => {
  const app=setup(); app.data.tracks[0].shapes[0].points[0] = 123;
  delete app.data.tracks[0].id;
  const response=await app.request('snapshot', {jobId:97});
  assert.equal(response.result.annotations.tracks[0].shapes[0].points[0], 123);
  assert.equal(response.result.annotations.tracks[0].clientID, 1);
  assert.equal(response.result.annotations.tracks[0].id, undefined);
  assert.equal(app.calls.length, 0);
});

test('apply commits exactly the chosen track, preserves other unsaved edits and refreshes', async () => {
  const app=setup(), baseline=clone(app.data.tracks[0]), updated=clone(baseline);
  updated.label_id=3; updated.attributes=[{spec_id:8,value:'new'}]; updated.shapes[0].points[6]=5;
  app.data.tracks[1].group=12;
  const reply=await app.request('apply', {jobId:97,baseline,track:updated});
  assert.equal(reply.result.applied,true); assert.equal(reply.result.warning,''); assert.equal(reply.result.clientID,3);
  assert.equal(app.calls.length,1); assert.equal(app.calls[0].removed.tracks.length,1);
  assert.equal(app.data.tracks.length,2); assert.equal(app.data.tracks.find(t=>t.clientID===2).group,12);
  assert.equal(app.data.tracks.find(t=>t.id===49).shapes[0].points[6],5);
  assert.equal(app.data.tracks.find(t=>t.id===49).label_id,3);
  assert.equal(app.state.annotation.annotations.states.find(t=>t.clientID===3).points[6],5);
  app.undo(); assert.equal(app.data.tracks.find(t=>t.id===49).shapes[0].points[6],4);
  app.redo(); assert.equal(app.data.tracks.find(t=>t.id===49).shapes[0].points[6],5);
});

test('apply refuses stale or deleted target without committing', async () => {
  for (const change of [app=>app.data.tracks[0].shapes[0].points[0]++, app=>app.data.tracks.shift()]) {
    const app=setup(), baseline=clone(app.data.tracks[0]); change(app);
    const reply=await app.request('apply',{jobId:97,baseline,track:baseline});
    assert.match(reply.error,/Track đã/); assert.equal(app.calls.length,0);
  }
});

test('apply adopts IDs assigned by CVAT Save while the preview was open', async () => {
  const app=setup(), baseline=clone(app.data.tracks[0]);
  delete baseline.id; delete baseline.shapes[0].id;
  app.data.tracks[0].id=59; app.data.tracks[0].shapes[0].id=999;
  const reply=await app.request('apply',{jobId:97,baseline,track:baseline});
  assert.equal(reply.result.applied,true);
  assert.equal(app.calls[0].added.tracks[0].id,59);
  assert.equal(app.calls[0].added.tracks[0].shapes[0].id,999);
});

test('wrong job, loading, locked track and incompatible UI fail before commit', async () => {
  for (const mode of ['wrong-job','saving','playing','drawing','review','loading','locked','no-plugin']) {
    const app=setup({locked: mode==='locked',noPlugin: mode==='no-plugin'}),baseline=clone(app.data.tracks[0]);
    if(mode==='saving')app.state.annotation.annotations.saving.uploading=true;
    if(mode==='playing')app.state.annotation.player.playing=true;
    if(mode==='drawing')app.state.annotation.canvas.activeControl='draw_cuboid';
    if(mode==='review')app.state.annotation.workspace='Review';
    if(mode==='loading')app.state.annotation.annotations.initialized=false;
    const reply=await app.request('apply',{jobId:mode==='wrong-job'?98:97,baseline,track:baseline});
    assert.ok(reply.error,mode);assert.equal(app.calls.length,0,mode);
  }
});

test('render failure after commit is reported as applied, not a retryable mutation failure', async () => {
  const app=setup({refreshFailure:true}),baseline=clone(app.data.tracks[0]);
  const reply=await app.request('apply',{jobId:97,baseline,track:baseline});
  assert.equal(reply.result.applied,true); assert.match(reply.result.warning,/render failed/);
  assert.equal(app.calls.length,1);
});
