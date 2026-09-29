import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENEMIES, H, W, idle, init, step, type Controls, type Enemy, type State } from './logic.ts'

const run = (s: State, ticks: number, c: Controls | ((s: State) => Controls) = idle) => {
  for (let i = 0; i < ticks && !s.over; i++) s = step(s, typeof c === 'function' ? c(s) : c)
  return s
}
// A quiet field: no waves coming, nothing on screen, and not invulnerable.
const quiet = (seed = 1): State => {
  const s = init(seed)
  return { ...s, script: [], phase: 'clear', clearTicks: 1e9, player: { ...s.player, invuln: 0 } }
}
const enemy = (s: State, kind: Enemy['kind'], x: number, y: number): Enemy => ({
  id: s.nextId++, kind, x, y, hp: ENEMIES[kind].hp, maxHp: ENEMIES[kind].hp, t: 200, path: 0, x0: x, dir: 1, cd: 999, spin: 0, flash: 0,
})

test('the same seed and inputs replay the same game', () => {
  const wiggle = (s: State): Controls => ({ dx: Math.sin(s.tick / 20) * 5, dy: Math.cos(s.tick / 31) * 3, bomb: s.tick === 400 })
  assert.deepEqual(run(init(9), 1500, wiggle), run(init(9), 1500, wiggle))
})

test('the ship follows the finger, but no faster than its top speed, and stays on the field', () => {
  const s = quiet()
  const moved = step(s, { dx: 5, dy: -3, bomb: false })
  assert.equal(moved.player.x, s.player.x + 5)
  assert.equal(moved.player.y, s.player.y - 3)
  const flung = step(s, { dx: 300, dy: 0, bomb: false })
  assert.ok(flung.player.x - s.player.x <= 14.01)
  const far = run(s, 100, { dx: -20, dy: 20, bomb: false })
  assert.ok(far.player.x >= 10 && far.player.y <= H - 16)
})

test('shots destroy an enemy for points and medals', () => {
  const s = quiet()
  s.enemies = [enemy(s, 'drone', s.player.x, s.player.y - 200)]
  const after = run(s, 40)
  assert.equal(after.enemies.filter(e => e.kind === 'drone').length, 0)
  assert.ok(after.score >= ENEMIES.drone.score)
  assert.ok(after.items.some(i => i.kind === 'medal') || after.chain > 0)
})

test('a bullet on the hitbox costs a life, clears the screen and brings you back protected', () => {
  const s = quiet()
  s.bullets = [{ x: s.player.x, y: s.player.y - 3, vx: 0, vy: 2, r: 4, color: 0 }, { x: 20, y: 20, vx: 0, vy: 0, r: 4, color: 0 }]
  const hit = step(s, idle)
  assert.equal(hit.player.lives, s.player.lives - 1)
  assert.equal(hit.bullets.length, 0)
  const back = run(hit, 80)
  assert.equal(back.player.x, W / 2)
  assert.ok(back.player.invuln > 0)
})

test('a bullet that passes close grazes, once', () => {
  const s = quiet()
  s.bullets = [{ x: s.player.x + 12, y: s.player.y - 40, vx: 0, vy: 3, r: 4, color: 0 }]
  const after = run(s, 30)
  assert.equal(after.graze, 1)
  assert.equal(after.player.lives, s.player.lives)
})

test('a bomb clears the bullets into medals and costs one bomb', () => {
  const s = quiet()
  s.bullets = Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 10, y: 100, vx: 0, vy: 1, r: 4, color: 0 }))
  const after = step(s, { dx: 0, dy: 0, bomb: true })
  assert.equal(after.player.bombs, s.player.bombs - 1)
  assert.equal(after.bullets.length, 0)
  assert.ok(after.items.filter(i => i.kind === 'medal').length >= 30)
  assert.equal(step(after, { dx: 0, dy: 0, bomb: true }).player.bombs, after.player.bombs) // one at a time
})

test('after the waves comes a boss, and beating it starts the next stage', () => {
  // An untouchable ship that stays under the nearest enemy, firing.
  const hunt = (s: State): Controls => {
    s.player.invuln = 999
    const target = s.enemies.filter(e => e.y > 0).sort((a, b) => b.y - a.y)[0]
    return { dx: target ? Math.max(-6, Math.min(6, target.x - s.player.x)) : 0, dy: 0, bomb: false }
  }
  let s = init(4)
  s.player.power = 5
  s = run(s, 60 * 90, hunt)
  assert.ok(s.stage >= 2 || s.phase === 'boss', `stage ${s.stage}, phase ${s.phase}`)
  s = run(s, 60 * 90, hunt)
  assert.ok(s.stage >= 2)
})

test('the game ends when the last life is lost', () => {
  let s = quiet()
  s.player.lives = 0
  s.bullets = [{ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 4, color: 0 }]
  s = step(s, idle)
  assert.equal(s.over, true)
  assert.equal(step(s, idle), s)
})
