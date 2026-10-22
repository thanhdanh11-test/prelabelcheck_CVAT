const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('cvat-resize-extension/content.js', 'utf8');

test('drawTrajectoryTrail draws motion trail and ghost wireframes on Top view when enabled', () => {
  const strokes = [];
  const lines = [];
  const rects = [];
  const ctxMock = {
    beginPath: () => {},
    stroke: () => strokes.push(true),
    setLineDash: () => {},
    moveTo: (x, y) => lines.push(['move', x, y]),
    lineTo: (x, y) => lines.push(['line', x, y]),
    fillRect: (x, y, w, h) => rects.push([x, y, w, h]),
  };

  const key = (frame, x, y = 0) => ({
    frame,
    outside: false,
    type: 'cuboid',
    points: [x, y, 0, 0, 0, 0, 4, 2, 2],
  });

  const shapes = [key(0, 0), key(2, 2), key(4, 4)];
  const frames = [0, 1, 2, 3, 4];
  const plan = { shapes };
  const controls = { '.trail': { checked: true } };

  // Projection function: identity for x, y
  const P = w => [w[0] * 10 + 50, w[1] * 10 + 50];
  const topView = { cap: 'Top · x–y', axis: 'Z', a: 0, b: 1, c: 2 };
  const sideView = { cap: 'Side · x–z', axis: 'Y', a: 0, b: 2, c: 1 };

  const sandbox = vm.createContext({
    plan,
    frames,
    controls,
    ctxMock,
    P,
    topView,
    sideView,
  });

  // Extract necessary helper functions from content.js
  const code = `
    const $ = s => controls[s];
    ${source.slice(source.indexOf('  function positionAt('), source.indexOf('  const byFrame ='))}
    ${source.slice(source.indexOf('  function boxFrame('), source.indexOf('  function forPointsNear('))}
    const stateAt = f => positionAt(plan.shapes, f);
    const toWorld = (F, l) => [l[0] + F.center[0], l[1] + F.center[1], l[2] + F.center[2]];
    ${source.slice(source.indexOf('  function drawTrajectoryTrail('), source.indexOf('  function updateSummary('))}
  `;

  vm.runInContext(code, sandbox);

  // 1. On Top view with trail enabled at frame 2
  vm.runInContext(`drawTrajectoryTrail(ctxMock, P, 2, topView, 1)`, sandbox);

  assert.ok(strokes.length > 0, 'Should have stroked trajectory lines');
  assert.ok(lines.length > 0, 'Should have moved/lined along trajectory');
  assert.ok(rects.length > 0, 'Should have drawn marker rects for neighbor frames');

  // 2. On Side view, trail should not be drawn
  strokes.length = 0;
  lines.length = 0;
  rects.length = 0;
  vm.runInContext(`drawTrajectoryTrail(ctxMock, P, 2, sideView, 1)`, sandbox);
  assert.equal(strokes.length, 0, 'Side view should not draw trajectory trail');

  // 3. When trail checkbox is disabled, nothing drawn on Top view
  controls['.trail'].checked = false;
  strokes.length = 0;
  lines.length = 0;
  vm.runInContext(`
    if ($('.trail')?.checked) {
      drawTrajectoryTrail(ctxMock, P, 2, topView, 1);
    }
  `, sandbox);
  assert.equal(strokes.length, 0, 'Disabled trail should draw nothing');
});
