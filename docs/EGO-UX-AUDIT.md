# Ego UX audit — 2026-10-20

Test target: local CVAT at `http://localhost:8080/tasks/76/jobs/97`, 66 frames, one cuboid track (server ID 49), initially 55 keyframes.

Ego Lite was launched and used with its existing authenticated session. The extension was not installed in this browser. Its current `content.js` was executed through the page runtime, providing the real panel, DOM events, API reads and point-cloud processing. This verifies content-script workflows but does not verify extension installation, isolated-world execution or packaged icon loading.

## Observations and improvements in 1.7.3

1. Scanning outside downloaded the track's clouds and took long enough that cancellation was needed. The progress button was disabled and the status still showed the track count. It now remains clickable to cancel and explains scanning/stopping/completion. Browser verification: second click stopped the preview, no editor appeared, and the button became usable again. Existing in-flight requests still finish before cancellation unwinds.
2. Selecting “Frame khớp kém” with zero flagged frames produced a blank editor. It now shows an explanatory empty state and “Bỏ bộ lọc”. Browser verification: `0 / 66 frame`, visible empty state, then all 66 frames restored by the reset button.
3. Auto fit finished with a blank status. It now reports the selected range, number of flagged frames and the undo shortcut. Verified on frames 0–3 with reference frame 0 and real cloud data.
4. The main status is now a polite live region for assistive technologies.

## Flows exercised

| Flow | Observed result |
|---|---|
| Load job / select track | Track 49 listed as sidebar #1; dimensions populated |
| Preview with automatic outside | 56 resulting keys; newly hidden frames 58–59 and 62; existing hidden frames retained (8 total) |
| Top/Side/Front rendering | Real cloud points and box outlines drawn without load-error indicators |
| Zoom / edge drag with size lock | L changed from 4.178 to 4.404; one manual frame |
| Cmd+Z after edge drag | L returned to 4.178; manual count returned to zero |
| F / Escape | Advanced zoom to frame 1, then closed zoom |
| Toggle outside / undo | Hidden count 8 → 9 → 8 |
| Short-range rigid auto fit | Completed frames 0–3; zero flagged frames; undo restored original key count |
| Browser fullscreen | Entered and exited successfully |
| CSS viewport 1280×720 | Editor remained usable; sidebar overflow scrolls |
| Save confirmation | Correct 55-keyframe confirmation appeared after undo; dismissed |
| Cancel new preview | Scanning → stopping → stopped, editor remained closed |
| Empty filter / reset | Clear message with 0/66, reset restored 66 frames |

No PATCH/POST/DELETE annotation request was submitted. All geometry changes were restricted to the extension's in-memory preview. Sampled 2D jobs had no tracks, so a live rectangle-track edit was not exercised. Accuracy of fitting beyond this short real-cloud sample remains unproven.

## Evidence

Screenshots are in `docs/evidence/ego-2026-10-20` (local only; excluded from Git because the images contain CVAT job data): `editor.png`, `zoom.png`, `empty-filter-before.png`, `empty-filter-after.png`, and `laptop-css1280.png`. The browser uses a non-default zoom; the laptop check explicitly measured `innerWidth=1280`, `innerHeight=720`.

Local checks: `node --check cvat-resize-extension/content.js`, `node --test tests/extension.test.cjs` (15 tests), and `git diff --check`.
