import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEVELS, init, neighbors, over, reveal, toggleFlag, type State } from './logic.ts'

test('the first tap is never a mine, and opens an area', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = reveal(init('hard', seed), 50)
    assert.equal(s.boom, -1)
    assert.equal(s.mine.filter(Boolean).length, LEVELS.hard.mines)
    assert.ok(s.open.filter(Boolean).length >= 9)
  }
})

test('the same seed lays the same mines', () => {
  assert.deepEqual(reveal(init('easy', 7), 40).mine, reveal(init('easy', 7), 40).mine)
})

test('numbers count the touching mines', () => {
  const s = reveal(init('medium', 3), 0)
  s.near.forEach((n, i) => assert.equal(n, neighbors(s, i).filter(j => s.mine[j]).length))
})

test('stepping on a mine ends the game; opening every safe square wins', () => {
  const s = reveal(init('easy', 11), 40)
  const mine = s.mine.indexOf(true)
  assert.ok(over(reveal(s, mine)))
  const cleared = s.mine.reduce((acc: State, m, i) => (m ? acc : reveal(acc, i)), s)
  assert.ok(cleared.won)
})

test('flags block opening, and chording opens around a satisfied number', () => {
  let s = reveal(init('easy', 5), 40)
  const mine = s.mine.indexOf(true)
  assert.equal(reveal(toggleFlag(s, mine), mine).boom, -1)
  // Find an open number, flag all its mines, and chord it: every neighbor ends up open or flagged.
  const n = s.open.findIndex((o, i) => o && s.near[i] > 0 && neighbors(s, i).some(j => !s.open[j]))
  for (const j of neighbors(s, n)) if (s.mine[j]) s = toggleFlag(s, j)
  s = reveal(s, n)
  assert.equal(s.boom, -1)
  assert.ok(neighbors(s, n).every(j => s.open[j] || s.flag[j]))
})
