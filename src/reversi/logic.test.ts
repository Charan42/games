import assert from 'node:assert/strict'
import { test } from 'node:test'
import { N, bestMove, count, flips, init, moves, play } from './logic.ts'

const at = (col: number, row: number) => row * N + col

test('black opens with four legal moves, and a move flips the trapped disc', () => {
  const s = init()
  assert.deepEqual(moves(s.board, 1).sort((a, b) => a - b), [at(3, 2), at(2, 3), at(5, 4), at(4, 5)])
  const next = play(s, at(3, 2))
  assert.deepEqual(next.flipped, [at(3, 3)])
  assert.equal(count(next.board, 1), 4)
  assert.equal(next.turn, 2)
  assert.equal(play(next, at(0, 0)), next) // not a legal move
})

test("lines don't wrap around the board's edge", () => {
  const board = Array(N * N).fill(0)
  board[at(7, 0)] = 2 // end of row 0 …
  board[at(0, 1)] = 1 // … and start of row 1: next to each other in the array, not on the board
  assert.deepEqual(flips(board, at(6, 0), 1), [])
})

test('a player with no move passes, and the game ends when nobody can move', () => {
  // Black takes the only move, which leaves white nothing: black goes again (or the game ends).
  const board = Array(N * N).fill(0)
  board[at(0, 0)] = 1
  board[at(1, 0)] = 2
  const s = play({ board, turn: 1, over: false, passed: false, last: -1, flipped: [] }, at(2, 0))
  assert.ok(s.over)
  assert.equal(count(s.board, 1), 3)
})

test('the computer grabs a corner when it can', () => {
  // A diagonal of white, black, white, black, white: white at the corner flips the black next to it.
  const board = Array(N * N).fill(0)
  ;[2, 1, 2, 1, 2].forEach((p, k) => (board[at(k + 1, k + 1)] = p))
  board[at(1, 1)] = 1
  board[at(2, 2)] = 2
  const s = { board, turn: 2 as const, over: false, passed: false, last: -1, flipped: [] }
  assert.ok(moves(board, 2).includes(at(0, 0)))
  assert.equal(bestMove(s, 3), at(0, 0))
})

test('the hard search answers quickly', () => {
  let s = init()
  for (let i = 0; i < 10; i++) s = play(s, bestMove(s, 2))
  const t = performance.now()
  bestMove(s, 5, 0, 0, 10)
  assert.ok(performance.now() - t < 1500)
})
