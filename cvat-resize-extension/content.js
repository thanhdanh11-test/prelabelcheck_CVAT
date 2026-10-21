// CVAT Track Resizer: gives every keyframe of one track the same size, can mark frames whose box
// holds too few points as outside, and lets the planned boxes be adjusted by hand on Top / Side /
// Front views of every frame before saving. CVAT interpolates between keyframes, so the box then
// has that size on every frame.
// Applies through the page bridge; CVAT owns Save and Undo/Redo.
(() => {
  "use strict";

  const JOB_PATH = /\/jobs\/(\d+)/;
  const CLOUD_CACHE = 24; // parsed frames kept in memory (~3.6 MB each for 300k points)

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
  const clouds = new Map(); // "job:frame" -> Promise<Float32Array>, least recently used first

  function loadCloud(frame) {
    const key = `${jobId}:${frame}`;
    let cloud = clouds.get(key);
    if (cloud) {
      clouds.delete(key);
    } else {
      const t0 = performance.now();
      cloud = fetch(`/api/jobs/${jobId}/data?type=frame&number=${frame}&quality=compressed`,
        { credentials: "same-origin" }).then(async (resp) => {
        if (!resp.ok) throw new Error(`Không tải được point cloud frame ${frame} (HTTP ${resp.status}).`);
        const buf = await resp.arrayBuffer(), t1 = performance.now(), xyz = parsePcd(buf);
        cloudStats.frames++;
        cloudStats.bytes += buf.byteLength;
        cloudStats.fetchMs += t1 - t0;
        cloudStats.parseMs += performance.now() - t1;
        return xyz;
      });
      cloud.catch(() => clouds.delete(key));
    }
    clouds.set(key, cloud);
    while (clouds.size > CLOUD_CACHE) clouds.delete(clouds.keys().next().value);
    return cloud;
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
    const key = `${jobId}:${trackId}:${frame}`;
    const old = near.get(key);
    if (old && cropCovers(old, center, reach)) {
      remember(key, old);
      return old.xyz;
    }
    const full = await loadCloud(frame);
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
  .side { width: 400px; flex: none; max-height: calc(100vh - 80px); overflow: hidden auto; padding: 0 16px 16px; }
  .panel.wide { left: 0 !important; top: 0 !important; width: 100vw; height: 100vh; border: 0; }
  .panel.wide .side { max-height: none; border-right: 1px solid var(--hairline); }
  .panel.wide h3 { cursor: default; }
  h3 { margin: 0 -16px 16px; padding: 12px 16px; border-bottom: 1px solid var(--hairline);
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
  .tools { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 8px; }
  .vals { margin-top: 8px; }
  .vals span { color: var(--body); }
  .vals { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
  .vals label { margin: 0; display: flex; align-items: center; gap: 6px; color: var(--muted); font-weight: 600; cursor: default; }
  .vals input { width: 100% !important; min-width: 0; }
  .btn.sm.ico { width: 30px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; letter-spacing: 0; }
  .ico svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .ico.on { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
  .ico.on:disabled { opacity: .7; }
  .sumtab { width: 100%; border-collapse: collapse; }
  .sumtab td { padding: 5px 0; border-bottom: 1px solid var(--hairline); color: var(--body); }
  .sumtab td + td { text-align: right; color: var(--ink); font-weight: 600; }
  .fitgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
  .fitgrid label { margin: 0; color: var(--muted); font-size: 11px; cursor: default; }
  .fitgrid input { width: 100%; margin-top: 4px; }
  .fit-kind { margin-top: 0; }
  .btn.fit { width: 100%; height: 44px; margin-top: 12px; }
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
  .warn { margin: 0 0 8px; padding: 8px 12px; background: var(--primary); color: var(--on-primary); }
  .warn b { color: var(--on-primary); font-weight: 700; }
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
  .zbody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
  .zbody .view { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .zbody .view:first-child { grid-row: 1 / 3; }
  .zbody .view:last-child { border-top: 1px solid var(--hairline); }
  .zbody canvas { display: block; touch-action: none; }
  .zbody .cap { left: 12px; bottom: 8px; font-size: 11px; }
  .nav { display: flex; gap: 4px; align-items: center; }
  .nav .pos { min-width: 72px; text-align: center; color: var(--body); font-size: 12px; }
</style>
<button class="fab"><img class="logo" alt="">Resize track</button>
<div class="panel" hidden>
 <div class="side">
  <h3><img class="logo" alt=""><span class="name">Track Resizer</span><span class="badge job"></span>
    <button class="btn help-btn" title="Hướng dẫn">?</button><button class="close" title="Đóng">✕</button></h3>

  <div class="warn">Bấm <b>Áp dụng</b> để xem box ngay trong CVAT. Sau đó bấm <b>Save</b> của CVAT để lưu server.</div>
  <div class="lbl">Track</div>
  <div class="row"><select class="track"></select></div>
  <div class="tools">
    <button class="btn pick">Lấy object đang chọn</button>
    <button class="btn refresh">Tải lại</button>
  </div>
  <div class="lbl">Kích thước</div>
  <div class="vals"></div>
  <div class="lbl">Tùy chọn</div>
  <label><input type="checkbox" class="bottom" checked>Giữ đáy cố định</label>
  <label><input type="checkbox" class="lock" checked>Khóa kích thước cả track</label>
  <label class="row"><span><input type="checkbox" class="auto" checked>Tự động outside ≤</span>
    <input type="number" class="thr" min="0" step="1" value="6" title="Số điểm tối đa trong box để coi là outside"></label>
  <div class="actions">
    <button class="btn preview">Xem trước</button>
    <button class="btn primary apply" disabled>Áp dụng</button>
  </div>
  <div class="status" role="status" aria-live="polite"></div>
  <div class="edit-sec" hidden>
    <div class="lbl">Chỉnh trong xem trước</div>
    <table class="sumtab"></table>
    <div class="lbl">Tự khớp</div>
    <select class="fit-kind">
      <option value="rigid">Xe, vật cứng (khớp theo hình dạng)</option>
      <option value="soft">Người, xe đạp (theo cụm điểm)</option>
    </select>
    <div class="fitgrid">
      <label>Frame đầu<input type="number" class="fit-a" min="0" step="1"></label>
      <label>Frame cuối<input type="number" class="fit-b" min="0" step="1"></label>
      <label>Frame mẫu<input type="number" class="fit-ref" min="0" step="1" placeholder="tự chọn"></label>
    </div>
    <button class="btn primary fit">Tự khớp</button>
  </div>
 </div>
 <div class="helpbox" hidden>
  <h5>Quy trình</h5>
  <ul><li>Chọn track, nhập L / W / H, bấm <b>Xem trước</b>.</li><li>Chỉnh box trên các mặt bên phải nếu cần, rồi bấm <b>Áp dụng</b>.</li>
    <li>Bấm <b>Áp dụng</b> cập nhật box trong CVAT; bấm <b>Save</b> của CVAT để lưu server.</li></ul>
  <h5>Chỉnh box</h5>
  <ul><li>Kéo <b>trong box</b> để di chuyển, kéo <b>cạnh</b> để đổi kích thước, kéo <b>chấm đỏ</b> ở Top để xoay.</li>
    <li>Sửa ở frame nào, frame đó thành keyframe; các frame giữa hai keyframe tự nội suy.</li>
    <li>Nút <b>con mắt</b>: ẩn / hiện frame. Nút <b>chìa khoá</b>: bật / tắt keyframe. Nền đỏ = đang bật.</li>
    <li>Class và attribute đổi ngay trên đầu mỗi frame (attribute đổi theo frame tạo keyframe).</li></ul>
  <h5>Tự khớp</h5>
  <ul><li>Đặt box <b>khít</b> ở frame mẫu (frame vật gần lidar nhất): kích thước và hình dạng lấy từ đó; để trống = keyframe nhiều điểm nhất.</li>
    <li>Khớp mọi frame từ frame đầu tới frame cuối; frame sửa tay được giữ nguyên.</li>
    <li><b>Xe, vật cứng</b>: xe đỗ, xe chạy, cột, rào. <b>Người, xe đạp</b>: chỉ khớp vị trí, hướng lấy theo keyframe.</li>
    <li>Frame khớp không chắc được đánh dấu: lọc bằng <b>Frame khớp kém</b> để xem lại.</li></ul>
  <h5>Phím tắt</h5>
  <ul><li><kbd>D</kbd> / <kbd>F</kbd>: frame trước / sau. <kbd>Esc</kbd>: thu nhỏ. <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd>: hoàn tác.</li></ul>
 </div>
 <div class="editor" hidden tabindex="-1">
  <div class="fbar">
    <span class="badge fcount"></span>
    <span class="sp"></span>
    <label><input type="checkbox" class="only-key">Keyframe</label>
    <label><input type="checkbox" class="only-hid">Frame ẩn</label>
    <label><input type="checkbox" class="only-bad">Frame khớp kém</label>
    <button class="btn sm clear" title="Xoá các keyframe ở giữa, giữ keyframe đầu và cuối">Xoá keyframe</button>
    <button class="btn sm full" title="Toàn màn hình (ẩn cả thanh trình duyệt)">⛶</button>
    <button class="btn sm eclose" title="Đóng xem trước">✕</button>
  </div>
  <div class="grid"></div>
  <div class="filter-empty" hidden role="status">Không có frame nào khớp bộ lọc đang chọn.<br><button class="btn reset-filters">Bỏ bộ lọc</button></div>
  <div class="zoom" hidden>
    <div class="chead zhead"></div>
    <div class="zbody">
      <div class="view"><canvas data-v="0" width="0" height="0"></canvas><div class="cap">Top · x–y</div></div>
      <div class="view"><canvas data-v="1" width="0" height="0"></canvas><div class="cap">Side · x–z</div></div>
      <div class="view"><canvas data-v="2" width="0" height="0"></canvas><div class="cap">Front · y–z</div></div>
    </div>
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
  }

  const selectedTrack = () => annotations && annotations.tracks.find((t) => t.uiId === Number($(".track").value));

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
    const sel = $(".track");
    sel.innerHTML = annotations.tracks.length
      ? annotations.tracks.map((t) => {
          const frames = t.shapes.map((s) => s.frame);
          return `<option value="${t.uiId}"${!t.shapes.length || !["cuboid", "rectangle"].includes(t.shapes[0].type) ? " disabled" : ""}>#${t.uiId} · ${t.id == null ? "chưa lưu" : `id ${t.id}`} · ${t.shapes[0]?.type || "rỗng"} · frame ${
            Math.min(...frames)}–${Math.max(...frames)} · ${t.shapes.length} keyframe</option>`;
        }).join("")
      : `<option value="">(job này không có track nào)</option>`;
    if (keep && annotations.tracks.some((t) => t.uiId === keep)) sel.value = String(keep);
    setStatus(`${annotations.tracks.length} track. Dữ liệu đang mở trong CVAT, gồm cả thay đổi chưa Save.`);
    renderInputs();
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
    $(".preview").title = "Bấm lần nữa để dừng xem trước";
    setStatus($(".auto").checked ? "Đang quét point cloud. Bấm nút tiến độ để dừng." : "Đang dựng xem trước…");
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
      if (cancelled && job && !plan) setStatus("Đã dừng xem trước. Có thể đổi cài đặt và xem trước lại.");
      logCloudStats("Xem trước");
    }
    plan.manual = new Set(); // frames edited by hand in the preview
    plan.flagged = new Set(); // frames the auto fit could not match well
    plan.track = { ...plan.track, attributes: (plan.track.attributes || []).slice() };
    plan.stale = false;
    const hiddenFrames = [...plan.counts].filter(([, n]) => n <= plan.threshold).map(([f]) => f);
    const hiddenText = !plan.counts.size ? "" : hiddenFrames.length
      ? `\nOutside (≤ ${plan.threshold} điểm): frame ${ranges(hiddenFrames).map(([a, b]) => a === b ? a : `${a}–${b}`).join(", ")}.`
      : `\nKhông frame nào có ≤ ${plan.threshold} điểm.`;
    $(".apply").disabled = false;
    const cuboid = plan.track.shapes[0].type === "cuboid";
    setStatus(`Track #${plan.track.uiId}: ${plan.shapes.length} keyframe sau khi đổi.${hiddenText}\n` +
      (cuboid ? "Chỉnh box trên các mặt bên phải nếu cần, rồi bấm \"Áp dụng\"." : "Bấm \"Áp dụng\" để hiện trong CVAT, rồi Save trong CVAT để lưu."));
    if (cuboid) openEditor();
  }

  async function apply() {
    endDrag();
    if (!plan || plan.stale || saving) return;
    if (fitting) return setStatus("Chờ tự khớp xong hoặc dừng trước khi áp dụng.", true);
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
      });
      applied = result.applied;
      if (applyingJob !== jobId || applyingPlan !== plan) return;
      closePlan();
      await loadData(result.clientID);
      setStatus(result.warning || "Đã áp dụng vào CVAT, chưa lưu server. Bấm Save trong CVAT để lưu; Undo/Redo dùng nút của CVAT.", !!result.warning);
    } catch (e) {
      if (applyingJob === jobId) {
        if (plan === applyingPlan) plan.stale = true;
        setStatus((applied ? "Đã áp dụng vào CVAT nhưng chưa tải lại danh sách tool. " : "") + e.message + (e.message.includes("Tải lại") ? "" : " Bấm Tải lại trong tool trước khi tiếp tục."), true);
      }
    } finally {
      saving = false;
    }
  }

  function pickActive() {
    const ui = activeUiId();
    if (ui === null) return setStatus("Chưa chọn object nào trên CVAT (bấm vào object ở sidebar).", true);
    const track = annotations && annotations.tracks.find((t) => t.uiId === ui);
    if (!track) {
      return setStatus(`Object #${ui} không có trong danh sách track hiện tại. Bấm Tải lại trong tool để đọc thay đổi mới nhất.`, true);
    }
    if (plan && plan.track.clientID === track.clientID) return setStatus(`Track #${ui} đang được xem trước.`);
    if (!confirmDrop()) return;
    closePlan();
    $(".track").value = String(track.uiId);
    renderInputs();
    setStatus(`Đã chọn track #${ui}${track.id == null ? " (chưa lưu)" : ` (id ${track.id})`}.`);
  }

  // ---------- preview editor: three views per frame ----------
  // After "Xem trước" the planned keyframes can be adjusted by hand on Top / Side / Front views of
  // every frame, drawn in the box's own axes (full XYZ rotation). Editing a frame makes it a
  // keyframe, so CVAT's interpolation carries the change to the frames around it. Only frames on
  // screen get canvases, clouds and redraws, so long tracks stay light.

  const VIEWS = [
    { cap: "Top · x–y", a: 0, b: 1, c: 2 },
    { cap: "Side · x–z", a: 0, b: 2, c: 1 },
    { cap: "Front · y–z", a: 1, b: 2, c: 0 },
  ];
  const CELL_PX = 300; // canvas bitmap of a grid view
  const editor = $(".editor"), grid = $(".grid"), zoom = $(".zoom"), zoomCanvases = [...root.querySelectorAll(".zbody canvas")];
  const cells = new Map(); // frame -> { cell, head, canvases }
  const visible = new Set(); // frames whose cell is on screen
  const loadState = new Map(); // frame -> "loading" | Error; absent = nothing pending
  const queue = [];
  let frames = [], undoStack = [], drag = null, zoomFrame = null, activeFrame = null, editGen = 0, loading = 0, drawPending = false;

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

  const stateAt = (f) => positionAt(plan.shapes, f);
  const keyAt = (f) => plan.shapes.find((s) => s.frame === f);
  const isFirstKey = (f) => plan.shapes[0].frame === f;
  const anchor = () => ($(".bottom").checked ? "bottom" : "center");
  const dirty = () => !!plan && (plan.manual.size > 0 || undoStack.length > 0);
  // Metres shown from a view's center to its edge.
  const viewRange = (p, v) => Math.max(p[6 + v.a], p[6 + v.b]) / 2 * 1.35 + 0.5;
  const viewReach = (p) => Math.max(...VIEWS.map((v) => viewRange(p, v))) * Math.SQRT2;
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
  function clearKeys() {
    if (fitting) return;
    endDrag();
    const first = plan.shapes[0], last = plan.shapes[plan.shapes.length - 1];
    const n = plan.shapes.length - (first === last ? 1 : 2);
    if (n <= 0) return setStatus("Không còn keyframe nào ở giữa để xoá.");
    if (!confirm(`Xoá ${n} keyframe ở giữa (giữ keyframe đầu ${first.frame} và cuối ${last.frame})?\nCó thể hoàn tác.`)) return;
    commit(snapshot());
    plan.shapes = first === last ? [first] : [first, last];
    plan.manual = new Set([...plan.manual].filter((f) => f === first.frame || f === last.frame));
    plan.flagged = new Set();
    modelChanged();
  }

  function modelChanged() {
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
      setStatus(`Đã tự khớp frame ${a}–${b}. ${flagged.size} frame cần kiểm tra lại. Có thể hoàn tác bằng Ctrl/⌘Z.`);
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
      nearCloud(plan.track.clientID ?? plan.track.id, f, p.slice(0, 3), viewReach(p), 1)
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
      for (const f of visible) drawCell(f);
      if (zoomFrame !== null) drawZoom();
      updateSummary();
    });
  }

  function headHtml(f, st, extra) {
    const k = !!keyAt(f), err = loadState.get(f) instanceof Error;
    return `<span class="f">${f}</span>${classHtml(f)}
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
    setHead(c.head, headHtml(f, st, `<button class="btn sm ico" data-act="zoom" data-f="${f}" title="Phóng to frame này">${ICON.zoom}</button>`));
    c.cell.classList.toggle("active", f === activeFrame);
    drawFrame(c.canvases, f, st);
  }

  function drawZoom() {
    const st = stateAt(zoomFrame), list = eligible();
    const prev = list.filter((x) => x < zoomFrame).pop(), next = list.find((x) => x > zoomFrame);
    setHead($(".zhead"), headHtml(zoomFrame, st,
      `<span class="nav"><button class="btn sm" data-act="go" data-f="${prev}" ${prev === undefined ? "disabled" : ""} title="Frame trước (D)">‹</button>
       <span class="pos">${frames.indexOf(zoomFrame) + 1} / ${frames.length}</span>
       <button class="btn sm" data-act="go" data-f="${next}" ${next === undefined ? "disabled" : ""} title="Frame sau (F)">›</button></span>
       <button class="btn sm" data-act="unzoom" title="Thu nhỏ (Esc)">✕</button>`));
    drawFrame(zoomCanvases, zoomFrame, st);
  }

  // While a frame is dragged its views keep the box from the drag start as reference, so the view
  // doesn't slide under the mouse; they re-center on release.
  function drawFrame(canvases, f, st) {
    const live = drag && drag.f === f, ref = live ? drag.ref : st.points;
    const crop = nearCached(plan.track.clientID ?? plan.track.id, f);
    if (!live && !(crop && cropCovers(crop, ref.slice(0, 3), viewReach(ref)))) ensureLoad(f);
    const err = loadState.get(f) instanceof Error ? loadState.get(f) : null;
    canvases.forEach((cv, i) => drawView(cv, crop && crop.xyz, st, ref, live ? drag.ranges[i] : viewRange(ref, VIEWS[i]), VIEWS[i], err));
  }

  function drawView(cv, xyz, st, ref, range, v, err) {
    const W = cv.width;
    if (!W) return;
    const ctx = cv.getContext("2d"), mid = W / 2, scale = mid / range, dot = dotOf(cv);
    const R = boxFrame(ref), S = boxFrame(st.points), same = ref === st.points, hs = S.half;
    // Build the pixels from scratch (no getImageData readback, which Chrome flags as slow).
    const img = ctx.createImageData(W, W), px = img.data;
    for (let o = 0; o < px.length; o += 4) { px[o] = px[o + 1] = px[o + 2] = 0x18; px[o + 3] = 255; }
    const plot = (q, shade, r) => {
      const X = Math.round(mid + q[v.a] * scale), Y = Math.round(mid - q[v.b] * scale);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = X + dx, y = Y + dy;
        if (x < 0 || y < 0 || x >= W || y >= W) continue;
        const o = (y * W + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = shade;
      }
    };
    const inside = [], rOut = Math.max(0, Math.round(dot - 0.6)), rIn = Math.max(1, Math.round(dot));
    if (xyz) {
      forPointsNear(xyz, R, range * Math.SQRT2 + R.reach, (x, y, z) => {
        const q = [x, y, z];
        if (Math.abs(q[v.a]) > range || Math.abs(q[v.b]) > range) return;
        const l = same ? q : toLocal(S, toWorld(R, q));
        if (Math.abs(l[0]) <= hs[0] && Math.abs(l[1]) <= hs[1] && Math.abs(l[2]) <= hs[2]) inside.push(q);
        else plot(q, Math.abs(l[v.c]) <= hs[v.c] ? 150 : 70, rOut); // brighter when level with the box
      });
    }
    for (const q of inside) plot(q, 255, rIn);
    ctx.putImageData(img, 0, 0);

    const P = (w) => { const q = toLocal(R, w); return [mid + q[v.a] * scale, mid - q[v.b] * scale]; };
    const corners = [];
    for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) corners.push(P(toWorld(S, [i * hs[0], j * hs[1], k * hs[2]])));
    ctx.strokeStyle = st.outside ? "#da291c" : "#d2d2d2";
    ctx.lineWidth = 2 * dot;
    ctx.setLineDash(st.outside ? [8 * dot, 6 * dot] : []);
    ctx.beginPath();
    for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
      ctx.moveTo(...corners[i]);
      ctx.lineTo(...corners[j]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (v.a === 0 && v.b === 1) { // heading (+x) and the rotate handle
      const [cx, cy] = P(S.center), [ex, ey] = P(toWorld(S, [hs[0], 0, 0])), [hx, hy] = P(toWorld(S, [hs[0] + 14 * dot / scale, 0, 0]));
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "#da291c";
      ctx.beginPath(); ctx.arc(hx, hy, 6 * dot, 0, 2 * Math.PI); ctx.fill();
    }
    if (!xyz) {
      ctx.fillStyle = "#969696";
      ctx.font = `${12 * dot}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(err ? "Không tải được point cloud" : "Đang tải…", mid, 20 * dot);
      ctx.textAlign = "start";
    }
  }

  function updateSummary() {
    const manual = plan.shapes.filter((s) => plan.manual.has(s.frame));
    const hidden = frames.filter((f) => stateAt(f).outside).length;
    const shown = eligible().length;
    $(".fcount").textContent = shown === frames.length ? `${frames.length} frame` : `${shown} / ${frames.length} frame`;
    $(".sumtab").innerHTML = [["Keyframe", plan.shapes.length], ["Sửa tay", manual.length], ["Frame ẩn", hidden],
      ["Frame khớp kém", plan.flagged.size]].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
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
    setActive(f);
    zoomFrame = f;
    zoom.hidden = false;
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
    $(".edit-sec").hidden = false;
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
    $(".edit-sec").hidden = true;
    panel.classList.remove("wide");
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

  function pointerLocal(cv, e, range) {
    const r = cv.getBoundingClientRect(), mid = cv.width / 2, scale = mid / range;
    return [((e.clientX - r.left) * cv.width / r.width - mid) / scale, (mid - (e.clientY - r.top) * cv.height / r.height) / scale];
  }
  function hitTest(cv, p, v, u, w, range) {
    const scale = cv.width / 2 / range, dot = dotOf(cv), tol = 7 * dot / scale;
    const ha = p[6 + v.a] / 2, hb = p[6 + v.b] / 2;
    if (v.a === 0 && v.b === 1 && Math.hypot(u - (ha + 14 * dot / scale), w) < 10 * dot / scale) return { mode: "rotate", cursor: "grab" };
    if (Math.abs(Math.abs(u) - ha) < tol && Math.abs(w) < hb + tol) return { mode: "size", axis: v.a, sign: Math.sign(u) || 1, cursor: "ew-resize" };
    if (Math.abs(Math.abs(w) - hb) < tol && Math.abs(u) < ha + tol) return { mode: "size", axis: v.b, sign: Math.sign(w) || 1, cursor: "ns-resize" };
    if (Math.abs(u) < ha && Math.abs(w) < hb) return { mode: "move", cursor: "move" };
    return null;
  }
  const canvasFrame = (cv) => (cv.closest(".zoom") ? zoomFrame : Number(cv.closest(".cell").dataset.f));

  editor.addEventListener("pointerdown", (e) => {
    const cv = e.target.closest("canvas");
    if (!cv || !plan || drag || fitting || e.button !== 0) return;
    editor.focus({ preventScroll: true });
    setActive(canvasFrame(cv));
    const f = canvasFrame(cv), v = VIEWS[cv.dataset.v], st = stateAt(f), range = viewRange(st.points, v);
    const [u, w] = pointerLocal(cv, e, range), hit = hitTest(cv, st.points, v, u, w, range);
    if (!hit) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    drag = { cv, f, vi: Number(cv.dataset.v), pointerId: e.pointerId, ref: st.points, u0: u, w0: w, ...hit,
             ranges: VIEWS.map((x) => viewRange(st.points, x)), snap: snapshot(), changed: false };
  });

  editor.addEventListener("pointermove", (e) => {
    const cv = e.target.closest("canvas");
    if (!drag) {
      if (!cv || !plan) return;
      const f = canvasFrame(cv), v = VIEWS[cv.dataset.v], st = stateAt(f), range = viewRange(st.points, v);
      const hit = hitTest(cv, st.points, v, ...pointerLocal(cv, e, range), range);
      cv.style.cursor = hit ? hit.cursor : "default";
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    const d = drag, v = VIEWS[d.vi], [u, w] = pointerLocal(d.cv, e, d.ranges[d.vi]);
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
    } else { // turn about the box's own z axis
      const t = Math.atan2(w, u) - Math.atan2(d.w0, d.u0), c = Math.cos(t), s = Math.sin(t);
      eulerXYZ(matMul(F.R, [[c, -s, 0], [s, c, 0], [0, 0, 1]])).forEach((x, i) => (p[3 + i] = x));
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
    editor.addEventListener(type, (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(); });
  }

  editor.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || !plan) return;
    if (fitting && b.dataset.act !== "zoom" && b.dataset.act !== "go" && b.dataset.act !== "unzoom") return setStatus("Đang tự khớp: chờ xong hoặc bấm Dừng.");
    const f = Number(b.dataset.f), act = b.dataset.act;
    if (act !== "unzoom") setActive(act === "go" ? f : zoomFrame ?? f);
    if (act === "out") toggleOutside(f);
    if (act === "key") toggleKey(f);
    if (act === "zoom") openZoom(f);
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
  $(".eclose").addEventListener("click", () => { if (confirmDrop()) closePlan(); });

  // Keys reach this only from inside the panel (the shadow root stops them from reaching CVAT).
  root.addEventListener("keydown", (e) => {
    if (!plan || editor.hidden || e.target.closest("input, select, textarea, [contenteditable]")) return;
    let handled = true;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") undo();
    else if (e.key === "Escape" && !$(".helpbox").hidden) $(".helpbox").hidden = true;
    else if (e.key === "Escape" && zoomFrame !== null) closeZoom();
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "d" || e.key === "D")) step(-1);
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "f" || e.key === "F")) step(1);
    else handled = false;
    if (handled) e.preventDefault();
  });


  // ---------- wiring ----------

  const guard = (fn) => async () => { try { await fn(); } catch (e) { setStatus(e.message, true); } };

  fab.addEventListener("click", guard(async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !plan) { // reopening keeps a preview in progress
      await loadData();
      if (activeUiId() !== null && annotations.tracks.some((t) => t.uiId === activeUiId())) pickActive();
    }
  }));
  $(".close").addEventListener("click", () => (panel.hidden = true));
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
    closePlan();
    await loadData(Number($(".track").value));
  }));
  $(".pick").addEventListener("click", guard(pickActive));
  $(".track").addEventListener("change", guard(() => {
    if (!confirmDrop()) return void ($(".track").value = String(plan.track.uiId));
    closePlan();
    renderInputs();
  }));
  $(".bottom").addEventListener("change", markStale);
  $(".auto").addEventListener("change", markStale);
  $(".thr").addEventListener("input", markStale);
  $(".preview").addEventListener("click", preview);
  $(".apply").addEventListener("click", apply);

  // CVAT is a single-page app: show the button only while a job page is open.
  function sync() {
    const m = location.pathname.match(JOB_PATH);
    const id = m ? Number(m[1]) : null;
    if (id !== jobId) {
      dataGeneration++;
      jobId = id;
      closePlan();
      job = annotations = null;
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
