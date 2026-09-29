// Field of view by recursive shadowcasting: scan outward from the viewer one octant at a time,
// row by row, and when a wall starts a shadow, recurse for the part of the row still lit.
// Cost is proportional to what's visible, not to the map.

// How each of the eight octants maps (dx, dy) onto the map.
const OCTANTS = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
]

export function fieldOfView(w: number, h: number, opaque: (i: number) => boolean, ox: number, oy: number, radius: number) {
  const seen = new Uint8Array(w * h)
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h
  const blocks = (x: number, y: number) => !inside(x, y) || opaque(y * w + x)
  seen[oy * w + ox] = 1
  const r2 = radius * radius + radius // a rounder edge than radius²

  function cast(row: number, start: number, end: number, [xx, xy, yx, yy]: number[]) {
    if (start < end) return
    for (let j = row; j <= radius; j++) {
      let blocked = false
      let nextStart = start
      for (let dx = -j; dx <= 0; dx++) {
        const dy = -j
        const x = ox + dx * xx + dy * xy
        const y = oy + dx * yx + dy * yy
        const left = (dx - 0.5) / (dy + 0.5)
        const right = (dx + 0.5) / (dy - 0.5)
        if (start < right) continue
        if (end > left) break
        if (dx * dx + dy * dy <= r2 && inside(x, y)) seen[y * w + x] = 1
        if (blocked) {
          if (blocks(x, y)) {
            nextStart = right
          } else {
            blocked = false
            start = nextStart
          }
        } else if (blocks(x, y) && j < radius) {
          blocked = true
          cast(j + 1, start, left, [xx, xy, yx, yy])
          nextStart = right
        }
      }
      if (blocked) break
    }
  }
  for (const o of OCTANTS) cast(1, 1, 0, o)
  return seen
}
