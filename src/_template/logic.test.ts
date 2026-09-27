import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COLS, ROWS, init, move } from './logic.ts'

test('stepping onto the dot scores and moves the dot off the player', () => {
  const s = init(7)
  const next = move({ ...s, dot: { x: s.player.x + 1, y: s.player.y } }, 'right')
  assert.equal(next.score, 1)
  assert.notDeepEqual(next.dot, next.player)
})

test('the player stays on the board', () => {
  let s = init(7)
  for (let i = 0; i < COLS + ROWS; i++) s = move(move(s, 'up'), 'left')
  assert.deepEqual(s.player, { x: 0, y: 0 })
})
