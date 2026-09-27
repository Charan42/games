import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COLS, init, step, turn, type State } from './logic.ts'

const head = (s: State) => s.snake[0]

test('moves one cell per step and ignores turning back on itself', () => {
  const s = init(1)
  assert.deepEqual(head(step(turn(s, 'down'))), { x: head(s).x, y: head(s).y - 1 })
})

test('two quick turns are both applied, one per step', () => {
  let s = turn(turn(init(1), 'left'), 'down')
  s = step(s)
  assert.equal(s.dir, 'left')
  s = step(s)
  assert.equal(s.dir, 'down')
})

test('eating grows the snake, scores, and puts new food on a free cell', () => {
  let s = init(1)
  s = step({ ...s, food: { x: head(s).x, y: head(s).y - 1 } })
  assert.equal(s.score, 1)
  assert.equal(s.snake.length, 4)
  assert.ok(!s.snake.some(c => c.x === s.food.x && c.y === s.food.y))
})

test('hitting a wall or its own body ends the game', () => {
  let s = turn(init(1), 'left')
  for (let i = 0; i < COLS; i++) s = step(s)
  assert.equal(s.alive, false)

  // Heading up with the body curled to the right: turning right bites it.
  const curled = { ...init(1), dir: 'up' as const, snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 }] }
  assert.equal(step(turn(curled, 'right')).alive, false)
})

test('the same seed and inputs replay the same game', () => {
  const play = () => {
    let s = init(42)
    for (const d of ['left', 'up', 'right', 'up'] as const) s = step(step(turn(s, d)))
    return s
  }
  assert.deepEqual(play(), play())
})
