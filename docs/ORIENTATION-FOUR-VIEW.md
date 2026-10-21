# Cuboid orientation and expanded frame — v1.11.0

Expanded frames hide the left tools and show a full-width LiDAR 3D viewport above three equally sized Top / Side / Front views. Undo and frame navigation remain available in the frame header. Escape restores the grid and sidebar, where Apply remains available. Both grid and expanded headers show the current number of points inside the box; geometry edits invalidate the count by its exact coordinates. Pending/error counts display …/— rather than a false zero.

## Controls

- 3D: left drag orbits, right/middle drag pans, wheel zooms, double-click or **Về box** recenters. These change only the camera.
- Only the selected item's cuboid is rendered over the whole frame's point cloud. The cloud comes from the existing shared RAM/IndexedDB loader, not a separate download path. Leaving expanded mode frees its GPU point buffer. Changing frames resets the camera onto the new box; late responses cannot replace a newer frame.
- Top / Side / Front retain mouse move and resize, plus a round rotation handle above each box. Shift-drag snaps to 15°. Buttons turn counterclockwise/clockwise 5° or flip 180° in the view plane.
- Orientation arrows use local positive X (red), Y (green), Z (blue). End-on axes in orthographic views use dot/cross symbols. Sidebar toggles control these arrows across all four views.
- Click a canvas to select the keyboard view, marked yellow. Arrows move 5 cm in that view plane; Shift uses 1 cm, Alt 20 cm. In 3D the plane follows the camera; the orthographic planes follow the box's local axes. PageUp/Down moves world Z, using the same step modifiers.
- Editing creates a keyframe, preserves dimensions/rotation when translating, and interpolates neighboring frames normally. A held arrow is one Undo step. Inputs/selects keep their normal keyboard behavior. D/F changes frame, Escape closes expanded mode, Ctrl/Cmd+Z undoes.

Rotation composes in the cuboid's local coordinate system and converts back to CVAT/three.js XYZ Euler angles. Positive screen turns map to +Z (Top), -Y (Side), +X (Front). This also handles boxes already tilted on other axes. The axis colors and per-view axes were checked against the local CVAT `cuboid.ts` and `canvas3dView.ts` sources.

`lidar-view.js` uses WebGL without external packages. It keeps only one selected cuboid and one cloud buffer. A WebGL failure displays an error while the three orthographic editors remain usable. Camera controls do not directly drag the 3D cuboid: mouse geometry edits use the three lower views; keyboard geometry edits work in all four views.

## Verification — 2026-10-21

- All 65 Node tests pass, covering the existing suite plus rotation composition, view hit areas, Shift snapping, orientation toggles, keyboard steps/local axes, held-key Undo, camera basis and stale cloud responses.
- Ego on local CVAT task 76 / job 97: 66 frames, 300,820 points in frame 0. The new four-view layout rendered, with the sidebar hidden and a single selected box. Background cache reached all 66 frames.
- Actual pointer orbit, pan, wheel zoom and reset passed; camera interaction left annotation geometry unchanged. No WebGL error was reported by `getError()`.
- Twelve actual keyboard checks (four commands per orthographic view) verified 5 cm / 1 cm / 20 cm displacement, unchanged size and rotation, and exact Undo restoration.
- Actual rotation-handle drags passed in all three views, including Shift in Side; Undo restored each preview. D/F frame changes and Escape/reopening restored the expected layout. Earlier orientation button checks covered 5° and 180° in each view.
- Before the follow-up UI change removed Apply from the expanded header, that button sent preview geometry into CVAT without reloading. Native CVAT Undo restored the original annotation content. Auto Save was off; no Save was used; the server annotation response remained unchanged.

Browser checks loaded the repository scripts into real MAIN and isolated execution worlds in Ego, in manifest order. They did not install an unpacked extension. Live coverage is one local job and desktop viewport, not every CVAT deployment or GPU. The six standalone IndexedDB fixture checks and the outside-splitting live flow are outside this test pass; see their separate reports.

Local screenshots and machine-readable results are under ignored `docs/evidence/four-view-*` and `docs/evidence/orientation-*` paths. Reload the extension and the job page once to load the new scripts; later Apply operations do not need a reload.
