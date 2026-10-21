// Runs in MAIN world: use CVAT's plugin API, never PATCH annotations behind its UI.
(() => {
  "use strict";
  if (window.__cvatTrackResizerBridge) return;
  window.__cvatTrackResizerBridge = true;
  const CHANNEL = "cvat-track-resizer-v2";
  let store = null, busy = false;

  function getStore() {
    if (!store) {
      if (typeof window.cvatUI?.registerComponent !== "function") {
        throw new Error("CVAT chưa sẵn sàng hoặc không hỗ trợ plugin API. Không có dữ liệu nào được thay đổi.");
      }
      window.cvatUI.registerComponent(({ store: cvatStore }) => {
        store = cvatStore;
        return { name: "CVAT Track Resizer", destructor: () => { store = null; } };
      });
    }
    return store;
  }

  function current(jobId, editing = false) {
    const state = getStore().getState(), annotation = state.annotation, job = annotation?.job?.instance;
    if (!job || job.id !== jobId || !annotation.annotations.initialized || annotation.job.fetching) {
      throw new Error("Job CVAT đang đổi hoặc chưa tải xong. Mở tool lại khi job sẵn sàng.");
    }
    if (editing && (annotation.annotations.saving?.uploading || annotation.job.saving || annotation.player.playing ||
        annotation.workspace === "Review" || annotation.canvas.activeControl !== "cursor")) {
      throw new Error("Dừng phát, chờ Save xong và chuyển về công cụ chọn trước khi Áp dụng (không hỗ trợ chế độ Review).");
    }
    return { state, annotation, job };
  }

  async function snapshot(jobId) {
    const { job } = current(jobId);
    const annotations = await job.annotations.export();
    current(jobId);
    return {
      job: { id: job.id, start_frame: job.startFrame, stop_frame: job.stopFrame },
      annotations,
      labels: job.labels.map((label) => label.toJSON()),
    };
  }

  // Ignore serialization IDs when checking for edits, but compare all annotation content.
  function fingerprint(value) {
    const normalize = (v) => {
      if (Array.isArray(v)) return v.map(normalize);
      if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort()
        .filter((key) => !["id", "clientID", "uiId"].includes(key) && v[key] !== undefined)
        .map((key) => [key, normalize(v[key])]));
      return v;
    };
    return JSON.stringify(normalize(value));
  }

  async function refresh(jobId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { state, annotation, job } = current(jobId);
      const frame = annotation.player.frame.number;
      const states = await job.annotations.get(frame, state.settings.workspace.showAllInterpolationTracks, annotation.annotations.filters);
      const history = await job.actions.get();
      const latest = current(jobId);
      if (latest.annotation.player.frame.number !== frame) continue;
      // Ground-truth overlays are read-only and unchanged by this track replacement.
      states.push(...latest.annotation.annotations.states.filter((s) => s.isGroundTruth));
      getStore().dispatch({ type: "FETCH_ANNOTATIONS_SUCCESS", payload: { states, history } });
      return;
    }
    throw new Error("Đã áp dụng nhưng frame đang đổi liên tục. Dừng phát rồi chuyển frame để làm mới box.");
  }

  async function apply(payload) {
    const { jobId, baseline, track } = payload;
    const { job, annotation } = current(jobId, true);
    if (typeof baseline?.clientID !== "number" || !Array.isArray(track?.shapes) || !track.shapes.length ||
        !["cuboid", "rectangle"].includes(track.shapes[0].type) || (track.elements || []).length) {
      throw new Error("Track không hợp lệ hoặc không được hỗ trợ.");
    }
    const exported = await job.annotations.export();
    const original = exported.tracks.find((t) => t.clientID === baseline.clientID);
    if (!original || fingerprint(original) !== fingerprint(baseline)) {
      throw new Error("Track đã được sửa hoặc Undo trong CVAT sau khi mở tool. Bấm Tải lại trong tool và xem trước lại.");
    }
    const states = await job.annotations.get(original.shapes[0].frame, true, []);
    if (states.find((s) => s.clientID === original.clientID)?.lock) throw new Error("Track đang khóa trong CVAT. Mở khóa trước khi áp dụng.");
    current(jobId, true);
    const replacement = structuredClone(track);
    delete replacement.clientID;
    delete replacement.uiId;
    const shapeIDs = new Map(original.shapes.map((shape) => [shape.frame, shape.id]));
    replacement.shapes = replacement.shapes.map((shape) => {
      const next = { ...shape };
      if (shapeIDs.get(shape.frame) === undefined) delete next.id;
      else next.id = shapeIDs.get(shape.frame);
      return next;
    });
    // Keep current server IDs, including ones assigned by a Save while preview was open.
    if (original.id === undefined) delete replacement.id;
    else replacement.id = original.id;
    await job.annotations.commit({ tracks: [replacement] }, { tracks: [original] }, current(jobId).annotation.player.frame.number);
    // Commit is now in native history; a refresh failure must never cause an automatic second commit.
    let warning = "", clientID;
    try {
      const previousIDs = new Set(exported.tracks.map((t) => t.clientID));
      const updated = await job.annotations.export();
      clientID = updated.tracks.find((t) => !previousIDs.has(t.clientID) && t.id === original.id)?.clientID;
      await refresh(jobId);
    } catch (error) { warning = error.message; }
    return { applied: true, clientID, warning: warning ? `Đã áp dụng vào bộ nhớ CVAT, chưa lưu server. Chuyển frame để làm mới box hoặc Undo trong CVAT. Chi tiết: ${warning}` : "" };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL ||
        event.data.direction !== "request" || typeof event.data.id !== "string") return;
    const { id, action, payload } = event.data;
    if (!["snapshot", "apply"].includes(action)) return;
    const reply = (result) => window.postMessage({ channel: CHANNEL, direction: "response", id, ...result }, location.origin);
    if (busy) { reply({ error: "Tool đang áp dụng. Chờ xong rồi thử lại." }); return; }
    busy = true;
    try {
      const result = action === "snapshot" ? await snapshot(payload.jobId) : await apply(payload);
      reply({ result });
    } catch (error) { reply({ error: error.message }); }
    finally { busy = false; }
  });
})();
