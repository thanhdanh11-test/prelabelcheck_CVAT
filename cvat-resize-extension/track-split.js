// Shared pure logic, loaded in both MAIN and isolated worlds.
(() => {
  "use strict";
  function cuts(shapes, gap, start = shapes[0]?.frame, stop = Infinity) {
    if (!Number.isSafeInteger(gap) || gap < 0) throw new Error("Ngưỡng tách phải là số frame nguyên ≥ 1 (hoặc tắt tách).");
    if (!Array.isArray(shapes) || !shapes.length || shapes.some((shape, i) =>
      !Number.isSafeInteger(shape.frame) || (i && shape.frame <= shapes[i - 1].frame))) {
      throw new Error("Keyframe phải có số frame nguyên và tăng dần, không trùng nhau.");
    }
    if (!gap) return [];
    const result = [];
    let seen = false, outside = null;
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i], from = Math.max(shape.frame, start), to = Math.min((shapes[i + 1]?.frame ?? Infinity) - 1, stop);
      if (from > to) continue;
      if (shape.outside) {
        if (seen && outside === null) outside = from;
      } else {
        if (outside !== null && from - outside >= gap) result.push({ outsideFrame: outside, reappearFrame: shape.frame, hiddenFrames: from - outside });
        outside = null;
        seen = true;
      }
    }
    return result;
  }

  // Frame ownership intervals, including hidden gaps at the end of the preceding segment.
  function ranges(shapes, boundaries, start, stop) {
    const starts = [Math.max(start, shapes[0].frame), ...boundaries.map(cut => cut.reappearFrame)];
    return starts.map((startFrame, i) => ({ startFrame, endFrame: (starts[i + 1] ?? stop + 1) - 1 }));
  }

  function split(track, gap = 0, start = track.shapes[0]?.frame, stop = Infinity) {
    const boundaries = cuts(track.shapes, gap, start, stop);
    const indexes = new Map(track.shapes.map((shape, i) => [shape.frame, i]));
    const starts = [0, ...boundaries.map(cut => indexes.get(cut.reappearFrame))];
    const ends = [...boundaries.map(cut => indexes.get(cut.outsideFrame) + 1), track.shapes.length];
    const wanted = new Set(starts), attributes = new Map(), snapshots = new Map();
    track.shapes.forEach((shape, i) => {
      for (const attr of shape.attributes || []) attributes.set(attr.spec_id, attr.value);
      if (wanted.has(i)) snapshots.set(i, [...attributes].map(([spec_id, value]) => ({ spec_id, value })));
    });
    const tracks = starts.map((begin, index) => {
      const part = structuredClone({ ...track, shapes: track.shapes.slice(begin, ends[index]) });
      part.frame = part.shapes[0].frame;
      delete part.clientID; delete part.uiId;
      if (index) {
        delete part.id;
        for (const shape of part.shapes) { delete shape.id; delete shape.clientID; }
        // A new track needs the effective mutable values, not just changes at its first key.
        part.shapes[0].attributes = snapshots.get(begin);
      }
      return part;
    });
    return { tracks, cuts: boundaries };
  }
  globalThis.CvatTrackSplit = { cuts, split, ranges };
})();
