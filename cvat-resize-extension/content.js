// CVAT Track Resizer: gives every keyframe of one track the same size, can mark frames whose box
// holds too few points as outside, and draws a top view of the selected box's point cloud.
// CVAT interpolates between keyframes, so the box then has that size on every frame.
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
  :host { all: initial; }
  * { box-sizing: border-box; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; padding: 8px 14px;
         border: 0; border-radius: 20px; background: #1677ff; color: #fff; cursor: pointer;
         box-shadow: 0 2px 8px rgba(0,0,0,.3); display: flex; align-items: center; gap: 6px; }
  .fab img { width: 18px; height: 18px; border-radius: 3px; background: #fff; }
  .panel { position: fixed; left: 70px; top: 100px; z-index: 2147483647; width: 390px;
           max-height: calc(100vh - 80px); overflow: hidden auto; padding: 12px; border-radius: 8px;
           background: #fff; color: #222; box-shadow: 0 4px 20px rgba(0,0,0,.35); }
  .panel[hidden] { display: none; }
  h3 { margin: 0 0 8px; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; cursor: move; user-select: none; }
  h3 button { border: 0; background: none; cursor: pointer; font-size: 16px; }
  h4 { margin: 12px 0 4px; font-weight: 600; border-top: 1px solid #eee; padding-top: 8px; }
  label { display: block; margin: 6px 0 2px; color: #555; }
  select, input { padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; background: #fff; color: #222; }
  select { width: 100%; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .row input[type=number] { width: 72px; }
  .modes label { display: inline-flex; gap: 4px; margin-right: 8px; color: #222; }
  .btn { padding: 5px 10px; border: 1px solid #ccc; border-radius: 4px; background: #f5f5f5; cursor: pointer; }
  .btn.primary { background: #1677ff; border-color: #1677ff; color: #fff; }
  .btn:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 6px; margin-top: 10px; }
  .warn { margin: 6px 0; padding: 6px; border-radius: 4px; background: #fff7e6; color: #874d00; }
  .status { margin-top: 8px; white-space: pre-wrap; }
  .status.err { color: #cf1322; }
  table { width: 100%; margin-top: 8px; border-collapse: collapse; table-layout: fixed; }
  td, th { padding: 2px 4px; border-bottom: 1px solid #eee; text-align: left; font-size: 12px; }
  .muted { color: #999; }
  canvas { display: block; width: 366px; height: 366px; margin-top: 4px; border-radius: 4px; background: #111; }
  .viewinfo { font-size: 12px; color: #555; min-height: 18px; }
</style>
<button class="fab">Resize track</button>
<div class="panel" hidden>
  <h3><span>Resize track — job <span class="job"></span></span><button class="close" title="Đóng">✕</button></h3>

  <div class="viewinfo">Top view: chọn một box ở sidebar CVAT.</div>
  <canvas class="view" width="732" height="732"></canvas>

  <h4>Sửa track</h4>
  <div class="warn">Bấm <b>Save</b> trong CVAT trước khi áp dụng. Trang sẽ tự tải lại sau khi lưu.</div>
  <label>Track</label>
  <div class="row"><select class="track"></select></div>
  <div class="row" style="margin-top:4px">
    <button class="btn pick">Lấy object đang chọn</button>
    <button class="btn refresh">Tải lại dữ liệu</button>
  </div>
  <label>Kích thước</label>
  <div class="modes">
    <label><input type="radio" name="mode" value="none"> Giữ nguyên</label>
    <label><input type="radio" name="mode" value="size" checked> Nhập số</label>
    <label><input type="radio" name="mode" value="scale"> Tỉ lệ</label>
    <label><input type="radio" name="mode" value="frame"> Lấy từ frame</label>
  </div>
  <div class="row vals"></div>
  <label><input type="checkbox" class="bottom" checked> Giữ đáy box cố định (không giữ thì giữ tâm)</label>
  <label class="row"><input type="checkbox" class="auto" checked> Tự động outside khi box có ≤
    <input type="number" class="thr" min="0" step="1" value="6"> điểm</label>
  <div class="actions">
    <button class="btn preview">Xem trước</button>
    <button class="btn primary apply" disabled>Áp dụng</button>
  </div>
  <div class="status"></div>
  <table class="table"></table>
</div>`;

  // Outside the shadow root a keystroke's target is the host div, not an input, so CVAT
  // would treat typing in the panel as hotkeys (next frame, delete, ...). Keep keys inside.
  for (const type of ["keydown", "keyup", "keypress"]) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  const $ = (sel) => root.querySelector(sel);
  const fab = $(".fab"), panel = $(".panel");
  if (globalThis.chrome && chrome.runtime && chrome.runtime.getURL) {
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL("icons/icon32.png");
    logo.alt = "";
    fab.prepend(logo);
  }
  let jobId = null, job = null, annotations = null, plan = null, planning = 0;

  function setStatus(text, isError) {
    $(".status").textContent = text;
    $(".status").className = "status" + (isError ? " err" : "");
  }

  const mode = () => root.querySelector("input[name=mode]:checked").value;
  const selectedTrack = () => annotations && annotations.tracks.find((t) => t.id === Number($(".track").value));

  function invalidate() {
    plan = null;
    planning++;
    $(".apply").disabled = true;
    $(".table").innerHTML = "";
  }

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
    box.querySelectorAll("input").forEach((i) => i.addEventListener("input", invalidate));
    invalidate();
  }

  async function loadData(keep) {
    setStatus("Đang tải annotation…");
    [job, annotations] = await Promise.all([api("GET", `/api/jobs/${jobId}`), api("GET", `/api/jobs/${jobId}/annotations`)]);
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
    lastView = null;
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
          const cloud = await loadCloud(f);
          if (token !== planning) throw new Error("cancelled");
          counts.set(f, countInside(cloud, positionAt(keys, f).points));
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
    invalidate();
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
    const before = new Map(plan.original.map((s) => [s.frame, s]));
    const rows = plan.shapes.map((s) => {
      const old = before.get(s.frame);
      const was = old ? `${fmt(sizeOf(old))}${old.outside ? " (ẩn)" : ""}` : '<span class="muted">mới</span>';
      const count = plan.counts.has(s.frame) ? ` · ${plan.counts.get(s.frame)} điểm` : "";
      return `<tr><td>${s.frame}</td><td>${was}</td><td>${s.outside ? "<b>ẩn</b>" : fmt(sizeOf(s))}${count}</td></tr>`;
    });
    $(".table").innerHTML = "<tr><th>Keyframe</th><th>Cũ</th><th>Mới</th></tr>" + rows.join("");
    const hiddenFrames = [...plan.counts].filter(([, n]) => n <= plan.threshold).map(([f]) => f);
    const hiddenText = !plan.counts.size ? "" : hiddenFrames.length
      ? `\nOutside (≤ ${plan.threshold} điểm): frame ${ranges(hiddenFrames).map(([a, b]) => a === b ? a : `${a}–${b}`).join(", ")}.`
      : `\nKhông frame nào có ≤ ${plan.threshold} điểm.`;
    $(".apply").disabled = false;
    setStatus(`Track #${plan.track.uiId}: ${plan.shapes.length} keyframe sau khi đổi.${hiddenText}\nBấm "Áp dụng" để lưu.`);
  }

  async function apply() {
    if (!plan) return;
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
    $(".track").value = String(track.id);
    renderInputs();
    setStatus(`Đã chọn track #${ui} (id ${track.id}).`);
  }

  // ---------- top view ----------

  let lastView = null;

  // Box of the selected sidebar object at a frame, from the saved annotations.
  function selectedBox(ui, frame) {
    const shape = annotations.shapes.find((s) => s.uiId === ui);
    if (shape) return shape.frame === frame ? { kind: "shape", points: shape.points, type: shape.type } : null;
    const track = annotations.tracks.find((t) => t.uiId === ui);
    if (!track) return undefined;
    const pos = positionAt(byFrame(track.shapes), frame);
    return pos && { kind: "track", points: pos.points, outside: pos.outside, type: track.shapes[0].type };
  }

  async function updateView() {
    if (panel.hidden || !annotations) return;
    const ui = activeUiId(), frame = currentFrame();
    const key = `${ui}@${frame}`;
    if (key === lastView) return;
    lastView = key;
    const info = $(".viewinfo"), canvas = $(".view"), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (ui === null || frame === null) return (info.textContent = "Top view: chọn một box ở sidebar CVAT.");
    const box = selectedBox(ui, frame);
    if (box === undefined) return (info.textContent = `#${ui}: chưa có trên server (Save rồi bấm "Tải lại dữ liệu").`);
    if (!box) return (info.textContent = `#${ui}: không có ở frame ${frame}.`);
    if (box.type !== "cuboid") return (info.textContent = `#${ui}: top view chỉ dùng cho cuboid 3D.`);
    info.textContent = `#${ui} · frame ${frame}: đang tải point cloud…`;
    let cloud;
    try {
      cloud = await loadCloud(frame);
    } catch (e) {
      if (lastView === key) info.textContent = e.message;
      return;
    }
    if (lastView !== key) return;

    const frameBox = boxFrame(box.points), [hx, hy, hz] = frameBox.half;
    const range = Math.max(hx, hy) * 1.6 + 1; // metres shown from the box center to the canvas edge
    const scale = canvas.width / 2 / range, mid = canvas.width / 2;
    // Build the pixels from scratch (no getImageData readback, which Chrome flags as slow).
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let o = 0; o < img.data.length; o += 4) {
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0x11; // same #111 background
      img.data[o + 3] = 255;
    }
    const plot = (x, y, rgb, r) => {
      const px = Math.round(mid + x * scale), py = Math.round(mid - y * scale);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const X = px + dx, Y = py + dy;
        if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height) continue;
        const o = (Y * canvas.width + X) * 4;
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
      }
    };
    const inside = [];
    let count = 0;
    forPointsNear(cloud, frameBox, range * Math.SQRT2 + hz, (x, y, z) => {
      if (Math.abs(x) > range || Math.abs(y) > range) return;
      if (Math.abs(x) <= hx && Math.abs(y) <= hy && Math.abs(z) <= hz) {
        count++;
        inside.push(x, y);
      } else {
        const shade = Math.abs(z) <= hz ? 150 : 70; // brighter when at the box's height
        plot(x, y, [shade, shade, shade], 0);
      }
    });
    for (let i = 0; i < inside.length; i += 2) plot(inside[i], inside[i + 1], [255, 140, 0], 1);
    ctx.putImageData(img, 0, 0);

    ctx.strokeStyle = box.outside ? "#888" : "#3fd13f";
    ctx.setLineDash(box.outside ? [8, 6] : []);
    ctx.lineWidth = 2;
    ctx.strokeRect(mid - hx * scale, mid - hy * scale, 2 * hx * scale, 2 * hy * scale);
    ctx.setLineDash([]);
    ctx.beginPath(); // heading: the box's +x axis
    ctx.moveTo(mid, mid);
    ctx.lineTo(mid + hx * scale, mid);
    ctx.stroke();
    ctx.fillStyle = "#ccc";
    ctx.font = "22px sans-serif";
    ctx.fillText(`${(2 * range).toFixed(1)} m`, 10, canvas.height - 12);

    const thr = Number($(".thr").value);
    info.textContent = `#${ui} · frame ${frame}${box.outside ? " · đang outside" : ""} · ${count} điểm trong box` +
      (count <= thr ? ` (≤ ${thr})` : "") + ". Xoay theo hướng box, vạch xanh = trục x.";
  }

  // ---------- wiring ----------

  const guard = (fn) => async () => { try { await fn(); } catch (e) { setStatus(e.message, true); } };

  fab.addEventListener("click", guard(async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
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
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }));
      } catch { /* not remembered, still works */ }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", stop);
    e.preventDefault();
  });
  $(".refresh").addEventListener("click", guard(() => loadData(Number($(".track").value))));
  $(".pick").addEventListener("click", guard(pickActive));
  $(".track").addEventListener("change", guard(renderInputs));
  root.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", guard(renderInputs)));
  $(".bottom").addEventListener("change", invalidate);
  $(".auto").addEventListener("change", invalidate);
  $(".thr").addEventListener("input", () => { invalidate(); lastView = null; });
  $(".preview").addEventListener("click", preview);
  $(".apply").addEventListener("click", apply);

  // CVAT is a single-page app: show the button only while a job page is open.
  function sync() {
    const m = location.pathname.match(JOB_PATH);
    const id = m ? Number(m[1]) : null;
    if (id !== jobId) {
      jobId = id;
      job = annotations = null;
      lastView = null;
      panel.hidden = true;
      invalidate();
      $(".job").textContent = id ?? "";
    }
    if (id && !host.isConnected) document.documentElement.appendChild(host);
    if (!id && host.isConnected) host.remove();
  }
  sync();
  setInterval(sync, 1000);
  setInterval(() => updateView().catch((e) => ($(".viewinfo").textContent = e.message)), 400);

  const done = sessionStorage.getItem("cvat-track-resizer-done");
  if (done && jobId) {
    sessionStorage.removeItem("cvat-track-resizer-done");
    panel.hidden = false;
    guard(() => loadData())().then(() => setStatus(done));
  }
})();
