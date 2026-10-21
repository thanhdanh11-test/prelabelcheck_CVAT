// One WebGL point cloud and one selected cuboid. No dependency on CVAT's renderer.
(() => {
  "use strict";
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const basis = (yaw, pitch) => ({
    right: [-Math.sin(yaw), Math.cos(yaw), 0],
    up: [-Math.sin(pitch) * Math.cos(yaw), -Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch)],
    back: [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)],
  });
  function create(canvas, onError = () => {}) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL không khả dụng; vẫn có thể chỉnh box ở ba view bên dưới.");
    const vertex = `attribute vec3 position; uniform vec3 target, right, up, back;
      uniform float distance, aspect, pointSize;
      void main() { vec3 p = position - target;
        float depth = distance - dot(p, back);
        gl_Position = vec4(dot(p, right) * 1.732 / aspect, dot(p, up) * 1.732,
          1.00002 * depth - 0.100001, depth); gl_PointSize = pointSize; }`;
    const fragment = `precision mediump float; uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }`;
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Không biên dịch được view LiDAR 3D.");
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Không khởi tạo được view LiDAR 3D.");
    const uniforms = Object.fromEntries(["target", "right", "up", "back", "distance", "aspect", "pointSize", "color"]
      .map(key => [key, gl.getUniformLocation(program, key)]));
    const position = gl.getAttribLocation(program, "position"), cloud = gl.createBuffer(), lines = gl.createBuffer();
    let count = 0, box = null, comparison = null, axes = [true, true, true], outside = false, pointer = null, lost = false;
    let target = [0, 0, 0], yaw = -Math.PI / 4, pitch = Math.PI / 6, distance = 12;
    function reset() {
      if (!box) return;
      target = box.center.slice(); yaw = -Math.PI / 4; pitch = Math.PI / 6;
      distance = Math.max(3, Math.hypot(...box.half) * 4); draw();
    }
    function getCamera() {
      return box ? { yaw, pitch, zoom: distance / Math.max(3, Math.hypot(...box.half) * 4),
        offset: target.map((n, i) => n - box.center[i]) } : null;
    }
    function restoreCamera(camera) {
      if (!box || !camera || ![camera.yaw, camera.pitch, camera.zoom, ...(camera.offset || [])].every(Number.isFinite) || camera.offset?.length !== 3 || camera.zoom <= 0) return reset();
      yaw = camera.yaw; pitch = Math.max(-1.5, Math.min(1.5, camera.pitch));
      distance = Math.max(.5, Math.min(3000, camera.zoom * Math.max(3, Math.hypot(...box.half) * 4)));
      target = box.center.map((n, i) => n + camera.offset[i]); draw();
    }
    function draw() {
      if (lost || !canvas.width || !canvas.height) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(.055, .065, .08, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program); gl.enableVertexAttribArray(position);
      const camera = basis(yaw, pitch);
      for (const key of ["right", "up", "back"]) gl.uniform3fv(uniforms[key], camera[key]);
      gl.uniform3fv(uniforms.target, target); gl.uniform1f(uniforms.distance, distance);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.uniform1f(uniforms.pointSize, Math.min(3, canvas.width / Math.max(1, canvas.clientWidth) * 1.3));
      gl.enable(gl.DEPTH_TEST); gl.bindBuffer(gl.ARRAY_BUFFER, cloud);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(uniforms.color, [.65, .7, .75]); gl.drawArrays(gl.POINTS, 0, count);
      if (!box) return;
      const world = local => box.R.map((row, i) => dot(row, local) + box.center[i]);
      const edgesOf = B => {
        const corners = [], edges = [];
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          const local = [x * B.half[0], y * B.half[1], z * B.half[2]];
          corners.push(B.R.map((row, i) => dot(row, local) + B.center[i]));
        }
        for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push(...corners[i], ...corners[i | bit]);
        return edges;
      };
      function stroke(vertices, color) {
        gl.bindBuffer(gl.ARRAY_BUFFER, lines); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0); gl.uniform3fv(uniforms.color, color);
        gl.drawArrays(gl.LINES, 0, vertices.length / 3);
      }
      // Keep the selected box visible through its point cloud, like annotation handles.
      gl.disable(gl.DEPTH_TEST); stroke(edgesOf(box), comparison ? [1, .74, .41] : outside ? [1, .2, .15] : [.25, .9, 1]);
      if (comparison) stroke(edgesOf(comparison), [.27, .9, 1]);
      for (let axis = 0; axis < 3; axis++) if (axes[axis]) {
        const end = [0, 0, 0]; end[axis] = box.half[axis] * 1.25;
        const arrow = [...box.center, ...world(end)], length = Math.min(.3, box.half[axis] * .25);
        for (const sign of [-1, 1]) {
          const wing = end.slice(); wing[axis] -= length; wing[(axis + 1) % 3] = sign * length * .5;
          arrow.push(...world(end), ...world(wing));
        }
        stroke(arrow, [[1, .32, .32], [.38, .84, .42], [.37, .56, 1]][axis]);
      }
    }
    canvas.addEventListener("pointerdown", e => {
      if (![0, 1, 2].includes(e.button)) return;
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button !== 0 };
    });
    canvas.addEventListener("pointermove", e => {
      if (!pointer || pointer.id !== e.pointerId) return;
      const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
      if (pointer.pan) {
        const camera = basis(yaw, pitch), scale = 2 * distance / (Math.sqrt(3) * Math.max(1, canvas.clientHeight));
        target = target.map((v, i) => v - dx * scale * camera.right[i] + dy * scale * camera.up[i]);
      } else {
        yaw -= dx * .008; pitch = Math.max(-1.5, Math.min(1.5, pitch + dy * .008));
      }
      pointer.x = e.clientX; pointer.y = e.clientY; draw();
    });
    const stop = () => {
      const id = pointer?.id; pointer = null;
      if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, stop);
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("wheel", e => {
      e.preventDefault(); const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      distance = Math.max(.5, Math.min(3000, distance * Math.exp(Math.max(-1, Math.min(1, pixels * .001))))); draw();
    }, { passive: false });
    canvas.addEventListener("dblclick", reset);
    canvas.addEventListener("webglcontextlost", e => {
      e.preventDefault(); lost = true; stop(); onError("Mất WebGL. Đóng rồi mở lại frame để khôi phục view 3D.");
    });
    return {
      setCloud(xyz) {
        count = xyz.length / 3; gl.bindBuffer(gl.ARRAY_BUFFER, cloud); gl.bufferData(gl.ARRAY_BUFFER, xyz, gl.STATIC_DRAW); draw();
      },
      setBox(value, hidden, enabled, proposed = null) { comparison = proposed; box = value; outside = hidden; axes = enabled; draw(); },
      resize() {
        const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio)); draw();
      },
      screenDelta(x, y) { const camera = basis(yaw, pitch); return camera.right.map((v, i) => x * v + y * camera.up[i]); },
      reset, getCamera, restoreCamera,
      clear() { stop(); comparison = null; box = null; count = 0; gl.bindBuffer(gl.ARRAY_BUFFER, cloud); gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW); draw(); },
      get lost() { return lost; },
    };
  }
  globalThis.CvatLidarView = { create, basis };
})();
