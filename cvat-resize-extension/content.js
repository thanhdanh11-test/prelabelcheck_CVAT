// CVAT Track Resizer: gives every keyframe of one track the same size, can mark frames whose box
// holds too few points as outside, and lets the planned boxes be adjusted by hand on Top / Side /
// Front views of every frame before saving. CVAT interpolates between keyframes, so the box then
// has that size on every frame.
// Talks to the CVAT REST API with the page's own login.
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

  async function api(method, path, body) {
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
    const resp = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`${method} ${path} → HTTP ${resp.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  // Object numbers the CVAT sidebar shows after a page load: tags, then shapes, then tracks.
  function withUiIds(annotations) {
    let n = annotations.tags.length;
    annotations.shapes.forEach((s) => (s.uiId = ++n));
    annotations.tracks.forEach((t) => (t.uiId = ++n));
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
    const fields = header.FIELDS, sizes = header.SIZE.map(Number), types = header.TYPE;
    const counts = (header.COUNT || fields.map(() => "1")).map(Number);
    const n = Number(header.POINTS ? header.POINTS[0] : header.WIDTH[0] * header.HEIGHT[0]);
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
        if (v.length < fields.length) continue;
        for (let j = 0; j < 3; j++) xyz[k * 3 + j] = Number(v[cols[j]]);
        k++;
      }
    } else if (format === "binary") {
      const offsets = [];
      let row = 0;
      fields.forEach((_, i) => { offsets.push(row); row += sizes[i] * counts[i]; });
      const view = new DataView(buffer, pos);
      const read = idx.map((i) => {
        if (types[i] !== "F") throw new Error("Toạ độ trong PCD không phải số thực.");
        return sizes[i] === 8 ? (o) => view.getFloat64(o, true) : (o) => view.getFloat32(o, true);
      });
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < 3; j++) xyz[k * 3 + j] = read[j](k * row + offsets[idx[j]]);
      }
    } else {
      throw new Error(`Chưa hỗ trợ PCD dạng "${format}".`);
    }
    return xyz;
  }

  const clouds = new Map(); // "job:frame" -> Promise<Float32Array>, least recently used first

  function loadCloud(frame) {
    const key = `${jobId}:${frame}`;
    let cloud = clouds.get(key);
    if (cloud) {
      clouds.delete(key);
    } else {
      cloud = fetch(`/api/jobs/${jobId}/data?type=frame&number=${frame}&quality=compressed`,
        { credentials: "same-origin" }).then(async (resp) => {
        if (!resp.ok) throw new Error(`Không tải được point cloud frame ${frame} (HTTP ${resp.status}).`);
        return parsePcd(await resp.arrayBuffer());
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
  async function nearCloud(trackId, frame, center, reach, margin = reach * 0.5 + 1) {
    const key = `${jobId}:${trackId}:${frame}`;
    const old = near.get(key);
    if (old && cropCovers(old, center, reach)) {
      near.delete(key);
      near.set(key, old);
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
    if (near.has(key)) nearFloats -= near.get(key).xyz.length;
    near.delete(key);
    near.set(key, crop);
    nearFloats += crop.xyz.length;
    while (nearFloats > NEAR_BUDGET && near.size > 1) {
      const [k, c] = near.entries().next().value;
      near.delete(k);
      nearFloats -= c.xyz.length;
    }
    return crop.xyz;
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
  .panel.wide .side { max-height: none; border-right: 1px solid var(--hairline); }
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
  .modes { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--control-border); }
  .modes label { margin: 0; padding: 8px 4px; text-align: center; color: var(--body);
                 font-size: 11px; font-weight: 600; letter-spacing: .65px; text-transform: uppercase; }
  .modes label + label { border-left: 1px solid var(--control-border); }
  .modes input { position: absolute; opacity: 0; pointer-events: none; }
  .modes label:has(input:checked) { background: var(--elevated); color: var(--ink); box-shadow: inset 0 -2px var(--primary); }
  .modes label:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
  .btn { height: 36px; padding: 0 16px; border: 1px solid var(--ink); border-radius: 0; background: transparent;
         color: var(--ink); cursor: pointer;
         font-size: 12px; font-weight: 700; line-height: 1; letter-spacing: 1.4px; text-transform: uppercase; }
  .btn:active { background: var(--elevated); }
  .btn.primary { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
  .btn.primary:active { border-color: var(--primary-active); background: var(--primary-active); }
  .btn:disabled { opacity: .35; cursor: default; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 24px; }
  .actions .btn { height: 44px; }
  .warn { margin: 0 0 8px; padding: 8px 12px; border: 1px solid var(--hairline); border-left: 2px solid var(--warning); color: var(--body); }
  .warn b { color: var(--ink); font-weight: 600; }
  .status { margin-top: 16px; color: var(--body); white-space: pre-wrap; }
  .status:empty { display: none; }
  .status.err { color: var(--warning); }
  .muted { color: var(--muted); }
  .btn.sm { height: 26px; padding: 0 8px; font-size: 10px; letter-spacing: 1.1px; border-color: var(--control-border); }
  .summary b { color: var(--ink); font-weight: 600; }
  .edits { margin: 8px 0 0; padding: 0; list-style: none; }
  .edits li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--hairline); color: var(--ink); cursor: pointer; }
  .edits li span { color: var(--body); font-size: 12px; }
  .edits li button { margin-left: auto; }
  .edits li.empty { color: var(--muted); font-size: 12px; border: 0; cursor: default; }
  .help { margin: 8px 0 0; padding-left: 16px; font-size: 12px; }
  .help b { color: var(--ink); font-weight: 600; }
  kbd { padding: 0 4px; border: 1px solid var(--control-border); border-radius: 2px; color: var(--ink); font-size: 11px; }

  .editor { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; outline: none; }
  .editor[hidden] { display: none; }
  .fbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-height: 53px; padding: 8px 16px; border-bottom: 1px solid var(--hairline); }
  .fbar .title { color: var(--ink); font-size: 16px; font-weight: 500; }
  .fbar .sp { flex: 1; }
  .fbar label { margin: 0; white-space: nowrap; }
  .legend { display: flex; gap: 12px; color: var(--muted); font-size: 12px; white-space: nowrap; }
  .legend i { display: inline-block; width: 8px; height: 8px; margin-right: 6px; }
  .grid { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-content: start; }
  .grid.one { grid-template-columns: 1fr; }
  .cell { position: relative; border: 1px solid var(--hairline); }
  .cell.is-key::before, .zoom.is-key::before { content: ""; position: absolute; top: 0; left: 0; z-index: 1; width: 9px; height: 9px;
                                                background: var(--primary); pointer-events: none; }
  .pick-l { display: inline-flex; align-items: center; gap: 4px; margin: 0; color: var(--muted); font-size: 10px; font-weight: 600;
            letter-spacing: .65px; text-transform: uppercase; white-space: nowrap; cursor: default; }
  .chead select, .chead input { height: 24px; padding: 0 4px; border-radius: 2px; font-size: 11px; max-width: 150px; text-transform: none; letter-spacing: 0; }
  .chead select { width: auto; }
  .chead input[type=number] { width: 64px; }
  .chead input[type=text] { width: 96px; }
  .chead .cls { color: var(--ink); font-weight: 600; }
  .cell[hidden] { display: none; }
  .cell.is-key { border-color: var(--control-border); }
  .cell.is-manual { border-color: var(--ink); }
  .cell.flash { outline: 2px solid var(--focus); }
  .cell.hidden-frame canvas { opacity: .55; }
  .chead { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 4px 6px 4px 10px; border-bottom: 1px solid var(--hairline); flex-wrap: wrap; }
  .chead .f { color: var(--ink); font-weight: 600; letter-spacing: .65px; white-space: nowrap; }
  .chead .n { color: var(--body); font-size: 12px; white-space: nowrap; }
  .tag { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; white-space: nowrap; }
  .tag.hid { color: var(--ink); }
  .chead .acts { margin-left: auto; display: flex; gap: 4px; align-items: center; }
  .btn.sm[data-act=zoom] { width: 30px; padding: 0; font-size: 15px; letter-spacing: 0; }
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
    <button class="close" title="Đóng">✕</button></h3>

  <div class="warn">Bấm <b>Save</b> trong CVAT trước khi áp dụng. Trang sẽ tự tải lại sau khi lưu.</div>
  <div class="lbl">Track</div>
  <div class="row"><select class="track"></select></div>
  <div class="tools">
    <button class="btn pick">Lấy object đang chọn</button>
    <button class="btn refresh">Tải lại</button>
  </div>
  <div class="lbl">Kích thước</div>
  <div class="modes">
    <label><input type="radio" name="mode" value="none"> Giữ nguyên</label>
    <label><input type="radio" name="mode" value="size" checked> Nhập số</label>
    <label><input type="radio" name="mode" value="scale"> Tỉ lệ</label>
    <label><input type="radio" name="mode" value="frame"> Từ frame</label>
  </div>
  <div class="row vals"></div>
  <div class="lbl">Tùy chọn</div>
  <label><input type="checkbox" class="bottom" checked>Giữ đáy box cố định (không giữ thì giữ tâm)</label>
  <label class="row"><span><input type="checkbox" class="auto" checked>Tự động outside khi box có ≤</span>
    <input type="number" class="thr" min="0" step="1" value="6"> điểm</label>
  <div class="actions">
    <button class="btn preview">Xem trước</button>
    <button class="btn primary apply" disabled>Áp dụng</button>
  </div>
  <div class="status"></div>
  <div class="edit-sec" hidden>
    <div class="lbl">Chỉnh trong xem trước</div>
    <div class="summary"></div>
    <label><input type="checkbox" class="lock" checked>Khóa kích thước cho cả track</label>
    <ul class="edits"></ul>
    <ul class="help">
      <li>Kéo <b>trong box</b> để di chuyển, kéo <b>cạnh</b> để đổi kích thước, kéo <b>chấm đỏ</b> ở Top để xoay.</li>
      <li>Sửa ở frame nào, frame đó thành keyframe; các frame giữa hai keyframe tự nội suy.</li>
      <li><b>⤢</b> phóng to một frame; <kbd>←</kbd> <kbd>→</kbd> đổi frame, <kbd>Esc</kbd> thu nhỏ. <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> hoàn tác.</li>
    </ul>
  </div>
 </div>
 <div class="editor" hidden tabindex="-1">
  <div class="fbar">
    <span class="title">Xem trước</span><span class="badge fcount"></span>
    <span class="legend"><span><i style="background:#fff"></i>Trong box</span><span><i style="background:#969696"></i>Ngang box</span>
      <span><i style="background:#464646"></i>Khác</span><span><i style="background:var(--primary)"></i>Keyframe</span>
      <span><i style="width:12px;height:0;border-top:2px dashed var(--primary);vertical-align:3px"></i>Sẽ ẩn</span></span>
    <span class="sp"></span>
    <button class="btn sm undo" disabled>Hoàn tác</button>
    <label><input type="checkbox" class="only-key">Chỉ keyframe</label>
    <label><input type="checkbox" class="only-hid">Chỉ frame sẽ ẩn</label>
    <button class="btn sm eclose" title="Đóng xem trước">✕</button>
  </div>
  <div class="grid"></div>
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
  let jobId = null, job = null, annotations = null, labels = [], plan = null, planning = 0;

  function setStatus(text, isError) {
    $(".status").textContent = text;
    $(".status").className = "status" + (isError ? " err" : "");
  }

  const mode = () => root.querySelector("input[name=mode]:checked").value;
  const selectedTrack = () => annotations && annotations.tracks.find((t) => t.id === Number($(".track").value));

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
    plan = null;
    planning++;
    $(".apply").disabled = true;
    closeEditor();
  }

  const confirmDrop = () => !dirty() || confirm("Bỏ các chỉnh tay trong xem trước?");

  function renderInputs() {
    const track = selectedTrack();
    const dims = track && track.shapes[0].type === "rectangle" ? ["W", "H"] : ["Dài (x)", "Rộng (y)", "Cao (z)"];
    const box = $(".vals");
    if (mode() === "none") {
      box.innerHTML = "";
    } else if (mode() === "frame") {
      box.innerHTML = `<span>Frame</span><input type="number" class="v" step="1" min="0" value="${currentFrame() ?? 0}">
        <span class="muted">(mặc định = frame đang xem)</span>`;
    } else {
      let start = dims.map(() => 1);
      if (mode() === "size" && track) {
        try { start = sizeAt(track, currentFrame() ?? 0); } catch { start = sizeOf(byFrame(track.shapes)[0]); }
      }
      box.innerHTML = dims.map((d, i) =>
        `<span title="${d}">${d.split(" ")[0]}</span><input type="number" class="v" step="0.01" value="${+start[i].toFixed(3)}">`).join("");
    }
    box.querySelectorAll("input").forEach((i) => i.addEventListener("input", markStale));
    markStale();
  }

  async function loadData(keep) {
    setStatus("Đang tải annotation…");
    [job, annotations] = await Promise.all([api("GET", `/api/jobs/${jobId}`), api("GET", `/api/jobs/${jobId}/annotations`)]);
    // Classes and their attributes for the pickers; without them the preview just shows the label id.
    labels = await api("GET", `/api/labels?job_id=${jobId}&page_size=500`).then((r) => r.results || r, () => []);
    withUiIds(annotations);
    const sel = $(".track");
    sel.innerHTML = annotations.tracks.length
      ? annotations.tracks.map((t) => {
          const frames = t.shapes.map((s) => s.frame);
          return `<option value="${t.id}">#${t.uiId} · id ${t.id} · ${t.shapes[0].type} · frame ${
            Math.min(...frames)}–${Math.max(...frames)} · ${t.shapes.length} keyframe</option>`;
        }).join("")
      : `<option value="">(job này không có track nào)</option>`;
    if (keep && annotations.tracks.some((t) => t.id === keep)) sel.value = String(keep);
    setStatus(`${annotations.tracks.length} track. Số # là số hiện trên sidebar CVAT.`);
    renderInputs();
  }

  // New keyframes for the track: resized, and (optionally) outside wherever the box holds too few points.
  async function buildPlan(token) {
    const track = selectedTrack();
    if (!track) throw new Error("Chưa chọn track.");
    const kind = track.shapes[0].type;
    const dims = kind === "cuboid" ? 3 : 2;
    const inputs = [...root.querySelectorAll(".vals input")];
    if (inputs.some((i) => i.value.trim() === "" || !Number.isFinite(Number(i.value)))) throw new Error("Nhập đủ các số.");
    const vals = inputs.map((i) => Number(i.value));
    let fixed = null, factors = null;
    if (mode() === "size") fixed = vals;
    else if (mode() === "frame") fixed = sizeAt(track, vals[0]);
    else if (mode() === "scale") factors = vals;
    if (fixed && Math.min(...fixed) <= 0) throw new Error(`Kích thước phải dương, đang là ${fmt(fixed)}.`);
    if (factors && Math.min(...factors) <= 0) throw new Error("Tỉ lệ phải dương.");
    const anchor = $(".bottom").checked ? "bottom" : "center";

    const original = byFrame(track.shapes);
    const keys = original.map((s) => {
      const old = sizeOf(s);
      const size = fixed ? fixed.slice() : factors ? old.map((x, i) => x * factors[i]) : old;
      return { ...s, points: fixed || factors ? resizedPoints(s, size, anchor) : s.points.slice() };
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
      const next = () => frames.shift();
      const worker = async () => {
        for (let f = next(); f !== undefined; f = next()) {
          const box = positionAt(keys, f).points, key = `${jobId}:${track.id}:${f}:${box.join(",")}`;
          let n = counted.get(key);
          if (n === undefined) {
            const b = boxFrame(box), xyz = await nearCloud(track.id, f, b.center, b.reach);
            if (token !== planning) throw new Error("cancelled");
            n = countInside(xyz, box);
            counted.set(key, n);
          }
          counts.set(f, n);
          setStatus(`Đang đếm điểm trong box… ${++done} frame`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const sorted = [...counts].sort((a, b) => a[0] - b[0]); // workers finish out of order
      counts.clear();
      sorted.forEach(([f, n]) => counts.set(f, n));
    }

    // Keyframes are rebuilt from the per-frame state. A run of hidden frames is opened by an outside
    // keyframe and closed by a visible one, and the frame before the run keeps a visible keyframe,
    // so every other frame keeps exactly the position it had.
    const result = new Map(keys.map((s) => [s.frame, { ...s }]));
    const setKey = (f, outside) => {
      const s = result.get(f) || { ...keys[0], id: undefined, frame: f, points: positionAt(keys, f).points };
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
    return { track, shapes, original, counts, threshold };
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
    if (!confirmDrop()) return;
    closePlan();
    const token = planning;
    $(".preview").disabled = true;
    try {
      const result = await buildPlan(token);
      if (token !== planning) return;
      plan = result;
    } catch (e) {
      if (token === planning) setStatus(e.message, true);
      return;
    } finally {
      $(".preview").disabled = false;
    }
    plan.manual = new Set(); // frames edited by hand in the preview
    plan.track = { ...plan.track, attributes: (plan.track.attributes || []).slice() };
    plan.stale = false;
    const hiddenFrames = [...plan.counts].filter(([, n]) => n <= plan.threshold).map(([f]) => f);
    const hiddenText = !plan.counts.size ? "" : hiddenFrames.length
      ? `\nOutside (≤ ${plan.threshold} điểm): frame ${ranges(hiddenFrames).map(([a, b]) => a === b ? a : `${a}–${b}`).join(", ")}.`
      : `\nKhông frame nào có ≤ ${plan.threshold} điểm.`;
    $(".apply").disabled = false;
    const cuboid = plan.track.shapes[0].type === "cuboid";
    setStatus(`Track #${plan.track.uiId}: ${plan.shapes.length} keyframe sau khi đổi.${hiddenText}\n` +
      (cuboid ? "Chỉnh box trên các mặt bên phải nếu cần, rồi bấm \"Áp dụng\"." : "Bấm \"Áp dụng\" để lưu."));
    if (cuboid) openEditor();
  }

  async function apply() {
    endDrag();
    if (!plan || plan.stale) return;
    if (!confirm(`Lưu ${plan.shapes.length} keyframe cho track #${plan.track.uiId} và tải lại trang?\n` +
                 `Thay đổi chưa Save trong CVAT sẽ bị mất.`)) return;
    $(".apply").disabled = true;
    setStatus("Đang lưu…");
    try {
      const { uiId, ...track } = { ...plan.track, shapes: plan.shapes };
      await api("PATCH", `/api/jobs/${jobId}/annotations?action=update`,
        { version: annotations.version, tags: [], shapes: [], tracks: [track] });
      const saved = (await api("GET", `/api/jobs/${jobId}/annotations`)).tracks.find((t) => t.id === track.id);
      const want = new Map(plan.shapes.map((s) => [s.frame, s]));
      const bad = (saved ? saved.shapes : []).filter((s) => !want.has(s.frame) || s.outside !== want.get(s.frame).outside ||
        s.points.some((v, i) => Math.abs(v - want.get(s.frame).points[i]) > 1e-6)).map((s) => s.frame);
      if (!saved || bad.length || saved.shapes.length !== want.size) {
        throw new Error(`Đã gửi nhưng dữ liệu trên server khác ở frame ${bad.join(", ") || "?"}. Kiểm tra lại job.`);
      }
      sessionStorage.setItem("cvat-track-resizer-done", `Đã lưu ${want.size} keyframe cho track #${plan.track.uiId}.`);
      setStatus("Đã lưu. Đang tải lại trang…");
      location.reload();
    } catch (e) {
      setStatus(e.message, true);
      $(".apply").disabled = false;
    }
  }

  function pickActive() {
    const ui = activeUiId();
    if (ui === null) return setStatus("Chưa chọn object nào trên CVAT (bấm vào object ở sidebar).", true);
    const track = annotations && annotations.tracks.find((t) => t.uiId === ui);
    if (!track) {
      return setStatus(`Object #${ui} không phải track, hoặc vừa tạo mà chưa tải lại trang (Save rồi F5).`, true);
    }
    if (plan && plan.track.id === track.id) return setStatus(`Track #${ui} đang được xem trước.`);
    if (!confirmDrop()) return;
    closePlan();
    $(".track").value = String(track.id);
    renderInputs();
    setStatus(`Đã chọn track #${ui} (id ${track.id}).`);
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
  let frames = [], undoStack = [], drag = null, zoomFrame = null, editGen = 0, loading = 0, drawPending = false;

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
    const key = { ...left, frame: f, points: pos.points, outside: pos.outside };
    plan.shapes.push(key);
    plan.shapes.sort((a, b) => a.frame - b.frame);
    return key;
  }

  const snapshot = () => ({ shapes: plan.shapes.map((s) => ({ ...s, points: s.points.slice() })), manual: [...plan.manual],
                            label_id: plan.track.label_id, attributes: plan.track.attributes });
  function commit(snap) {
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
  }
  function undo() {
    endDrag();
    const snap = undoStack.pop();
    if (!snap) return;
    plan.shapes = snap.shapes;
    plan.manual = new Set(snap.manual);
    plan.track.label_id = snap.label_id;
    plan.track.attributes = snap.attributes;
    modelChanged();
  }

  // Locked size: a size edit on one frame resizes every keyframe, so the whole track keeps one size.
  function setGeometry(f, points, size) {
    ensureKey(f).points = points;
    plan.manual.add(f);
    if (size && $(".lock").checked) {
      for (const s of plan.shapes) if (s.frame !== f) s.points = resizedPoints(s, size, anchor());
      if (mode() === "size") root.querySelectorAll(".vals input").forEach((i, k) => (i.value = +size[k].toFixed(3)));
    }
  }

  // Hides or shows only this frame: CVAT keeps a state until the next keyframe, so the next frame is
  // pinned to what it was first.
  function toggleOutside(f) {
    endDrag();
    const snap = snapshot(), cur = stateAt(f);
    if (f < frames[frames.length - 1]) ensureKey(f + 1);
    ensureKey(f).outside = !cur.outside;
    plan.manual.add(f);
    commit(snap);
    modelChanged();
  }

  function dropKey(f) {
    if (isFirstKey(f) || !keyAt(f)) return; // the first keyframe starts the track
    endDrag();
    commit(snapshot());
    plan.shapes = plan.shapes.filter((s) => s.frame !== f);
    plan.manual.delete(f);
    modelChanged();
  }

  // ---- class and attributes ----
  // The class and immutable attributes belong to the track; a mutable attribute is set by
  // keyframes and keeps its value until a later keyframe sets it again, like in CVAT.

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
    if (!label) return `<span class="pick-l">Class <span class="cls">#${plan.track.label_id}</span></span>`;
    const choices = labels.filter((l) => !l.type || l.type === "any" || l.type === "cuboid" || l.id === label.id);
    const vals = attrValues(f);
    return `<label class="pick-l">Class <select data-f="${f}" data-label>${choices.map((l) =>
        `<option value="${l.id}"${l.id === label.id ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>` +
      (label.attributes || []).map((a) => `<label class="pick-l" title="${a.mutable ? "Đổi theo frame (tạo keyframe)" : "Chung cho cả track"}">${
        esc(a.name)} ${attrControl(f, a, vals.get(a.id))}</label>`).join("");
  }

  function modelChanged() {
    applyFilters();
    scheduleDraw();
  }

  // ---- clouds for the views ----

  function ensureLoad(f) {
    if (loadState.has(f)) return;
    loadState.set(f, "loading");
    queue.push(f);
    pump();
  }
  function pump() {
    while (loading < 3 && queue.length) {
      queue.sort((a, b) => (b === zoomFrame) - (a === zoomFrame)); // the zoomed frame first
      const f = queue.shift();
      if (!visible.has(f) && f !== zoomFrame) { loadState.delete(f); continue; } // scrolled away
      const gen = editGen, p = stateAt(f).points;
      loading++;
      nearCloud(plan.track.id, f, p.slice(0, 3), viewReach(p), 1)
        .then(() => loadState.delete(f), (e) => loadState.set(f, e))
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
    const k = keyAt(f), err = loadState.get(f) instanceof Error;
    return `<span class="f">FRAME ${f}</span>${classHtml(f)}
      ${err ? '<span class="tag hid">Lỗi tải</span>' : ""}${st.outside ? '<span class="tag hid">Sẽ ẩn</span>' : ""}
      <span class="acts"><button class="btn sm" data-act="out" data-f="${f}">${st.outside ? "Hiện" : "Ẩn"}</button>
      ${k && !isFirstKey(f) ? `<button class="btn sm" data-act="drop" data-f="${f}" title="Bỏ keyframe này">Bỏ key</button>` : ""}
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
    c.cell.classList.toggle("is-key", !!keyAt(f));
    c.cell.classList.toggle("is-manual", plan.manual.has(f));
    c.cell.classList.toggle("hidden-frame", st.outside);
    setHead(c.head, headHtml(f, st, `<button class="btn sm" data-act="zoom" data-f="${f}" title="Phóng to frame này">⤢</button>`));
    drawFrame(c.canvases, f, st);
  }

  function drawZoom() {
    const st = stateAt(zoomFrame), list = eligible();
    const prev = list.filter((x) => x < zoomFrame).pop(), next = list.find((x) => x > zoomFrame);
    zoom.classList.toggle("is-key", !!keyAt(zoomFrame));
    setHead($(".zhead"), headHtml(zoomFrame, st,
      `<span class="nav"><button class="btn sm" data-act="go" data-f="${prev}" ${prev === undefined ? "disabled" : ""} title="Frame trước (←)">‹</button>
       <span class="pos">${frames.indexOf(zoomFrame) + 1} / ${frames.length}</span>
       <button class="btn sm" data-act="go" data-f="${next}" ${next === undefined ? "disabled" : ""} title="Frame sau (→)">›</button></span>
       <button class="btn sm" data-act="unzoom" title="Thu nhỏ (Esc)">✕</button>`));
    drawFrame(zoomCanvases, zoomFrame, st);
  }

  // While a frame is dragged its views keep the box from the drag start as reference, so the view
  // doesn't slide under the mouse; they re-center on release.
  function drawFrame(canvases, f, st) {
    const live = drag && drag.f === f, ref = live ? drag.ref : st.points;
    const crop = nearCached(plan.track.id, f);
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
    $(".fcount").textContent = `${frames.length} frame`;
    $(".undo").disabled = !undoStack.length;
    $(".summary").innerHTML = `<b>${plan.shapes.length}</b> keyframe · <b>${manual.length}</b> sửa tay · <b>${hidden}</b> frame sẽ ẩn`;
    $(".edits").innerHTML = manual.length ? manual.map((s) =>
      `<li data-f="${s.frame}">Frame ${s.frame}<span>${fmt(s.points.slice(6, 9).map((x) => +x))}${s.outside ? " · ẩn" : ""}</span>
       ${isFirstKey(s.frame) ? "" : `<button class="btn sm" data-act="drop" data-f="${s.frame}">Bỏ key</button>`}</li>`).join("")
      : '<li class="empty">Chưa sửa tay frame nào.</li>';
  }

  // ---- filters, zoom and navigation ----

  function applyFilters() {
    const onlyKey = $(".only-key").checked, onlyHid = $(".only-hid").checked;
    for (const [f, c] of cells) c.cell.hidden = (onlyKey && !keyAt(f)) || (onlyHid && !stateAt(f).outside);
  }
  const eligible = () => frames.filter((f) => !cells.get(f).cell.hidden);

  function reveal(f, flash = true) {
    if (zoomFrame !== null) return openZoom(f);
    const c = cells.get(f);
    if (!c) return;
    if (c.cell.hidden) {
      $(".only-key").checked = $(".only-hid").checked = false;
      applyFilters();
    }
    c.cell.scrollIntoView({ block: flash ? "center" : "nearest" });
    if (flash) {
      c.cell.classList.add("flash");
      setTimeout(() => c.cell.classList.remove("flash"), 900);
    }
  }

  function openZoom(f) {
    endDrag();
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
    panel.classList.add("wide");
    fitPanel();
    applyFilters();
    scheduleDraw();
  }

  function closeEditor() {
    endDrag();
    observer.disconnect();
    grid.innerHTML = "";
    cells.clear();
    visible.clear();
    loadState.clear();
    queue.length = 0;
    undoStack = [];
    zoomFrame = null;
    zoom.hidden = true;
    editor.hidden = true;
    $(".edit-sec").hidden = true;
    panel.classList.remove("wide");
    editGen++;
    fitPanel();
  }

  // The wide panel (tool + frames) fills the window below and right of its corner.
  function fitPanel() {
    if (!panel.classList.contains("wide")) {
      panel.style.width = panel.style.height = "";
      return;
    }
    const w = Math.min(1480, innerWidth - 32);
    const left = Math.max(16, Math.min(parseFloat(panel.style.left) || 70, innerWidth - w - 16));
    const top = Math.max(16, Math.min(parseFloat(panel.style.top) || 100, innerHeight - 480));
    Object.assign(panel.style, { left: left + "px", top: top + "px", width: w + "px", height: Math.max(400, innerHeight - top - 16) + "px" });
    grid.classList.toggle("one", grid.clientWidth < 760);
  }
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
    if (!cv || !plan || drag || e.button !== 0) return;
    editor.focus({ preventScroll: true });
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
    const f = Number(b.dataset.f), act = b.dataset.act;
    if (act === "out") toggleOutside(f);
    if (act === "drop") dropKey(f);
    if (act === "zoom") openZoom(f);
    if (act === "go") openZoom(f);
    if (act === "unzoom") closeZoom();
  });
  editor.addEventListener("change", (e) => {
    const el = e.target;
    if (!plan || !el.matches("[data-f]")) return;
    if (el.matches("[data-label]")) setLabel(Number(el.value));
    else if (el.dataset.spec) setAttribute(Number(el.dataset.f), Number(el.dataset.spec), el.value);
  });
  $(".edits").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act=drop]");
    if (b) return dropKey(Number(b.dataset.f));
    const li = e.target.closest("li[data-f]");
    if (li) reveal(Number(li.dataset.f));
  });
  $(".undo").addEventListener("click", undo);
  $(".only-key").addEventListener("change", modelChanged);
  $(".only-hid").addEventListener("change", modelChanged);
  $(".eclose").addEventListener("click", () => { if (confirmDrop()) closePlan(); });

  // Keys reach this only from inside the panel (the shadow root stops them from reaching CVAT).
  root.addEventListener("keydown", (e) => {
    if (!plan || editor.hidden || e.target.closest("input, select, textarea, [contenteditable]")) return;
    let handled = true;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") undo();
    else if (e.key === "Escape" && zoomFrame !== null) closeZoom();
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && zoomFrame !== null) {
      const list = eligible(), next = e.key === "ArrowLeft" ? list.filter((x) => x < zoomFrame).pop() : list.find((x) => x > zoomFrame);
      if (next !== undefined) openZoom(next);
    } else handled = false;
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
    if (e.target.closest("button")) return;
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
    if (!confirmDrop()) return void ($(".track").value = String(plan.track.id));
    closePlan();
    renderInputs();
  }));
  root.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", guard(renderInputs)));
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

  const done = sessionStorage.getItem("cvat-track-resizer-done");
  if (done && jobId) {
    sessionStorage.removeItem("cvat-track-resizer-done");
    panel.hidden = false;
    guard(() => loadData())().then(() => setStatus(done));
  }
})();
