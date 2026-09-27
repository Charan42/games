import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COLS, ENEMIES, FIRST_WAVE, ON_PATH, PATH_LENGTH, ROWS, TOWERS, along, build, callWave, init, refund, sell, step, upgrade,
  type State,
} from './logic.ts'

const run = (s: State, ticks: number) => {
  for (let i = 0; i < ticks; i++) s = step(s)
  return s
}
const free = [...Array(COLS * ROWS).keys()].filter(c => !ON_PATH.has(c))

test('the path is one connected walk from off the left edge to off the bottom', () => {
  assert.deepEqual(along(0), [-0.5, 1.5])
  assert.equal(along(PATH_LENGTH)[1], ROWS + 0.5)
  for (let d = 0; d < PATH_LENGTH; d += 0.25) {
    const [a, b] = [along(d), along(d + 0.25)]
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.26)
  }
})

test('towers go beside the path, never on it, and only if you can pay', () => {
  const s = init()
  assert.equal(build(s, [...ON_PATH][0], 'gun'), s)
  const built = build(s, free[0], 'gun')
  assert.equal(built.gold, s.gold - TOWERS.gun.cost)
  assert.equal(build(built, free[0], 'gun'), built) // taken
  const broke = { ...s, gold: 10 }
  assert.equal(build(broke, free[0], 'gun'), broke)
})

test('upgrades cost gold, and selling pays back part of everything spent', () => {
  let s = build({ ...init(), gold: 1000 }, free[0], 'cannon')
  s = upgrade(s, free[0])
  assert.equal(s.towers[0].level, 2)
  const spent = s.towers[0].spent
  const gold = s.gold
  s = sell(s, free[0])
  assert.equal(s.towers.length, 0)
  assert.equal(s.gold, gold + refund({ ...s.towers[0], spent } as never))
})

test('an undefended wave walks through and costs lives; calling it early pays', () => {
  let s = callWave(init())
  assert.equal(s.gold, init().gold + FIRST_WAVE / 60)
  // Wave 1 is seven grunts; by 30 s they're all through, and wave 2 (due at 25 s) isn't yet.
  s = run(s, 30 * 60)
  assert.equal(s.lives, 20 - 7)
})

test('guns along the path stop the first wave and earn gold', () => {
  let s = { ...init(), gold: 1000 }
  // Guns in the column between the first two runs of the path.
  for (const cell of [2 * COLS + 2, 2 * COLS + 4, 2 * COLS + 6, 3 * COLS + 3]) s = build(s, cell, 'gun')
  const gold = s.gold
  s = run(callWave(s), 60 * 40)
  assert.equal(s.lives, 20)
  assert.ok(s.gold > gold + 6 * ENEMIES.grunt.reward)
})

test('the game ends when the lives run out', () => {
  const s = run({ ...init(), lives: 1 }, FIRST_WAVE + 60 * 40)
  assert.ok(s.over)
  assert.equal(step(s), s)
})
