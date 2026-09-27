import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LINES, SIDES, bestLine, draw, init, over, type State } from './logic.ts'

const drawAll = (lines: number[], s: State = init()) => lines.reduce(draw, s)

test('the fourth side takes the box and the same player goes again', () => {
  const [top, bottom, left, right] = SIDES[0]
  let s = drawAll([top, bottom, left])
  assert.equal(s.turn, 2) // three turns: 1, 2, 1, so it's 2's move
  s = draw(s, right)
  assert.equal(s.boxes[0], 2)
  assert.deepEqual(s.score, [0, 0, 1])
  assert.equal(s.turn, 2)
  assert.equal(draw(s, right), s) // already drawn
})

test('one line can close two boxes', () => {
  const shared = SIDES[0][3] // right side of box 0 is the left side of box 1
  const others = [...SIDES[0], ...SIDES[1]].filter(e => e !== shared)
  const s = draw(drawAll(others), shared)
  assert.equal(s.score[1] + s.score[2], 2)
})

test('the game ends when every line is drawn, with every box taken', () => {
  const s = drawAll(Array.from({ length: LINES }, (_, e) => e))
  assert.ok(over(s))
  assert.equal(s.score[1] + s.score[2], SIDES.length)
})

test('the computer takes a free box, and otherwise avoids giving one', () => {
  const [top, bottom, left, right] = SIDES[0]
  assert.equal(bestLine(drawAll([top, bottom, left]), true, 0), right)
  // Box 0 has two sides: drawing either of the other two would hand it over.
  const s = drawAll([top, bottom])
  for (const luck of [0, 0.3, 0.6, 0.99]) assert.ok(![left, right].includes(bestLine(s, true, luck)))
})
