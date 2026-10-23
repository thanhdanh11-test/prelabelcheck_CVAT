// Isolated-world cache. Only point clouds are persisted, never annotations or credentials.
(() => {
  "use strict";
  const BUDGET = 1024 ** 3, MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const abortError = () => new DOMException("Đã dừng tải", "AbortError");

  function openStore({ indexedDB = globalThis.indexedDB, budget = BUDGET, name = "cvat-track-resizer-clouds-v1" } = {}) {
    let opening;
    function open() {
      if (!opening) opening = new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error("Trình duyệt không hỗ trợ IndexedDB"));
        const request = indexedDB.open(name, 1);
        let settled = false;
        const timer = setTimeout(() => { settled = true; reject(new Error("Không mở được cache trình duyệt")); }, 2500);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("frames", { keyPath: "key" });
          request.result.createObjectStore("meta", { keyPath: "key" });
        };
        request.onerror = () => { clearTimeout(timer); settled = true; reject(request.error); };
        request.onsuccess = () => {
          clearTimeout(timer);
          if (settled) { request.result.close(); return; }
          settled = true;
          request.result.onversionchange = () => { request.result.close(); opening = null; };
          resolve(request.result);
        };
      });
      return opening;
    }
    async function transact(work) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(["frames", "meta"], "readwrite");
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error("Không ghi được cache trình duyệt"));
        work(tx.objectStore("frames"), tx.objectStore("meta"), value => { result = value; });
      });
    }
    return {
      async get(key, metadataOnly = false) {
        return transact((frames, meta, done) => {
          const request = meta.get(key);
          request.onsuccess = () => {
            const item = request.result;
            if (!item) return done(null);
            if (Date.now() - item.created > MAX_AGE) { frames.delete(key); meta.delete(key); return done(null); }
            meta.put({ ...item, used: Date.now() });
            if (metadataOnly) return done(true);
            const data = frames.get(key);
            data.onsuccess = () => done(data.result?.xyz || null);
          };
        });
      },
      async put(key, scope, xyz, protectScope = false) {
        return transact((frames, meta, done) => {
          const request = meta.getAll();
          request.onsuccess = () => {
            const now = Date.now(), bytes = xyz.byteLength;
            const items = request.result.filter(item => {
              if (now - item.created <= MAX_AGE) return true;
              frames.delete(item.key); meta.delete(item.key); return false;
            });
            let used = items.reduce((sum, item) => sum + (item.key === key ? 0 : item.bytes), 0);
            const victims = items.filter(item => item.key !== key && (!protectScope || item.scope !== scope))
              .sort((a, b) => a.used - b.used);
            if (bytes > budget || used + bytes - victims.reduce((sum, item) => sum + item.bytes, 0) > budget) return done(false);
            for (const item of victims) {
              if (used + bytes <= budget) break;
              frames.delete(item.key); meta.delete(item.key); used -= item.bytes;
            }
            frames.put({ key, xyz });
            meta.put({ key, scope, bytes, used: now, created: now });
            done(true);
          };
        });
      },
      async clear() {
        return transact((frames, meta) => { frames.clear(); meta.clear(); });
      },
      async count(scope) {
        return transact((frames, meta, done) => {
          const request = meta.getAll();
          request.onsuccess = () => done(request.result.filter(item => item.scope === scope && Date.now() - item.created <= MAX_AGE).length);
        });
      },
    };
  }

  function create({ fetchFrame, store = openStore(), onState = () => {}, memoryLimit = 24, memoryBudget = 128 * 1024 ** 2 } = {}) {
    const memory = new Map(), pending = new Map(), queue = [];
    let active = 0, epoch = 0, context = null, run = null, storageError = "", clearing = null, memoryBytes = 0;
    let viewing = null, heading = 1; // frame last read in the foreground and the way the viewer is moving
    let status = { running: false, done: 0, total: 0, message: "" };
    const emit = patch => { status = { ...status, ...patch, storageError }; onState({ ...status }); };
    async function disk(method, ...args) {
      if (storageError) return null;
      try { return await store[method](...args); }
      catch (error) {
        storageError = error.name === "QuotaExceededError" ? "Hết dung lượng trình duyệt" : "Không dùng được IndexedDB";
        emit({}); return null;
      }
    }
    function pump() {
      queue.sort((a, b) => Number(a.background) - Number(b.background));
      while (active < 3 && queue.length) {
        const task = queue.shift();
        active++;
        (async () => {
          if (task.epoch !== epoch || task.controller.signal.aborted) throw abortError();
          let xyz = task.context.persistent === false ? null : await disk("get", task.key);
          if (task.epoch !== epoch || task.controller.signal.aborted) throw abortError();
          let persisted = !!xyz;
          if (!xyz) {
            xyz = await fetchFrame(task.context.jobId, task.frame, task.controller.signal);
            if (task.epoch !== epoch) throw abortError();
            persisted = task.context.persistent !== false && !!(await disk("put", task.key, task.context.scope, xyz, task.background));
          }
          if (task.epoch !== epoch) throw abortError();
          if (!task.background) {
            memoryBytes -= memory.get(task.key)?.byteLength || 0;
            memory.delete(task.key); memory.set(task.key, xyz);
            memoryBytes += xyz.byteLength;
            while (memory.size > 1 && (memory.size > memoryLimit || memoryBytes > memoryBudget)) {
              const key = memory.keys().next().value;
              memoryBytes -= memory.get(key).byteLength; memory.delete(key);
            }
          }
          return { xyz, persisted };
        })().then(task.resolve, task.reject).finally(() => {
          active--; if (pending.get(task.key) === task) pending.delete(task.key); pump();
        });
      }
    }
    function request(frame, background = false) {
      if (!context) return Promise.reject(new Error("Chưa tải metadata của job"));
      const key = `${context.scope}:${frame}`;
      const existing = pending.get(key);
      if (existing && !existing.controller.signal.aborted) { if (!background) existing.background = false; return existing.promise; }
      if (!background && memory.has(key)) {
        const xyz = memory.get(key); memory.delete(key); memory.set(key, xyz);
        return Promise.resolve({ xyz });
      }
      const task = { key, frame, background, context, epoch, controller: new AbortController() };
      task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
      pending.set(key, task); queue.push(task); pump();
      return task.promise;
    }
    function stop() {
      if (run) run.cancelled = true;
      run = null;
      // Abort only background-only requests; a foreground reader may have joined one.
      for (const task of pending.values()) if (task.background) task.controller.abort();
      emit({ running: false, message: "Đã dừng tải nền. Có thể tiếp tục." });
    }
    // Like CVAT's prefetch analyzer: preload around where the viewer is, ahead of their direction
    // of travel first. With no foreground read yet it walks the job from its first frame.
    function nextFrame(target, seen) {
      const at = Math.min(Math.max(viewing ?? target.start, target.start), target.stop);
      for (let d = 0; d <= target.stop - target.start; d++) {
        for (const frame of [at + heading * d, at - heading * d]) {
          if (frame >= target.start && frame <= target.stop && !seen.has(frame)) return frame;
        }
      }
      return null;
    }
    function reset() {
      stop(); epoch++; viewing = null; heading = 1;
      for (const task of pending.values()) task.controller.abort();
      for (const task of queue.splice(0)) task.reject(abortError());
      pending.clear(); memory.clear(); memoryBytes = 0;
    }
    return {
      configure(next) {
        if (context?.scope === next?.scope) return;
        reset(); context = next; storageError = "";
        emit({ done: 0, total: next ? next.stop - next.start + 1 : 0, message: "" });
      },
      async get(frame) {
        if (clearing) await clearing;
        if (viewing !== null && frame !== viewing) heading = frame > viewing ? 1 : -1;
        viewing = frame;
        return (await request(frame)).xyz;
      },
      async prefetch() {
        if (clearing) await clearing;
        if (!context || run) return;
        if (context.persistent === false) { emit({ message: "Cache chưa mở khóa hoặc chưa xác minh metadata; chỉ dùng RAM" }); return; }
        const token = { cancelled: false }, target = context;
        run = token;
        emit({ running: true, done: 0, message: "Đang tải nền" });
        try {
          const seen = new Set();
          for (let frame; (frame = nextFrame(target, seen)) !== null;) {
            seen.add(frame);
            if (token.cancelled) return;
            const hit = await disk("get", `${target.scope}:${frame}`, true);
            if (token.cancelled) return;
            if (storageError) { emit({ message: "Chỉ dùng RAM; đã dừng tải nền" }); return; }
            if (!hit) {
              const result = await request(frame, true);
              if (token.cancelled) return;
              if (!result.persisted) { emit({ message: "Cache đã đầy hoặc không ghi được. Chỉ tải frame cần xem." }); return; }
            }
            emit({ done: seen.size });
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          const count = await disk("count", target.scope);
          if (token.cancelled) return;
          emit({ done: count || 0, message: count === target.stop - target.start + 1 ? "Đã cache toàn bộ job" :
            "Đã quét hết job; một số frame không còn trong cache. Chỉ tải bổ sung khi cần." });
        } catch (error) {
          if (!token.cancelled) emit({ message: `Tải nền bị dừng: ${error.message}. Bấm Tiếp tục để thử lại.` });
        } finally {
          if (run === token) { run = null; emit({ running: false }); }
        }
      },
      stop,
      async clear() {
        reset();
        // Serialize clear with any earlier IDB transaction and keep new readers behind it.
        storageError = "";
        clearing = disk("clear");
        await clearing; clearing = null;
        emit({ done: 0, message: storageError ? "Không xóa được cache" : "Đã xóa cache point cloud của extension trên server này" });
      },
      get state() { return { ...status, storageError }; },
    };
  }
  globalThis.CvatCloudCache = { create, openStore };
})();
