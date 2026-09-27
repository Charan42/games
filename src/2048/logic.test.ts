import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SIZE, init, move, type State, type Tile } from './logic.ts'

// A board from rows of numbers (0 = empty), and back.
const board = (rows: number[][], seed = 1): State => ({
  tiles: rows.flatMap((row, y) => row.flatMap((value, x): Tile[] => (value ? [{ id: y * SIZE + x + 1, value, x, y }] : []))),
  score: 0,
  seed,
  nextId: 100,
  won: false,
  over: false,
})
const rows = (s: State, skipFresh = true) =>
  Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => s.tiles.find(t => t.x === x && t.y === y && !(skipFresh && t.fresh))?.value ?? 0),
  )

test('a new game has two tiles', () => {
  assert.equal(init(5).tiles.length, 2)
})

test('tiles slide and equal pairs merge once, nearest the wall first', () => {
  const s = move(board([[2, 2, 2, 2], [2, 2, 4, 0], [0, 4, 0, 4], [8, 0, 0, 8]]), 'left')
  assert.deepEqual(rows(s), [[4, 4, 0, 0], [4, 4, 0, 0], [8, 0, 0, 0], [16, 0, 0, 0]])
  assert.equal(s.score, 4 + 4 + 4 + 8 + 16)
  assert.equal(s.tiles.filter(t => t.fresh).length, 1)
  assert.deepEqual(rows(move(board([[0, 2, 2, 2]]), 'right')).slice(0, 1), [[0, 0, 2, 4]])
})

test('up and down move columns', () => {
  const s = move(board([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0]]), 'down')
  assert.deepEqual(rows(s).map(r => r[0]), [0, 0, 4, 4])
})

test("a move that changes nothing isn't a move", () => {
  const s = board([[2, 4, 0, 0]])
  assert.equal(move(s, 'left'), s)
})

test('the game ends when the board is full with no pairs', () => {
  // After sliding right, the only gap is at the bottom left, between a 16 and an 8: whatever
  // lands there (2 or 4) has no match anywhere.
  const s = move(board([[2, 4, 2, 4], [4, 2, 4, 2], [16, 4, 2, 4], [8, 16, 32, 0]]), 'right')
  assert.equal(s.tiles.length, 16)
  assert.ok(s.over)
  assert.ok(!move(board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]]), 'right').over) // a pair is left
})

test('making 2048 wins, and play goes on', () => {
  const s = move(board([[1024, 1024, 0, 0]]), 'left')
  assert.ok(s.won)
  assert.ok(!s.over)
})
