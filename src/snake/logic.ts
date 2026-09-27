import { DELTA, type Dir } from '../shared/input.ts'
import { rand } from '../shared/rng.ts'

export const COLS = 15
export const ROWS = 24 // portrait board: phones first

export type Cell = { x: number; y: number }

export interface State {
  snake: Cell[] // head first
  dir: Dir // direction of the last move
  queue: Dir[] // turns waiting for the next steps, so two quick swipes both count
  food: Cell
  seed: number
  score: number
  alive: boolean
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export function init(seed: number): State {
  const x = Math.floor(COLS / 2)
  const y = Math.floor(ROWS / 2)
  const snake = [{ x, y }, { x, y: y + 1 }, { x, y: y + 2 }]
  return placeFood({ snake, dir: 'up', queue: [], food: snake[0], seed, score: 0, alive: true })
}

export function turn(s: State, d: Dir): State {
  const last = s.queue.at(-1) ?? s.dir
  if (s.queue.length === 2 || d === last || d === OPPOSITE[last]) return s
  return { ...s, queue: [...s.queue, d] }
}

export function step(s: State): State {
  if (!s.alive) return s
  const [dir = s.dir, ...queue] = s.queue
  const head = { x: s.snake[0].x + DELTA[dir].x, y: s.snake[0].y + DELTA[dir].y }
  const eats = head.x === s.food.x && head.y === s.food.y
  const body = eats ? s.snake : s.snake.slice(0, -1) // the tail moves out of the way unless we grow
  const dead =
    head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || body.some(c => c.x === head.x && c.y === head.y)
  if (dead) return { ...s, dir, queue, alive: false }
  const next = { ...s, dir, queue, snake: [head, ...body] }
  return eats ? placeFood({ ...next, score: s.score + 1 }) : next
}

// Milliseconds per step. ponytail: linear speed-up per bite; tune after playtesting on a phone.
export const tickMs = (s: State) => Math.max(70, 150 - s.score * 3)

function placeFood(s: State): State {
  const free: Cell[] = []
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) if (!s.snake.some(c => c.x === x && c.y === y)) free.push({ x, y })
  if (!free.length) return { ...s, alive: false } // board full: nothing left to eat
  const [r, seed] = rand(s.seed)
  return { ...s, food: free[Math.floor(r * free.length)], seed }
}
