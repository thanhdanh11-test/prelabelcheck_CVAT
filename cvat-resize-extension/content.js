// CVAT Track Resizer: gives every keyframe of one track the same size, can mark frames whose box
// holds too few points as outside, and lets the planned boxes be adjusted by hand on Top / Side /
// Front views of every frame before saving. CVAT interpolates between keyframes, so the box then
// has that size on every frame.
// Applies through the page bridge; CVAT owns Save and Undo/Redo.
(() => {
  "use strict";

  const JOB_PATH = /\/jobs\/(\d+)/;

  // ---------- geometry ----------

  function sizeOf(shape) {
    const p = shape.points;
    if (shape.type === "cuboid") return p.slice(6, 9);
    if (shape.type === "rectangle") return [p[2] - p[0], p[3] - p[1]];
    throw new Error(`Không hỗ trợ loại ${shape.type} (chỉ cuboid và rectangle).`);
  }

  // Track position at a frame, the way CVAT computes it: linear between the keyframes around the
  // frame (an outside keyframe still pulls the geometry), visibility from the keyframe on the left.
  // Returns null before the first keyframe.
  function positionAt(keys, frame) {
    let i = -1;
    while (i + 1 < keys.length && keys[i + 1].frame <= frame) i++;
    if (i < 0) return null;
    const a = keys[i], b = keys[i + 1];
    if (a.frame === frame || !b) return { points: a.points.slice(), outside: a.outside };
    const t = (frame - a.frame) / (b.frame - a.frame);
    const angles = a.type === "cuboid" ? [3, 4, 5] : [];
    const points = a.points.map((x, j) => {
      if (!angles.includes(j)) return x + (b.points[j] - x) * t;
      // cuboid rotations turn the short way round and stay within (-π, π], like CVAT
      const turn = wrapAngle(b.points[j] - x);
      return wrapAngle(x + turn * t);
    });
    return { points, outside: a.outside };
  }

  function wrapAngle(v) {
    const r = (v + Math.PI) % (2 * Math.PI);
    return (r <= 0 ? r + 2 * Math.PI : r) - Math.PI;
  }

  const byFrame = (shapes) => shapes.slice().sort((a, b) => a.frame - b.frame);

  function sizeAt(track, frame) {
    const pos = positionAt(byFrame(track.shapes), frame);
    if (!pos || pos.outside) throw new Error(`Track không hiện ở frame ${frame}.`);
    return sizeOf({ type: track.shapes[0].type, points: pos.points });
  }

  function resizedPoints(shape, size, anchor) {
    const p = shape.points.slice();
    if (shape.type === "cuboid") {
      if (anchor === "bottom") p[2] += (size[2] - p[8]) / 2; // keep the floor at the same height
      p.splice(6, 3, ...size);
    } else {
      const [w, h] = size;
      const cx = (p[0] + p[2]) / 2;
      const cy = anchor === "bottom" ? p[3] - h / 2 : (p[1] + p[3]) / 2;
      p.splice(0, 4, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    }
    return p;
  }

  // CVAT cuboid points are [x, y, z, rx, ry, rz, sx, sy, sz, ...]; the rotation is a three.js
  // Euler in XYZ order, so world = R * local + center with R = Rx * Ry * Rz.
  function boxFrame(p) {
    const [cx, cy, cz, rx, ry, rz, sx, sy, sz] = p;
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry);
    const e = Math.cos(rz), f = Math.sin(rz);
    const R = [
      [c * e, -c * f, d],
      [a * f + b * e * d, a * e - b * f * d, -b * c],
      [b * f - a * e * d, b * e + a * f * d, a * c],
    ];
    const half = [sx / 2, sy / 2, sz / 2];
    return { center: [cx, cy, cz], R, half, reach: Math.hypot(...half) };
  }

  // Calls visit(localX, localY, localZ) for every point near the box; returns nothing.
  function forPointsNear(xyz, box, reach, visit) {
    const [cx, cy, cz] = box.center, R = box.R;
    for (let k = 0; k < xyz.length; k += 3) {
      const dx = xyz[k] - cx, dy = xyz[k + 1] - cy, dz = xyz[k + 2] - cz;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach || Math.abs(dz) > reach) continue;
      visit(R[0][0] * dx + R[1][0] * dy + R[2][0] * dz,
            R[0][1] * dx + R[1][1] * dy + R[2][1] * dz,
            R[0][2] * dx + R[1][2] * dy + R[2][2] * dz);
    }
  }

  function countInside(xyz, points) {
    const box = boxFrame(points), [hx, hy, hz] = box.half;
    let n = 0;
    forPointsNear(xyz, box, box.reach, (x, y, z) => {
      if (Math.abs(x) <= hx && Math.abs(y) <= hy && Math.abs(z) <= hz) n++;
    });
    return n;
  }

  const fmt = (v) => v.map((x) => x.toFixed(3)).join(" × ");

  // ---------- CVAT API ----------

  function bridgeRequest(action, payload) {
    const id = crypto.randomUUID(), channel = "cvat-track-resizer-v2";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(new Error("Không nhận được phản hồi từ CVAT. Reload extension và trang nếu vừa cập nhật. Nếu đang Áp dụng, bấm Tải lại trong tool để kiểm tra trước khi thử lại."));
      }, 15000);
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel ||
            event.data.direction !== "response" || event.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
      }
      window.addEventListener("message", receive);
      window.postMessage({ channel, direction: "request", id, action, payload }, location.origin);
    });
  }

  // Use the actual client IDs from CVAT, including objects that have not been saved.
  function withUiIds(annotations) {
    let n = annotations.tags.length;
    annotations.shapes.forEach((s) => (s.uiId = s.clientID ?? ++n));
    annotations.tracks.forEach((t) => (t.uiId = t.clientID ?? ++n));
    return annotations;
  }

  // Only x, y, z are kept, as a flat Float32Array.
  function parsePcd(buffer) {
    const bytes = new Uint8Array(buffer), header = {};
    let pos = 0;
    while (!header.DATA) {
      const nl = bytes.indexOf(10, pos);
      if (nl < 0) throw new Error("File PCD không đọc được.");
      const line = new TextDecoder().decode(bytes.subarray(pos, nl)).trim();
      pos = nl + 1;
      if (!line || line.startsWith("#")) continue;
      const [key, ...rest] = line.split(/\s+/);
      header[key.toUpperCase()] = rest;
    }
    const fields = header.FIELDS, types = header.TYPE;
    if (!fields || !header.SIZE || !types) throw new Error("Header PCD thiếu FIELDS, SIZE hoặc TYPE.");
    const sizes = header.SIZE.map(Number);
    const counts = (header.COUNT || fields.map(() => "1")).map(Number);
    const n = Number(header.POINTS ? header.POINTS[0] : (header.WIDTH || [0])[0] * (header.HEIGHT || [1])[0]);
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000000 ||
        sizes.length !== fields.length || types.length !== fields.length || counts.length !== fields.length ||
        sizes.some((v) => ![1, 2, 4, 8].includes(v)) || counts.some((v) => !Number.isSafeInteger(v) || v < 1)) {
      throw new Error("Header PCD không hợp lệ hoặc quá lớn.");
    }
    const idx = ["x", "y", "z"].map((f) => fields.indexOf(f));
    if (idx.some((i) => i < 0)) throw new Error("File PCD không có trường x y z.");
    const xyz = new Float32Array(n * 3);
    const format = header.DATA[0].toLowerCase();
    if (format === "ascii") {
      const cols = idx.map((i) => counts.slice(0, i).reduce((s, c) => s + c, 0));
      const lines = new TextDecoder().decode(bytes.subarray(pos)).split("\n");
      let k = 0;
      for (const line of lines) {
        if (k >= n) break;
        const v = line.trim().split(/\s+/);
        if (!line.trim() || line.trim().startsWith("#")) continue;
        if (v.length < counts.reduce((sum, count) => sum + count, 0)) throw new Error("Dòng PCD thiếu cột.");
        for (let j = 0; j < 3; j++) xyz[k * 3 + j] = Number(v[cols[j]]);
        k++;
      }
      if (k !== n) throw new Error("PCD thiếu dữ liệu điểm.");
    } else if (format === "binary") {
      const offsets = [];
      let row = 0;
      fields.forEach((_, i) => { offsets.push(row); row += sizes[i] * counts[i]; });
      if (bytes.length - pos < n * row) throw new Error("PCD binary thiếu dữ liệu điểm.");
      const view = new DataView(buffer, pos);
      const read = idx.map((i) => {
        if (types[i] !== "F" || ![4, 8].includes(sizes[i])) throw new Error("Toạ độ trong PCD không phải số thực.");
        return sizes[i] === 8 ? (o) => view.getFloat64(o, true) : (o) => view.getFloat32(o, true);
      });
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < 3; j++) xyz[k * 3 + j] = read[j](k * row + offsets[idx[j]]);
      }
    } else {
      throw new Error(`Chưa hỗ trợ PCD dạng "${format}".`);
    }
    // Invalid lidar returns must never become phantom points at the origin.
    let kept = 0;
    for (let k = 0; k < xyz.length; k += 3) {
      if (!Number.isFinite(xyz[k]) || !Number.isFinite(xyz[k + 1]) || !Number.isFinite(xyz[k + 2])) continue;
      xyz[kept++] = xyz[k]; xyz[kept++] = xyz[k + 1]; xyz[kept++] = xyz[k + 2];
    }
    return xyz.subarray(0, kept);
  }

  // Where loading time goes, logged to the console after each preview / auto fit.
  const cloudStats = { frames: 0, bytes: 0, fetchMs: 0, parseMs: 0, since: 0 };
  function logCloudStats(what) {
    const st = cloudStats, wall = (performance.now() - st.since) / 1000;
    if (st.frames) {
      console.info(`[Track Resizer] ${what}: ${wall.toFixed(1)} s, ${st.frames} frame tải mới, ` +
        `${(st.bytes / 1e6).toFixed(1)} MB (${(st.bytes / 1e6 / st.frames).toFixed(1)} MB/frame), ` +
        `tải ${(st.fetchMs / st.frames).toFixed(0)} ms/frame, parse ${(st.parseMs / st.frames).toFixed(0)} ms/frame`);
    } else console.info(`[Track Resizer] ${what}: ${wall.toFixed(1)} s, không tải frame nào (dùng cache)`);
    Object.assign(st, { frames: 0, bytes: 0, fetchMs: 0, parseMs: 0, since: performance.now() });
  }
  const cacheVault = CvatCacheVault.create();
  const encryptedCloudStore = cacheVault.wrapStore(CvatCloudCache.openStore({ name: "cvat-track-resizer-clouds-encrypted-v1" }));
  const cloudCache = CvatCloudCache.create({
    store: encryptedCloudStore,
    onState: renderCacheState,
    async fetchFrame(id, frame, signal) {
      const t0 = performance.now();
      const resp = await fetch(`/api/jobs/${id}/data?type=frame&number=${frame}&quality=compressed`,
        { credentials: "same-origin", signal, cache: "no-store" });
      if (!resp.ok) throw new Error(`Không tải được point cloud frame ${frame} (HTTP ${resp.status}).`);
      const buf = await resp.arrayBuffer(), t1 = performance.now(), xyz = parsePcd(buf);
      cloudStats.frames++;
      cloudStats.bytes += buf.byteLength;
      cloudStats.fetchMs += t1 - t0;
      cloudStats.parseMs += performance.now() - t1;
      return xyz;
    },
  });
  let cacheJob = null, cacheSetup = null, cacheGeneration = 0;
  async function loadCloud(frame) {
    const generation = cacheGeneration;
    await cacheSetup;
    if (generation !== cacheGeneration) throw new Error("Job đã đổi");
    return cloudCache.get(frame);
  }

  function renderCacheState(state) {
    renderVaultState();
    $(".cache-toggle").textContent = state.running ? "Dừng tải nền" : "Tiếp tục tải nền";
    $(".cache-status").textContent = `${state.message || "Cache point cloud"} · ${state.done}/${state.total} frame` +
      (state.storageError ? ` · ${state.storageError}` : "");
  }

  let vaultBusy = false, vaultMessage = "", cacheChannel = null;
  function renderVaultState() {
    const el = $(".vault-status");
    if (!el) return;
    const unlocked = cacheVault.unlocked;
    el.textContent = vaultMessage || (unlocked ? "Đã mở khóa — point cloud và nguồn item lưu mã hóa." :
      "Đang khóa — chỉ dùng RAM. Lần mở khóa đầu tiên chuyển nguồn item và dọn cache cũ chưa mã hóa.");
    $(".vault-lock").disabled = false;
    $(".vault-reset").disabled = vaultBusy;
    $(".cache-toggle").disabled = vaultBusy || !unlocked;
  }
  async function refreshVaultCache() {
    cacheJob = null; cacheGeneration++; cloudCache.configure(null);
    near.clear(); nearFloats = 0;
    if (job) await prepareCache(job);
    renderVaultState();
  }
  function lockVault() {
    cacheChannel?.invalidate();
    cacheVault.lock();
    // Keep annotation drafts, but release point-cloud views and invalidate pending draws.
    if (plan) savePreview();
    if (saving) closeEditor(); else closePlan();
    editGen++; near.clear(); nearFloats = 0; counted.clear(); queue.length = 0; loadState.clear();
    // Preserve not-yet-persisted links created from annotation drafts; discard restored links.
    if (!originsChanged) itemOrigins.clear();
    cacheJob = null; cacheGeneration++; cloudCache.configure(null);
    vaultMessage = "Cache tab này đã khóa. Bản nháp annotation giữ trong tab; xem tiếp dùng RAM.";
    renderVaultState();
  }

  function prepareCache(loadedJob) {
    if (cacheJob === loadedJob.id) return cacheSetup;
    cacheJob = loadedJob.id;
    const id = loadedJob.id, generation = ++cacheGeneration;
    $(".cache-controls").hidden = loadedJob.dimension === "2d";
    cacheSetup = (async () => {
      if (loadedJob.dimension === "2d") return;
      let signature, persistent = true;
      try {
        // Validate access on every page/job entry before reading persistent data.
        const response = await fetch(`/api/jobs/${id}/data/meta`, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const meta = await response.json();
        const bytes = new TextEncoder().encode(JSON.stringify([loadedJob.task_id, loadedJob.created_date, meta]));
        signature = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      } catch {
        signature = crypto.randomUUID(); persistent = false;
      }
      if (jobId !== id || generation !== cacheGeneration) return;
      cloudCache.configure({ jobId: id, scope: `${location.origin}:${id}:${signature}:xyz-v1`,
        start: loadedJob.start_frame, stop: loadedJob.stop_frame, persistent: persistent && cacheVault.unlocked });
      if (persistent && cacheVault.unlocked) void cloudCache.prefetch();
      else $(".cache-status").textContent = persistent ? "Cache đang khóa — chỉ dùng RAM, không tải nền." : "Không xác minh được metadata; chỉ dùng RAM. Tải lại trang để thử cache lại.";
    })();
    return cacheSetup;
  }

  // Points of one frame near one track, cut from the full cloud, so previewing a long track again
  // doesn't download every frame again. A crop is a world-axis cube; it answers a box only when the
  // box's whole search cube (center ± reach) lies inside it, so counts match the full cloud exactly.
  const NEAR_BUDGET = 16e6; // floats kept over all crops (~64 MB)
  const near = new Map(); // "job:track:frame" -> { center, half, xyz }, least recently used first
  let nearFloats = 0;

  const cropCovers = (crop, center, reach) => Math.max(...center.map((v, i) => Math.abs(v - crop.center[i]))) + reach <= crop.half;
  const nearCached = (trackId, frame) => near.get(`${jobId}:${trackId}:${frame}`);

  // Points within `reach` of `center` (plus `margin` of room for later tweaks), cut from the frame.
  // The default margin leaves room for later size tweaks and for the auto fit's search around the box.
  async function nearCloud(trackId, frame, center, reach, margin = reach * 0.5 + 4) {
    const requestedJob = jobId;
    const key = `${jobId}:${trackId}:${frame}`;
    const old = near.get(key);
    if (old && cropCovers(old, center, reach)) {
      remember(key, old);
      return old.xyz;
    }
    const full = await loadCloud(frame);
    if (requestedJob !== jobId) throw new Error("Job đã đổi");
    const [cx, cy, cz] = center, half = reach + margin;
    const kept = [];
    for (let k = 0; k < full.length; k += 3) {
      if (Math.abs(full[k] - cx) <= half && Math.abs(full[k + 1] - cy) <= half && Math.abs(full[k + 2] - cz) <= half) {
        kept.push(full[k], full[k + 1], full[k + 2]);
      }
    }
    const crop = { center: center.slice(), half, xyz: Float32Array.from(kept) };
    remember(key, crop);
    return crop.xyz;
  }

  function remember(key, crop) {
    if (near.has(key)) nearFloats -= near.get(key).xyz.length;
    near.delete(key);
    near.set(key, crop);
    nearFloats += crop.xyz.length;
    while (nearFloats > NEAR_BUDGET && near.size > 1) {
      const [k, c] = near.entries().next().value;
      near.delete(k);
      nearFloats -= c.xyz.length;
    }
  }

  // Points inside a box, by job, track, frame and exact box geometry: changing only the threshold
  // (or previewing again unchanged) needs no counting at all.
  const counted = new Map();

  // ---------- CVAT page state ----------

  function activeUiId() {
    const el = document.querySelector(".cvat-objects-sidebar-state-active-item");
    const m = el && el.id.match(/(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  function currentFrame() {
    const input = document.querySelector(".cvat-player-frame-selector input") ||
      document.querySelector(".cvat-player-controls input.ant-input-number-input");
    const n = input ? Number(input.value) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  // ---------- UI ----------

  // Icons of tool buttons (also used in the template below).
  const BTN_ICON = {
    fit: '<svg viewBox="0 0 24 24"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><rect x="8" y="8" width="8" height="8"/></svg>',
    accept: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    region: '<svg viewBox="0 0 24 24"><path d="M3 7V3h4M10 3h4M17 3h4v4M21 10v1M3 10v4M3 17v4h4M10 21h1"/><path d="M14 14l7 2.5-3 1.2-1.2 3.3z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    clearKeys: '<svg viewBox="0 0 24 24"><circle cx="7" cy="17" r="4.5"/><path d="M10.2 13.8L21 3M16.5 7.5l3 3"/><path d="M14 14l7 7M21 14l-7 7"/></svg>',
    shrink: '<svg viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>',
  };

  const host = document.createElement("div");
  host.id = "cvat-track-resizer";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host {
    all: initial;
    --primary: #da291c; --primary-active: #b01e0a; --on-primary: #fff;
    --canvas: #181818; --elevated: #303030; --hairline: #303030;
    --ink: #fff; --body: #969696; --muted: #8f8f8f; --control-border: #666; --warning: #f13a2c; --focus: #f6e500;
  }
  * { box-sizing: border-box; font: 400 13px/1.5 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; height: 40px; padding: 0 16px;
         border: 1px solid var(--hairline); border-radius: 0; background: var(--canvas); color: var(--ink); cursor: pointer;
         display: flex; align-items: center; gap: 8px;
         font-weight: 700; font-size: 12px; line-height: 1; letter-spacing: 1.4px; text-transform: uppercase; }
  .fab:active { background: var(--elevated); }
  .logo { width: 20px; height: 20px; object-fit: contain; }
  .panel { position: fixed; left: 70px; top: 100px; z-index: 2147483647; display: flex; overflow: hidden;
           border: 1px solid var(--hairline); border-radius: 0; background: var(--canvas); color: var(--body);
           box-shadow: 0 4px 8px rgba(0,0,0,.1); color-scheme: dark; }
  .panel[hidden] { display: none; }
  .side { width: 400px; flex: none; max-height: calc(100vh - 80px); display: flex; flex-direction: column; }
  .side-scroll { flex: 1; min-height: 0; overflow: hidden auto; padding: 0 16px 16px; }
  .side-foot { flex: none; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hairline); }
  .side-foot .btn { height: 44px; }
  .panel.wide { left: 0 !important; top: 0 !important; width: 100vw; height: 100vh; border: 0; }
  .panel.wide .side { max-height: none; border-right: 1px solid var(--hairline); }
  .panel.frame-expanded .side, .panel.frame-expanded .helpbox { display: none; }
  .panel.wide h3 { cursor: default; }
  h3 { flex: none; margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--hairline);
       display: flex; align-items: center; gap: 8px; cursor: move; user-select: none; }
  h3 .logo { width: 28px; height: 28px; }
  h3 .name { color: var(--ink); font-size: 16px; font-weight: 500; letter-spacing: .08px; }
  h3 .close { margin-left: auto; width: 32px; height: 32px; border: 0; background: none; color: var(--body);
              cursor: pointer; font-size: 16px; }
  h3 .close:active { color: var(--ink); }
  .badge { padding: 4px 12px; border-radius: 9999px; background: var(--elevated); color: var(--ink);
           font-size: 11px; font-weight: 600; line-height: 1.4; letter-spacing: 1.1px; text-transform: uppercase; }
  .badge:empty { display: none; }
  h4, .lbl { display: block; margin: 16px 0 8px; color: var(--muted);
             font-size: 11px; font-weight: 600; line-height: 1.4; letter-spacing: 1.1px; text-transform: uppercase; }
  h4 { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--hairline); color: var(--ink); }
  label { display: block; margin: 8px 0 0; color: var(--body); cursor: pointer; }
  select, input[type=number] { height: 36px; padding: 0 12px; border: 1px solid var(--control-border); border-radius: 4px;
                               background: var(--canvas); color: var(--ink); }
  select { width: 100%; }
  input[type=checkbox] { accent-color: var(--primary); vertical-align: -2px; margin: 0 6px 0 0; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .row input[type=number] { width: 76px; }
  label.row { flex-wrap: nowrap; }
  .track-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 16px; }
  .track-row .ico-btn { height: 36px; width: 36px; }
  .review-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .review-row label { margin: 0; white-space: nowrap; }
  .review-box { display: flex; align-items: center; gap: 6px; }
  .btn.quiet { height: 32px; padding: 0 12px; border-color: var(--control-border); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .btn.ico-btn { width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-color: var(--control-border); }
  .ico-btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .sec { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 8px; padding-top: 14px; border-top: 1px solid var(--hairline);
         color: var(--muted); font-size: 11px; font-weight: 600; line-height: 1.4; letter-spacing: 1.1px; text-transform: uppercase; }
  .opt-inline { display: flex; gap: 16px; flex-wrap: wrap; }
  .opt-inline label { min-height: 36px; display: flex; align-items: center; margin: 0; }
  .edit-sec.off { opacity: .4; }
  .need-preview { color: var(--focus); letter-spacing: 0; text-transform: none; font-weight: 500; }
  .edit-sec:not(.off) .need-preview { display: none; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { height: 28px; padding: 0 10px; border: 1px solid var(--hairline); background: none; color: var(--ink); font-size: 12px; cursor: pointer; }
  .chip:disabled { cursor: default; color: var(--body); }
  .chip.on { border-color: var(--primary); }
  .chip b { font-weight: 600; }
  .split-summary { margin-top: 6px; color: var(--muted); font-size: 12px; }
  .split-summary[hidden], .split-receipt[hidden] { display: none; }
  .split-summary, .split-receipt { white-space: pre-line; line-height: 1.6; }
  .split-receipt { margin-top: 8px; padding: 8px; border: 1px solid var(--hairline); font-size: 12px; }
  .item-origin { color: #f6d365; display: inline-flex; gap: 8px; align-items: center; font-size: 12px; }
  .item-origin[hidden] { display: none; }
  .split-nav { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .split-nav[hidden] { display: none; }
  .split-nav .nav-label { flex-basis: 100%; color: var(--muted); font-size: 11px; }
  .cell.split-start { border-top: 3px solid #d8a44c; }
  .tag.split-origin { color: #d8a44c; }
  details.advanced { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--hairline); }
  details.advanced summary { cursor: pointer; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 1.1px; text-transform: uppercase; }
  .vault-controls { margin-top: 12px; display: grid; gap: 6px; }
  .vault-controls [hidden] { display: none; }
  .vault-controls label { display: grid; gap: 4px; }
  .vault-controls input { min-width: 0; width: 100%; }
  .vault-controls .cache-btns { flex-wrap: wrap; }
  .vault-status, .vault-controls small { color: var(--muted); font-size: 12px; }
  .cache-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .cache-row .cache-status { color: var(--muted); font-size: 12px; }
  .cache-btns { display: flex; gap: 6px; flex: none; }
  .cache-btns .btn.quiet { height: 28px; padding: 0 8px; font-size: 12px; }
  .review-count { color: var(--muted); font-size: 12px; }
  .option-row { min-height: 40px; display: flex; align-items: center; margin: 0; }
  .option-row { display: grid; grid-template-columns: minmax(0, 1fr) 68px 42px; gap: 8px; }
  .option-row label { margin: 0; }
  .option-row input[type=number] { width: 100%; }
  .option-row > span { color: var(--muted); font-size: 12px; }
  .vals { margin-top: 8px; }
  .vals span { color: var(--body); }
  .vals { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
  .vals label { margin: 0; display: flex; align-items: center; gap: 6px; color: var(--muted); font-weight: 600; cursor: default; }
  .vals input { width: 100% !important; min-width: 0; }
  .btn.sm.ico { width: 30px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; letter-spacing: 0; }
  .ico svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .ico.on { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
  .ico.on:disabled { opacity: .7; }
  .fitgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
  .fitgrid label { margin: 0; color: var(--muted); font-size: 11px; cursor: default; }
  .fitgrid input { width: 100%; margin-top: 4px; }
  .fit-kind { margin-top: 0; }
  .btn.fit { width: 100%; height: 40px; margin-top: 10px; }
  .btn.busy { background: linear-gradient(90deg, var(--primary) var(--p, 0%), var(--elevated) var(--p, 0%));
              border-color: var(--primary); color: var(--on-primary); font-variant-numeric: tabular-nums; }
  .btn.busy:disabled { opacity: 1; }
  h3 .help-btn { margin-left: auto; width: 28px; height: 28px; padding: 0; font-size: 14px; letter-spacing: 0; border-color: var(--control-border); }
  h3 .help-btn + .close { margin-left: 0; }
  .helpbox { position: absolute; left: 16px; top: 56px; z-index: 3; width: 368px; max-height: calc(100% - 72px); overflow: auto;
             padding: 12px 16px; border: 1px solid var(--control-border); background: var(--canvas); color: var(--body); }
  .helpbox[hidden] { display: none; }
  .helpbox h5 { margin: 10px 0 4px; color: var(--ink); font-size: 12px; font-weight: 600; }
  .helpbox h5:first-child { margin-top: 0; }
  .helpbox ul { margin: 0; padding-left: 16px; font-size: 12px; }
  .btn { height: 36px; padding: 0 16px; border: 1px solid var(--ink); border-radius: 0; background: transparent;
         color: var(--ink); cursor: pointer;
         font-size: 12px; font-weight: 700; line-height: 1; letter-spacing: 1.4px; text-transform: uppercase; }
  .btn:active { background: var(--elevated); }
  .btn.primary { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
  .btn.primary:active { border-color: var(--primary-active); background: var(--primary-active); }
  .btn:disabled { opacity: .35; cursor: default; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 24px; }
  .actions .btn { height: 44px; }
  .status { margin-top: 16px; color: var(--body); white-space: pre-wrap; }
  .status:empty { display: none; }
  .status.err { color: var(--warning); }
  .muted { color: var(--muted); }
  .btn.sm { height: 26px; padding: 0 8px; font-size: 10px; letter-spacing: 1.1px; border-color: var(--control-border); }
  kbd { padding: 0 4px; border: 1px solid var(--control-border); border-radius: 2px; color: var(--ink); font-size: 11px; }

  .editor { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; outline: none; }
  .editor[hidden] { display: none; }
  .fbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-height: 53px; padding: 8px 16px; border-bottom: 1px solid var(--hairline); }
  .fbar .sp { flex: 1; }
  .fbar label { margin: 0; white-space: nowrap; }
  .grid { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-content: start; }
  .grid.one { grid-template-columns: 1fr; }
  .filter-empty { position: absolute; top: 72px; left: 16px; right: 16px; padding: 32px 16px; text-align: center; color: var(--body); }
  .filter-empty[hidden] { display: none; }
  .filter-empty .btn { margin-top: 16px; }
  .cell { position: relative; border: 1px solid var(--hairline); }
  .cell.active { outline: 2px solid var(--primary); outline-offset: -1px; }
  .chead select, .chead input { height: 26px; padding: 0 4px; border-radius: 2px; font-size: 11px; width: 96px; text-transform: none; letter-spacing: 0; }
  .chead input[type=number] { width: 64px; }
  .chead input[type=text] { width: 96px; }
  .chead .cls { color: var(--ink); font-weight: 600; }
  .cell[hidden] { display: none; }
  .cell.is-manual { border-color: var(--ink); }
  .cell.flash { outline: 2px solid var(--focus); }
  .cell.hidden-frame canvas { opacity: .55; }
  .chead { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 4px 6px 4px 10px; border-bottom: 1px solid var(--hairline); flex-wrap: wrap; }
  .chead .f { min-width: 28px; color: var(--ink); font-weight: 600; letter-spacing: .65px; white-space: nowrap; }
  .chead .n { color: var(--body); font-size: 12px; white-space: nowrap; }
  .tag { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; white-space: nowrap; }
  .tag.hid { color: var(--ink); }
  .tag.bad { color: var(--warning); }
  .row .fit-ref { width: 90px; }
  .chead .acts { margin-left: auto; display: flex; gap: 4px; align-items: center; }
  .views { display: grid; grid-template-columns: repeat(3, 1fr); }
  .view { position: relative; min-width: 0; }
  .view + .view { border-left: 1px solid var(--hairline); }
  .views canvas { display: block; width: 100%; aspect-ratio: 1; touch-action: none; background: var(--canvas); }
  .cap { position: absolute; left: 8px; bottom: 4px; color: var(--muted); font-size: 10px; font-weight: 600; letter-spacing: 1.1px;
         text-transform: uppercase; pointer-events: none; }
  .zoom { position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column; background: var(--canvas); }
  .zoom[hidden] { display: none; }
  .zoom .chead { min-height: 53px; padding: 8px 12px 8px 16px; }
  .zoom .chead .f { font-size: 16px; }
  .zbody { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
  .zbody .view { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .zbody .lidar-slot { grid-column: 1 / 4; position: relative; min-height: 0; overflow: hidden; }
  .zbody .view { border-top: 1px solid var(--hairline); }
  .zbody .keyboard-view { box-shadow: inset 0 0 0 2px var(--focus); }
  .lidar-canvas { width: 100%; height: 100%; cursor: grab; }
  .lidar-slot .cap { top: 8px; bottom: auto; }
  .lidar-slot .reset-camera { position: absolute; top: 8px; right: 8px; }
  .lidar-message { position: absolute; left: 12px; bottom: 8px; pointer-events: none; color: var(--body); }
  .zoom-status { padding: 0 12px; color: var(--warning); max-height: 60px; overflow: auto; }
  .zoom-status:empty { display: none; }
  .frame-fitbar { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 7px 12px; border-bottom: 1px solid var(--hairline); }
  .frame-fitbar label { margin: 0; }
  .frame-fit-msg:empty { display: none; }
  .frame-fit-msg { flex: 1; min-width: 180px; font-size: 12px; }
  .fit-before { color: #ffbd69; }
  .fit-after { color: #44e5ff; }
  .frame-fitbar [hidden] { display: none; }
  .fit-trio, .chead .fit-trio { display: inline-flex; gap: 4px; align-items: center; }
  /* Expanded view: two tools in the bar; accept/cancel drop in as a row right under them, over the
     view, so nothing in the bar moves and the mouse travels one button height. */
  .fit-cluster { position: relative; display: inline-flex; }
  .fit-confirm { position: absolute; top: calc(100% + 4px); left: 0; z-index: 3; display: flex; gap: 4px; }
  .fit-confirm[hidden] { display: none; }
  .chead .fit-note { flex-basis: 100%; color: var(--body); font-size: 11px; line-height: 1.3; }
  .chead .fit-note.proposal { color: #44e5ff; }
  .view-max { position: absolute; top: 6px; right: 6px; z-index: 1; }
  .lidar-slot .reset-camera { right: 42px; }
  .zbody.solo { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .zbody.solo > :not(.solo-view) { display: none !important; }
  .zbody.solo > .solo-view { grid-column: 1; border-top: 0; }
  .view-max.on { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
  .zbody canvas { display: block; touch-action: none; }
  .zbody .cap { left: 12px; bottom: 8px; font-size: 11px; }
  .view .cap { top: 6px; bottom: auto; }
  .nav { display: flex; gap: 4px; align-items: center; }
  .nav .pos { min-width: 72px; text-align: center; color: var(--body); font-size: 12px; }
</style>
<button class="fab"><img class="logo" alt="">Resize track</button>
<div class="panel" hidden>
 <div class="side">
  <h3><img class="logo" alt=""><span class="name">Track Resizer</span><span class="badge job"></span>
    <button class="btn help-btn" title="Hướng dẫn">?</button><button class="close" title="Đóng" aria-label="Đóng">✕</button></h3>
  <div class="side-scroll">
  <div class="track-row"><select class="track" aria-label="Track"></select><button class="btn ico-btn refresh" title="Tải lại dữ liệu job" aria-label="Tải lại">${BTN_ICON.refresh}</button></div>
  <div class="review-row"><button class="btn quiet pick">Lấy object đang chọn</button>
    <span class="review-box"><label><input type="checkbox" class="review-done">Đã kiểm tra</label><span class="review-count"></span>
      <button class="btn ico-btn review-next" title="Item chưa kiểm tra tiếp" aria-label="Item chưa kiểm tra tiếp">${BTN_ICON.next}</button></span></div>
  <div class="sec">Kích thước</div>
  <div class="vals"></div>
  <div class="opt-inline">
    <label><input type="checkbox" class="bottom" checked>Giữ đáy</label>
    <label><input type="checkbox" class="lock" checked>Khóa kích thước cả track</label>
    <label><input type="checkbox" class="trail" checked>Vệt quỹ đạo (Top)</label>
  </div>
  <div class="edit-sec off" inert>
    <div class="sec"><span>Tự khớp</span><span class="need-preview">cần Xem trước</span></div>
    <select class="fit-kind" aria-label="Loại vật">
      <option value="rigid">Xe, vật cứng</option>
      <option value="soft">Người, xe đạp</option>
    </select>
    <div class="fitgrid">
      <label>Từ frame<input type="number" class="fit-a" min="0" step="1"></label>
      <label>Đến frame<input type="number" class="fit-b" min="0" step="1"></label>
      <label>Frame mẫu<input type="number" class="fit-ref" min="0" step="1" placeholder="tự chọn"></label>
    </div>
    <button class="btn primary fit">Tự khớp</button>
  </div>
  <div class="draft" hidden>
    <div class="sec">Bản nháp</div>
    <div class="chips sumtab"></div>
  </div>
  <div class="status" role="status" aria-live="polite"></div>
  <div class="split-summary" role="status" aria-live="polite" hidden></div>
  <div class="split-receipt" role="status" aria-live="polite" hidden></div>
  <div class="split-nav split-side-nav" hidden></div>
  <details class="advanced">
    <summary>Nâng cao</summary>
    <div class="option-row"><label><input type="checkbox" class="auto" checked>Tự động outside ≤</label>
      <input id="outside-threshold" type="number" class="thr" min="0" step="1" value="6" aria-label="Ngưỡng điểm outside"><span>điểm</span></div>
    <div class="option-row"><label><input type="checkbox" class="split-outside" checked>Tách khi outside ≥</label>
      <input id="outside-gap" type="number" class="split-gap" min="1" step="1" value="6" aria-label="Ngưỡng frame tách object"><span>frame</span></div>
    <div class="vault-controls">
      <b>Cache mã hóa</b>
      <div class="vault-status" role="status" aria-live="polite">Đang khóa — chỉ dùng RAM. Cache cũ chưa mã hóa được dọn sau lần mở khóa đầu tiên.</div>
      <p>Mở khóa: bấm biểu tượng CVAT Track Resizer trên thanh tiện ích Chrome. Chỉ nhập mật khẩu trong popup extension.</p>
      <div class="cache-btns"><button class="btn quiet vault-lock">Khóa mọi tab cùng server</button><button class="btn quiet vault-reset">Quên mật khẩu / Xóa kho</button></div>
      <small>Quên mật khẩu phải xóa kho. Xóa kho mất nguồn item đã lưu, không xóa annotation trên CVAT.</small>
    </div>
    <div class="cache-controls cache-row"><span class="cache-status" role="status" aria-live="polite"></span>
      <span class="cache-btns"><button class="btn quiet cache-toggle">Tải nền toàn job</button><button class="btn quiet cache-clear">Xóa cache</button></span></div>
  </details>
  </div>
  <div class="side-foot">
    <button class="btn preview">Xem trước</button>
    <button class="btn primary apply" disabled>Áp dụng</button>
  </div>
 </div>
 <div class="helpbox" hidden>
  <h5>Quy trình</h5>
  <ul><li>Chọn track, nhập L / W / H, bấm <b>Xem trước</b>.</li><li>Chỉnh box trên các mặt bên phải nếu cần, rồi bấm <b>Áp dụng</b>.</li>
    <li>Bấm <b>Áp dụng</b> cập nhật box trong CVAT; bấm <b>Save</b> của CVAT để lưu server.</li></ul>
  <h5>Chỉnh box</h5>
  <ul><li>Kéo <b>trong box</b> để di chuyển, kéo <b>cạnh</b> để đổi kích thước, kéo <b>chấm tròn phía trên box</b> để xoay theo view: Top quanh Z, Side quanh Y, Front quanh X.</li>
    <li>Giữ <b>Shift</b> khi kéo tay nắm xoay để bước 15°. Hướng box luôn hiện: X đỏ, Y xanh lá, Z xanh dương.</li>
    <li>Sửa ở frame nào, frame đó thành keyframe; các frame giữa hai keyframe tự nội suy. <b>Xoá keyframe</b> chỉ bỏ keyframe thừa, box ở mọi frame giữ nguyên vị trí (lệch ≤ 5 cm / 1°).</li>
    <li>Nút <b>con mắt</b>: ẩn / hiện frame. Nút <b>chìa khoá</b>: bật / tắt keyframe. Nền đỏ = đang bật.</li>
    <li>Class và attribute đổi ngay trên đầu mỗi frame (attribute đổi theo frame tạo keyframe).</li></ul>
  <h5>Tự khớp</h5>
  <ul><li>Đặt box <b>khít</b> ở frame mẫu (frame vật gần lidar nhất): kích thước và hình dạng lấy từ đó; để trống = keyframe nhiều điểm nhất.</li>
    <li>Khớp mọi frame từ frame đầu tới frame cuối; frame sửa tay được giữ nguyên.</li>
    <li><b>Xe, vật cứng</b>: xe đỗ, xe chạy, cột, rào. <b>Người, xe đạp</b>: chỉ khớp vị trí, hướng lấy theo keyframe.</li>
    <li>Frame khớp không chắc được đánh dấu: lọc bằng <b>Frame khớp kém</b> để xem lại.</li></ul>
  <h5>Khớp frame này</h5>
  <ul><li>Bấm icon khớp (khung có ô vuông) trên đầu mỗi frame thu nhỏ hoặc trên thanh view mở rộng; icon ✓ (chấp nhận) và ✕ (hủy) hiện sát bên (view mở rộng: ngay bên dưới) và ẩn sau khi chọn. <kbd>Enter</kbd> chấp nhận, <kbd>Esc</kbd> hủy.</li>
    <li>Luôn khớp vị trí (dịch tâm XY tối đa 50 cm), hướng (yaw tối đa ±15°) và sáu mặt. Yêu cầu ít nhất 30 điểm và |rx|, |ry| ≤ 0,01 rad (khoảng 0,57°). Box nghiêng hơn vẫn chỉnh tay được; xoay Side/Front 1° đã vượt giới hạn khớp.</li>
    <li>Sáu mặt: đầu/đuôi và hai bên theo điểm của vật (mặt chỉ lùi vào khi LiDAR thấy mặt đó, mỗi mặt đổi tối đa 50 cm), đáy lên mặt đường, nóc lên điểm cao nhất (cao đổi tối đa 60 cm). Khi <b>Khóa kích thước cả track</b> bật, kích thước mới áp cho cả track.</li>
    <li>Cam là box hiện tại, xanh là đề xuất. Nhận chỉ đổi bản nháp; một lần Undo hoàn tác. Số điểm tăng không đảm bảo box đúng hơn.</li></ul>
  <h5>Item mới sau outside</h5>
  <ul><li>Mặc định tách khi outside ≥ 6 frame liên tiếp; đây là số frame, khác ngưỡng số điểm để tự ẩn. Preview đánh dấu vàng <b>BẮT ĐẦU ITEM MỚI</b> và ghi nguồn từng đoạn.</li>
    <li><b>Đoạn gốc / Đoạn mới 2 / …</b> ở sidebar và frame mở rộng đưa tới đầu đoạn; sau Áp dụng chọn item tương ứng, giữ nháp khi chuyển.</li>
    <li>Chữ vàng <b>Tạo từ item #…</b> trên thanh số frame ghi nguồn. <b>Đến item gốc</b> mở đoạn đầu sau tách, không khôi phục track chưa tách. Nguồn item lưu mã hóa theo server/job khi mở khóa cache. Sau reload cần mở khóa để hiện lại nguồn. Save annotation trước khi tải lại; item chưa có ID chỉ được nhận lại nếu hình học khớp duy nhất. Không khôi phục được nguồn đã mất từ bản cũ.</li>
    <li>Bảng ID là lịch sử lần Áp dụng gần nhất, không tự cập nhật sau Undo/Redo/Save. Item mới có ID server sau Save; nếu item đích không còn tồn tại, tải lại danh sách.</li></ul>
  <h5>Vệt quỹ đạo</h5>
  <ul><li>Bật <b>Vệt quỹ đạo (Top)</b> để hiện đường nối tâm box các frame lân cận và khung mờ (ghost wireframe) của frame trước / sau trên khung nhìn Top, giúp căn chỉnh vị trí và hướng di chuyển mượt mà.</li></ul>
  <h5>Camera và kiểm tra item</h5>
  <ul><li>3D: kéo trái để xoay, kéo phải để pan, cuộn để zoom. Đổi frame giữ hướng nhìn và mức zoom tương đối, camera đi theo box. <b>Về box</b> hoặc double-click đặt lại góc nhìn.</li>
    <li><b>Đã kiểm tra</b> là dấu thủ công trên trình duyệt theo job và ID server; không tự đánh dấu sau khi khớp và không Save annotation. Item chưa có ID server chỉ giữ dấu trong phiên tab. Có thể bỏ dấu để kiểm tra lại.</li></ul>
  <h5>Tùy chọn và cache</h5>
  <ul><li>Giữ đáy khi đổi kích thước; khóa kích thước áp dụng thay đổi kích thước cho cả track. Tự động outside dựa vào số điểm; tách object theo số frame outside liên tiếp.</li>
    <li>Point cloud dùng chung giữa các item. Bấm biểu tượng extension trên thanh Chrome để đặt/mở mật khẩu cache riêng. Chưa mở khóa: chỉ RAM; đã mở: tải nền ưu tiên frame đang xem, lưu mã hóa tối đa 1 GiB. Xóa cache chỉ xóa cloud. Quên mật khẩu / Xóa kho xóa cả nguồn item đã lưu, không xóa annotation CVAT. Checklist/vị trí panel không mã hóa.</li></ul>
  <h5>Phím tắt</h5>
  <ul><li>View mở rộng: nút phóng ở góc mỗi view để xem riêng view đó, bấm lại để về bốn view. Top/Side/Front: cuộn chuột để phóng to/thu nhỏ quanh con trỏ (không giới hạn thu nhỏ ở 3×, pan tự do trên point cloud), kéo trái vùng trống khi tắt Kéo vùng (hoặc chuột phải/giữa) để di chuyển, double-click để về mặc định. Dữ liệu là point cloud frame hiện tại, không ghép map nhiều frame.</li>
    <li><b>Kéo vùng</b> (icon khung nét đứt bên trái icon khớp, nền đỏ khi bật): bật rồi kéo chuột trái ở vùng trống của Top/Side/Front để khoanh vùng vật: box nhảy về giữa các điểm trong vùng (Top: dọc + ngang; Side/Front: theo chiều ngang của view), giữ hướng và kích thước. Sau đó bấm khớp để chỉnh sát.</li>
    <li>Ở frame thu nhỏ hoặc mở rộng, chọn view rồi dùng ← ↑ ↓ → để dịch 5 cm; Shift: 1 cm, Alt: 20 cm; PageUp/Down: nâng/hạ.</li><li><kbd>,</kbd> / <kbd>.</kbd>: xoay −1° / +1° theo view (3D dùng yaw); Shift: 15°. Không chỉnh box khi đang nhập liệu.</li><li><kbd>D</kbd> / <kbd>F</kbd>: frame trước / sau. <kbd>Esc</kbd>: đóng hướng dẫn, nếu không thì hủy đề xuất khớp, nếu không thì thu nhỏ. <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd>: hoàn tác.</li></ul>
 </div>
 <div class="editor" hidden tabindex="-1">
  <div class="fbar">
    <span class="badge fcount"></span>
    <span class="item-origin" hidden><span class="item-origin-label"></span> <button class="btn sm" data-split-kind="origin" data-split-index="0">Đến item gốc</button></span>
    <span class="sp"></span>
    <label><input type="checkbox" class="only-key">Keyframe</label>
    <label><input type="checkbox" class="only-hid">Frame ẩn</label>
    <label><input type="checkbox" class="only-bad">Frame khớp kém</label>
    <button class="btn sm ico clear" title="Xoá keyframe thừa; box ở mọi frame giữ nguyên vị trí" aria-label="Xoá keyframe thừa">${BTN_ICON.clearKeys}</button>
    <button class="btn sm full" title="Toàn màn hình (ẩn cả thanh trình duyệt)" aria-label="Toàn màn hình">⛶</button>
    <button class="btn sm quiet eclose" title="Đóng xem trước; hỏi lại nếu còn chỉnh sửa chưa áp dụng">Thoát xem trước</button>
  </div>
  <div class="grid"></div>
  <div class="filter-empty" hidden role="status">Không có frame nào khớp bộ lọc đang chọn.<br><button class="btn reset-filters">Bỏ bộ lọc</button></div>
  <div class="zoom" hidden>
    <div class="chead zhead"></div>
    <div class="frame-fitbar">
      <span class="fit-cluster"><span class="fit-trio"><button class="btn sm ico region-mode" aria-pressed="false" title="Kéo vùng để đưa box về vật: bật rồi kéo chuột trái quanh vật ở Top/Side/Front" aria-label="Kéo vùng để đưa box về vật">${BTN_ICON.region}</button><button class="btn sm ico fit-current" title="Tự động khớp box frame này (vị trí, hướng và sáu mặt)" aria-label="Tự động khớp frame này">${BTN_ICON.fit}</button></span>
        <span class="fit-trio fit-confirm" hidden><button class="btn sm ico fit-accept" title="Chấp nhận (Enter)" aria-label="Chấp nhận">${BTN_ICON.accept}</button><button class="btn sm ico fit-cancel" title="Hủy (Esc)" aria-label="Hủy">${BTN_ICON.cancel}</button></span></span>
      <span class="frame-fit-msg" role="status" aria-live="polite"></span>
      <span class="fit-legend" hidden><span class="fit-before">Cam: hiện tại</span> · <span class="fit-after">Xanh: đề xuất</span></span>
    </div>
    <div class="zbody">
      <div class="lidar-slot"><canvas class="lidar-canvas" aria-label="LiDAR 3D: kéo trái để xoay, kéo phải để pan, cuộn để zoom"></canvas><div class="cap">LiDAR 3D · item đang chọn</div><button class="btn sm reset-camera" title="Đưa camera về box đang chọn">Về box</button><button class="btn sm ico view-max" data-slot="3" title="Phóng to riêng view này"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button><div class="lidar-message" role="status"></div></div>
      <div class="view"><canvas data-v="0" width="0" height="0"></canvas><div class="cap">Top · x–y</div><button class="btn sm ico view-max" data-slot="0" title="Phóng to riêng view này"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div>
      <div class="view"><canvas data-v="1" width="0" height="0"></canvas><div class="cap">Side · x–z</div><button class="btn sm ico view-max" data-slot="1" title="Phóng to riêng view này"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div>
      <div class="view"><canvas data-v="2" width="0" height="0"></canvas><div class="cap">Front · y–z</div><button class="btn sm ico view-max" data-slot="2" title="Phóng to riêng view này"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div>
    </div>
    <div class="split-nav split-zoom-nav" hidden></div>
    <div class="zoom-status" role="status" aria-live="polite"></div>
  </div>
 </div>
</div>`;

  // Outside the shadow root a keystroke's target is the host div, not an input, so CVAT
  // would treat typing in the panel as hotkeys (next frame, delete, ...). Keep keys inside.
  for (const type of ["keydown", "keyup", "keypress"]) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  const $ = (sel) => root.querySelector(sel);
  const fab = $(".fab"), panel = $(".panel");
  const logoUrl = globalThis.chrome && chrome.runtime && chrome.runtime.getURL && chrome.runtime.getURL("icons/icon128.png");
  root.querySelectorAll(".logo").forEach((img) => (logoUrl ? (img.src = logoUrl) : img.remove()));
  let jobId = null, job = null, annotations = null, labels = [], plan = null, planning = 0, dataGeneration = 0, saving = false, previewRun = null;
  let previewSettled = Promise.resolve(), switchGeneration = 0;
  const reviews = globalThis.CvatReviewState.create({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
  const previews = new Map(); // Per-item drafts only live in this tab; no point clouds/DOM here.

  for (const type of ["click", "change", "input", "pointerdown", "keydown"]) {
    root.addEventListener(type, (e) => {
      if (saving) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  // A long-running button doubles as its own progress bar; null puts its label back.
  function progress(btn, x, label) {
    if (x === null) {
      btn.classList.remove("busy");
      btn.style.removeProperty("--p");
      btn.textContent = label;
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(x * 100)));
    btn.classList.add("busy");
    btn.style.setProperty("--p", pct + "%");
    btn.textContent = pct + "%";
  }

  function setStatus(text, isError) {
    $(".status").textContent = text;
    $(".status").className = "status" + (isError ? " err" : "");
    $(".zoom-status").textContent = isError ? text : "";
  }

  const selectedTrack = () => annotations && annotations.tracks.find((t) => t.uiId === Number($(".track").value));

  function renderReviewState() {
    const track = selectedTrack(), tracks = annotations?.tracks || [];
    // One lookup table and one pass over the checklist, not a scan of all tracks per option.
    const checked = new Map(tracks.map(t => [t.uiId, reviews.has(jobId, t)]));
    $(".review-done").disabled = !track;
    $(".review-done").checked = !!track && !!checked.get(track.uiId);
    const done = tracks.filter(t => checked.get(t.uiId)).length;
    $(".review-count").textContent = `${done}/${tracks.length}`;
    $(".review-count").title = `${done}/${tracks.length} item đã kiểm tra`;
    $(".review-next").disabled = !tracks.some(t => t.uiId !== track?.uiId && !checked.get(t.uiId) && ["cuboid", "rectangle"].includes(t.shapes[0]?.type));
    for (const option of $(".track").options) {
      option.dataset.baseLabel ??= option.textContent;
      option.textContent = `${checked.get(Number(option.value)) ? "✓ " : ""}${option.dataset.baseLabel}`;
    }
  }

  function toggleItemReviewed() {
    const track = selectedTrack();
    if (!track) return;
    const checked = $(".review-done").checked, result = reviews.set(jobId, track, checked);
    renderReviewState();
    if (!result.persistent) setStatus("Dấu kiểm tra chỉ được giữ trong phiên tab này.", track.id != null);
  }

  async function nextUncheckedItem() {
    const tracks = annotations?.tracks || [], current = selectedTrack();
    const at = tracks.indexOf(current), ordered = [...tracks.slice(at + 1), ...tracks.slice(0, at)];
    const next = ordered.find(t => !reviews.has(jobId, t) && ["cuboid", "rectangle"].includes(t.shapes[0]?.type));
    if (next) await switchTrack(next.uiId);
  }

  // A setting changed: a preview being built is out of date, and a shown one must be rebuilt
  // before saving. Hand edits stay on screen until then.
  function markStale() {
    planning++;
    $(".apply").disabled = true;
    if (plan && !plan.stale) {
      plan.stale = true;
      setStatus(`Cài đặt đã đổi: bấm "Xem trước" để tính lại${dirty() ? " (các chỉnh tay sẽ bị bỏ)" : ""}.`);
    }
  }

  function closePlan() {
    closeEditor();
    plan = null;
    planning++;
    $(".apply").disabled = true;
    $(".split-summary").hidden = true;
    renderSplitNavigation();
  }

  function readSplitGap() {
    if (!$(".split-outside").checked) return 0;
    const gap = Number($(".split-gap").value);
    if (!Number.isSafeInteger(gap) || gap < 1) throw new Error("Nhập số frame tách object là số nguyên ≥ 1.");
    return gap;
  }

  let splitReceipt = null, splitNavigating = false;
  const itemOrigins = new Map(); // runtime client IDs; persisted identities never use client IDs
  let originsChanged = false;
  let originStorageWarning = "";

  function recordSplitOrigins(source, segments) {
    const oldID = source.clientID ?? source.uiId, first = segments?.[0];
    if (oldID == null || !first) return;
    originsChanged = true;
    const inherited = itemOrigins.get(oldID);
    itemOrigins.delete(oldID);
    // Applying even without splitting replaces client IDs. Keep existing children's parent link current.
    for (const [id, origin] of itemOrigins) if (origin.target.clientID === oldID) {
      itemOrigins.set(id, { ...origin, target: { ...first } });
    }
    if (inherited && first.clientID != null) itemOrigins.set(first.clientID, inherited);
    for (const part of segments.slice(1)) if (part.clientID != null) {
      itemOrigins.set(part.clientID, { source: { ...source }, target: { ...first } });
    }
  }

  // Keep only annotation identity fields; Save allocates track/shape IDs without changing these.
  function originIdentity(track) {
    const attrs = values => (values || []).map(a => [a.spec_id, a.value]).sort((a, b) => a[0] - b[0]);
    return { id: track.id ?? null, fingerprint: JSON.stringify([track.label_id, attrs(track.attributes),
      [...(track.shapes || [])].sort((a, b) => a.frame - b.frame).map(s =>
        [s.frame, s.type, s.points, !!s.outside, !!s.occluded, s.rotation ?? 0, attrs(s.attributes)])]) };
  }

  function resolveOriginIdentity(identity, tracks) {
    if (!identity || typeof identity.fingerprint !== "string") return null;
    // Once a server ID is known, never fall back to geometry if that ID disappeared.
    const matches = identity.id != null ? tracks.filter(t => t.id === identity.id) :
      tracks.filter(t => originIdentity(t).fingerprint === identity.fingerprint);
    return matches.length === 1 ? matches[0] : null;
  }

  async function syncStoredOrigins(tracks) {
    if (!cacheVault.unlocked) {
      originStorageWarning = "Cache đang khóa: nguồn item mới chỉ giữ trong RAM. Mở khóa trước khi đóng trang để lưu nguồn.";
      return;
    }
    const ownerJob = jobId;
    return cacheVault.withLock(async () => {
    if (ownerJob !== jobId) return;
    const key = `cvat-track-origins:v1:${jobId}`; // localStorage is already scoped to server origin
    try {
      const raw = await cacheVault.readOrigins(key), saved = raw ? JSON.parse(raw) : null;
      if (ownerJob !== jobId) return;
      if (saved && (saved.version !== 1 || !Array.isArray(saved.links))) throw new Error("Invalid origin storage");
      let links = (saved?.links || []).filter(link => link && link.source && link.target && link.child &&
        Number.isSafeInteger(link.startFrame) && Number.isSafeInteger(link.endFrame));
      if (originsChanged) {
        // Snapshot the new collection immediately after Apply, before native Save assigns IDs.
        const fresh = [];
        for (const [clientID, origin] of itemOrigins) {
          const child = tracks.find(t => t.clientID === clientID);
          const parent = tracks.find(t => t.clientID === origin.target.clientID);
          if (!child || !parent) continue;
          fresh.push({ child: originIdentity(child), target: originIdentity(parent),
            source: { uiId: origin.source.uiId ?? origin.source.clientID, id: origin.source.id },
            startFrame: origin.target.startFrame, endFrame: origin.target.endFrame });
        }
        // Keep unresolved history for native Undo/Redo; current links take precedence.
        links = links.filter(link => {
          const oldChild = resolveOriginIdentity(link.child, tracks);
          return !oldChild || !fresh.some(item => resolveOriginIdentity(item.child, tracks) === oldChild);
        });
        links.push(...fresh);
      }
      const restored = new Map();
      for (const link of links) {
        const child = resolveOriginIdentity(link.child, tracks), parent = resolveOriginIdentity(link.target, tracks);
        if (!child) continue;
        link.child = originIdentity(child); // promote to stable server ID after Save
        if (parent) link.target = originIdentity(parent);
        restored.set(child.clientID, { source: link.source, target: { clientID: parent?.clientID,
          id: parent?.id, startFrame: link.startFrame, endFrame: link.endFrame } });
      }
      // A failed write must keep the live links and display a persistence warning.
      await cacheVault.writeOrigins(key, JSON.stringify({ version: 1, links }));
      if (ownerJob !== jobId) return;
      itemOrigins.clear();
      for (const [id, origin] of restored) itemOrigins.set(id, origin);
      originsChanged = false;
      originStorageWarning = "";
    } catch {
      originStorageWarning = "Không lưu/đọc được nguồn item mã hóa; liên kết hiện tại chỉ giữ trong phiên. Mở khóa hoặc kiểm tra dung lượng trình duyệt.";
    }
    });
  }

  function renderItemOrigin() {
    const el = $(".item-origin");
    if (!el) return;
    const origin = itemOrigins.get(plan?.track.clientID);
    el.hidden = !origin;
    $(".item-origin-label").textContent = origin ? `Tạo từ ${splitSourceLabel(origin.source)}` : "";
    const button = el.querySelector("button");
    button.disabled = origin?.target.clientID == null;
    button.title = origin?.target.clientID == null ? "Chưa xác định được item gốc hiện tại" :
      `Đến đoạn gốc hiện tại: item #${origin.target.clientID}, frame ${origin.target.startFrame}`;
  }

  function renderSplitNavigation() {
    renderItemOrigin();
    let html = "";
    const buttons = (parts, kind) => parts.map((part, i) =>
      `<button class="btn sm" data-split-kind="${kind}" data-split-index="${i}" ${kind === "receipt" && part.clientID == null ? "disabled" : ""}>${i ? `Đoạn mới ${i + 1}` : "Đoạn gốc"} · ${part.startFrame}–${part.endFrame}</button>`).join("");
    if (plan?.cuts?.length) html += '<span class="nav-label">Chuyển đoạn trong bản nháp</span>' +
      buttons(CvatTrackSplit.ranges(plan.shapes, plan.cuts, job.start_frame, job.stop_frame), "preview");
    if (splitReceipt?.length > 1) html += '<span class="nav-label">Chọn item từ lần Áp dụng gần nhất</span>' + buttons(splitReceipt, "receipt");
    for (const selector of [".split-side-nav", ".split-zoom-nav"]) {
      const el = $(selector);
      if (el) { if (el.innerHTML !== html) el.innerHTML = html; el.hidden = !html; }
    }
  }

  async function navigateSplit(kind, index) {
    if (!Number.isSafeInteger(index) || index < 0 || splitNavigating) return;
    if (saving || fitting || previewRun !== null) return setStatus("Chờ tác vụ hiện tại xong rồi chuyển đoạn.", true);
    let part;
    const expanded = zoomFrame !== null;
    if (kind === "preview") {
      if (!plan?.cuts?.length) return;
      part = CvatTrackSplit.ranges(plan.shapes, plan.cuts, job.start_frame, job.stop_frame)[index];
    } else if (kind === "receipt" || kind === "origin") {
      const ownerJob = jobId, ownerPlan = plan;
      const currentLink = () => kind === "origin" ? itemOrigins.get(ownerPlan?.track.clientID) : splitReceipt;
      const receipt = currentLink();
      part = kind === "origin" ? receipt?.target : receipt?.[index];
      if (part?.clientID == null) return;
      splitNavigating = true;
      try {
        const fresh = await bridgeRequest("snapshot", { jobId: ownerJob });
        if (jobId !== ownerJob || currentLink() !== receipt || plan !== ownerPlan || saving || fitting || previewRun !== null) return;
        const target = fresh.annotations.tracks.find(t => t.clientID === part.clientID);
        const local = annotations.tracks.find(t => t.clientID === part.clientID);
        if (!target || !local || (part.id != null && target.id !== part.id)) {
          return setStatus("Item của đoạn này không còn khớp sau Undo/Redo hoặc tải lại. Bấm Tải lại để kiểm tra danh sách hiện tại.", true);
        }
        if (JSON.stringify(target.shapes) !== JSON.stringify(local.shapes) || target.label_id !== local.label_id) {
          return setStatus("Dữ liệu item đã đổi trong CVAT. Bấm Tải lại trước khi chuyển theo bảng kết quả.", true);
        }
        // Keep the existing switch path: it caches drafts and Undo for both items.
        if (plan?.track.clientID !== part.clientID) await switchTrack(local.uiId);
        if (jobId !== ownerJob || currentLink() !== receipt || plan?.track.clientID !== part.clientID) return;
      } finally { splitNavigating = false; }
    } else return;
    if (!part || !plan || !cells.has(part.startFrame)) return;
    for (const selector of [".only-key", ".only-hid", ".only-bad"]) $(selector).checked = false;
    applyFilters();
    setActive(part.startFrame);
    if (expanded) openZoom(part.startFrame);
    else reveal(part.startFrame);
    scheduleDraw();
  }

  function splitSourceLabel(track) {
    return `item #${track?.uiId ?? track?.clientID ?? "?"} · ${track?.id == null ? "chưa có ID server" : `ID server ${track.id}`}`;
  }

  function splitFrameLabel(f) {
    if (!plan?.cuts?.length) return "";
    const index = plan.cuts.filter(cut => cut.reappearFrame <= f).length;
    const start = index > 0 && plan.cuts[index - 1].reappearFrame === f;
    return `${start ? "BẮT ĐẦU ITEM MỚI · " : ""}Đoạn ${index + 1} từ ${splitSourceLabel(plan.track)}`;
  }

  function showSplitReceipt(source, segments) {
    recordSplitOrigins(source, segments);
    splitReceipt = segments?.length > 1 ? segments.map(part => ({ ...part })) : null;
    const el = $(".split-receipt");
    el.hidden = !segments || segments.length < 2;
    el.textContent = el.hidden ? "" : `Lần Áp dụng gần nhất — từ ${splitSourceLabel(source)}\n` +
      segments.map((part, i) => `Đoạn ${i + 1}: frame ${part.startFrame}–${part.endFrame} → ` +
        (part.clientID == null ? "chưa xác định item mới" : `item #${part.clientID} · ${part.id == null ? "chưa có ID server" : `ID server ${part.id}`}`)).join("\n") +
      "\nID tại thời điểm Áp dụng; chưa Save. Bảng lịch sử không cập nhật theo Undo/Redo/Save; mất khi tải lại trang.";
    renderSplitNavigation();
  }

  function updateSplitPreview() {
    const summary = $(".split-summary");
    summary.hidden = !plan;
    if (!plan) return;
    try {
      const gap = readSplitGap();
      plan.cuts = CvatTrackSplit.cuts(plan.shapes, gap, job.start_frame, job.stop_frame);
      summary.textContent = !gap ? "Không tách object theo outside." : !plan.cuts.length ?
        "Giữ 1 object." :
        `Sẽ tạo ${plan.cuts.length + 1} object riêng từ ${splitSourceLabel(plan.track)}\n` +
        CvatTrackSplit.ranges(plan.shapes, plan.cuts, job.start_frame, job.stop_frame).map((part, i) =>
          `Đoạn ${i + 1}${i ? " (item mới)" : plan.track?.id == null ? " (đoạn đầu)" : " (giữ ID server gốc)"}: frame ${part.startFrame}–${part.endFrame}` +
          (plan.cuts[i] ? ` · ẩn ${plan.cuts[i].outsideFrame}–${plan.cuts[i].reappearFrame - 1}` : "")).join("\n");
      $(".apply").disabled = plan.stale || saving;
    } catch (error) {
      plan.cuts = [];
      summary.textContent = error.message;
      $(".apply").disabled = true;
    }
    renderSplitNavigation();
  }

  const confirmDrop = () => !dirty() || confirm("Bỏ các chỉnh tay trong xem trước?");

  // The new size, prefilled with the track's size at the frame on screen (unchanged = size kept).
  function renderInputs() {
    const track = selectedTrack();
    const dims = track && track.shapes[0]?.type === "rectangle" ? ["W", "H"] : ["L", "W", "H"];
    let start = dims.map(() => 1);
    if (track && track.shapes.length && ["cuboid", "rectangle"].includes(track.shapes[0].type)) {
      try { start = sizeAt(track, currentFrame() ?? 0); } catch { start = sizeOf(byFrame(track.shapes)[0]); }
    }
    const box = $(".vals");
    box.innerHTML = dims.map((d, i) => `<label title="${({ L: "Dài (x)", W: "Rộng (y)", H: "Cao (z)" })[d]}">${d}<input type="number" class="v" step="0.01" value="${+start[i].toFixed(3)}"></label>`).join("");
    box.querySelectorAll("input").forEach((i) => i.addEventListener("input", markStale));
    markStale();
  }

  async function loadData(keep) {
    setStatus("Đang tải annotation…");
    const id = jobId, generation = ++dataGeneration;
    const loaded = await bridgeRequest("snapshot", { jobId: id });
    if (generation !== dataGeneration || id !== jobId) return;
    job = loaded.job;
    annotations = loaded.annotations;
    labels = loaded.labels;
    withUiIds(annotations);
    await syncStoredOrigins(annotations.tracks);
    if (generation !== dataGeneration || id !== jobId) return;
    const sel = $(".track");
    sel.innerHTML = annotations.tracks.length
      ? annotations.tracks.map((t) => {
          const frames = t.shapes.map((s) => s.frame);
          const serverText = t.id == null ? "chưa lưu" : `id ${t.id}`;
          return `<option value="${t.uiId}"${!t.shapes.length || !["cuboid", "rectangle"].includes(t.shapes[0].type) ? " disabled" : ""}>${serverText} (#${t.uiId}) · ${t.shapes[0]?.type || "rỗng"} · frame ${
            Math.min(...frames)}–${Math.max(...frames)} · ${t.shapes.length} keyframe</option>`;
        }).join("")
      : `<option value="">(job này không có track nào)</option>`;
    if (keep && annotations.tracks.some((t) => t.uiId === keep)) sel.value = String(keep);
    renderReviewState();
    setStatus(originStorageWarning || `${annotations.tracks.length} track.`, !!originStorageWarning);
    renderInputs();
    await prepareCache(job);
  }

  // New keyframes for the track: resized, and (optionally) outside wherever the box holds too few points.
  async function buildPlan(token) {
    const track = selectedTrack();
    if (!track) throw new Error("Chưa chọn track.");
    if (!track.shapes.length) throw new Error("Track không có keyframe.");
    const kind = track.shapes[0].type;
    if (!["cuboid", "rectangle"].includes(kind)) throw new Error(`Không hỗ trợ loại ${kind}.`);
    const dims = kind === "cuboid" ? 3 : 2;
    const inputs = [...root.querySelectorAll(".vals input")];
    if (inputs.some((i) => i.value.trim() === "" || !Number.isFinite(Number(i.value)))) throw new Error("Nhập đủ các số.");
    const vals = inputs.map((i) => Number(i.value));
    const fixed = vals;
    if (Math.min(...fixed) <= 0) throw new Error(`Kích thước phải dương, đang là ${fmt(fixed)}.`);
    const anchor = $(".bottom").checked ? "bottom" : "center";

    const original = byFrame(track.shapes);
    const keys = original.map((s) => {
      const old = sizeOf(s);
      return { ...s, points: resizedPoints(s, fixed.slice(), anchor) };
    });

    const auto = $(".auto").checked;
    const threshold = Number($(".thr").value);
    const counts = new Map(); // frame -> points inside, for frames where the track is visible
    if (auto) {
      if (kind !== "cuboid") throw new Error("Tự động outside chỉ dùng cho cuboid 3D.");
      if (!Number.isInteger(threshold) || threshold < 0) throw new Error("Ngưỡng điểm phải là số nguyên ≥ 0.");
      const frames = [];
      for (let f = keys[0].frame; f <= job.stop_frame; f++) {
        const pos = positionAt(keys, f);
        if (pos && !pos.outside) frames.push(f);
      }
      let done = 0;
      let cursor = 0;
      const total = frames.length, next = () => frames[cursor++];
      const worker = async () => {
        for (let f = next(); f !== undefined; f = next()) {
          if (token !== planning) throw new Error("cancelled");
          const box = positionAt(keys, f).points, key = `${jobId}:${track.clientID ?? track.id}:${f}:${box.join(",")}`;
          let n = counted.get(key);
          if (n === undefined) {
            const b = boxFrame(box), xyz = await nearCloud(track.clientID ?? track.id, f, b.center, b.reach);
            if (token !== planning) throw new Error("cancelled");
            n = countInside(xyz, box);
            counted.set(key, n);
            while (counted.size > 20000) counted.delete(counted.keys().next().value);
          }
          counts.set(f, n);
          progress($(".preview"), ++done / total);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      const sorted = [...counts].sort((a, b) => a[0] - b[0]); // workers finish out of order
      counts.clear();
      sorted.forEach(([f, n]) => counts.set(f, n));
    }

    // Keyframes are rebuilt from the per-frame state. A run of hidden frames is opened by an outside
    // keyframe and closed by a visible one, and the frame before the run keeps a visible keyframe,
    // so every other frame keeps exactly the position it had.
    const result = new Map(keys.map((s) => [s.frame, { ...s }]));
    const setKey = (f, outside) => {
      const left = [...keys].reverse().find((s) => s.frame <= f);
      const s = result.get(f) || { ...left, id: undefined, attributes: [], frame: f, points: positionAt(keys, f).points };
      if (!result.has(f)) delete s.id;
      result.set(f, { ...s, outside });
    };
    const hidden = (f) => counts.has(f) && counts.get(f) <= threshold;
    for (const f of counts.keys()) {
      const prevVisible = counts.has(f - 1) && !hidden(f - 1);
      if (hidden(f)) {
        if (!counts.has(f - 1) || prevVisible) {
          if (prevVisible) setKey(f - 1, false);
          setKey(f, true);
        } else if (result.has(f)) {
          setKey(f, true);
        }
      } else if (counts.has(f - 1) && hidden(f - 1)) {
        setKey(f, false);
      }
    }
    const shapes = [...result.values()].sort((a, b) => a.frame - b.frame);
    return { track, baseline: JSON.parse(JSON.stringify(track)), shapes, original, counts, threshold };
  }

  function ranges(frames) {
    const out = [];
    for (const f of frames) {
      const last = out[out.length - 1];
      if (last && f === last[1] + 1) last[1] = f; else out.push([f, f]);
    }
    return out;
  }

  async function preview() {
    if (previewRun !== null) {
      planning++;
      $(".preview").disabled = true;
      setStatus("Đang dừng xem trước…");
      return;
    }
    if (!confirmDrop()) return;
    closePlan();
    const token = planning;
    previewRun = token;
    let settled;
    previewSettled = new Promise(resolve => { settled = resolve; });
    $(".preview").title = "Bấm lần nữa để dừng xem trước";
    setStatus($(".auto").checked ? "Đang quét point cloud…" : "Đang dựng xem trước…");
    if ($(".auto").checked) progress($(".preview"), 0);
    Object.assign(cloudStats, { frames: 0, bytes: 0, fetchMs: 0, parseMs: 0, since: performance.now() });
    try {
      const result = await buildPlan(token);
      if (token !== planning) return;
      plan = result;
    } catch (e) {
      if (token === planning) setStatus(e.message, true);
      return;
    } finally {
      const cancelled = token !== planning;
      previewRun = null;
      $(".preview").disabled = false;
      $(".preview").title = "";
      progress($(".preview"), null, "Xem trước");
      if (cancelled && job && !plan) setStatus("Đã dừng xem trước.");
      logCloudStats("Xem trước");
      settled();
    }
    plan.manual = new Set(); // frames edited by hand in the preview
    plan.flagged = new Set(); // frames the auto fit could not match well
    plan.track = { ...plan.track, attributes: (plan.track.attributes || []).slice() };
    plan.stale = false;
    updateSplitPreview();
    const hiddenFrames = [...plan.counts].filter(([, n]) => n <= plan.threshold).map(([f]) => f);
    const hiddenText = !plan.counts.size ? "" : hiddenFrames.length
      ? `\nOutside (≤ ${plan.threshold} điểm): frame ${ranges(hiddenFrames).map(([a, b]) => a === b ? a : `${a}–${b}`).join(", ")}.`
      : `\nKhông frame nào có ≤ ${plan.threshold} điểm.`;
    const serverLabel = plan.track.id != null ? `id ${plan.track.id} (#${plan.track.uiId})` : `#${plan.track.uiId}`;
    setStatus(`Track ${serverLabel}: ${plan.shapes.length} keyframe.${hiddenText}`);
    if (plan.track.shapes[0]?.type === "cuboid") openEditor();
  }

  async function apply() {
    endDrag();
    if (!plan || plan.stale || saving) return;
    if (fitting) return setStatus("Chờ tự khớp xong hoặc dừng trước khi áp dụng.", true);
    let splitGap;
    try { splitGap = readSplitGap(); } catch (error) { return setStatus(error.message, true); }
    saving = true;
    const applyingPlan = plan, applyingJob = jobId;
    $(".apply").disabled = true;
    setStatus("Đang áp dụng vào CVAT…");
    let applied = false;
    try {
      const result = await bridgeRequest("apply", {
        jobId: applyingJob,
        baseline: applyingPlan.baseline,
        track: { ...applyingPlan.track, shapes: applyingPlan.shapes },
        splitGap,
      });
      applied = result.applied;
      if (applyingJob !== jobId || applyingPlan !== plan) return;
      showSplitReceipt(applyingPlan.track, result.segments);
      closePlan();
      await loadData(result.clientID);
      setStatus(originStorageWarning || result.warning || `Đã áp dụng ${result.trackCount || 1} object vào CVAT, chưa lưu server.`, !!(originStorageWarning || result.warning));
    } catch (e) {
      if (applyingJob === jobId) {
        if (plan === applyingPlan) plan.stale = true;
        setStatus((applied ? "Đã áp dụng vào CVAT nhưng chưa tải lại danh sách tool. " : "") + e.message + (e.message.includes("Tải lại") ? "" : " Bấm Tải lại trong tool trước khi tiếp tục."), true);
      }
    } finally {
      saving = false;
    }
  }

  function savePreview() {
    endDrag();
    if (!plan) return;
    const values = {}, checks = {};
    for (const name of ["thr", "split-gap", "fit-a", "fit-b", "fit-ref", "fit-kind"]) values[name] = $("." + name).value;
    for (const name of ["bottom", "auto", "split-outside", "lock", "trail", "only-key", "only-hid", "only-bad"]) {
      if ($("." + name)) checks[name] = $("." + name).checked;
    }
    previews.set(plan.track.uiId, { plan, undo: undoStack.slice(), values, checks,
      inputs: [...root.querySelectorAll(".vals input")].map(input => input.value),
      active: activeFrame, zoom: zoomFrame, scroll: grid.scrollTop });
  }

  async function switchTrack(id) {
    if (fitting) {
      $(".track").value = String(plan.track.uiId);
      renderReviewState();
      return setStatus("Dừng tự khớp trước khi chuyển item.", true);
    }
    const generation = ++switchGeneration;
    savePreview();
    closePlan();
    $(".track").value = String(id);
    renderReviewState();
    renderInputs();
    // Let an old outside scan finish cancellation before building the next item.
    await previewSettled;
    if (generation !== switchGeneration || !selectedTrack()) return;
    const saved = previews.get(id);
    if (!saved) return preview();
    previews.delete(id);
    plan = saved.plan;
    // Keep edits visible but disallow Apply if a refresh changed the source track.
    if (JSON.stringify(plan.baseline) !== JSON.stringify(selectedTrack())) plan.stale = true;
    for (const [name, checked] of Object.entries(saved.checks)) if ($("." + name)) $("." + name).checked = checked;
    root.querySelectorAll(".vals input").forEach((input, i) => { input.value = saved.inputs[i]; });
    if (plan.track.shapes[0].type === "cuboid") openEditor();
    for (const [name, value] of Object.entries(saved.values)) $("." + name).value = value;
    undoStack = saved.undo;
    if (saved.active !== null && cells.has(saved.active)) setActive(saved.active);
    grid.scrollTop = saved.scroll;
    if (saved.zoom !== null && cells.has(saved.zoom)) openZoom(saved.zoom);
    updateSplitPreview();
    setStatus(plan.stale ? "Đã khôi phục chỉnh sửa; dữ liệu hoặc cài đặt đã đổi. Xem trước lại trước khi Áp dụng." :
      `Đã khôi phục preview item #${id}, gồm chỉnh sửa và Undo.`, plan.stale);
  }

  async function pickActive() {
    const ui = activeUiId();
    if (ui === null) return setStatus("Chưa chọn object nào trên CVAT (bấm vào object ở sidebar).", true);
    const track = annotations && annotations.tracks.find((t) => t.uiId === ui);
    if (!track) {
      return setStatus(`Object #${ui} không có trong danh sách track hiện tại. Bấm Tải lại trong tool để đọc thay đổi mới nhất.`, true);
    }
    if (plan && plan.track.clientID === track.clientID) return setStatus(`Track #${ui} đang được xem trước.`);
    await switchTrack(track.uiId);
  }

  // ---------- preview editor: three views per frame ----------
  // After "Xem trước" the planned keyframes can be adjusted by hand on Top / Side / Front views of
  // every frame, drawn in the box's own axes (full XYZ rotation). Editing a frame makes it a
  // keyframe, so CVAT's interpolation carries the change to the frames around it. Only frames on
  // screen get canvases, clouds and redraws, so long tracks stay light.

  const VIEWS = [
    { cap: "Top · x–y", axis: "Z", a: 0, b: 1, c: 2 },
    { cap: "Side · x–z", axis: "Y", a: 0, b: 2, c: 1 },
    { cap: "Front · y–z", axis: "X", a: 1, b: 2, c: 0 },
  ];
  const CELL_PX = 300; // canvas bitmap of a grid view
  const editor = $(".editor"), grid = $(".grid"), zoom = $(".zoom"), zoomCanvases = [...root.querySelectorAll(".zbody canvas[data-v]")];
  const cells = new Map(); // frame -> { cell, head, canvases }
  const visible = new Set(); // frames whose cell is on screen
  const loadState = new Map(); // frame -> "loading" | Error; absent = nothing pending
  const queue = [];
  let frames = [], undoStack = [], drag = null, zoomFrame = null, activeFrame = null, editGen = 0, loading = 0, drawPending = false;
  let lidar = null, lidarRequest = 0, keyboardView = 0, nudgeKey = null, lidarCamera = null;
  let frameFit = null, frameFitEpoch = 0, frameFitNote = null;
  // Expanded orthographic views: k scales the default range (minimum 0.1, no zoom-out cap),
  // u/w is the window center as a share of the default range. soloSlot: 0–2 ortho, 3 LiDAR.
  let orthoZoom = VIEWS.map(() => ({ k: 1, u: 0, w: 0 })), soloSlot = null, panDrag = null;
  // regionMode (toggle beside the fit icon): a left drag on empty space of an expanded view draws the
  // region the box goes to; when off, that drag pans like a right/middle drag.
  let regionDrag = null, regionMode = false;

  const mul = (R, v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const mulT = (R, v) => [0, 1, 2].map((j) => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]);
  const toLocal = (F, w) => mulT(F.R, [w[0] - F.center[0], w[1] - F.center[1], w[2] - F.center[2]]);
  const toWorld = (F, l) => mul(F.R, l).map((x, i) => x + F.center[i]);
  const matMul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));

  // Back from a rotation matrix to the three.js XYZ Euler angles CVAT stores (inverse of boxFrame).
  function eulerXYZ(m) {
    const ry = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
    if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), ry, Math.atan2(-m[0][1], m[0][0])];
    return [Math.atan2(m[2][1], m[1][1]), ry, 0];
  }

  // Compose a local rotation in the displayed (a,b) plane, retaining CVAT's XYZ Euler storage.
  // Positive angles move counterclockwise on screen: +Z (Top), -Y (Side), +X (Front).
  function rotatedInView(points, v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), turn = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    turn[v.a][v.a] = turn[v.b][v.b] = c;
    turn[v.a][v.b] = -s; turn[v.b][v.a] = s;
    const result = points.slice();
    eulerXYZ(matMul(boxFrame(points).R, turn)).forEach((value, i) => { result[3 + i] = value; });
    return result;
  }

  function orientationInView(points, reference, v, axis) {
    const local = [0, 0, 0]; local[axis] = 1;
    const direction = mulT(boxFrame(reference).R, mul(boxFrame(points).R, local));
    return { u: direction[v.a], w: direction[v.b], depth: direction[v.c] * (v.a === 0 && v.b === 2 ? -1 : 1) };
  }

  function rotateFrame(f, v, degrees) {
    if (!plan || fitting || !Number.isFinite(degrees)) return;
    endDrag();
    const before = snapshot(), points = stateAt(f).points;
    setGeometry(f, rotatedInView(points, v, degrees * Math.PI / 180), null);
    commit(before);
    setActive(f);
    modelChanged();
  }

  const stateAt = (f) => positionAt(plan.shapes, f);
  const keyAt = (f) => plan.shapes.find((s) => s.frame === f);
  const isFirstKey = (f) => plan.shapes[0].frame === f;
  const anchor = () => ($(".bottom").checked ? "bottom" : "center");
  const dirty = () => !!plan && (plan.manual.size > 0 || undoStack.length > 0);
  // Metres shown from a view's center to its edge.
  const viewRange = (p, v) => Math.max(p[6 + v.a], p[6 + v.b]) / 2 * 1.35 + 0.5;
  const viewReach = (p) => Math.max(...VIEWS.map((v) => viewRange(p, v))) * Math.SQRT2;
  // What a view shows: half-width in metres and the center offset in the box's view axes.
  function viewWindow(p, i, zoomed) {
    const base = viewRange(p, VIEWS[i]), z = zoomed ? orthoZoom[i] : { k: 1, u: 0, w: 0 };
    return { range: base * z.k, cu: z.u * base, cw: z.w * base };
  }
  // Crop a frame needs: zoomed-out or panned expanded views reach further than the default.
  function frameReach(f, p) {
    if (f !== zoomFrame) return viewReach(p);
    return Math.max(viewReach(p), ...VIEWS.map((v, i) => { const w = viewWindow(p, i, true); return (w.range + Math.hypot(w.cu, w.cw)) * Math.SQRT2; }));
  }
  // Canvas pixels per on-screen unit, so points, lines and grab zones look alike in every view size.
  const dotOf = (cv) => cv.width / (cv.clientWidth || cv.width) * 0.6;

  // The keyframe at a frame, created from the interpolated state when there is none yet.
  function ensureKey(f) {
    const old = keyAt(f);
    if (old) return old;
    const pos = stateAt(f);
    const { id, ...left } = [...plan.shapes].reverse().find((s) => s.frame < f) || plan.shapes[0];
    const key = { ...left, attributes: [], frame: f, points: pos.points, outside: pos.outside };
    plan.shapes.push(key);
    plan.shapes.sort((a, b) => a.frame - b.frame);
    return key;
  }

  const snapshot = () => ({ shapes: plan.shapes.map((s) => ({ ...s, points: s.points.slice() })), manual: [...plan.manual],
                            inputs: [...root.querySelectorAll(".vals input")].map((i) => i.value), label_id: plan.track.label_id, attributes: plan.track.attributes, flagged: [...plan.flagged] });
  function commit(snap) {
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
  }
  function undo() {
    if (fitting) return;
    endDrag();
    const snap = undoStack.pop();
    if (!snap) return;
    plan.shapes = snap.shapes;
    root.querySelectorAll(".vals input").forEach((input, i) => (input.value = snap.inputs[i]));
    plan.manual = new Set(snap.manual);
    plan.track.label_id = snap.label_id;
    plan.track.attributes = snap.attributes;
    plan.flagged = new Set(snap.flagged);
    modelChanged();
  }

  // Locked size: a size edit on one frame resizes every keyframe, so the whole track keeps one size.
  function setGeometry(f, points, size) {
    ensureKey(f).points = points;
    plan.manual.add(f);
    plan.flagged.delete(f);
    if (size && $(".lock").checked) {
      for (const s of plan.shapes) if (s.frame !== f) s.points = resizedPoints(s, size, anchor());
      root.querySelectorAll(".vals input").forEach((i, k) => (i.value = +size[k].toFixed(3)));
    }
  }

  // Hides or shows only this frame: CVAT keeps a state until the next keyframe, so the next frame is
  // pinned to what it was first.
  function toggleOutside(f) {
    if (fitting) return;
    endDrag();
    const snap = snapshot(), cur = stateAt(f);
    if (f < frames[frames.length - 1]) ensureKey(f + 1);
    ensureKey(f).outside = !cur.outside;
    plan.manual.add(f);
    plan.flagged.delete(f);
    commit(snap);
    modelChanged();
  }

  function toggleKey(f) {
    if (fitting) return;
    if (keyAt(f)) return dropKey(f);
    endDrag();
    commit(snapshot());
    ensureKey(f);
    plan.manual.add(f);
    modelChanged();
  }

  function dropKey(f) {
    if (fitting || isFirstKey(f) || !keyAt(f)) return; // the first keyframe starts the track
    endDrag();
    commit(snapshot());
    plan.shapes = plan.shapes.filter((s) => s.frame !== f);
    plan.manual.delete(f);
    modelChanged();
  }

  // ---- class and attributes ----
  // The class and immutable attributes belong to the track; a mutable attribute is set by
  // keyframes and keeps its value until a later keyframe sets it again, like in CVAT.

  const ICON = {
    eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>',
    key: '<svg viewBox="0 0 24 24"><circle cx="7" cy="17" r="4.5"/><path d="M10.2 13.8L21 3M16.5 7.5l3 3M13.8 10.2l2.2 2.2"/></svg>',
    zoom: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  };

  const labelOf = (id) => labels.find((l) => l.id === id);
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function attrValues(f) {
    const vals = new Map();
    for (const a of (labelOf(plan.track.label_id) || {}).attributes || []) vals.set(a.id, a.default_value);
    for (const a of plan.track.attributes) vals.set(a.spec_id, a.value);
    for (const s of plan.shapes) {
      if (s.frame > f) break;
      for (const a of s.attributes || []) vals.set(a.spec_id, a.value);
    }
    return vals;
  }

  const withValue = (list, spec, value) => [...(list || []).filter((a) => a.spec_id !== spec), { spec_id: spec, value }];

  function setAttribute(f, spec, value) {
    endDrag();
    const def = ((labelOf(plan.track.label_id) || {}).attributes || []).find((a) => a.id === spec);
    if (!def || attrValues(f).get(spec) === value) return;
    commit(snapshot());
    if (def.mutable) {
      const key = ensureKey(f);
      key.attributes = withValue(key.attributes, spec, value);
      plan.manual.add(f);
    } else {
      plan.track.attributes = withValue(plan.track.attributes, spec, value);
    }
    modelChanged();
  }

  // A new class brings its own attributes, all at their defaults.
  function setLabel(id) {
    endDrag();
    const label = labelOf(id);
    if (!label || id === plan.track.label_id) return;
    commit(snapshot());
    const defs = label.attributes || [];
    plan.track.label_id = id;
    plan.track.attributes = defs.filter((a) => !a.mutable).map((a) => ({ spec_id: a.id, value: a.default_value }));
    const first = defs.filter((a) => a.mutable).map((a) => ({ spec_id: a.id, value: a.default_value }));
    plan.shapes = plan.shapes.map((s, i) => ({ ...s, attributes: i ? [] : first }));
    modelChanged();
  }

  function attrControl(f, def, value) {
    const data = `data-f="${f}" data-spec="${def.id}"`;
    let values = null;
    if (def.input_type === "select" || def.input_type === "radio") values = def.values;
    else if (def.input_type === "checkbox") values = ["true", "false"];
    else if (def.input_type === "number") {
      const [min, max, step] = def.values.map(Number);
      if (step > 0 && (max - min) / step <= 100) values = Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => String(+(min + i * step).toFixed(6)));
      else return `<input type="number" ${data} min="${min}" max="${max}" step="${step || "any"}" value="${esc(value)}">`;
    } else return `<input type="text" ${data} value="${esc(value)}">`;
    if (!values.includes(value)) values = [value, ...values];
    return `<select ${data}>${values.map((v) => `<option${v === value ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  }

  function classHtml(f) {
    const label = labelOf(plan.track.label_id);
    if (!label) return `<span class="cls" title="Class">#${plan.track.label_id}</span>`;
    const choices = labels.filter((l) => !l.type || l.type === "any" || l.type === "cuboid" || l.id === label.id);
    const vals = attrValues(f);
    return `<select data-f="${f}" data-label title="Class">${choices.map((l) =>
        `<option value="${l.id}"${l.id === label.id ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` +
      (label.attributes || []).map((a) => attrControl(f, a, vals.get(a.id))
        .replace(/^<(select|input)/, `<$1 title="${esc(a.name)}${a.mutable ? " (đổi theo frame)" : " (cả track)"}"`)).join("");
  }

  // Keeps the first keyframe (the track starts there) and the last one (so the track still ends
  // where it did); everything between is interpolated from those two.
  // Keyframes whose state the others already give: CVAT's interpolation between the keyframes kept
  // stays within FIT.posTol (centre and size) and FIT.yawTol (angles) of what every frame shows now.
  // The first and last keyframe, outside changes and keyframes that set attributes always stay.
  function essentialKeys(shapes) {
    const keep = new Set(), state = (s) => positionAt(shapes, s.frame).points;
    shapes.forEach((s, i) => {
      if (i === 0 || i === shapes.length - 1 || s.outside !== shapes[i - 1].outside || s.attributes?.length) keep.add(i);
    });
    const err = (a, b, k) => {
      const pa = state(shapes[a]), pb = state(shapes[b]), type = shapes[k].type;
      const p = positionAt([{ frame: shapes[a].frame, type, points: pa }, { frame: shapes[b].frame, type, points: pb }], shapes[k].frame).points;
      const q = shapes[k].points, angles = type === "cuboid" ? [3, 4, 5] : [];
      return Math.max(...q.map((x, j) => angles.includes(j) ? Math.abs(wrapAngle(p[j] - x)) / FIT.yawTol : Math.abs(p[j] - x) / FIT.posTol));
    };
    // Between two kept keyframes the interpolated track is piecewise linear with its corners at the
    // keyframes in between, so the largest error is always at one of them.
    const split = (a, b) => {
      let worst = 1, at = -1;
      for (let k = a + 1; k < b; k++) { const e = err(a, b, k); if (e > worst) { worst = e; at = k; } }
      if (at < 0) return;
      keep.add(at);
      split(a, at);
      split(at, b);
    };
    const fixed = [...keep].sort((x, y) => x - y);
    for (let i = 0; i + 1 < fixed.length; i++) split(fixed[i], fixed[i + 1]);
    return shapes.filter((_, i) => keep.has(i));
  }

  function clearKeys() {
    if (fitting) return;
    endDrag();
    const kept = essentialKeys(plan.shapes), n = plan.shapes.length - kept.length;
    if (n <= 0) return setStatus("Không có keyframe thừa: mỗi keyframe đều cần để giữ vị trí box.");
    if (!confirm(`Xoá ${n} keyframe thừa, giữ ${kept.length} keyframe?\nBox ở mọi frame giữ nguyên vị trí (lệch tối đa 5 cm / 1°). Có thể hoàn tác.`)) return;
    commit(snapshot());
    plan.shapes = kept;
    const frames = new Set(kept.map((s) => s.frame));
    plan.manual = new Set([...plan.manual].filter((f) => frames.has(f)));
    modelChanged();
  }


  function modelChanged() {
    cancelFrameFit();
    updateSplitPreview();
    applyFilters();
    scheduleDraw();
  }

  // ---- auto fit for rigid objects ----
  // From a reference frame where the box is right, the points inside it become a template of the
  // object (box axes, yaw only). Walking frame by frame away from it, the template is searched for
  // around where the box is expected (constant velocity, or the current keyframes), then aligned
  // with ICP on x, y, z and yaw; the size stays fixed. Points seen in good fits grow the template, so
  // sides that come into view later still match. Frames with too few matching points get a box
  // interpolated from good neighbours and are flagged for review. The dense result is reduced to the
  // keyframes CVAT's linear interpolation needs.

  const FIT = {
    voxel: 0.08, // template resolution (m)
    cells: [0.15, 0.3], // nearest-neighbour grids; the widest is also the widest ICP match distance
    score: 0.2, // coarse search: a target point scores when within one cell of the template
    near: 0.15, // final ICP match distance; inlier distance
    ground: 0.15, // points lower than this above the box floor are treated as ground
    minPts: 8, // fewer object points than this: not fitted
    minRatio: 0.5, // fewer template matches than this share: not fitted
    minDensity: 0.3, // fewer object points than this share of the last good fit: occluded, not fitted
    learn: 0.85, // template matches needed before a frame's points join the template
    posTol: 0.05, yawTol: Math.PI / 180, // keyframe reduction tolerance
  };
  let fitting = null; // { cancelled } while a fit runs

  const poseOf = (p) => ({ x: p[0], y: p[1], z: p[2], yaw: p[5] });
  const cellKey = (ix, iy, iz) => (ix + 1024) * 4194304 + (iy + 1024) * 2048 + (iz + 1024);
  const lerpPose = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
                                   yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * t });

  // occ: a byte per FIT.score cell over the box plus a margin, set around every template point, so
  // the coarse search scores a point with one array read.
  function newTemplate(size) {
    const pad = 0.6, s = FIT.score, dims = size.map((v) => Math.ceil((v + 2 * pad) / s));
    return { n: 0, seen: new Set(), grids: FIT.cells.map(() => new Map()),
             occ: { cells: new Uint8Array(dims[0] * dims[1] * dims[2]), dims, origin: size.map((v) => -v / 2 - pad) } };
  }
  function addPoint(T, x, y, z) {
    const v = FIT.voxel, k = cellKey(Math.floor(x / v), Math.floor(y / v), Math.floor(z / v));
    if (T.seen.has(k)) return;
    T.seen.add(k);
    T.n++;
    FIT.cells.forEach((c, i) => {
      const g = cellKey(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)), grid = T.grids[i];
      if (!grid.has(g)) grid.set(g, []);
      grid.get(g).push(x, y, z);
    });
    const o = T.occ, [nx, ny, nz] = o.dims, s = FIT.score;
    const ix = Math.floor((x - o.origin[0]) / s), iy = Math.floor((y - o.origin[1]) / s), iz = Math.floor((z - o.origin[2]) / s);
    for (let a = Math.max(0, ix - 1); a <= Math.min(nx - 1, ix + 1); a++)
      for (let b = Math.max(0, iy - 1); b <= Math.min(ny - 1, iy + 1); b++)
        for (let c = Math.max(0, iz - 1); c <= Math.min(nz - 1, iz + 1); c++) o.cells[(a * ny + b) * nz + c] = 1;
  }
  // Closest template point within dmax (≤ the widest cell) as [x, y, z, d²], or null. Uses the finest
  // grid whose cells are at least dmax, so the 27 cells around the point cover the search.
  function nearest(T, x, y, z, dmax) {
    const i = FIT.cells.findIndex((c) => c >= dmax), c = FIT.cells[i], grid = T.grids[i];
    const ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    let best = dmax * dmax, hit = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      const pts = grid.get(cellKey(ix + a, iy + b, iz + d));
      if (!pts) continue;
      for (let k = 0; k < pts.length; k += 3) {
        const dx = pts[k] - x, dy = pts[k + 1] - y, dz = pts[k + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; hit = [pts[k], pts[k + 1], pts[k + 2], d2]; }
      }
    }
    return hit;
  }

  // Calls visit(world index, lx, ly, lz) for target points in the object region of pose P: above the
  // floor and within `margin` of the box sides and top.
  function forObjectPoints(Q, P, size, margin, visit) {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), hx = size[0] / 2 + margin, hy = size[1] / 2 + margin;
    const floor = -size[2] / 2 + FIT.ground, top = size[2] / 2 + margin;
    for (let k = 0; k < Q.length; k += 3) {
      const dx = Q[k] - P.x, dy = Q[k + 1] - P.y, lz = Q[k + 2] - P.z;
      if (lz < floor || lz > top) continue;
      const lx = c * dx + s * dy, ly = -s * dx + c * dy;
      if (Math.abs(lx) > hx || Math.abs(ly) > hy) continue;
      visit(k, lx, ly, lz);
    }
  }

  // Points on the template minus points in the box that are not: a pose that takes in part of a
  // neighbouring object gains its touching face but loses more where the object itself no longer fits.
  // (Inlined object-region test: this runs for every point of every search candidate.)
  function score(T, Q, P, size) {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), hx = size[0] / 2 + 0.15, hy = size[1] / 2 + 0.15;
    const floor = -size[2] / 2 + FIT.ground, top = size[2] / 2 + 0.15;
    const { cells, dims, origin } = T.occ, ny = dims[1], nz = dims[2], inv = 1 / FIT.score;
    let sc = 0;
    for (let k = 0; k < Q.length; k += 3) {
      const dx = Q[k] - P.x, dy = Q[k + 1] - P.y, lz = Q[k + 2] - P.z;
      if (lz < floor || lz > top) continue;
      const lx = c * dx + s * dy, ly = -s * dx + c * dy;
      if (lx > hx || lx < -hx || ly > hy || ly < -hy) continue;
      const i = (((lx - origin[0]) * inv) | 0) * ny + (((ly - origin[1]) * inv) | 0);
      sc += cells[i * nz + (((lz - origin[2]) * inv) | 0)] ? 1 : -1;
    }
    return sc;
  }

  // Point-to-point ICP over x, y, z and yaw, starting from the coarse search (within ~0.2 m);
  // correspondences go from what the frame sees to the template.
  function icp(T, Q, P0, size) {
    let P = { ...P0 };
    for (let it = 0; it < 12; it++) {
      const dmax = it < 5 ? 0.3 : FIT.near;
      const c = Math.cos(P.yaw), s = Math.sin(P.yaw), pw = [], qw = [];
      forObjectPoints(Q, P, size, 0.3, (k, x, y, z) => {
        const m = nearest(T, x, y, z, dmax);
        if (!m) return;
        pw.push(P.x + c * m[0] - s * m[1], P.y + s * m[0] + c * m[1], P.z + m[2]);
        qw.push(Q[k], Q[k + 1], Q[k + 2]);
      });
      const n = pw.length / 3;
      if (n < 5) break;
      let px = 0, py = 0, qx = 0, qy = 0, dz = 0;
      for (let k = 0; k < pw.length; k += 3) { px += pw[k]; py += pw[k + 1]; qx += qw[k]; qy += qw[k + 1]; dz += qw[k + 2] - pw[k + 2]; }
      px /= n; py /= n; qx /= n; qy /= n; dz /= n;
      let sxx = 0, sxy = 0;
      for (let k = 0; k < pw.length; k += 3) {
        const ax = pw[k] - px, ay = pw[k + 1] - py, bx = qw[k] - qx, by = qw[k + 1] - qy;
        sxx += ax * bx + ay * by;
        sxy += ax * by - ay * bx;
      }
      const t = Math.atan2(sxy, sxx), ct = Math.cos(t), st = Math.sin(t);
      const ox = P.x - px, oy = P.y - py;
      const next = { x: qx + ct * ox - st * oy, y: qy + st * ox + ct * oy, z: P.z + dz, yaw: wrapAngle(P.yaw + t) };
      const moved = Math.hypot(next.x - P.x, next.y - P.y, next.z - P.z);
      P = next;
      if (moved < 1e-3 && Math.abs(t) < 1e-4) break;
    }
    return P;
  }

  // Seen mostly from one side, ICP can slide the box along that side. The size is known, so along
  // length and width: shift the box until the object's points (bar the outer 2%) fit inside it, and
  // when an outermost layer is dense enough to be a face (bumper, flank), put the box edge on it.
  function contain(Q, P, size) {
    const xs = [], ys = [];
    forObjectPoints(Q, P, size, 0.3, (k, x, y) => { xs.push(x); ys.push(y); });
    if (xs.length < FIT.minPts) return P;
    const shift = (v, half) => {
      v.sort((a, b) => a - b);
      const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.ceil(v.length * 0.98) - 1];
      if (hi - lo > 2 * half) return (lo + hi) / 2; // wider than the box: center it
      if (hi > half) return hi - half;
      if (lo < -half) return lo + half;
      let atLo = 0, atHi = 0;
      for (const x of v) { if (x < lo + 0.08) atLo++; if (x > hi - 0.08) atHi++; }
      const face = 0.1 * v.length;
      if (atLo >= face && atLo >= atHi) return lo + half;
      if (atHi >= face) return hi - half;
      return 0;
    };
    const dx = shift(xs, size[0] / 2), dy = shift(ys, size[1] / 2), c = Math.cos(P.yaw), s = Math.sin(P.yaw);
    return { ...P, x: P.x + c * dx - s * dy, y: P.y + s * dx + c * dy };
  }

  // n: object points of the whole frame (compared across frames for occlusion); ratio: the share of a
  // thinned sample that lies on the template.
  function matchStats(T, Q, sample, P, size) {
    let n = 0, m = 0, inliers = 0;
    forObjectPoints(Q, P, size, 0.15, () => n++);
    forObjectPoints(sample, P, size, 0.15, (k, x, y, z) => { m++; if (nearest(T, x, y, z, FIT.near)) inliers++; });
    return { P, n, ratio: m ? inliers / m : 0 };
  }

  // Object-height points of a frame around the expected spots (no ground, no far clutter).
  function targetPoints(cloud, centers, radius, size) {
    const out = [], lo = -size[2] / 2 + FIT.ground - 0.3, hi = size[2] / 2 + 0.8;
    for (let k = 0; k < cloud.length; k += 3) {
      for (const C of centers) {
        const dz = cloud[k + 2] - C.z;
        if (dz < lo || dz > hi || Math.abs(cloud[k] - C.x) > radius || Math.abs(cloud[k + 1] - C.y) > radius) continue;
        out.push(cloud[k], cloud[k + 1], cloud[k + 2]);
        break;
      }
    }
    return out;
  }

  // Heading of a vehicle from its points seen from above (L-shape fitting, closeness criterion): the
  // angle in [0°, 90°) whose rectangle hugs the points best, so it works from one visible side too.
  function lShapeAngle(xs, ys) {
    const n = xs.length, p1 = new Float64Array(n), p2 = new Float64Array(n);
    const closeness = (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      let a1 = Infinity, b1 = -Infinity, a2 = Infinity, b2 = -Infinity;
      for (let i = 0; i < n; i++) {
        p1[i] = c * xs[i] + s * ys[i]; p2[i] = -s * xs[i] + c * ys[i];
        if (p1[i] < a1) a1 = p1[i]; if (p1[i] > b1) b1 = p1[i];
        if (p2[i] < a2) a2 = p2[i]; if (p2[i] > b2) b2 = p2[i];
      }
      let sc = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.min(b1 - p1[i], p1[i] - a1, b2 - p2[i], p2[i] - a2);
        sc += 1 / Math.max(d, 0.05);
      }
      return sc;
    };
    let best = 0, bestSc = -1;
    for (let deg = 0; deg < 90; deg += 2) { const sc = closeness(deg * Math.PI / 180); if (sc > bestSc) { bestSc = sc; best = deg; } }
    let fine = best;
    for (let deg = best - 2; deg <= best + 2; deg += 0.25) { const sc = closeness(deg * Math.PI / 180); if (sc > bestSc) { bestSc = sc; fine = deg; } }
    return fine * Math.PI / 180;
  }

  // Poses turned to the L-shape heading of the points around P: both axis choices (the angle is
  // ambiguous by 90°), each facing the side nearest P's heading.
  function lShapePoses(Q, P, size, margin) {
    const xs = [], ys = [];
    forObjectPoints(Q, P, size, margin, (k, x, y) => { xs.push(x); ys.push(y); });
    if (xs.length < 20) return [];
    const a = lShapeAngle(xs, ys);
    return [a, a + Math.PI / 2].map((t) => {
      let yaw = wrapAngle(P.yaw + t);
      if (Math.abs(wrapAngle(yaw - P.yaw)) > Math.PI / 2) yaw = wrapAngle(yaw + Math.PI);
      return { ...P, yaw };
    });
  }

  // Road height under a box: points in a ring 0.4–1.2 m around the footprint (clear of the object's
  // own sides when the box is off by up to the 50 cm fit limit), near the current floor. Median, then
  // the median of points within 10 cm of it; the road is flat, so most of the ring must lie in that
  // layer, otherwise walls or a neighbor dominate and there is no answer.
  function groundNear(cloud, P, size) {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), hx = size[0] / 2, hy = size[1] / 2, floor = P.z - size[2] / 2, zs = [];
    for (let k = 0; k < cloud.length; k += 3) {
      const z = cloud[k + 2];
      if (z < floor - 0.8 || z > floor + 0.6) continue;
      const dx = cloud[k] - P.x, dy = cloud[k + 1] - P.y, lx = Math.abs(c * dx + s * dy), ly = Math.abs(-s * dx + c * dy);
      if (lx > hx + 1.2 || ly > hy + 1.2 || (lx < hx + 0.4 && ly < hy + 0.4)) continue;
      zs.push(z);
    }
    if (zs.length < 20) return null;
    const median = (v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)], m = median(zs);
    const near = zs.filter((z) => Math.abs(z - m) <= 0.1);
    return near.length >= Math.max(10, 0.4 * zs.length) ? median(near) : null;
  }

  // Roof: a high percentile of the points over the footprint and above the road (2% left for noise).
  function roofOver(cloud, P, size, ground) {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), hx = size[0] / 2, hy = size[1] / 2, top = P.z + size[2] / 2, zs = [];
    for (let k = 0; k < cloud.length; k += 3) {
      const z = cloud[k + 2];
      if (z < ground + 0.3 || z > top + 0.8) continue;
      const dx = cloud[k] - P.x, dy = cloud[k + 1] - P.y;
      if (Math.abs(c * dx + s * dy) > hx || Math.abs(-s * dx + c * dy) > hy) continue;
      zs.push(z);
    }
    if (zs.length < 20) return null;
    zs.sort((a, b) => a - b);
    return zs[Math.ceil(zs.length * 0.98) - 1];
  }

  // New [lo, hi] of one box axis from the object's points projected on it (sorted ascending).
  // A face moves out to points beyond it only while they stay connected (no 20 cm gap, so a neighbor
  // across a gap is not taken in), and moves in only onto a dense layer, i.e. a face the LiDAR saw;
  // the far, unseen face stays where it was. Each face ends within 50 cm of where it started, `start`
  // being the original box's center on this axis relative to the current one.
  function fitSpan(v, half, start = 0) {
    const n = v.length;
    if (n < 20) return [-half, half];
    const out = (from, step) => { // last connected value walking outward from index `from`
      let i = from;
      while (i + step >= 0 && i + step < n && Math.abs(v[i + step] - v[i]) <= 0.2) i += step;
      return v[i];
    };
    let inLo = v.findIndex((x) => x >= -half), inHi = n - 1;
    while (inHi >= 0 && v[inHi] > half) inHi--;
    if (inLo < 0 || inHi < 0) return [-half, half];
    const lo = Math.max(v[Math.floor(n * 0.02)], out(inLo, -1)), hi = Math.min(v[Math.ceil(n * 0.98) - 1], out(inHi, 1));
    const dense = (x, inward) => v.filter((y) => inward * (y - x) >= 0 && inward * (y - x) <= 0.08).length >= Math.max(8, 0.08 * n);
    let a = lo < -half || dense(lo, 1) ? lo : -half, b = hi > half || dense(hi, -1) ? hi : half;
    if (Math.abs(a - (start - half)) > 0.5) a = -half;
    if (Math.abs(b - (start + half)) > 0.5) b = half;
    return b - a >= 0.2 ? [a, b] : [-half, half];
  }

  // Conservative same-frame proposal: reuse the existing local face alignment,
  // with a fixed support set so iterations cannot walk onto a neighboring object.
  // fitFaces then fits all six faces: front/back and both sides from the object's points, the floor
  // onto the road and the top onto the roof (faces ±50 cm, height ±60 cm).
  function fitCurrentPoints(cloud, points, allowYaw = false, fitFaces = false) {
    if (points.length < 9 || !points.slice(0, 9).every(Number.isFinite) || points.slice(6, 9).some(n => n <= 0)) throw new Error("Box không hợp lệ.");
    if (Math.abs(points[3]) > 0.01 || Math.abs(points[4]) > 0.01) throw new Error("Bản thử chỉ khớp box gần thẳng đứng (rx/ry ≤ 0,01 rad).");
    const P0 = poseOf(points), size = points.slice(6, 9), support = [], notes = [];
    const beforeCount = countInside(cloud, points);
    if (beforeCount < 30) throw new Error(`Chỉ có ${beforeCount} điểm trong box; cần ít nhất 30 điểm để đề xuất khớp.`);
    // The road first: a sunken box would otherwise take road points as object support.
    let ground = null;
    if (fitFaces) {
      ground = groundNear(cloud, P0, size);
      if (ground === null) notes.push("không thấy mặt đường");
      else if (Math.abs(ground - (P0.z - size[2] / 2)) > 0.5) { notes.push("mặt đường lệch > 50 cm, giữ đáy"); ground = null; }
      else P0.z = ground + size[2] / 2;
    }
    forObjectPoints(cloud, P0, size, 0.35, k => support.push(cloud[k], cloud[k + 1], cloud[k + 2]));
    if (support.length / 3 < 30) throw new Error("Không đủ điểm phía trên đáy box để khớp.");
    const stride = Math.max(1, Math.ceil(support.length / 3 / 2000));
    const sample = support.filter((_, i) => Math.floor(i / 3) % stride === 0);
    // All candidates score the SAME points. Outside support is penalized; point
    // count alone is not an accuracy or confidence score.
    const cost = P => {
      const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
      let sum = 0;
      for (let k = 0; k < sample.length; k += 3) {
        const dx = sample[k] - P.x, dy = sample[k + 1] - P.y;
        const x = Math.abs(c * dx + s * dy) - size[0] / 2;
        const y = Math.abs(-s * dx + c * dy) - size[1] / 2;
        sum += Math.min(Math.abs(x), Math.abs(y), 0.5) + 2 * Math.hypot(Math.max(0, x), Math.max(0, y));
      }
      return sum / (sample.length / 3);
    };
    let best = { ...P0 }, bestCost = cost(P0);
    const seeds = [P0];
    if (allowYaw) {
      for (const deg of [-15, -10, -5, 5, 10, 15]) seeds.push({ ...P0, yaw: wrapAngle(P0.yaw + deg * Math.PI / 180) });
      seeds.push(...lShapePoses(sample, P0, size, 0.35));
    }
    for (const seed of seeds) {
      let candidate = seed;
      if (Math.abs(wrapAngle(candidate.yaw - P0.yaw)) > Math.PI / 12 + 1e-9) continue;
      for (let i = 0; i < 4; i++) candidate = contain(sample, candidate, size);
      if (Math.hypot(candidate.x - P0.x, candidate.y - P0.y) > 0.5) continue;
      const value = cost(candidate);
      if (value < bestCost - 1e-6) { best = candidate; bestCost = value; }
    }
    const proposed = points.slice();
    proposed[0] = best.x; proposed[1] = best.y;
    if (allowYaw) proposed[5] = best.yaw;
    if (fitFaces) {
      const floor = ground ?? points[2] - size[2] / 2, c = Math.cos(best.yaw), s = Math.sin(best.yaw);
      // Front/back from points level with the box sides, left/right from points level with its ends.
      const xs = [], ys = [], hx = size[0] / 2, hy = size[1] / 2, zTop = floor + size[2] + 0.3;
      for (let k = 0; k < cloud.length; k += 3) {
        const z = cloud[k + 2];
        if (z < floor + FIT.ground || z > zTop) continue;
        const dx = cloud[k] - best.x, dy = cloud[k + 1] - best.y, lx = c * dx + s * dy, ly = -s * dx + c * dy;
        if (Math.abs(ly) <= hy + 0.1 && Math.abs(lx) <= hx + 0.5) xs.push(lx);
        if (Math.abs(lx) <= hx + 0.1 && Math.abs(ly) <= hy + 0.5) ys.push(ly);
      }
      const ox = points[0] - best.x, oy = points[1] - best.y; // the original center in the fitted box axes
      const [x0, x1] = fitSpan(xs.sort((a, b) => a - b), hx, c * ox + s * oy), [y0, y1] = fitSpan(ys.sort((a, b) => a - b), hy, -s * ox + c * oy);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      proposed[0] = best.x + c * mx - s * my; proposed[1] = best.y + s * mx + c * my;
      proposed[6] = x1 - x0; proposed[7] = y1 - y0;
      const footprint = { ...best, x: proposed[0], y: proposed[1] }, fsize = [proposed[6], proposed[7], size[2]];
      const roof = roofOver(cloud, { ...footprint, z: floor + size[2] / 2 }, fsize, floor);
      let top = floor + size[2];
      if (roof === null) notes.push("không đủ điểm nóc, giữ chiều cao");
      else if (Math.abs(roof - top) > 0.6 || roof - floor < 0.3) notes.push("nóc lệch > 60 cm, giữ chiều cao");
      else top = roof;
      proposed[2] = (floor + top) / 2;
      proposed[8] = top - floor;
    }
    const distance = Math.hypot(proposed[0] - points[0], proposed[1] - points[1]);
    const angle = wrapAngle(proposed[5] - points[5]) * 180 / Math.PI;
    const floorShift = (proposed[2] - proposed[8] / 2) - (points[2] - points[8] / 2), sizeChange = [0, 1, 2].map((i) => proposed[6 + i] - points[6 + i]);
    return { points: proposed, beforeCount, afterCount: countInside(cloud, proposed), distance, angle, floorShift, sizeChange, notes,
      changed: distance > 1e-4 || Math.abs(angle) > 0.01 || Math.abs(floorShift) > 0.005 || sizeChange.some((d) => Math.abs(d) > 0.005) };
  }

  function renderFrameFit(message = "", f = frameFit?.f ?? zoomFrame) {
    const pending = frameFit?.pending, proposal = frameFit && !pending;
    if (message) frameFitNote = { f, text: message };
    else if (frameFit) frameFitNote = null;
    $(".fit-current").disabled = !!pending || !!fitting || zoomFrame === null || !!(plan && stateAt(zoomFrame)?.outside);
    $(".fit-confirm").hidden = !frameFit || frameFit.f !== zoomFrame;
    $(".fit-accept").disabled = !proposal;
    $(".fit-legend").hidden = !proposal || frameFit.f !== zoomFrame;
    $(".frame-fit-msg").textContent = message || (pending ? "Đang tính đề xuất…" : proposal ?
      `Frame ${frameFit.f} · ${frameFitSummary(frameFit)} · ${frameFit.beforeCount} → ${frameFit.afterCount} điểm.` :
      "");
    if (plan) scheduleDraw();
  }

  function cancelFrameFit() {
    frameFitEpoch++;
    frameFit = null;
    frameFitNote = null;
    renderFrameFit();
    scheduleDraw();
  }

  // One-line summary of a proposal, shared by the expanded bar and the small-view header.
  function frameFitSummary(r) {
    const parts = [`dịch ${(r.distance * 100).toFixed(1)} cm`, `xoay ${r.angle.toFixed(1)}°`];
    if (Math.abs(r.floorShift) > 0.005) parts.push(`đáy ${r.floorShift > 0 ? "+" : ""}${(r.floorShift * 100).toFixed(0)} cm`);
    const sized = (r.sizeChange || []).map((d, i) => Math.abs(d) > 0.005 ? `${["dài", "rộng", "cao"][i]} ${d > 0 ? "+" : ""}${(d * 100).toFixed(0)} cm` : "").filter(Boolean);
    if (sized.length) parts.push(sized.join(" · ") + ($(".lock").checked ? " (cả track)" : ""));
    return parts.concat(r.notes || []).join(" · ");
  }

  async function proposeFrameFit(f = zoomFrame) {
    if (!plan || f === null || fitting || saving) return;
    endDrag();
    cancelFrameFit();
    frameFitNote = null;
    const owner = plan, before = stateAt(f);
    if (before.outside) return renderFrameFit("Frame đang outside. Chọn frame đang hiện để khớp.", f);
    const source = JSON.stringify(plan.shapes), epoch = frameFitEpoch;
    const allowYaw = true, fitFaces = true; // always: yaw within ±15° and all six faces
    frameFit = { f, owner, source, pending: true };
    renderFrameFit();
    try {
      const F = boxFrame(before.points);
      const xyz = await nearCloud(plan.track.clientID ?? plan.track.id, f, F.center, F.reach + 1);
      if (epoch !== frameFitEpoch || owner !== plan) return;
      if (source !== JSON.stringify(plan.shapes)) { cancelFrameFit(); return; }
      const result = fitCurrentPoints(xyz, before.points, allowYaw, fitFaces);
      if (!result.changed) {
        cancelFrameFit();
        return renderFrameFit(`Frame ${f}: chưa tìm thấy điều chỉnh tốt hơn. Box giữ nguyên.${result.notes?.length ? " " + result.notes.join(" · ") + "." : ""}`, f);
      }
      frameFit = { ...result, f, owner, source };
      renderFrameFit(); scheduleDraw();
    } catch (error) {
      if (epoch !== frameFitEpoch) return;
      cancelFrameFit(); renderFrameFit(error.message, f);
    }
  }

  function acceptFrameFit() {
    const proposal = frameFit;
    if (!proposal || proposal.pending || fitting || saving) return;
    if (proposal.owner !== plan || proposal.source !== JSON.stringify(plan.shapes) || plan.stale) {
      cancelFrameFit(); return renderFrameFit("Box hoặc dữ liệu đã đổi. Chạy khớp lại trước khi chấp nhận.", proposal.f);
    }
    const before = snapshot(), f = proposal.f, points = proposal.points.slice();
    // Pin adjacent states BEFORE editing, so this local operation affects only f
    // (a size change still follows "Khóa kích thước cả track", like a drag on an edge).
    if (f > plan.shapes[0].frame) ensureKey(f - 1);
    if (f < job.stop_frame) ensureKey(f + 1);
    setGeometry(f, points, (proposal.sizeChange || []).some((d) => Math.abs(d) > 0.005) ? points.slice(6, 9) : null);
    commit(before);
    modelChanged();
    renderFrameFit(`Đã nhận frame ${f} vào bản nháp.`, f);
    editor.focus({ preventScroll: true });
  }

  async function fitFrame(f, T, size, pred, alt, W, lastN) {
    const centers = Math.hypot(alt.x - pred.x, alt.y - pred.y) > 0.3 ? [pred, alt] : [pred];
    const radius = W + Math.hypot(size[0], size[1]) / 2 + 0.5;
    const cloud = await nearCloud(plan.track.clientID ?? plan.track.id, f, [pred.x, pred.y, pred.z], radius + Math.hypot(alt.x - pred.x, alt.y - pred.y));
    const Q = targetPoints(cloud, centers, radius, size);
    // the search and ICP run on a thinned set of points; the final checks use all of them
    const thin = (max) => { const every = Math.ceil(Q.length / 3 / max); return every > 1 ? Q.filter((_, i) => Math.floor(i / 3) % every === 0) : Q; };
    const Qs = thin(1500), Qi = thin(2000);
    // coarse: a grid of positions and headings around each expected spot, scored by template hits
    const step = Math.max(0.2, W / 6);
    let best = null;
    for (const C of centers) {
      for (let dx = -W; dx <= W + 1e-9; dx += step) for (let dy = -W; dy <= W + 1e-9; dy += step) {
        for (const da of [-20, -10, -5, 0, 5, 10, 20]) {
          const P = { x: C.x + dx, y: C.y + dy, z: C.z, yaw: C.yaw + da * Math.PI / 180 };
          const sc = score(T, Qs, P, size);
          if (!best || sc > best.sc) best = { P, sc };
        }
      }
      // the heading the points themselves show, for turns beyond the grid
      for (const L of lShapePoses(Qs, C, size, 0.5)) {
        for (let dx = -0.4; dx <= 0.4 + 1e-9; dx += 0.2) for (let dy = -0.4; dy <= 0.4 + 1e-9; dy += 0.2) {
          const P = { ...L, x: L.x + dx, y: L.y + dy }, sc = score(T, Qs, P, size);
          if (sc > best.sc) best = { P, sc };
        }
      }
    }
    const r = matchStats(T, Q, thin(4000), contain(Q, icp(T, Qi, best.P, size), size), size);
    r.ok = r.n >= FIT.minPts && r.n >= FIT.minDensity * lastN && r.ratio >= FIT.minRatio &&
      Math.hypot(r.P.x - pred.x, r.P.y - pred.y) <= W + 0.5;
    r.Q = Q;
    return r;
  }

  // Fewest keyframes whose linear interpolation stays within tolerance of the fitted poses.
  function reduceKeys(frames, pose, forced) {
    const keys = new Set(forced);
    const err = (a, b, f) => {
      const p = lerpPose(pose.get(a), pose.get(b), (f - a) / (b - a)), q = pose.get(f);
      return Math.max(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / FIT.posTol, Math.abs(wrapAngle(p.yaw - q.yaw)) / FIT.yawTol);
    };
    const split = (a, b) => {
      let worst = 1, at = -1;
      for (let f = a + 1; f < b; f++) if (pose.has(f)) { const e = err(a, b, f); if (e > worst) { worst = e; at = f; } }
      if (at < 0) return;
      keys.add(at);
      split(a, at);
      split(at, b);
    };
    const sorted = [...keys].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i++) split(sorted[i], sorted[i + 1]);
    return [...keys].filter((f) => f >= frames[0] && f <= frames[frames.length - 1]).sort((x, y) => x - y);
  }

  // ---- soft objects (people, cyclists): the point cluster at the expected spot ----
  // Shapes change from frame to frame, so there is no template: among the object-height points near
  // the expected spot, mean shift finds the density peak nearest the prediction, and the fixed-size
  // box is put on it, its floor on the local ground. Heading comes from the
  // keyframes: in sensor coordinates the apparent motion mixes in the lidar car's own motion, so it
  // cannot give the object's heading.

  // The ground height around P: a low percentile of the point heights there.
  function groundAt(cloud, P, r) {
    const zs = [];
    for (let k = 0; k < cloud.length; k += 3) {
      if (Math.abs(cloud[k] - P.x) <= r && Math.abs(cloud[k + 1] - P.y) <= r && cloud[k + 2] < P.z + 0.5) zs.push(cloud[k + 2]);
    }
    if (zs.length < 20) return null;
    zs.sort((a, b) => a - b);
    return zs[Math.floor(zs.length * 0.05)];
  }

  async function fitSoft(f, size, pred, alt, W, lastN) {
    const cloud = await nearCloud(plan.track.clientID ?? plan.track.id, f, [pred.x, pred.y, pred.z], Math.max(2.5, W + Math.max(size[0], size[1])) + 0.2);
    const g = groundAt(cloud, pred, 2.5) ?? pred.z - size[2] / 2;
    const lo = g + 0.12, hi = g + size[2] + 0.3, reach = W + Math.max(size[0], size[1]), cell = 0.2;
    const X = [], Y = [], cellsOf = new Map(); // object-height points near the prediction, and their 2D cells
    for (let k = 0; k < cloud.length; k += 3) {
      const z = cloud[k + 2];
      if (z < lo || z > hi || Math.abs(cloud[k] - pred.x) > reach || Math.abs(cloud[k + 1] - pred.y) > reach) continue;
      const key = cellKey(Math.floor(cloud[k] / cell), Math.floor(cloud[k + 1] / cell), 0);
      if (!cellsOf.has(key)) cellsOf.set(key, []);
      cellsOf.get(key).push(X.length);
      X.push(cloud[k]); Y.push(cloud[k + 1]);
    }
    // seeds: the prediction and the middle of every cluster of occupied cells (8-way joined)
    const seeds = [{ x: pred.x, y: pred.y }], seen = new Set();
    for (const start of cellsOf.keys()) {
      if (seen.has(start)) continue;
      const stack = [start];
      let n = 0, sx = 0, sy = 0;
      seen.add(start);
      while (stack.length) {
        const key = stack.pop(), iy = Math.floor(key / 2048) % 2048 - 1024, ix = Math.floor(key / 4194304) - 1024;
        for (const i of cellsOf.get(key)) { n++; sx += X[i]; sy += Y[i]; }
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const nb = cellKey(ix + a, iy + b, 0);
          if (cellsOf.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
      }
      if (n >= FIT.minPts) seeds.push({ x: sx / n, y: sy / n });
    }
    // mean shift from each seed: the centre moves to the mean of the points within half a box of it,
    // so it settles on one person even when a neighbour's cluster touches theirs
    const r = Math.max(size[0], size[1]) / 2, peaks = [];
    for (const seed of seeds) {
      let cx = seed.x, cy = seed.y, n = 0;
      for (let it = 0; it < 20; it++) {
        let sx = 0, sy = 0;
        n = 0;
        for (let i = 0; i < X.length; i++) if (Math.hypot(X[i] - cx, Y[i] - cy) <= r) { n++; sx += X[i]; sy += Y[i]; }
        if (!n) break;
        const nx = sx / n, ny = sy / n, moved = Math.hypot(nx - cx, ny - cy);
        cx = nx; cy = ny;
        if (moved < 0.005) break;
      }
      if (n < FIT.minPts || peaks.some((q) => Math.hypot(q.x - cx, q.y - cy) < 0.1)) continue;
      peaks.push({ x: cx, y: cy, n, d: Math.hypot(cx - pred.x, cy - pred.y) });
    }
    if (!peaks.length) return { P: pred, n: 0, ok: false };
    peaks.sort((a, b) => a.d - b.d);
    const best = peaks[0], rival = peaks[1];

    // The peak is the middle of what the lidar sees: the near half of the person. Move it away from
    // the lidar (the origin, in sensor coordinates) by about how far that half's middle sits from
    // the body axis. Far from the origin the data is in map coordinates and the lidar is unknown.
    const dist = Math.hypot(best.x, best.y), back = dist > 0.5 && dist < 80 ? 0.35 * Math.min(size[0], size[1]) / 2 : 0;
    const P = { x: best.x + (best.x / dist) * back, y: best.y + (best.y / dist) * back, z: g + size[2] / 2, yaw: alt.yaw };
    const n = best.n;
    // two people about as close to where this one should be: cannot tell them apart
    const ambiguous = rival && rival.d < best.d + 0.15;
    const ok = !ambiguous && n >= FIT.minDensity * lastN && Math.hypot(P.x - pred.x, P.y - pred.y) <= W + 0.3;
    return { P, n, ok };
  }

  // Light smoothing of fitted positions (weights 1-2-3-2-1): removes the frame-to-frame jitter of
  // swinging arms and legs. Neighbours count only in pairs (f - d with f + d), so steady motion is
  // not pulled, at the ends of a run either.
  function smoothPoses(pose, fitted) {
    const out = new Map();
    for (const f of fitted) {
      const p = pose.get(f);
      let w = 3, x = 3 * p.x, y = 3 * p.y, z = 3 * p.z;
      for (const d of [1, 2]) {
        if (!fitted.has(f - d) || !fitted.has(f + d)) break;
        const a = pose.get(f - d), b = pose.get(f + d), k = 3 - d;
        w += 2 * k; x += k * (a.x + b.x); y += k * (a.y + b.y); z += k * (a.z + b.z);
      }
      out.set(f, { ...p, x: x / w, y: y / w, z: z / w });
    }
    for (const [f, p] of out) pose.set(f, p);
  }

  async function pickReference(a, b) {
    const typed = $(".fit-ref").value.trim();
    if (typed !== "") {
      const r = Number(typed);
      if (!Number.isInteger(r) || r < a || r > b) throw new Error(`Frame mẫu phải nằm trong ${a}–${b}.`);
      return r;
    }
    // the visible keyframe whose box holds the most points
    let best = null;
    for (const s of plan.shapes) {
      if (s.frame < a || s.frame > b || s.outside) continue;

      const F = boxFrame(s.points), n = countInside(await nearCloud(plan.track.clientID ?? plan.track.id, s.frame, F.center, F.reach), s.points);
      if (!best || n > best.n) best = { f: s.frame, n };
    }
    if (!best) throw new Error("Không có keyframe nào đang hiện để làm frame mẫu.");
    $(".fit-ref").value = best.f;
    return best.f;
  }

  async function autoFit() {
    if (fitting) { fitting.cancelled = true; return; }
    if (!plan || editor.hidden) return;
    cancelFrameFit();
    endDrag();
    const run = fitting = { cancelled: false }, gen = editGen;
    const btn = $(".fit");
    btn.title = "Bấm để dừng";
    progress(btn, 0);
    Object.assign(cloudStats, { frames: 0, bytes: 0, fetchMs: 0, parseMs: 0, since: performance.now() });
    const check = () => { if (run.cancelled || gen !== editGen) throw new Error("cancelled"); };
    try {
      const soft = $(".fit-kind").value === "soft", first = plan.shapes[0].frame, stop = frames[frames.length - 1];
      const a = Number($(".fit-a").value), b = Number($(".fit-b").value);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < first || b > stop || b <= a) {
        throw new Error(`Frame đầu và frame cuối phải là số nguyên trong ${first}–${stop}, frame cuối sau frame đầu.`);
      }
      const r = await pickReference(a, b);
      check();
      const ref = stateAt(r);
      if (ref.outside) throw new Error(`Track đang ẩn ở frame mẫu ${r}.`);
      const p0 = ref.points, size = p0.slice(6, 9);
      let P0 = poseOf(p0);
      if (Math.abs(p0[3]) > 0.15 || Math.abs(p0[4]) > 0.15) throw new Error("Box ở frame mẫu đang nghiêng (rx/ry); tự khớp chỉ xoay quanh trục đứng.");
      progress(btn, 0.08);
      const refCloud = await nearCloud(plan.track.clientID ?? plan.track.id, r, [P0.x, P0.y, P0.z], Math.hypot(size[0], size[1]) / 2 + 2);
      check();
      // The reference box may only be roughly placed (CVAT draws new cuboids at heading 0): turn it
      // to the L-shape heading and fit it to the points when that holds clearly more points.
      if (!soft && !plan.manual.has(r)) {
        const Qr = targetPoints(refCloud, [P0], Math.hypot(size[0], size[1]) / 2 + 1.5, size);
        const inside = (P) => { let n = 0; forObjectPoints(Qr, P, size, 0, () => n++); return n; };
        let best = P0, bestN = inside(P0);
        for (const L of lShapePoses(Qr, P0, size, 0.8)) {
          let P = L;
          for (let i = 0; i < 4; i++) P = contain(Qr, P, size); // each pass re-centres the region it looks at
          const n = inside(P);
          if (n > bestN * 1.05) { best = P; bestN = n; }
        }
        P0 = best;
      }

      // template from the reference frame (rigid objects only use it)
      const T = newTemplate(size), cr = Math.cos(P0.yaw), sr = Math.sin(P0.yaw);
      for (let k = 0; k < refCloud.length; k += 3) {
        const dx = refCloud[k] - P0.x, dy = refCloud[k + 1] - P0.y, z = refCloud[k + 2] - P0.z;
        const x = cr * dx + sr * dy, y = -sr * dx + cr * dy;
        if (Math.abs(x) <= size[0] / 2 + 0.1 && Math.abs(y) <= size[1] / 2 + 0.1 && z >= -size[2] / 2 + FIT.ground && z <= size[2] / 2 + 0.1) addPoint(T, x, y, z);
      }
      if (T.n < (soft ? FIT.minPts : 30)) throw new Error(`Frame mẫu ${r} chỉ có ${T.n} điểm trong box. Chọn frame vật ở gần lidar hơn.`);

      const anchors = new Set([...plan.manual].filter((f) => f >= a && f <= b && f !== r && !stateAt(f).outside));
      const visible = (f) => !stateAt(f).outside;
      const pose = new Map([[r, P0]]), flagged = new Set();
      const total = frames.filter((f) => f >= a && f <= b && visible(f)).length;
      let done = 1;
      let refN = 0;
      if (soft) refN = (await fitSoft(r, size, P0, P0, 0.3, 0)).n;
      else forObjectPoints(targetPoints(refCloud, [P0], Math.hypot(size[0], size[1]) / 2 + 1, size), P0, size, 0.15, () => refN++);
      for (const dir of [1, -1]) {
        let prev = P0, prevF = r, vel = null, lastN = refN;
        for (let f = r + dir; dir > 0 ? f <= b : f >= a; f += dir) {
          check();
          if (!visible(f)) continue;
          const st = poseOf(stateAt(f).points), gap = Math.abs(f - prevF);
          if (anchors.has(f)) { // trust the hand-placed box and take the motion from it
            vel = { x: (st.x - prev.x) / gap, y: (st.y - prev.y) / gap, z: (st.z - prev.z) / gap, yaw: wrapAngle(st.yaw - prev.yaw) / gap };
            prev = st; prevF = f; pose.set(f, st); done++;
            continue;
          }
          const pred = vel ? { x: prev.x + vel.x * gap, y: prev.y + vel.y * gap, z: prev.z + vel.z * gap, yaw: wrapAngle(prev.yaw + vel.yaw * gap) } : st;
          const speed = vel ? Math.hypot(vel.x, vel.y) : Math.hypot(st.x - prev.x, st.y - prev.y) / gap;
          const W = Math.min(3, Math.max(0.5, 0.5 + 0.5 * speed * gap));
          const res = soft ? await fitSoft(f, size, pred, st, W, lastN) : await fitFrame(f, T, size, pred, st, W, lastN);
          check();
          progress(btn, 0.1 + 0.85 * ++done / total);
          if (!res.ok) { flagged.add(f); continue; }
          const step = { x: (res.P.x - prev.x) / gap, y: (res.P.y - prev.y) / gap, z: (res.P.z - prev.z) / gap, yaw: wrapAngle(res.P.yaw - prev.yaw) / gap };
          vel = vel ? { x: (vel.x + step.x) / 2, y: (vel.y + step.y) / 2, z: (vel.z + step.z) / 2, yaw: (vel.yaw + step.yaw) / 2 } : step;
          prev = res.P; prevF = f; pose.set(f, res.P); lastN = res.n;
          if (!soft && T.n < 8000 && res.ratio >= FIT.learn) { // a sure fit: what it shows of the object joins the template
            const c = Math.cos(res.P.yaw), s = Math.sin(res.P.yaw), Q = res.Q;
            for (let k = 0; k < Q.length; k += 3) {
              const dx = Q[k] - res.P.x, dy = Q[k + 1] - res.P.y, z = Q[k + 2] - res.P.z;
              const x = c * dx + s * dy, y = -s * dx + c * dy;
              if (Math.abs(x) <= size[0] / 2 + 0.05 && Math.abs(y) <= size[1] / 2 + 0.05 && z >= -size[2] / 2 + FIT.ground && z <= size[2] / 2 + 0.05) addPoint(T, x, y, z);
            }
          }
        }
      }

      if (soft) smoothPoses(pose, new Set([...pose.keys()].filter((f) => f !== r && !anchors.has(f))));

      // every frame in range gets a pose: fitted, or between the nearest fitted ones
      const range = frames.filter((f) => f >= a && f <= b), known = [...pose.keys()].sort((x, y) => x - y);
      for (const f of range) {
        if (!visible(f)) { pose.set(f, poseOf(stateAt(f).points)); continue; }
        if (pose.has(f)) continue;
        const lo = known.filter((k) => k < f).pop(), hi = known.find((k) => k > f);
        pose.set(f, lo === undefined ? pose.get(hi) : hi === undefined ? pose.get(lo) : lerpPose(pose.get(lo), pose.get(hi), (f - lo) / (hi - lo)));
      }

      // keyframes: the ends, the reference, hand edits, visibility changes and keys holding attributes stay
      const forced = new Set([a, b, r, ...[...plan.manual].filter((f) => f >= a && f <= b)]);
      for (const f of range) if (f > a && visible(f) !== visible(f - 1)) forced.add(f);
      for (const s of plan.shapes) if (s.frame >= a && s.frame <= b && (s.attributes || []).length && s.frame !== a) forced.add(s.frame);
      const fitted = new Map([...pose].filter(([f]) => visible(f)));
      for (const f of forced) if (!fitted.has(f)) fitted.set(f, pose.get(f));
      const keep = reduceKeys(range, fitted, forced);

      check();
      commit(snapshot());
      // Pin neighbours so fitting a subrange preserves interpolation outside it.
      if (a > first) ensureKey(a - 1);
      if (b < stop) ensureKey(b + 1);
      const old = new Map(plan.shapes.map((s) => [s.frame, s]));
      const { id, ...base } = plan.shapes[0];
      const inRange = keep.map((f) => {
        const out = !visible(f), cur = old.get(f);
        if (anchors.has(f) || plan.manual.has(f) || out) return { ...cur || { ...base, attributes: [] }, frame: f, points: stateAt(f).points, outside: out };
        const P = pose.get(f), pts = p0.slice();
        pts[0] = P.x; pts[1] = P.y; pts[2] = P.z; pts[5] = wrapAngle(P.yaw);
        return { ...(cur || { ...base, attributes: [] }), frame: f, points: pts, outside: out };
      });
      plan.shapes = [...plan.shapes.filter((s) => s.frame < a || s.frame > b), ...inRange].sort((x, y) => x.frame - y.frame);
      plan.flagged = flagged;
      modelChanged();
      progress(btn, 1);
      setStatus(`Đã tự khớp frame ${a}–${b}. ${flagged.size} frame cần kiểm tra lại.`);
    } catch (e) {
      setStatus(e.message === "cancelled" ? "Đã dừng tự khớp, track không đổi." : e.message, e.message !== "cancelled");
    } finally {
      if (fitting === run) fitting = null;
      btn.title = "";
      progress(btn, null, "Tự khớp");
      logCloudStats("Tự khớp");
    }
  }

  // ---- clouds for the views ----

  function ensureLoad(f) {
    if (loadState.has(f)) return;
    loadState.set(f, "loading");
    queue.push(f);
    pump();
  }
  function pump() {
    while (loading < 4 && queue.length) {
      queue.sort((a, b) => (b === zoomFrame) - (a === zoomFrame)); // the zoomed frame first
      const f = queue.shift();
      if (!visible.has(f) && f !== zoomFrame) { loadState.delete(f); continue; } // scrolled away
      const gen = editGen, p = stateAt(f).points;
      loading++;
      nearCloud(plan.track.clientID ?? plan.track.id, f, p.slice(0, 3), frameReach(f, p), 1)
        .then(() => { if (gen === editGen) loadState.delete(f); }, (e) => { if (gen === editGen) loadState.set(f, e); })
        .finally(() => {
          loading--;
          if (gen === editGen) scheduleDraw();
          pump();
        });
    }
  }

  // ---- drawing ----

  function scheduleDraw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => {
      drawPending = false;
      if (!plan || editor.hidden) return;
      if (zoomFrame === null) for (const f of visible) drawCell(f);
      if (zoomFrame !== null) drawZoom();
      updateSummary();
    });
  }

  function previewPointCount(f, points) {
    const trackId = plan.track.clientID ?? plan.track.id;
    const key = `${jobId}:${trackId}:${f}:${points.join(",")}`;
    if (counted.has(key)) return counted.get(key);
    const crop = nearCached(trackId, f), box = boxFrame(points);
    if (!crop || !cropCovers(crop, box.center, box.reach)) return null;
    const n = countInside(crop.xyz, points);
    counted.set(key, n);
    while (counted.size > 20000) counted.delete(counted.keys().next().value);
    return n;
  }

  function headHtml(f, st, extra) {
    const k = !!keyAt(f), err = loadState.get(f) instanceof Error;
    const n = previewPointCount(f, st.points);
    return `<span class="f">${f}</span>${classHtml(f)}
      <span class="n" title="Số điểm point cloud nằm trong box hiện tại">${n === null ? (err ? "—" : "…") : n.toLocaleString("vi-VN")} điểm trong box</span>
      ${plan.cuts?.length ? `<span class="tag split-origin" title="Đoạn dự kiến, chưa tạo item; khoảng frame bao gồm cả frame ẩn">${esc(splitFrameLabel(f))}</span>` : ""}
      ${err ? '<span class="tag bad" title="Không tải được point cloud">!</span>' : ""}${
      plan.flagged.has(f) ? '<span class="tag bad" title="Tự khớp không chắc chắn ở frame này: kiểm tra lại">Khớp kém</span>' : ""}
      <span class="acts"><button class="btn sm ico${st.outside ? " on" : ""}" data-act="out" data-f="${f}"
          title="${st.outside ? "Đang ẩn: bấm để hiện" : "Ẩn frame này"}">${st.outside ? ICON.eyeOff : ICON.eye}</button>
        <button class="btn sm ico${k ? " on" : ""}" data-act="key" data-f="${f}" ${k && isFirstKey(f) ? "disabled" : ""}
          title="${k ? (isFirstKey(f) ? "Keyframe đầu của track" : "Keyframe: bấm để bỏ") : "Đặt keyframe ở frame này"}">${ICON.key}</button>
      ${extra}</span>`;
  }

  function setHead(el, html) {
    if (el.dataset.html === html) return;
    el.innerHTML = html;
    el.dataset.html = html;
  }

  function drawCell(f) {
    const c = cells.get(f);
    if (!c || c.cell.hidden) return;
    const st = stateAt(f);
    c.cell.classList.toggle("is-manual", plan.manual.has(f));
    c.cell.classList.toggle("hidden-frame", st.outside);
    setHead(c.head, headHtml(f, st, `${fitControlsHtml(f, st)}<button class="btn sm ico" data-act="zoom" data-f="${f}" title="Phóng to frame này">${ICON.zoom}</button>`) + fitNoteHtml(f));
    c.cell.classList.toggle("active", f === activeFrame);
    c.cell.classList.toggle("split-start", !!plan.cuts?.some(cut => cut.reappearFrame === f));
    drawFrame(c.canvases, f, st);
  }

  // Khớp / Nhận / Hủy side by side in a small view's header, so a proposal is judged without
  // moving the mouse across the screen. Yaw and all six faces are always enabled.
  function fitControlsHtml(f, st) {
    const here = frameFit?.f === f, proposal = here && !frameFit.pending;
    const cancel = `<button class="btn sm ico" data-act="fit-cancel" data-f="${f}" title="Hủy (Esc)" aria-label="Hủy">${BTN_ICON.cancel}</button>`;
    if (here && frameFit.pending) return `<span class="fit-trio"><button class="btn sm ico" disabled title="Đang khớp…" aria-label="Đang khớp">${BTN_ICON.fit}</button>${cancel}</span>`;
    return `<span class="fit-trio"><button class="btn sm ico" data-act="fit" data-f="${f}" ${st.outside || fitting ? "disabled" : ""} title="Khớp box frame này với point cloud" aria-label="Khớp frame này">${BTN_ICON.fit}</button>${
      proposal ? `<button class="btn sm ico" data-act="fit-accept" data-f="${f}" title="Chấp nhận (Enter)" aria-label="Chấp nhận">${BTN_ICON.accept}</button>${cancel}` : ""}</span>`;
  }
  function fitNoteHtml(f) {
    if (frameFit?.f === f && !frameFit.pending) return `<span class="fit-note proposal">Xanh: đề xuất · ${esc(frameFitSummary(frameFit))} · ${frameFit.beforeCount} → ${frameFit.afterCount} điểm</span>`;
    return frameFitNote?.f === f ? `<span class="fit-note">${esc(frameFitNote.text)}</span>` : "";
  }

  function drawZoom() {
    const st = stateAt(zoomFrame), list = eligible();
    const prev = list.filter((x) => x < zoomFrame).pop(), next = list.find((x) => x > zoomFrame);
    setHead($(".zhead"), headHtml(zoomFrame, st,
      `<span class="nav"><button class="btn sm" data-act="go" data-f="${prev}" ${prev === undefined ? "disabled" : ""} title="Frame trước (D)">‹</button>
       <span class="pos">${frames.indexOf(zoomFrame) + 1} / ${frames.length}</span>
       <button class="btn sm" data-act="go" data-f="${next}" ${next === undefined ? "disabled" : ""} title="Frame sau (F)">›</button></span>
       <button class="btn sm ico" data-act="unzoom" title="Thu nhỏ (Esc)" aria-label="Thu nhỏ">${BTN_ICON.shrink}</button>`));
    drawFrame(zoomCanvases, zoomFrame, st);
    if (lidar) lidar.setBox(boxFrame(st.points), st.outside, [true, true, true],
      frameFit && !frameFit.pending && frameFit.f === zoomFrame ? boxFrame(frameFit.points) : null);
  }

  // While a frame is dragged its views keep the box from the drag start as reference, so the view
  // doesn't slide under the mouse; they re-center on release.
  function drawFrame(canvases, f, st) {
    const live = drag && drag.f === f, ref = live ? drag.ref : st.points;
    const crop = nearCached(plan.track.clientID ?? plan.track.id, f);
    if (!live && !(crop && cropCovers(crop, ref.slice(0, 3), frameReach(f, ref)))) ensureLoad(f);
    const err = loadState.get(f) instanceof Error ? loadState.get(f) : null;
    const proposed = frameFit && !frameFit.pending && frameFit.f === f ? frameFit.points : null;
    const zoomed = canvases === zoomCanvases;
    canvases.forEach((cv, i) => {
      const win = live ? drag.wins[i] : viewWindow(ref, i, zoomed);
      drawView(cv, crop && crop.xyz, st, ref, win, VIEWS[i], err, proposed, f);
      if (zoomed && regionDrag && regionDrag.vi === i && cv.width) drawRegion(cv, win, regionDrag);
    });
  }

  function drawRegion(cv, win, R) {
    const ctx = cv.getContext("2d"), mid = cv.width / 2, scale = mid / win.range, dot = dotOf(cv);
    const X = (u) => mid + (u - win.cu) * scale, Y = (w) => mid - (w - win.cw) * scale;
    const x = Math.min(X(R.u0), X(R.u1)), y = Math.min(Y(R.w0), Y(R.w1)), wd = Math.abs(X(R.u1) - X(R.u0)), ht = Math.abs(Y(R.w1) - Y(R.w0));
    ctx.fillStyle = "rgba(246,229,0,.08)"; ctx.fillRect(x, y, wd, ht);
    ctx.strokeStyle = "#f6e500"; ctx.lineWidth = 1.5 * dot; ctx.setLineDash([6 * dot, 4 * dot]);
    ctx.strokeRect(x, y, wd, ht); ctx.setLineDash([]);
  }

  function drawView(cv, xyz, st, ref, win, v, err, proposed = null, f = null) {
    const W = cv.width;
    if (!W) return;
    const { range, cu, cw } = win, ctx = cv.getContext("2d"), mid = W / 2, scale = mid / range, dot = dotOf(cv);
    const R = boxFrame(ref), S = boxFrame(st.points), same = ref === st.points, hs = S.half;
    // Build the pixels from scratch (no getImageData readback, which Chrome flags as slow).
    const img = ctx.createImageData(W, W), px = img.data;
    for (let o = 0; o < px.length; o += 4) { px[o] = px[o + 1] = px[o + 2] = 0x18; px[o + 3] = 255; }
    const plot = (q, shade, r) => {
      const X = Math.round(mid + (q[v.a] - cu) * scale), Y = Math.round(mid - (q[v.b] - cw) * scale);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = X + dx, y = Y + dy;
        if (x < 0 || y < 0 || x >= W || y >= W) continue;
        const o = (y * W + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = shade;
      }
    };
    const inside = [], rOut = Math.max(0, Math.round(dot - 0.6)), rIn = Math.max(1, Math.round(dot));
    if (xyz) {
      forPointsNear(xyz, R, (range + Math.hypot(cu, cw)) * Math.SQRT2 + R.reach, (x, y, z) => {
        const q = [x, y, z];
        if (Math.abs(q[v.a] - cu) > range || Math.abs(q[v.b] - cw) > range) return;
        const l = same ? q : toLocal(S, toWorld(R, q));
        if (Math.abs(l[0]) <= hs[0] && Math.abs(l[1]) <= hs[1] && Math.abs(l[2]) <= hs[2]) inside.push(q);
        else plot(q, Math.abs(l[v.c]) <= hs[v.c] ? 150 : 70, rOut); // brighter when level with the box
      });
    }
    for (const q of inside) plot(q, 255, rIn);
    ctx.putImageData(img, 0, 0);

    const P = (w) => { const q = toLocal(R, w); return [mid + (q[v.a] - cu) * scale, mid - (q[v.b] - cw) * scale]; };
    const corners = [];
    for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) corners.push(P(toWorld(S, [i * hs[0], j * hs[1], k * hs[2]])));
    ctx.strokeStyle = proposed ? "#ffbd69" : st.outside ? "#da291c" : "#d2d2d2";
    ctx.lineWidth = 2 * dot;
    ctx.setLineDash(st.outside ? [8 * dot, 6 * dot] : []);
    ctx.beginPath();
    for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
      ctx.moveTo(...corners[i]);
      ctx.lineTo(...corners[j]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (proposed) {
      const B = boxFrame(proposed), comparison = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) comparison.push(P(toWorld(B, [x * B.half[0], y * B.half[1], z * B.half[2]])));
      ctx.strokeStyle = "#44e5ff";
      ctx.beginPath();
      for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) {
        ctx.moveTo(...comparison[i]); ctx.lineTo(...comparison[i | bit]);
      }
      ctx.stroke();
    }
    if (f !== null && typeof plan !== "undefined" && plan?.shapes?.length && $(".trail")?.checked) {
      drawTrajectoryTrail(ctx, P, f, v, dot);
    }
    const colors = ["#ff5252", "#61d66b", "#5f8fff"];
    for (let axis = 0; axis < 3; axis++) {
      const direction = orientationInView(st.points, ref, v, axis);
      ctx.strokeStyle = ctx.fillStyle = colors[axis];
      ctx.lineWidth = 2 * dot; ctx.font = `${16 * dot}px sans-serif`;
      ctx.textAlign = "left";
      if (Math.hypot(direction.u, direction.w) < 0.08) {
        continue;
      }
      const end = [0, 0, 0]; end[axis] = hs[axis] * 0.8;
      const [cx, cy] = P(S.center), [ex, ey] = P(toWorld(S, end));
      const angle = Math.atan2(ey - cy, ex - cx), head = 7 * dot;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
      ctx.moveTo(ex - head * Math.cos(angle - Math.PI / 6), ey - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex - head * Math.cos(angle + Math.PI / 6), ey - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      ctx.fillText("+" + "XYZ"[axis], ex + 5 * dot, ey - 5 * dot);
    }
    // Like CVAT, a separate handle sits beyond the upper face in each orthographic view.
    const edge = [0, 0, 0], handle = [0, 0, 0];
    edge[v.b] = hs[v.b]; handle[v.b] = hs[v.b] + 14 * dot / scale;
    const [hx, hy] = P(toWorld(S, handle));
    ctx.strokeStyle = "#d2d2d2"; ctx.lineWidth = 2 * dot;
    ctx.beginPath(); ctx.moveTo(...P(toWorld(S, edge))); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = colors[v.c];
    ctx.beginPath(); ctx.arc(hx, hy, 6 * dot, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    if (!xyz) {
      ctx.fillStyle = "#969696";
      ctx.font = `${12 * dot}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(err ? "Không tải được point cloud" : "Đang tải…", mid, 20 * dot);
      ctx.textAlign = "start";
    }
  }

  function drawTrajectoryTrail(ctx, P, f, v, dot) {
    if (!v.cap.startsWith("Top") || typeof frames === "undefined" || !frames.length) return;
    const fMin = Math.max(frames[0], f - 5), fMax = Math.min(frames[frames.length - 1], f + 5);
    const pts = [];
    for (let k = fMin; k <= fMax; k++) {
      const pState = stateAt(k);
      if (!pState || pState.outside) continue;
      const c2d = P(pState.points.slice(0, 3));
      if (Number.isFinite(c2d[0]) && Number.isFinite(c2d[1])) pts.push({ k, c2d });
    }
    if (pts.length > 1) {
      ctx.strokeStyle = "rgba(0, 220, 255, 0.4)";
      ctx.lineWidth = 1.5 * dot;
      ctx.setLineDash([3 * dot, 3 * dot]);
      ctx.beginPath();
      pts.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.c2d[0], p.c2d[1]);
        else ctx.lineTo(p.c2d[0], p.c2d[1]);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      if (ctx.fillRect) {
        const s = 1.5 * dot;
        pts.forEach((p) => {
          if (p.k === f) return;
          ctx.fillStyle = p.k < f ? "rgba(0, 220, 255, 0.6)" : "rgba(255, 170, 68, 0.6)";
          ctx.fillRect(p.c2d[0] - s, p.c2d[1] - s, 2 * s, 2 * s);
        });
      }
    }
    for (const nf of [f - 1, f + 1]) {
      if (nf >= frames[0] && nf <= frames[frames.length - 1] && nf !== f) {
        const nst = stateAt(nf);
        if (nst && !nst.outside) {
          const G = boxFrame(nst.points), gh = G.half, gCorners = [];
          for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
            gCorners.push(P(toWorld(G, [x * gh[0], y * gh[1], z * gh[2]])));
          }
          ctx.strokeStyle = nf < f ? "rgba(0, 220, 255, 0.22)" : "rgba(255, 170, 68, 0.22)";
          ctx.lineWidth = 1 * dot;
          ctx.setLineDash([3 * dot, 4 * dot]);
          ctx.beginPath();
          for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
            ctx.moveTo(gCorners[i][0], gCorners[i][1]); ctx.lineTo(gCorners[j][0], gCorners[j][1]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  function updateSummary() {
    const manual = plan.shapes.filter((s) => plan.manual.has(s.frame));
    const hidden = frames.filter((f) => stateAt(f).outside).length;
    const shown = eligible().length;
    $(".fcount").textContent = shown === frames.length ? `${frames.length} frame` : `${shown} / ${frames.length} frame`;
    // Chips double as the preview filters: the same three as the checkboxes above the frames.
    const html = [["keyframe", plan.shapes.length, ".only-key"], ["sửa tay", manual.length, null], ["frame ẩn", hidden, ".only-hid"],
      ["khớp kém", plan.flagged.size, ".only-bad"]].map(([k, v, filter]) => filter ?
        `<button class="chip${$(filter).checked ? " on" : ""}" data-filter="${filter}" aria-pressed="${$(filter).checked}" title="Lọc frame: ${k}"><b>${v}</b> ${k}</button>` :
        `<button class="chip" disabled><b>${v}</b> ${k}</button>`).join("");
    if ($(".sumtab").dataset.html !== html) { $(".sumtab").innerHTML = html; $(".sumtab").dataset.html = html; }
  }

  // ---- filters, zoom and navigation ----

  function applyFilters() {
    const onlyKey = $(".only-key").checked, onlyHid = $(".only-hid").checked, onlyBad = $(".only-bad").checked;
    for (const [f, c] of cells) c.cell.hidden = (onlyKey && !keyAt(f)) || (onlyHid && !stateAt(f).outside) || (onlyBad && !plan.flagged.has(f));
    $(".filter-empty").hidden = !cells.size || eligible().length > 0;
  }
  const eligible = () => frames.filter((f) => !cells.get(f).cell.hidden);

  function reveal(f, flash = true) {
    if (zoomFrame !== null) return openZoom(f);
    const c = cells.get(f);
    if (!c) return;
    if (c.cell.hidden) {
      $(".only-key").checked = $(".only-hid").checked = $(".only-bad").checked = false;
      applyFilters();
    }
    c.cell.scrollIntoView({ block: flash ? "center" : "nearest" });
    if (flash) {
      c.cell.classList.add("flash");
      setTimeout(() => c.cell.classList.remove("flash"), 900);
    }
  }

  // The frame being worked on gets a red outline; D / F step it like in CVAT.
  function setActive(f) {
    if (f === activeFrame) return;
    const old = cells.get(activeFrame), cur = cells.get(f);
    if (old) old.cell.classList.remove("active");
    activeFrame = f;
    if (cur) cur.cell.classList.add("active");
  }

  function step(dir) {
    const list = eligible(), at = zoomFrame ?? activeFrame;
    const next = at === null ? list[0] : dir < 0 ? list.filter((x) => x < at).pop() : list.find((x) => x > at);
    if (next === undefined) return;
    if (zoomFrame !== null) return openZoom(next);
    setActive(next);
    cells.get(next).cell.scrollIntoView({ block: "nearest" });
  }

  function openZoom(f) {
    endDrag();
    if (frameFit?.f !== f) cancelFrameFit();
    nudgeKey = null;
    setActive(f);
    const changed = zoomFrame !== f;
    zoomFrame = f;
    renderFrameFit();
    zoom.hidden = false;
    panel.classList.add("frame-expanded");
    selectKeyboardView(keyboardView);
    if (changed) void loadLidar(f);
    fitZoom();
    editor.focus({ preventScroll: true });
    scheduleDraw();
  }
  function closeZoom() {
    if (zoomFrame === null) return;
    endDrag();
    const f = zoomFrame;
    zoomFrame = null;
    zoom.hidden = true;
    clearLidar();
    panel.classList.remove("frame-expanded");
    zoomCanvases.forEach((cv) => (cv.width = cv.height = 0));
    reveal(f, false);
    scheduleDraw();
  }
  // Square canvases that fill their slot, at device resolution, so pointer and pixels map 1:1.
  function fitZoom() {
    if (zoomFrame === null) return;
    for (const cv of zoomCanvases) {
      const slot = cv.parentElement, size = Math.max(50, Math.floor(Math.min(slot.clientWidth, slot.clientHeight)) - 2);
      const px = Math.round(size * devicePixelRatio);
      cv.style.width = cv.style.height = size + "px";
      if (cv.width !== px) cv.width = cv.height = px; // resizing clears the bitmap, so only when it changed
    }
    lidar?.resize();
  }
  new ResizeObserver(() => { fitZoom(); scheduleDraw(); }).observe($(".zbody"));

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const f = Number(e.target.dataset.f), c = cells.get(f);
      if (!c) continue;
      if (e.isIntersecting) visible.add(f); else visible.delete(f);
      for (const cv of c.canvases) cv.width = cv.height = e.isIntersecting ? CELL_PX : 0; // off screen: no bitmap
    }
    scheduleDraw();
  }, { root: grid, rootMargin: "300px 0px" });

  function openEditor() {
    closeEditor();
    editGen++;
    frames = [];
    for (let f = plan.shapes[0].frame; f <= job.stop_frame; f++) frames.push(f);
    const views = VIEWS.map((v, i) => `<div class="view"><canvas data-v="${i}" width="0" height="0"></canvas><div class="cap">${v.cap}</div></div>`).join("");
    grid.innerHTML = frames.map((f) => `<div class="cell" data-f="${f}"><div class="chead"></div><div class="views">${views}</div></div>`).join("");
    for (const cell of grid.children) {
      cells.set(Number(cell.dataset.f), { cell, head: cell.firstElementChild, canvases: [...cell.querySelectorAll("canvas")] });
      observer.observe(cell);
    }
    editor.hidden = false;
    setEditSection(true);
    $(".fit-a").value = plan.shapes[0].frame;
    $(".fit-b").value = plan.shapes[plan.shapes.length - 1].frame;
    $(".fit-ref").value = "";
    panel.classList.add("wide");
    fitPanel();
    applyFilters();
    scheduleDraw();
  }

  function closeEditor() {
    endDrag();
    cancelFrameFit();
    clearLidar();
    lidarCamera = null;
    orthoZoom = VIEWS.map(() => ({ k: 1, u: 0, w: 0 }));
    panDrag = regionDrag = null;
    setRegionMode(false);
    setSolo(null);
    if (root.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (fitting) fitting.cancelled = true;
    observer.disconnect();
    grid.innerHTML = "";
    cells.clear();
    visible.clear();
    loadState.clear();
    queue.length = 0;
    undoStack = [];
    zoomFrame = null;
    activeFrame = null;
    zoom.hidden = true;
    editor.hidden = true;
    setEditSection(false);
    panel.classList.remove("wide", "frame-expanded");
    editGen++;
    fitPanel();
  }

  // The wide panel (tool + frames) fills the window below and right of its corner.
  // The preview fills the window (CSS); a narrow window gets one frame per row.
  function fitPanel() {
    grid.classList.toggle("one", panel.classList.contains("wide") && grid.clientWidth < 760);
  }

  // Browser fullscreen for the panel; the shadow root knows which of its elements holds it.
  function toggleFullscreen() {
    if (root.fullscreenElement) document.exitFullscreen().catch(() => {});
    else panel.requestFullscreen().catch((e) => setStatus(`Không bật được toàn màn hình: ${e.message}`, true));
  }
  document.addEventListener("fullscreenchange", () => { fitPanel(); fitZoom(); scheduleDraw(); });
  addEventListener("resize", () => { fitPanel(); fitZoom(); });

  // ---- mouse editing ----

  function clearLidar() {
    lidarRequest++;
    nudgeKey = null;
    lidarCamera = lidar?.getCamera() || lidarCamera;
    lidar?.clear();
    $(".lidar-message").textContent = "";
  }

  async function loadLidar(f) {
    const request = ++lidarRequest;
    lidarCamera = lidar?.getCamera() || lidarCamera;
    try {
      if (lidar?.lost) {
        const old = $(".lidar-canvas");
        old.replaceWith(old.cloneNode(false));
        lidar = null;
      }
      if (!lidar) lidar = globalThis.CvatLidarView.create($(".lidar-canvas"), message => { $(".lidar-message").textContent = message; });
      lidar.clear();
      lidar.setBox(boxFrame(stateAt(f).points), stateAt(f).outside, [true, true, true]);
      lidar.restoreCamera(lidarCamera);
      lidar.resize();
      $(".lidar-message").textContent = "Đang tải LiDAR 3D…";
      const xyz = await loadCloud(f);
      if (request !== lidarRequest || zoomFrame !== f || !plan) return;
      lidar.setCloud(xyz);
      const planLabel = plan.track.id != null ? `id ${plan.track.id} (#${plan.track.uiId})` : `#${plan.track.uiId}`;
      $(".lidar-message").textContent = `${(xyz.length / 3).toLocaleString()} điểm · chỉ box item ${planLabel}`;
    } catch (error) {
      if (request === lidarRequest) $(".lidar-message").textContent = `Không mở được LiDAR 3D: ${error.message}`;
    }
  }

  function selectKeyboardView(index) {
    keyboardView = index;
    zoom.querySelectorAll(".view").forEach((view, i) => view.classList.toggle("keyboard-view", i === index));
    $(".lidar-slot").classList.toggle("keyboard-view", index === 3);
  }

  // Arrow displacement is in the selected view plane; PageUp/Down uses world Z.
  function nudgeFrame(e) {
    const f = zoomFrame ?? activeFrame;
    if (!plan || fitting || drag || f === null) return;
    const amount = e.shiftKey ? .01 : e.altKey ? .2 : .05;
    const p = stateAt(f).points, local = [0, 0, 0];
    let delta;
    if (e.key === "PageUp" || e.key === "PageDown") delta = [0, 0, e.key === "PageUp" ? amount : -amount];
    else {
      const x = e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0;
      const y = e.key === "ArrowDown" ? -amount : e.key === "ArrowUp" ? amount : 0;
      if (keyboardView === 3 && lidar) delta = lidar.screenDelta(x, y);
      else { const v = VIEWS[keyboardView === 3 ? 0 : keyboardView]; local[v.a] = x; local[v.b] = y; delta = mul(boxFrame(p).R, local); }
    }
    if (!e.repeat || nudgeKey !== e.key) commit(snapshot());
    nudgeKey = e.key;
    const next = p.slice();
    delta.forEach((value, i) => { next[i] += value; });
    setGeometry(f, next, null);
    modelChanged();
  }

  editor.addEventListener("pointerdown", e => {
    nudgeKey = null;
    const canvas = e.target.closest("canvas");
    if (!canvas) return;
    selectKeyboardView(canvas.classList.contains("lidar-canvas") ? 3 : Number(canvas.dataset.v));
    editor.focus({ preventScroll: true });
  });
  $(".reset-camera").addEventListener("click", () => { lidar?.reset(); editor.focus({ preventScroll: true }); });

  function pointerLocal(cv, e, win) {
    const r = cv.getBoundingClientRect(), mid = cv.width / 2, scale = mid / win.range;
    return [((e.clientX - r.left) * cv.width / r.width - mid) / scale + win.cu, (mid - (e.clientY - r.top) * cv.height / r.height) / scale + win.cw];
  }
  function hitTest(cv, p, v, u, w, range) {
    const scale = cv.width / 2 / range, dot = dotOf(cv), tol = 7 * dot / scale;
    const ha = p[6 + v.a] / 2, hb = p[6 + v.b] / 2;
    if (Math.hypot(u, w - (hb + 14 * dot / scale)) < 10 * dot / scale) return { mode: "rotate", cursor: "grab" };
    if (Math.abs(Math.abs(u) - ha) < tol && Math.abs(w) < hb + tol) return { mode: "size", axis: v.a, sign: Math.sign(u) || 1, cursor: "ew-resize" };
    if (Math.abs(Math.abs(w) - hb) < tol && Math.abs(u) < ha + tol) return { mode: "size", axis: v.b, sign: Math.sign(w) || 1, cursor: "ns-resize" };
    if (Math.abs(u) < ha && Math.abs(w) < hb) return { mode: "move", cursor: "move" };
    return null;
  }
  const canvasFrame = (cv) => (cv.closest(".zoom") ? zoomFrame : Number(cv.closest(".cell").dataset.f));
  const canvasWindow = (cv, p) => viewWindow(p, Number(cv.dataset.v), !!cv.closest(".zoom"));

  // Pan freely across the frame cloud, independently of zoom. Double-click returns to the box.
  function setOrthoWindow(i, p, k, cu, cw) {
    const base = viewRange(p, VIEWS[i]);
    if (![k, cu, cw, base].every(Number.isFinite) || k < 0.1 || base <= 0) return;
    orthoZoom[i] = { k, u: cu / base, w: cw / base };
    scheduleDraw();
  }

  // Wheel zooms an expanded Top/Side/Front view about the pointer; dragging empty space pans it.
  editor.addEventListener("wheel", (e) => {
    const cv = e.target.closest(".zoom canvas[data-v]");
    if (!cv || !plan || zoomFrame === null || drag || regionDrag) return;
    e.preventDefault();
    const i = Number(cv.dataset.v), p = stateAt(zoomFrame).points, base = viewRange(p, VIEWS[i]), win = viewWindow(p, i, true);
    const [u, w] = pointerLocal(cv, e, win), su = (u - win.cu) / win.range, sw = (w - win.cw) / win.range;
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cv.clientHeight : 1);
    const k = Math.max(0.1, orthoZoom[i].k * Math.exp(Math.max(-1, Math.min(1, pixels * 0.0015)))), range = base * k;
    setOrthoWindow(i, p, k, u - su * range, w - sw * range);
  }, { passive: false });
  editor.addEventListener("contextmenu", (e) => { if (e.target.closest(".zoom canvas[data-v]")) e.preventDefault(); });

  // Where the box should go for a region drawn in view v (box axes, metres): the middle of the object
  // points there, horizontally only (the floor is left to the fit), then — for an upright box — the
  // fit's face alignment (contain) on those points, so a box longer than the visible part rests on the
  // face the LiDAR saw instead of straddling it. Ground is the lowest layer of the region's points and
  // is dropped; with too few points the region's own middle is used. Returns the shift in box axes and
  // the number of points it is based on.
  function regionShift(xyz, p, v, u0, u1, w0, w1) {
    const F = boxFrame(p), ua = Math.min(u0, u1), ub = Math.max(u0, u1), wa = Math.min(w0, w1), wb = Math.max(w0, w1);
    const depth = F.half[v.c] + 1, pts = [];
    forPointsNear(xyz, F, Math.hypot(Math.max(-ua, ub), Math.max(-wa, wb), depth), (x, y, z) => {
      const q = [x, y, z];
      if (q[v.a] < ua || q[v.a] > ub || q[v.b] < wa || q[v.b] > wb || Math.abs(q[v.c]) > depth) return;
      pts.push(q);
    });
    let obj = [];
    if (pts.length) {
      const zs = pts.map((q) => q[2]).sort((a, b) => a - b), ground = zs[Math.floor(zs.length * 0.05)];
      obj = pts.filter((q) => q[2] >= ground + 0.2);
    }
    const mid = (axis, lo, hi) => {
      if (obj.length < 10) return (lo + hi) / 2;
      const vals = obj.map((q) => q[axis]).sort((a, b) => a - b);
      return (vals[Math.floor(vals.length * 0.02)] + vals[Math.ceil(vals.length * 0.98) - 1]) / 2;
    };
    const shift = [0, 0, 0];
    shift[v.a] = mid(v.a, ua, ub);
    if (v.b !== 2) shift[v.b] = mid(v.b, wa, wb);
    if (obj.length < 10) return { shift, n: 0 };
    if (Math.abs(p[3]) <= 0.01 && Math.abs(p[4]) <= 0.01) {
      const Q = obj.flatMap((q) => toWorld(F, q)), c = toWorld(F, shift);
      let P = { x: c[0], y: c[1], z: p[2], yaw: p[5] };
      for (let i = 0; i < 4; i++) P = contain(Q, P, p.slice(6, 9));
      const local = toLocal(F, [P.x, P.y, p[2]]);
      shift[0] = local[0]; shift[1] = local[1];
    }
    return { shift, n: obj.length };
  }

  function moveToRegion(R) {
    if (!plan || fitting || zoomFrame !== R.f) return;
    if (Math.abs(R.u1 - R.u0) < 0.1 && Math.abs(R.w1 - R.w0) < 0.1) return; // a click, not a region
    const crop = nearCached(plan.track.clientID ?? plan.track.id, R.f), p = stateAt(R.f).points;
    if (!crop) return renderFrameFit("Point cloud chưa tải xong.", R.f);
    const { shift, n } = regionShift(crop.xyz, p, VIEWS[R.vi], R.u0, R.u1, R.w0, R.w1);
    const next = p.slice();
    mul(boxFrame(p).R, shift).forEach((d, i) => { next[i] += d; });
    const snap = snapshot();
    setGeometry(R.f, next, null);
    commit(snap);
    modelChanged();
    renderFrameFit(`Đã đưa box về vùng chọn (${n ? `giữa ${n} điểm` : "giữa vùng, ít điểm"}, dịch ${(Math.hypot(...shift) * 100).toFixed(0)} cm). Bấm khớp để chỉnh sát.`, R.f);
  }

  editor.addEventListener("dblclick", (e) => {
    const cv = e.target.closest(".zoom canvas[data-v]");
    if (cv && plan && zoomFrame !== null) setOrthoWindow(Number(cv.dataset.v), stateAt(zoomFrame).points, 1, 0, 0);
  });

  // <svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg> shows one expanded view alone; pressing it again brings the four views back.
  function setSolo(slot) {
    soloSlot = slot;
    const zbody = $(".zbody"), slots = [...zoom.querySelectorAll(".zbody .view"), $(".lidar-slot")];
    zbody.classList.toggle("solo", slot !== null);
    slots.forEach((el, i) => el.classList.toggle("solo-view", i === slot));
    zoom.querySelectorAll(".view-max").forEach((b) => {
      const on = Number(b.dataset.slot) === slot;
      b.classList.toggle("on", on);
      b.title = on ? "Hiện lại cả bốn view" : "Phóng to riêng view này";
    });
    if (slot !== null) selectKeyboardView(slot);
    fitZoom();
    scheduleDraw();
  }
  $(".zbody").addEventListener("click", (e) => {
    const b = e.target.closest(".view-max");
    if (!b) return;
    const slot = Number(b.dataset.slot);
    setSolo(soloSlot === slot ? null : slot);
    editor.focus({ preventScroll: true });
  });

  editor.addEventListener("pointerdown", (e) => {
    const cv = e.target.closest("canvas[data-v]");
    if (!cv || !plan || drag || panDrag || regionDrag || fitting) return;
    const inZoom = !!cv.closest(".zoom"), vi = Number(cv.dataset.v);
    if (e.button !== 0 && !(inZoom && (e.button === 1 || e.button === 2))) return;
    editor.focus({ preventScroll: true });
    setActive(canvasFrame(cv));
    const f = canvasFrame(cv), v = VIEWS[vi], st = stateAt(f), win = canvasWindow(cv, st.points);
    const [u, w] = pointerLocal(cv, e, win), hit = e.button === 0 && hitTest(cv, st.points, v, u, w, win.range);
    if (!hit) {
      if (!inZoom) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      // Right/middle drag pans; a left drag draws the region to send the box to when that mode is on.
      if (e.button !== 0 || !regionMode) panDrag = { cv, vi, pointerId: e.pointerId, win, u0: u, w0: w };
      else { regionDrag = { cv, f, vi, pointerId: e.pointerId, win, u0: u, w0: w, u1: u, w1: w }; scheduleDraw(); }
      return;
    }
    cancelFrameFit();
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const zoomed = !!cv.closest(".zoom");
    drag = { cv, f, vi: Number(cv.dataset.v), pointerId: e.pointerId, ref: st.points, u0: u, w0: w, ...hit,
             wins: VIEWS.map((x, i) => viewWindow(st.points, i, zoomed)), snap: snapshot(), changed: false };
  });

  editor.addEventListener("pointermove", (e) => {
    const cv = e.target.closest("canvas[data-v]");
    if (regionDrag) {
      if (e.pointerId !== regionDrag.pointerId) return;
      [regionDrag.u1, regionDrag.w1] = pointerLocal(regionDrag.cv, e, regionDrag.win);
      scheduleDraw();
      return;
    }
    if (panDrag) {
      if (e.pointerId !== panDrag.pointerId || zoomFrame === null) return;
      const P = panDrag, [u, w] = pointerLocal(P.cv, e, P.win);
      setOrthoWindow(P.vi, stateAt(zoomFrame).points, orthoZoom[P.vi].k, P.win.cu - (u - P.u0), P.win.cw - (w - P.w0));
      return;
    }
    if (!drag) {
      if (!cv || !plan) return;
      const f = canvasFrame(cv), v = VIEWS[cv.dataset.v], st = stateAt(f), win = canvasWindow(cv, st.points);
      const hit = hitTest(cv, st.points, v, ...pointerLocal(cv, e, win), win.range);
      cv.style.cursor = hit ? hit.cursor : !cv.closest(".zoom") ? "default" : regionMode ? "crosshair" : "grab";
      cv.title = hit?.mode === "rotate" ? `Xoay quanh ${v.axis}; giữ Shift để bước 15°` : v.cap;
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    const d = drag, v = VIEWS[d.vi], [u, w] = pointerLocal(d.cv, e, d.wins[d.vi]);
    const p0 = d.ref, F = boxFrame(p0), delta = [0, 0, 0], p = p0.slice();
    delta[v.a] = u - d.u0;
    delta[v.b] = w - d.w0;
    let size = null;
    if (d.mode === "move") {
      mul(F.R, delta).forEach((x, i) => (p[i] += x));
    } else if (d.mode === "size") { // the opposite face stays where it was
      const k = d.axis, s = Math.max(0.05, p0[6 + k] + d.sign * delta[k]), shift = [0, 0, 0];
      shift[k] = d.sign * (s - p0[6 + k]) / 2;
      mul(F.R, shift).forEach((x, i) => (p[i] += x));
      p[6 + k] = s;
      size = p.slice(6, 9);
    } else { // turn in this view's local plane, including already tilted cuboids
      if (Math.hypot(u, w) < 1e-6) return;
      let angle = wrapAngle(Math.atan2(w, u) - Math.atan2(d.w0, d.u0));
      if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
      const rotated = rotatedInView(p0, v, angle);
      for (let i = 3; i < 6; i++) p[i] = rotated[i];
    }
    d.changed = true;
    setGeometry(d.f, p, size);
    scheduleDraw();
  });

  // Every way a drag can stop ends here; one finished drag is one undo step.
  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { d.cv.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    if (d.changed) commit(d.snap);
    modelChanged();
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    editor.addEventListener(type, (e) => {
      if (regionDrag && e.pointerId === regionDrag.pointerId) {
        const R = regionDrag;
        regionDrag = null;
        if (type === "pointerup") moveToRegion(R);
        scheduleDraw();
      }
      if (panDrag && e.pointerId === panDrag.pointerId) panDrag = null;
      if (drag && e.pointerId === drag.pointerId) endDrag();
    });
  }

  editor.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || !plan) return;
    if (fitting && b.dataset.act !== "zoom" && b.dataset.act !== "go" && b.dataset.act !== "unzoom") return setStatus("Đang tự khớp: chờ xong hoặc bấm Dừng.");
    if (b.dataset.act === "rotate") {
      const cv = b.closest(".view").querySelector("canvas");
      selectKeyboardView(Number(cv.dataset.v));
      rotateFrame(canvasFrame(cv), VIEWS[cv.dataset.v], Number(b.dataset.turn));
      return;
    }
    const f = Number(b.dataset.f), act = b.dataset.act;
    if (act !== "unzoom") setActive(act === "go" ? f : zoomFrame ?? f);
    if (act === "out") toggleOutside(f);
    if (act === "key") toggleKey(f);
    if (act === "zoom") openZoom(f);
    if (act === "fit") void proposeFrameFit(f);
    if (act === "fit-accept") acceptFrameFit();
    if (act === "fit-cancel") cancelFrameFit();
    if (act === "go") openZoom(f);
    if (act === "unzoom") closeZoom();
  });
  editor.addEventListener("change", (e) => {
    const el = e.target;
    if (!plan || !el.matches("[data-f]")) return;
    if (fitting) { // put the picker back to the model's value
      el.closest(".chead").dataset.html = "";
      setStatus("Đang tự khớp: chờ xong hoặc bấm Dừng.");
      return modelChanged();
    }
    if (!el.checkValidity()) {
      el.reportValidity();
      return setStatus("Giá trị attribute nằm ngoài giới hạn cho phép.", true);
    }
    setActive(Number(el.dataset.f));
    if (el.matches("[data-label]")) setLabel(Number(el.value));
    else if (el.dataset.spec) setAttribute(Number(el.dataset.f), Number(el.dataset.spec), el.value);
  });
  $(".clear").addEventListener("click", clearKeys);
  $(".sumtab").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip || !plan) return;
    $(chip.dataset.filter).checked = !$(chip.dataset.filter).checked;
    modelChanged();
  });
  $(".full").addEventListener("click", toggleFullscreen);
  $(".reset-filters").addEventListener("click", () => {
    $(".only-key").checked = $(".only-hid").checked = $(".only-bad").checked = false;
    modelChanged();
    editor.focus({ preventScroll: true });
  });
  $(".only-key").addEventListener("change", modelChanged);
  $(".only-hid").addEventListener("change", modelChanged);
  $(".only-bad").addEventListener("change", modelChanged);
  $(".fit").addEventListener("click", autoFit);
  $(".fit-current").addEventListener("click", () => proposeFrameFit());
  function setRegionMode(on) {
    regionMode = on;
    const b = $(".region-mode");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  $(".region-mode").addEventListener("click", () => { setRegionMode(!regionMode); editor.focus({ preventScroll: true }); });
  $(".fit-accept").addEventListener("click", acceptFrameFit);
  $(".fit-cancel").addEventListener("click", cancelFrameFit);
  $(".eclose").addEventListener("click", () => { if (confirmDrop()) closePlan(); });

  // Keys reach this only from inside the panel (the shadow root stops them from reaching CVAT).
  root.addEventListener("keydown", (e) => {
    if (!plan || editor.hidden || e.target.closest("input, select, textarea, [contenteditable]")) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) nudgeKey = null;
    let handled = true;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") undo();
    else if (e.key === "Escape" && !$(".helpbox").hidden) $(".helpbox").hidden = true;
    else if (e.key === "Escape" && frameFit) cancelFrameFit();
    else if (e.key === "Enter" && frameFit && !frameFit.pending && !e.target.closest("button")) acceptFrameFit();
    else if (e.key === "Escape" && zoomFrame !== null) closeZoom();
    else if (!e.metaKey && !e.ctrlKey && (zoomFrame ?? activeFrame) !== null && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) nudgeFrame(e);
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && [",", ".", "<", ">"].includes(e.key) && (zoomFrame ?? activeFrame) !== null) {
      if (!fitting && !drag) rotateFrame(zoomFrame ?? activeFrame, VIEWS[keyboardView === 3 ? 0 : keyboardView],
        ([",", "<"].includes(e.key) ? -1 : 1) * (e.shiftKey ? 15 : 1));
    }
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "d" || e.key === "D")) step(-1);
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "f" || e.key === "F")) step(1);
    else handled = false;
    if (handled) e.preventDefault();
  });
  root.addEventListener("keyup", e => { if (e.key === nudgeKey) nudgeKey = null; });
  addEventListener("blur", () => { nudgeKey = null; });


  // ---------- wiring ----------

  const guard = (fn) => async () => { try { await fn(); } catch (e) { setStatus(e.message, true); } };

  fab.addEventListener("click", guard(async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !plan) { // reopening keeps a preview in progress
      await loadData();
      if (activeUiId() !== null && annotations.tracks.some((t) => t.uiId === activeUiId())) await pickActive();
    }
  }));
  $(".close").addEventListener("click", () => (panel.hidden = true));
  // Auto-fit needs a preview; outside one it stays visible but inert. While a preview is open the
  // header's close only tucks the panel away (the draft stays), so it shows — instead of ✕.
  function setEditSection(on) {
    const sec = $(".edit-sec"), close = $(".close");
    sec.classList.toggle("off", !on);
    sec.inert = !on;
    $(".draft").hidden = !on;
    close.textContent = on ? "—" : "✕";
    close.title = on ? "Ẩn panel, giữ bản nháp" : "Đóng";
    close.setAttribute("aria-label", close.title);
  }
  $(".help-btn").addEventListener("click", () => ($(".helpbox").hidden = !$(".helpbox").hidden));
  root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".helpbox, .help-btn")) $(".helpbox").hidden = true; });

  // Drag the panel by its title so it never has to cover the part of CVAT being worked on.
  const POS_KEY = "cvat-track-resizer-pos";
  const place = (left, top) => {
    panel.style.left = Math.max(0, Math.min(left, innerWidth - 60)) + "px";
    panel.style.top = Math.max(0, Math.min(top, innerHeight - 40)) + "px";
  };
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (saved) place(saved.left, saved.top);
  } catch { /* storage unavailable: keep the default spot */ }
  $("h3").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || panel.classList.contains("wide")) return;
    const box = panel.getBoundingClientRect(), dx = e.clientX - box.left, dy = e.clientY - box.top;
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const stop = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", stop);
      fitPanel();
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }));
      } catch { /* not remembered, still works */ }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", stop);
    e.preventDefault();
  });
  $(".refresh").addEventListener("click", guard(async () => {
    if (!confirmDrop()) return;
    switchGeneration++;
    closePlan();
    await loadData(Number($(".track").value));
  }));
  async function unlockFromPopup(proof, issued) {
    const ownerJob = jobId;
    vaultBusy = true; vaultMessage = "Đang mở khóa và chuyển dữ liệu cũ…"; renderVaultState();
    try {
      await cacheVault.acceptUnlock(proof, issued.header, issued.lockToken);
      await cacheVault.migrateOrigins();
      await CvatCacheVault.retireLegacy();
      if (ownerJob !== jobId || !cacheVault.unlocked) throw Error("Tab/cache đã đổi khi mở khóa. Thử lại từ popup.");
      if (annotations) await syncStoredOrigins(annotations.tracks);
      vaultMessage = originStorageWarning || "Đã mở khóa. Cache cũ đã dọn; dữ liệu mới lưu mã hóa.";
      await refreshVaultCache(); renderSplitNavigation();
      if (!cacheVault.unlocked) throw Error("Cache đã bị khóa trong lúc mở khóa.");
      return vaultMessage;
    } catch (error) {
      cacheVault.lock(); vaultMessage = error.message; setStatus(error.message, true); throw error;
    } finally { proof?.rawKey?.fill(0); vaultBusy = false; renderVaultState(); }
  }
  async function lockAllVaults() {
    // Revocation first: do not wait for fits/network work in any tab to finish.
    try { cacheVault.lockAll(); }
    finally { lockVault(); }
    vaultMessage = "Đã khóa mọi tab cùng server. Bản nháp giữ trong tab; nguồn item chưa lưu cần mở khóa lại trước khi đóng trang.";
    renderVaultState(); return vaultMessage;
  }
  cacheChannel = CvatCacheChannel.install({
    getState: () => ({ origin: location.origin, jobId, ...cacheVault.describe(), unlocked: cacheVault.unlocked,
      busy: vaultBusy || saving || !!fitting || previewRun !== null }),
    unlock: unlockFromPopup, lockAll: lockAllVaults,
  });
  $(".vault-lock").addEventListener("click", guard(lockAllVaults));
  $(".vault-reset").addEventListener("click", guard(async () => {
    if (vaultBusy || saving || fitting || previewRun !== null) return setStatus("Dừng tác vụ trước khi xóa kho.", true);
    if (!confirm("Xóa kho cache và mọi liên kết nguồn item đã lưu trên server này? Không khôi phục được nguồn item. Annotation trên CVAT không bị xóa.")) return;
    vaultBusy = true;
    try {
      lockVault(); await cacheVault.reset(async () => { await encryptedCloudStore.clear(); await CvatCacheVault.retireLegacy(); });
      vaultMessage = "Đã xóa kho. Có thể đặt mật khẩu mới hoặc tiếp tục chỉ dùng RAM.";
    } finally { vaultBusy = false; renderVaultState(); }
  }));
  addEventListener("pagehide", lockVault);
  addEventListener("storage", event => {
    if (event.key === CvatCacheVault.HEADER || event.key === CvatCacheVault.LOCK || event.key === null) lockVault();
  });
  renderVaultState();
  $(".cache-toggle").addEventListener("click", guard(async () => {
    if (cloudCache.state.running) cloudCache.stop();
    else await cloudCache.prefetch();
  }));
  $(".cache-clear").addEventListener("click", guard(async () => {
    if (fitting || previewRun !== null) return setStatus("Dừng xem trước/tự khớp trước khi xóa cache.", true);
    $(".cache-clear").disabled = true;
    $(".cache-toggle").disabled = true;
    editGen++;
    near.clear(); nearFloats = 0; counted.clear(); queue.length = 0; loadState.clear();
    try { await cloudCache.clear(); }
    finally {
      $(".cache-clear").disabled = false;
      renderVaultState();
      scheduleDraw();
    }
  }));
  $(".review-done").addEventListener("change", toggleItemReviewed);
  $(".review-next").addEventListener("click", guard(nextUncheckedItem));
  addEventListener("storage", e => { if (e.key === reviews.key(jobId) || e.key === null) renderReviewState(); });
  $(".pick").addEventListener("click", guard(pickActive));
  $(".track").addEventListener("change", guard(() => switchTrack(Number($(".track").value))));
  $(".bottom").addEventListener("change", markStale);
  $(".auto").addEventListener("change", markStale);
  $(".thr").addEventListener("input", markStale);
  root.addEventListener("click", e => {
    const button = e.target.closest("button[data-split-kind]");
    if (!button || button.disabled) return;
    void navigateSplit(button.dataset.splitKind, Number(button.dataset.splitIndex)).catch(error => setStatus(error.message, true));
  });
  $(".split-outside").addEventListener("change", modelChanged);
  $(".split-gap").addEventListener("input", modelChanged);
  if ($(".trail")) $(".trail").addEventListener("change", scheduleDraw);
  $(".preview").addEventListener("click", preview);
  $(".apply").addEventListener("click", apply);

  // CVAT is a single-page app: show the button only while a job page is open.
  function sync() {
    const m = location.pathname.match(JOB_PATH);
    const id = m ? Number(m[1]) : null;
    if (id !== jobId) {
      cacheChannel?.invalidate();
      dataGeneration++;
      switchGeneration++;
      jobId = id;
      splitReceipt = null;
      itemOrigins.clear();
      originsChanged = false;
      originStorageWarning = "";
      $(".split-receipt").hidden = true;
      $(".split-receipt").textContent = "";
      closePlan();
      job = annotations = null;
      cacheJob = cacheSetup = null;
      cacheGeneration++;
      cloudCache.configure(null);
      near.clear(); nearFloats = 0;
      previews.clear();
      counted.clear();
      panel.hidden = true;
      $(".job").textContent = id ? `Job ${id}` : "";
    }
    if (id && !host.isConnected) document.documentElement.appendChild(host);
    if (!id && host.isConnected) host.remove();
  }
  sync();
  setInterval(sync, 1000);


})();
