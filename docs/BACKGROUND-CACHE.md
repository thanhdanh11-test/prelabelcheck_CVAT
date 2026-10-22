# Background point-cloud cache — v1.9.0

Opening the tool on a 3D job starts a background preload. Since v1.13.1 (lesson from CVAT's `PrefetchAnalyzer`, which only reads ahead of the current position) the preload starts at the frame last read in the foreground and fans out, looking first in the direction the viewer is moving, and re-picks the nearest missing frame after every download, so a jump moves it. With no foreground read yet it walks the job from its first frame. Configure/Clear forget the viewing position. Foreground frame reads have priority in a shared three-slot queue and join an existing request for the same frame. Stop aborts only background-only requests; Continue skips frames already persisted. Preload never generates all item previews.

`cloud-cache.js` reads RAM, then IndexedDB, then CVAT. Parsed XYZ arrays are shared by every item in a job/frame. RAM retains up to 24 full frames or 128 MiB, with at least one frame retained. Existing near-box crops have a roughly 64 MB budget. Point counts are capped at 20,000 entries.

Persistent storage is limited to 1 GiB per CVAT origin, expires after seven days and evicts least-recently-used entries. Background writes protect frames in the current job: if the whole job cannot fit, preload stops instead of endlessly evicting and re-downloading that job. Foreground reads still work. Storage failures degrade to RAM and an explicit message. Browser quota/eviction can reduce what remains available.

Keys include origin, job ID, a digest of task ID/job creation date/frame metadata, frame number and parser version. Authenticated metadata is fetched on each tab/job entry before persistent reads. If metadata cannot be verified, the session uses RAM only. Metadata is not a content checksum: replacing source bytes without changing metadata requires clearing cache or waiting for expiry.

Clear removes only this extension's point-cloud database contents on the current origin. It leaves cookies, annotations and preview drafts alone, cancels old requests, and prevents their late responses from restoring cleared data. Visible preview frames may be downloaded again immediately. Other open tabs have their own RAM caches and can continue writing to the shared IndexedDB database.

Item switching stores drafts, input settings, native tool Undo snapshots and viewport position in RAM. A → B → A restores A without re-running its outside scan. A new item automatically builds its preview using shared cloud data. Only one preview DOM is mounted. A draft whose source changed remains visible but cannot be applied until rebuilt. Switching during auto-fit requires stopping the fit first. Drafts are not persisted and are discarded on reload, tab close or job navigation.

## Verification

- 35 Node tests pass: existing geometry/PCD/Apply regressions plus shared frame reads, cache reuse across controller instances, changed dataset keys, foreground priority, Stop/Continue, storage failures, capacity, stale job responses, clearing pending downloads, per-item edits/Undo/viewport restoration and rapid switching.
- `tests/cloud-cache-browser.html` provides six real IndexedDB integration checks in a separate temporary database: typed-array round-trip/reopen, concurrent budget enforcement, preload protection, LRU eviction, expiry and clear. Serve the repository with `python3 -m http.server 5181 --bind 127.0.0.1`, then open `/tests/cloud-cache-browser.html`.
- Follow-up Ego verification on 2026-10-21, during v1.11 testing: local job 97 opened successfully and background preload reached 66/66 frames. The expanded LiDAR view used the shared loader and displayed 300,820 points at frame 0. This is a live integration check, not proof of every persistence/eviction scenario; the six standalone IndexedDB fixture checks remain unrun. See `ORIENTATION-FOUR-VIEW.md` and the earlier `LIVE-APPLY.md`.

### v1.13.1 — lessons from CVAT

- Viewer-centred preload (above): 4 new tests (order around the viewed frame in both directions, sequential without a foreground read, follows a jump mid-run, forgets position on configure). Disabling the change turns 2 red.
- Checklist lookups (`object-state-index.ts` lesson: one index per array): `review-state.js` reparses localStorage only when the stored text changed; `renderReviewState` builds one Map instead of scanning all tracks per option. Micro-benchmark at 500 tracks × 2,000 saved IDs: about 210 ms → under 1 ms per render. Disabling the cached parse turns 1 test red.
- Tried and reverted: counting then filling a typed array in `nearCloud`. Measured 3.2 → 5.4 ms per 300k-point crop because the frame is scanned twice and a crop keeps about 0.5% of points.
- Not adopted: CVAT's periodic metadata re-check (`chunks_updated_date`) and RAM sizing from frame size. Both are in the Idea Vault.
- `node --test tests/*.test.cjs`: 100/100. Not yet run in Chrome against a live job.

No npm packages, server annotation writes or new extension permissions are required.
