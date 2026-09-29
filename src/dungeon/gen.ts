// Making a floor: rooms joined by corridors (with doors where corridors meet rooms), or on
// some floors a cave grown by a cellular automaton. Everything comes from the seed.
import { rand } from '../shared/rng.ts'

export const W = 40
export const H = 30
export const WALL = 0
export const FLOOR = 1
export const DOOR = 2 // closed: blocks sight until opened
export const OPEN = 3
export const STAIRS = 4

export const passable = (t: number) => t !== WALL
export const opaque = (t: number) => t === WALL || t === DOOR

// A tiny random source that advances a seed held in an object, for code that needs many rolls.
export class Rng {
  seed: number
  constructor(seed: number) {
    this.seed = seed
  }
  next() {
    const [v, s] = rand(this.seed)
    this.seed = s
    return v
  }
  int(lo: number, hi: number) {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }
  chance(p: number) {
    return this.next() < p
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]
  }
}

export interface Room { x: number; y: number; w: number; h: number }
export interface Floor { tiles: number[]; rooms: Room[]; start: number; stairs: number }

const idx = (x: number, y: number) => y * W + x
export const NEIGHBORS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const

// Steps from `from` to every tile reachable through `ok` tiles (8 directions), -1 if unreachable.
export function distances(tiles: readonly number[], from: number, ok: (i: number) => boolean = i => passable(tiles[i])) {
  const dist = new Int16Array(W * H).fill(-1)
  const queue = [from]
  dist[from] = 0
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const [x, y] = [i % W, Math.floor(i / W)]
    for (const [dx, dy] of NEIGHBORS) {
      const [nx, ny] = [x + dx, y + dy]
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const n = idx(nx, ny)
      if (dist[n] >= 0 || !ok(n) || !diagonalOk(tiles, x, y, dx, dy)) continue
      dist[n] = dist[i] + 1
      queue.push(n)
    }
  }
  return dist
}

// No cutting corners: a diagonal step needs both side squares open, and never goes through a
// doorway (closed doors count as walls).
export function diagonalOk(tiles: readonly number[], x: number, y: number, dx: number, dy: number) {
  if (!dx || !dy) return true
  const side = (t: number) => t !== WALL && t !== DOOR
  const door = (t: number) => t === DOOR || t === OPEN
  return side(tiles[idx(x + dx, y)]) && side(tiles[idx(x, y + dy)]) && !door(tiles[idx(x, y)]) && !door(tiles[idx(x + dx, y + dy)])
}

function rooms(rng: Rng): { tiles: number[]; rooms: Room[] } {
  const tiles = Array<number>(W * H).fill(WALL)
  const list: Room[] = []
  for (let tries = 0; tries < 300 && list.length < 11; tries++) {
    const w = rng.int(4, 10)
    const h = rng.int(3, 7)
    const r = { x: rng.int(1, W - w - 1), y: rng.int(1, H - h - 1), w, h }
    if (list.some(o => r.x <= o.x + o.w + 1 && o.x <= r.x + r.w + 1 && r.y <= o.y + o.h + 1 && o.y <= r.y + r.h + 1)) continue
    list.push(r)
    for (let y = r.y; y < r.y + h; y++) for (let x = r.x; x < r.x + w; x++) tiles[idx(x, y)] = FLOOR
  }
  // Corridors: each room to the next from left to right, plus a couple of loops.
  list.sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2))
  const center = (r: Room) => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)]
  const dig = (a: Room, b: Room) => {
    let [x, y] = center(a)
    const [tx, ty] = center(b)
    const horizontalFirst = rng.chance(0.5)
    const carve = () => {
      tiles[idx(x, y)] = FLOOR
    }
    if (horizontalFirst) {
      while (x !== tx) (x += Math.sign(tx - x)), carve()
      while (y !== ty) (y += Math.sign(ty - y)), carve()
    } else {
      while (y !== ty) (y += Math.sign(ty - y)), carve()
      while (x !== tx) (x += Math.sign(tx - x)), carve()
    }
  }
  for (let i = 1; i < list.length; i++) dig(list[i - 1], list[i])
  for (let i = 0; i < 2; i++) dig(rng.pick(list), rng.pick(list))

  // Doors: corridor squares right outside a room, with wall on both sides of them.
  for (const r of list) {
    for (let x = r.x; x < r.x + r.w; x++) {
      for (const y of [r.y - 1, r.y + r.h]) {
        const i = idx(x, y)
        if (tiles[i] === FLOOR && tiles[i - 1] === WALL && tiles[i + 1] === WALL && rng.chance(0.6)) tiles[i] = DOOR
      }
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      for (const x of [r.x - 1, r.x + r.w]) {
        const i = idx(x, y)
        if (tiles[i] === FLOOR && tiles[i - W] === WALL && tiles[i + W] === WALL && rng.chance(0.6)) tiles[i] = DOOR
      }
    }
  }
  return { tiles, rooms: list }
}

function cave(rng: Rng): number[] | null {
  let tiles = Array.from({ length: W * H }, (_, i) => {
    const [x, y] = [i % W, Math.floor(i / W)]
    return x === 0 || y === 0 || x === W - 1 || y === H - 1 || rng.chance(0.45) ? WALL : FLOOR
  })
  for (let pass = 0; pass < 5; pass++) {
    tiles = tiles.map((t, i) => {
      const [x, y] = [i % W, Math.floor(i / W)]
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return WALL
      const walls = NEIGHBORS.filter(([dx, dy]) => tiles[idx(x + dx, y + dy)] === WALL).length
      return walls >= 5 || (walls === 0 && pass < 2) ? WALL : walls <= 3 ? FLOOR : t
    })
  }
  // Keep only the biggest connected cave.
  let best: Int16Array | null = null
  let bestSize = 0
  const done = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (tiles[i] !== FLOOR || done[i]) continue
    const d = distances(tiles, i)
    let size = 0
    d.forEach((v, j) => {
      if (v >= 0) (done[j] = 1), size++
    })
    if (size > bestSize) [best, bestSize] = [d, size]
  }
  if (!best || bestSize < W * H * 0.35) return null
  return tiles.map((t, i) => (best![i] >= 0 ? t : WALL))
}

// A floor for `depth`: caves on every third floor, rooms elsewhere. The start is in the first
// room (or anywhere in a cave) and the stairs are as far away as the floor allows.
export function makeFloor(rng: Rng, depth: number): Floor {
  let tiles: number[] | null = null
  let list: Room[] = []
  if (depth % 3 === 0) for (let i = 0; i < 20 && !tiles; i++) tiles = cave(rng)
  if (!tiles) ({ tiles, rooms: list } = rooms(rng))
  const floors = tiles.flatMap((t, i) => (t === FLOOR ? [i] : []))
  const first = list[0]
  const start = first ? idx(first.x + Math.floor(first.w / 2), first.y + Math.floor(first.h / 2)) : rng.pick(floors)
  const dist = distances(tiles, start)
  let stairs = start
  for (const i of floors) if (dist[i] > dist[stairs]) stairs = i
  tiles[stairs] = STAIRS
  return { tiles, rooms: list, start, stairs }
}
