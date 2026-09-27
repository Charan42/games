import { rand } from '../shared/rng.ts'

// Minesweeper. Mines are laid on the first reveal, away from that square and its neighbors,
// so the first tap always opens an area.
export const LEVELS = {
  easy: { cols: 9, rows: 9, mines: 10 },
  medium: { cols: 10, rows: 14, mines: 24 },
  hard: { cols: 12, rows: 18, mines: 42 },
}
export type Level = keyof typeof LEVELS

export interface State {
  cols: number
  rows: number
  mines: number
  seed: number
  mine: boolean[] // empty until the first reveal
  open: boolean[]
  flag: boolean[]
  near: number[] // mines touching each square
  boom: number // the mine that went off, or -1
  won: boolean
}

export function init(level: Level, seed: number): State {
  const { cols, rows, mines } = LEVELS[level]
  const n = cols * rows
  return { cols, rows, mines, seed, mine: [], open: Array(n).fill(false), flag: Array(n).fill(false), near: [], boom: -1, won: false }
}

export const over = (s: State) => s.won || s.boom >= 0

export function neighbors(s: State, i: number): number[] {
  const [x, y] = [i % s.cols, Math.floor(i / s.cols)]
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [nx, ny] = [x + dx, y + dy]
      if ((dx || dy) && nx >= 0 && nx < s.cols && ny >= 0 && ny < s.rows) out.push(ny * s.cols + nx)
    }
  return out
}

function lay(s: State, safe: number): State {
  const keepClear = new Set([safe, ...neighbors(s, safe)])
  const spots = [...s.open.keys()].filter(i => !keepClear.has(i))
  const mine = Array(s.open.length).fill(false)
  let seed = s.seed
  // Partial Fisher–Yates: the first `mines` spots of a shuffle.
  for (let k = 0; k < s.mines; k++) {
    const [r, next] = rand(seed)
    seed = next
    const j = k + Math.floor(r * (spots.length - k))
    ;[spots[k], spots[j]] = [spots[j], spots[k]]
    mine[spots[k]] = true
  }
  const withMines = { ...s, mine, seed }
  return { ...withMines, near: mine.map((_, i) => neighbors(withMines, i).filter(j => mine[j]).length) }
}

// Open a square. A zero opens its neighbors too, and so on (flood fill). Tapping an open
// number whose mines are all flagged opens the rest of its neighbors ("chording").
export function reveal(s: State, i: number): State {
  if (over(s) || s.flag[i]) return s
  if (!s.mine.length) s = lay(s, i)
  if (s.open[i]) {
    const around = neighbors(s, i)
    if (!s.near[i] || around.filter(j => s.flag[j]).length !== s.near[i]) return s
    return around.reduce((acc, j) => (acc.open[j] || acc.flag[j] ? acc : openFrom(acc, j)), s)
  }
  return openFrom(s, i)
}

function openFrom(s: State, i: number): State {
  if (over(s)) return s
  if (s.mine[i]) return { ...s, boom: i }
  const open = s.open.slice()
  const todo = [i]
  while (todo.length) {
    const j = todo.pop()!
    if (open[j] || s.flag[j]) continue
    open[j] = true
    if (s.near[j] === 0) todo.push(...neighbors(s, j))
  }
  const won = open.every((o, j) => o || s.mine[j])
  return { ...s, open, won }
}

export function toggleFlag(s: State, i: number): State {
  if (over(s) || s.open[i]) return s
  const flag = s.flag.slice()
  flag[i] = !flag[i]
  return { ...s, flag }
}

export const flagsLeft = (s: State) => s.mines - s.flag.filter(Boolean).length
