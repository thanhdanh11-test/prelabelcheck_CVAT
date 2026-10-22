#!/usr/bin/env python3
"""Resize every keyframe of one CVAT track (3D cuboid or 2D rectangle) to one size.

CVAT interpolates between keyframes, so giving all keyframes the same size makes
the box the same size on every frame of the track. Position and rotation are kept.

Examples:
  export CVAT_TOKEN=...                       # Profile > Access tokens in the CVAT UI
  cvat_resize_track.py --job 97 --list
  cvat_resize_track.py --job 97 --track 45 --size 4.5 1.9 1.6
  cvat_resize_track.py --job 97 --track 45 --from-frame 65 --anchor bottom
  cvat_resize_track.py --job 97 --track 45 --scale 1.1 --dry-run

Save your work in CVAT before running, and reload the job page afterwards.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request


class Cvat:
    def __init__(self, url, token=None, user=None, password=None):
        self.url = url.rstrip("/")
        if token:
            self.auth = "Bearer " + token
        elif user and password:
            self.auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
        else:
            sys.exit("Need --token (or CVAT_TOKEN) or --user/--password (or CVAT_USER/CVAT_PASSWORD).")

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method)
        req.add_header("Authorization", self.auth)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode(errors='replace')[:500]}")



def size_of(shape):
    p = shape["points"]
    if shape["type"] == "cuboid":
        return p[6:9]
    if shape["type"] == "rectangle":
        return [p[2] - p[0], p[3] - p[1]]
    sys.exit(f"Unsupported shape type: {shape['type']} (only cuboid and rectangle).")


def size_at(track, frame):
    """Track size at a frame, linearly interpolated between keyframes like CVAT does."""
    keys = sorted((s for s in track["shapes"] if not s["outside"]), key=lambda s: s["frame"])
    if not keys:
        sys.exit("Track has no visible keyframes.")
    if frame <= keys[0]["frame"]:
        return size_of(keys[0])
    for a, b in zip(keys, keys[1:]):
        if a["frame"] <= frame <= b["frame"]:
            t = (frame - a["frame"]) / (b["frame"] - a["frame"])
            return [x + (y - x) * t for x, y in zip(size_of(a), size_of(b))]
    return size_of(keys[-1])


def resized_points(shape, new_size, anchor):
    p = list(shape["points"])
    if shape["type"] == "cuboid":
        if anchor == "bottom":
            p[2] += (new_size[2] - p[8]) / 2  # keep the cuboid's floor at the same height
        p[6:9] = new_size
    else:
        cx, cy = (p[0] + p[2]) / 2, (p[1] + p[3]) / 2
        w, h = new_size
        if anchor == "bottom":
            cy = p[3] - h / 2
        p[:4] = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    return p


def fmt(v):
    return "x".join(f"{x:.3f}" for x in v)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("CVAT_URL", "http://localhost:8080"))
    ap.add_argument("--token", default=os.environ.get("CVAT_TOKEN"), help="CVAT access token")
    ap.add_argument("--user", default=os.environ.get("CVAT_USER"))
    ap.add_argument("--password", default=os.environ.get("CVAT_PASSWORD"))
    ap.add_argument("--job", type=int, required=True)
    ap.add_argument("--list", action="store_true", help="list the job's tracks and exit")
    ap.add_argument("--track", type=int, help="server track id (see --list)")
    how = ap.add_mutually_exclusive_group()
    how.add_argument("--size", type=float, nargs="+", metavar="N",
                     help="new size: L W H for cuboids (CVAT scale x y z), W H for rectangles")
    how.add_argument("--scale", type=float, nargs="+", metavar="K",
                     help="multiply each keyframe's size: one factor, or one per axis")
    how.add_argument("--from-frame", type=int, metavar="F",
                     help="use the track's size at frame F for every frame")
    ap.add_argument("--anchor", choices=["center", "bottom"], default="center",
                     help="keep the box center (default) or its bottom fixed")
    ap.add_argument("--dry-run", action="store_true", help="show the changes without saving")
    args = ap.parse_args()

    cvat = Cvat(args.url, args.token, args.user, args.password)
    annotations = cvat.request("GET", f"/api/jobs/{args.job}/annotations")

    if args.list:
        print(f"{'track (id)':>10}  type       frames      keys  size at first keyframe")
        for t in annotations["tracks"]:
            frames = sorted(s["frame"] for s in t["shapes"])
            print(f"{t['id']:>10}  {t['shapes'][0]['type']:<9}  {frames[0]:>4}-{frames[-1]:<5} "
                  f"{len(frames):>4}  {fmt(size_of(t['shapes'][0]))}")
        return

    if args.track is None:
        ap.error("give --track (or --list)")
    if not (args.size or args.scale or args.from_frame is not None):
        ap.error("give one of --size, --scale, --from-frame")

    track = next((t for t in annotations["tracks"] if t["id"] == args.track), None)
    if track is None:
        sys.exit(f"Track {args.track} not found in job {args.job}; use --list.")

    kind = track["shapes"][0]["type"]
    dims = 3 if kind == "cuboid" else 2
    if args.size and len(args.size) != dims:
        ap.error(f"--size needs {dims} numbers for a {kind}")
    if args.scale and len(args.scale) not in (1, dims):
        ap.error(f"--scale needs 1 or {dims} numbers for a {kind}")
    fixed = args.size or (size_at(track, args.from_frame) if args.from_frame is not None else None)
    if fixed is not None and min(fixed) <= 0:
        sys.exit(f"Size must be positive, got {fmt(fixed)}")

    print(f"Track id {track['id']}, {kind}, {len(track['shapes'])} keyframes, anchor={args.anchor}")
    for shape in sorted(track["shapes"], key=lambda s: s["frame"]):
        old = size_of(shape)
        if fixed is not None:
            new = list(fixed)
        else:
            k = args.scale * dims if len(args.scale) == 1 else args.scale
            new = [x * f for x, f in zip(old, k)]
        shape["points"] = resized_points(shape, new, args.anchor)
        print(f"  frame {shape['frame']:>5}{' (outside)' if shape['outside'] else '':<10} {fmt(old)} -> {fmt(new)}")

    if args.dry_run:
        print("Dry run: nothing saved.")
        return
    body = {"version": annotations["version"], "tags": [], "shapes": [], "tracks": [track]}
    cvat.request("PATCH", f"/api/jobs/{args.job}/annotations?action=update", body)

    saved = next(t for t in cvat.request("GET", f"/api/jobs/{args.job}/annotations")["tracks"] if t["id"] == track["id"])
    want = {s["frame"]: s["points"] for s in track["shapes"]}
    bad = [s["frame"] for s in saved["shapes"]
           if any(abs(a - b) > 1e-6 for a, b in zip(s["points"], want.get(s["frame"], [])))
           or s["frame"] not in want]
    if bad or len(saved["shapes"]) != len(want):
        sys.exit(f"Saved, but the server copy differs at frames {bad}; check the job.")
    print(f"Saved {len(want)} keyframes. Reload the job page in CVAT to see the change.")


if __name__ == "__main__":
    main()
