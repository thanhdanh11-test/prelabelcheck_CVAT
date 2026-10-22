const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cvat-resize-extension/content.js', 'utf8');
const key = (frame, x, outside = false) => ({ type: 'cuboid', frame, outside, points: [x, 0, 0, 0, 0, 0, 4, 2, 2] });
function setup(shapes) {
  const els = Object.fromEntries(['.path-out', '.path-copy'].map(name => [name, { hidden: true, disabled: true, textContent: '', innerHTML: '' }]));
  const copied = [];
  const ctx = vm.createContext({ els, copied, track: { uiId: 7, shapes }, CvatTrackPath: undefined, navigator: { clipboard: { writeText: async text => copied.push(text) } } });
  vm.runInContext(fs.readFileSync('cvat-resize-extension/track-path.js', 'utf8'), ctx);
  vm.runInContext(`
    const $ = name => els[name], job = { start_frame: 0, stop_frame: 9 };
    let status = '', failed = false;
    const setStatus = (text, error) => { status = text; failed = !!error; };
    const selectedTrack = () => track;
  ` + source.slice(source.indexOf('  let pathResult = null;'), source.indexOf('  // ---------- preview editor')), ctx);
  return { els, copied, run: code => vm.runInContext(code, ctx) };
}
test('trace fills the summary, a map and one row per visible frame, finish first', () => {
  const app = setup([key(0, 0), key(4, 8), key(5, 8, true)]);
  app.run('tracePath()');
  const html = app.els['.path-out'].innerHTML;
  assert.equal(app.els['.path-out'].hidden, false);
  assert.equal(app.els['.path-copy'].disabled, false);
  assert.match(html, /4 → 0/);
  assert.match(html, /8\.000 m/);
  assert.match(html, /<svg class="path-map"/);
  assert.equal((html.match(/<tr(?: class="skip")?><td>\d/g) || []).length, 5);
  assert.ok(html.indexOf('<td>4 ◆') < html.indexOf('<td>0 ◆'));
  assert.match(app.run('status'), /frame 4 → 0, 5 frame/);
});
test('hidden gap is listed and drawn as a dashed link', () => {
  const app = setup([key(0, 0), key(2, 2, true), key(6, 10), key(7, 11, true)]);
  app.run('tracePath()');
  const html = app.els['.path-out'].innerHTML;
  assert.match(html, /Ẩn frame 2–5/);
  assert.match(html, /class="gap"/);
  assert.equal((html.match(/class="run"/g) || []).length, 2);
});
test('a track that is never visible says so and offers no CSV', () => {
  const app = setup([key(0, 0, true)]);
  app.run('tracePath()');
  assert.match(app.els['.path-out'].textContent, /không hiện/);
  assert.equal(app.els['.path-copy'].disabled, true);
});
test('copy puts the finish-first CSV on the clipboard; clear hides everything', async () => {
  const app = setup([key(0, 0), key(2, 2)]);
  app.run('tracePath()');
  await app.run('copyPath()');
  assert.match(app.copied[0], /^frame,x,y,z,yaw_deg,step,keyframe\n9,/);
  app.run('clearPath()');
  assert.equal(app.els['.path-out'].hidden, true);
  assert.equal(app.els['.path-copy'].disabled, true);
});
