const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ctx = vm.createContext({ setTimeout, clearTimeout, AbortController, DOMException });
vm.runInContext(fs.readFileSync('cvat-resize-extension/cloud-cache.js', 'utf8'), ctx);
const { create } = ctx.CvatCloudCache;
const xyz = n => new Float32Array([n, 2, 3]);
const job = (id = 1) => ({ jobId: id, scope: `host:${id}:revision`, start: 0, stop: 4 });
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage() {
  const data = new Map();
  return { data, async get(key, meta) { return meta ? data.has(key) : data.get(key); },
    async put(key, scope, points) { data.set(key, points); return true; }, async clear() { data.clear(); },
    async count(scope) { return [...data.keys()].filter(key => key.startsWith(scope + ':')).length; } };
}
test('items share requests by frame; persistent cache survives a new controller', async () => {
  const store = storage(), calls = [];
  const fetchFrame = async (id, frame) => { calls.push([id, frame]); return xyz(frame); };
  const first = create({ store, fetchFrame, memoryLimit: 1 }); first.configure(job());
  const [a, b] = await Promise.all([first.get(0), first.get(0)]);
  assert.equal(a, b); assert.equal(calls.length, 1);
  await first.get(1); await first.get(0);
  const reopened = create({ store, fetchFrame }); reopened.configure(job());
  assert.equal((await reopened.get(0))[0], 0);
  assert.equal(calls.length, 2);
  reopened.configure({ ...job(), scope: 'host:1:new-revision' });
  await reopened.get(0); assert.equal(calls.length, 3);
});
test('foreground joins background download and Stop does not cancel its reader', async () => {
  let release, signal;
  const store = storage();
  const cache = create({ store, fetchFrame: (id, frame, s) => { signal = s; return new Promise(resolve => { release = resolve; }); } });
  cache.configure(job());
  const prefetch = cache.prefetch(); await tick();
  const foreground = cache.get(0); cache.stop();
  assert.equal(signal.aborted, false);
  release(xyz(0)); await foreground; await prefetch;
  assert.equal(cache.state.running, false); assert.equal(store.data.size, 1);
});
test('prefetch stops on storage failure but foreground remains usable', async () => {
  const store = { get: async () => { throw Error('denied'); } };
  let downloads = 0;
  const cache = create({ store, fetchFrame: async () => { downloads++; return xyz(1); } }); cache.configure(job());
  await cache.prefetch(); assert.equal(downloads, 0); assert.match(cache.state.storageError, /IndexedDB/);
  assert.equal((await cache.get(0))[0], 1); assert.equal(downloads, 1);
});
test('job change cancels late responses without polluting the new cache', async () => {
  let release;
  const store = storage();
  const cache = create({ store, fetchFrame: id => id === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(xyz(2)) });
  cache.configure(job(1)); const old = cache.get(0); const rejected = assert.rejects(old, { name: 'AbortError' }); await tick();
  cache.configure(job(2)); release(xyz(1)); await rejected;
  assert.equal((await cache.get(0))[0], 2);
  assert.deepEqual([...store.data.keys()], ['host:2:revision:0']);
});
test('prefetch completes all frames once and resumes without downloads', async () => {
  const store = storage(), calls = [];
  const cache = create({ store, fetchFrame: async (id, frame) => { calls.push(frame); return xyz(frame); } }); cache.configure(job());
  await cache.prefetch(); assert.equal(cache.state.done, 5); assert.equal(cache.state.running, false);
  await cache.prefetch(); assert.deepEqual(calls, [0, 1, 2, 3, 4]);
});
test('full cache stops background instead of evicting frames from its own job', async () => {
  const store = storage(); let protectedWrite;
  store.put = async (key, scope, points, protect) => { protectedWrite = protect; return false; };
  const cache = create({ store, fetchFrame: async () => xyz(1) }); cache.configure(job());
  await cache.prefetch(); assert.equal(protectedWrite, true); assert.equal(cache.state.done, 0);
  assert.match(cache.state.message, /đầy/);
  assert.equal((await cache.get(1))[0], 1); assert.equal(protectedWrite, false);
});
test('clear cancels old downloads and does not let them repopulate storage', async () => {
  const store = storage(); let release;
  const cache = create({ store, fetchFrame: () => new Promise(resolve => { release = resolve; }) }); cache.configure(job());
  const read = cache.get(0), rejected = assert.rejects(read, { name: 'AbortError' }); await tick();
  await cache.clear(); release(xyz(1)); await rejected;
  assert.equal(store.data.size, 0); assert.equal(cache.state.done, 0);
});
test('unverified metadata never reads or writes disk and disables preload', async () => {
  const store = { get: () => assert.fail('disk read'), put: () => assert.fail('disk write') };
  const cache = create({ store, fetchFrame: async () => xyz(1) }); cache.configure({ ...job(), persistent: false });
  await cache.prefetch(); assert.equal((await cache.get(0))[0], 1);
});
test('stop aborts background-only fetch; resume can fetch it again', async () => {
  let first = true;
  const cache = create({ store: storage(), fetchFrame: async (id, frame, signal) => {
    if (!first) return xyz(frame);
    first = false;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError'))));
  } }); cache.configure(job());
  const run = cache.prefetch(); await tick(); cache.stop();
  const resume = cache.prefetch(); await Promise.all([run, resume]);
  assert.equal(cache.state.done, 5);
});
test('foreground downloads can proceed while a background frame is still pending', async () => {
  let release;
  const starts = [];
  const cache = create({ store: storage(), fetchFrame: async (id, frame) => {
    starts.push(frame);
    return frame === 0 ? new Promise(resolve => { release = resolve; }) : xyz(frame);
  } }); cache.configure(job());
  const run=cache.prefetch(); await tick();
  const result=await cache.get(4);
  assert.equal(result[0],4); assert.deepEqual(starts,[0,4]);
  cache.stop(); release(xyz(0)); await run;
});
