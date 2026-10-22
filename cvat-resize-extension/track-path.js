// Pure path tracing for one track, loaded in the isolated world. Read-only: never touches annotations.
// Walks the track from its last visible frame back to its first and reports where it was.
(() => {
  "use strict";
  const wrap = (v) => {
    const r = (v + Math.PI) % (2 * Math.PI);
    return (r <= 0 ? r + 2 * Math.PI : r) - Math.PI;
  };

  // Centre (x, y, z) and yaw of a keyframe: cuboid points are [x, y, z, rx, ry, rz, ...],
  // a rectangle is [x1, y1, x2, y2] and has no height or yaw.
  function poseOf(shape) {
    const p = shape.points;
    if (shape.type === "cuboid") return { x: p[0], y: p[1], z: p[2], yaw: p[5] };
    if (shape.type === "rectangle") return { x: (p[0] + p[2]) / 2, y: (p[1] + p[3]) / 2, z: 0, yaw: null };
    throw new Error(`Không hỗ trợ loại ${shape.type} (chỉ cuboid và rectangle).`);
  }

  // Linear between keyframes like CVAT; visibility comes from the keyframe on the left.
  function between(a, b, t) {
    const lerp = (u, v) => u + (v - u) * t;
    return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z),
      yaw: a.yaw === null ? null : wrap(a.yaw + wrap(b.yaw - a.yaw) * t) };
  }

  // frames: ascending visible frames; the result lists them finish → beginning.
  function trace(track, startFrame = -Infinity, stopFrame = Infinity) {
    const shapes = (track?.shapes || []).slice().sort((a, b) => a.frame - b.frame);
    if (!shapes.length) throw new Error("Track không có keyframe.");
    if (shapes.some((s, i) => !Number.isSafeInteger(s.frame) || (i && s.frame <= shapes[i - 1].frame))) {
      throw new Error("Keyframe phải có số frame nguyên và không trùng nhau.");
    }
    const type = shapes[0].type, poses = shapes.map(poseOf);
    // A track whose last keyframe is visible continues to the job's last frame.
    const from = Math.max(shapes[0].frame, startFrame), last = Number.isFinite(stopFrame) ? stopFrame : shapes.at(-1).frame;
    const list = [];
    let i = 0;
    for (let frame = shapes[0].frame; frame <= last; frame++) {
      while (i + 1 < shapes.length && shapes[i + 1].frame <= frame) i++;
      if (frame < from || shapes[i].outside) continue;
      const next = shapes[i + 1], key = shapes[i].frame === frame;
      const pose = key || !next ? poses[i] : between(poses[i], poses[i + 1], (frame - shapes[i].frame) / (next.frame - shapes[i].frame));
      list.push({ frame, ...pose, key });
    }
    list.reverse();

    const runs = [], gaps = [];
    let length = 0, lengthXY = 0, max = null;
    list.forEach((p, k) => {
      const prev = list[k - 1];
      if (prev && prev.frame - p.frame === 1) {
        p.stepXY = Math.hypot(prev.x - p.x, prev.y - p.y);
        p.step = Math.hypot(p.stepXY, prev.z - p.z);
        length += p.step; lengthXY += p.stepXY;
        runs.at(-1).length += p.step;
        runs.at(-1).first = p.frame;
        if (!max || p.step > max.step) max = { frame: p.frame, step: p.step };
      } else {
        p.step = p.stepXY = null; // first frame of a run: nothing to measure from
        if (prev) gaps.push({ hiddenFrom: p.frame + 1, hiddenTo: prev.frame - 1,
          jump: Math.hypot(prev.x - p.x, prev.y - p.y, prev.z - p.z) });
        runs.push({ last: p.frame, first: p.frame, length: 0 });
      }
    });
    const finish = list[0] || null, begin = list.at(-1) || null;
    const net = finish ? Math.hypot(finish.x - begin.x, finish.y - begin.y, finish.z - begin.z) : 0;
    const netXY = finish ? Math.hypot(finish.x - begin.x, finish.y - begin.y) : 0;
    return {
      type, unit: type === "cuboid" ? "m" : "px", points: list, runs, gaps,
      summary: { finishFrame: finish?.frame ?? null, beginFrame: begin?.frame ?? null, frames: list.length,
        length, lengthXY, net, netXY, maxStep: max },
    };
  }

  function toCsv(result) {
    const rows = result.points.map((p) => [p.frame, p.x, p.y, p.z, p.yaw === null ? "" : p.yaw * 180 / Math.PI,
      p.step ?? "", p.key ? 1 : 0].map((v) => typeof v === "number" && !Number.isInteger(v) ? +v.toFixed(4) : v).join(","));
    return ["frame,x,y,z,yaw_deg,step,keyframe", ...rows].join("\n");
  }

  globalThis.CvatTrackPath = { trace, toCsv };
})();
