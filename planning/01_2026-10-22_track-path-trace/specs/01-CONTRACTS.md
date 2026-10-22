# 01 — Contracts

```js
globalThis.CvatTrackPath = { trace, toCsv };

trace(track: { shapes: Shape[] }, startFrame = -Infinity, stopFrame = Infinity): TraceResult
toCsv(result: TraceResult): string

Shape  = { frame: int, outside: boolean, type: "cuboid" | "rectangle", points: number[] }
// cuboid points: [x, y, z, rx, ry, rz, sx, sy, sz]   rectangle points: [x1, y1, x2, y2]

TraceResult = {
  type: "cuboid" | "rectangle",
  unit: "m" | "px",                 // cuboid → m, rectangle → px
  points: PathPoint[],              // frame giảm dần: finish → beginning
  runs:   { last: int, first: int, length: number }[],   // đoạn liên tục, finish-first
  gaps:   { hiddenFrom: int, hiddenTo: int, jump: number }[],
  summary: { finishFrame: int|null, beginFrame: int|null, frames: int,
             length: number, lengthXY: number, net: number, netXY: number,
             maxStep: { frame: int, step: number } | null }
}
PathPoint = { frame, x, y, z, yaw: number|null, key: boolean,
              step: number|null, stepXY: number|null }
```

- `x, y, z` = tâm box (cuboid) hoặc tâm chữ nhật với `z = 0` (rectangle). `yaw` = `points[5]` (rad), `null` với rectangle.
- `step` = khoảng cách 3D tới điểm đứng ngay trước trong danh sách (frame liền sau theo thời gian); `null` ở frame đầu tiên của mỗi đoạn.
- `net` = khoảng cách 3D giữa `points[0]` và `points.at(-1)`.
- CSV: header `frame,x,y,z,yaw_deg,step,keyframe`; số thực làm tròn 4 chữ số; `yaw_deg` và `step` để trống khi `null`.

UI (`content.js`): `.path-trace`, `.path-copy`, `.path-out`; `tracePath()`, `copyPath()`, `clearPath()`, `renderPath()`, `pathMap()`.
