import { DELTA, type Dir } from '../shared/input.ts'
import { rand } from '../shared/rng.ts'

// Replace the rules, keep the shape: plain data in, plain data out, and randomness only
// through the seed in the state. That's what makes tests, replays and daily seeds possible.
export const COLS = 9
export const ROWS = 14

export type Cell = { x: number; y: number }

export interface State {
  player: Cell
  dot: Cell
  seed: number
  score: number
}

export function init(seed: number): State {
  return placeDot({ player: { x: 4, y: 7 }, dot: { x: 0, y: 0 }, seed, score: 0 })
}

export function move(s: State, d: Dir): State {
  const player = {
    x: Math.min(COLS - 1, Math.max(0, s.player.x + DELTA[d].x)),
    y: Math.min(ROWS - 1, Math.max(0, s.player.y + DELTA[d].y)),
  }
  const next = { ...s, player }
  return player.x === s.dot.x && player.y === s.dot.y ? placeDot({ ...next, score: s.score + 1 }) : next
}

// Any cell except the player's: pick one of the other COLS × ROWS − 1 cells.
function placeDot(s: State): State {
  const [r, seed] = rand(s.seed)
  let i = Math.floor(r * (COLS * ROWS - 1))
  if (i >= s.player.y * COLS + s.player.x) i++
  return { ...s, dot: { x: i % COLS, y: Math.floor(i / COLS) }, seed }
}
