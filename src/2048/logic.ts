import type { Dir } from '../shared/input.ts'
import { rand } from '../shared/rng.ts'

// 2048: slide every tile as far as it goes; two equal tiles that meet merge into one worth
// double. Each move that changes the board adds a 2 (or, one time in ten, a 4).
export const SIZE = 4

export interface Tile {
  id: number
  value: number
  x: number
  y: number
  from?: [number, number] // the two tiles that merged into this one, for animating
  fresh?: boolean // just appeared
}

export interface State {
  tiles: Tile[]
  score: number
  seed: number
  nextId: number
  won: boolean // made 2048 (you can keep going)
  over: boolean // no move left
}

export function init(seed: number): State {
  return spawn(spawn({ tiles: [], score: 0, seed, nextId: 1, won: false, over: false }))
}

function spawn(s: State): State {
  const taken = new Set(s.tiles.map(t => t.y * SIZE + t.x))
  const empty = [...Array(SIZE * SIZE).keys()].filter(i => !taken.has(i))
  if (!empty.length) return s
  const [r1, s1] = rand(s.seed)
  const [r2, seed] = rand(s1)
  const i = empty[Math.floor(r1 * empty.length)]
  const tile = { id: s.nextId, value: r2 < 0.9 ? 2 : 4, x: i % SIZE, y: Math.floor(i / SIZE), fresh: true }
  return { ...s, tiles: [...s.tiles, tile], seed, nextId: s.nextId + 1 }
}

export function move(s: State, dir: Dir): State {
  if (s.over) return s
  // Walk each line from the side the tiles slide toward.
  const horizontal = dir === 'left' || dir === 'right'
  const toward = dir === 'left' || dir === 'up' ? 0 : SIZE - 1
  const back = toward ? -1 : 1
  let { nextId, score } = s
  const tiles: Tile[] = []
  let moved = false
  for (let line = 0; line < SIZE; line++) {
    const inLine = s.tiles
      .filter(t => (horizontal ? t.y : t.x) === line)
      .sort((a, b) => ((horizontal ? a.x : a.y) - (horizontal ? b.x : b.y)) * back)
    let pos = toward
    let prev: Tile | null = null // the last placed tile, if it may still merge
    for (const t of inLine) {
      const at = (p: number) => (horizontal ? { x: p, y: line } : { x: line, y: p })
      if (prev && prev.value === t.value && !prev.from) {
        const merged: Tile = { id: nextId++, value: t.value * 2, ...at(pos - back), from: [prev.id, t.id] }
        tiles[tiles.indexOf(prev)] = merged
        score += merged.value
        prev = null
        moved = true
      } else {
        const placed: Tile = { id: t.id, value: t.value, ...at(pos) }
        if (placed.x !== t.x || placed.y !== t.y) moved = true
        tiles.push(placed)
        prev = placed
        pos += back
      }
    }
  }
  if (!moved) return s
  const next = spawn({ ...s, tiles, score, nextId, won: s.won || tiles.some(t => t.value >= 2048) })
  return { ...next, over: !canMove(next.tiles) }
}

function canMove(tiles: Tile[]): boolean {
  if (tiles.length < SIZE * SIZE) return true
  const grid = new Map(tiles.map(t => [t.y * SIZE + t.x, t.value]))
  return tiles.some(
    t => (t.x + 1 < SIZE && grid.get(t.y * SIZE + t.x + 1) === t.value) || (t.y + 1 < SIZE && grid.get((t.y + 1) * SIZE + t.x) === t.value),
  )
}
