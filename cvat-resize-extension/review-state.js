// Local review checklist. Server IDs survive reload; unsaved client IDs stay in this tab.
(() => {
  "use strict";
  function create(storage) {
    const memory = new Map(), drafts = new Map(), failed = new Set();
    const key = job => `cvat-track-reviews:v1:${job}`;
    const stable = track => Number.isSafeInteger(track?.id) && track.id > 0;
    function read(job) {
      if (failed.has(job)) return new Set(memory.get(job) || []);
      try {
        const raw = storage.getItem(key(job));
        const value = raw ? JSON.parse(raw) : null;
        const ids = value?.version === 1 && Array.isArray(value.ids) ? value.ids.filter(id => Number.isSafeInteger(id) && id > 0) : [];
        memory.set(job, ids);
        return new Set(ids);
      } catch {
        return new Set(memory.get(job) || []);
      }
    }
    function has(job, track) {
      return stable(track) ? read(job).has(track.id) : !!drafts.get(job)?.has(track?.clientID ?? track?.uiId);
    }
    function set(job, track, checked) {
      if (!stable(track)) {
        const ids = drafts.get(job) || new Set(), id = track?.clientID ?? track?.uiId;
        if (id === undefined || id === null) return { persistent: false };
        checked ? ids.add(id) : ids.delete(id); drafts.set(job, ids);
        return { persistent: false };
      }
      const ids = read(job);
      checked ? ids.add(track.id) : ids.delete(track.id);
      memory.set(job, [...ids]);
      try {
        storage.setItem(key(job), JSON.stringify({ version: 1, ids: [...ids] }));
        failed.delete(job);
        return { persistent: true };
      } catch {
        failed.add(job);
        return { persistent: false };
      }
    }
    return { has, set, key };
  }
  globalThis.CvatReviewState = { create };
})();
