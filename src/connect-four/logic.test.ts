import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COLS, ROWS, bestMove, drop, init, over, type State } from './logic.ts'

const play = (cols: number[], s: State = init()) => cols.reduce(drop, s)

test('discs stack from the bottom, and a full column refuses more', () => {
  let s = play([3, 3])
  assert.equal(s.board[(ROWS - 1) * COLS + 3], 1)
  assert.equal(s.board[(ROWS - 2) * COLS + 3], 2)
  s = play([3, 3, 3, 3], s)
  assert.equal(drop(s, 3), s)
})

test('four in a row wins, across, down and diagonally', () => {
  assert.equal(play([0, 0, 1, 1, 2, 2, 3]).winner, 1)
  assert.equal(play([0, 1, 0, 1, 0, 1, 0]).winner, 1)
  const diagonal = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3])
  assert.equal(diagonal.winner, 1)
  assert.equal(diagonal.line.length, 4)
  assert.ok(over(diagonal))
})

test('the computer takes a win, and blocks one', () => {
  // Player 1 has three across the bottom (columns 0–2) and it's player 2's turn: block at 3.
  assert.equal(bestMove(play([0, 0, 1, 1, 2]), 4), 3)
  // Player 1 to move with three in column 6 on top of each other: win there.
  assert.equal(bestMove(play([6, 0, 6, 1, 6, 5]), 4), 6)
})

test('the hard search answers quickly from the opening', () => {
  const t = performance.now()
  bestMove(init(), 8)
  assert.ok(performance.now() - t < 1500)
})
