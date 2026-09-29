import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LANE_W, TICKS, init, input, step, type Input, type State } from './logic.ts'

const run = (s: State, ticks: number, each?: (s: State) => Input | null) => {
  for (let i = 0; i < ticks && !s.over; i++) {
    const a = each?.(s)
    s = step(a ? input(s, a) : s)
  }
  return s
}
// A clear track with one obstacle right ahead, the runner up to speed.
function lone(kind: 'low' | 'high' | 'block', lane = 0, z = 20): State {
  const s = init(1)
  return { ...s, obstacles: [{ id: 999, kind, lane, z, len: kind === 'block' ? 1.4 : 0.5 }], pickups: [], powers: [], nextZ: 1e9 }
}
const ticksTo = (s: State, z: number) => Math.floor(((z - s.d) / s.speed) * TICKS)

// Plays like a careful person: keep to the lane that stays clear of trains and crates the
// longest (without swerving into something alongside), jump barriers, slide under bars.
function bot(s: State): Input | null {
  const clear = (lane: number) =>
    Math.min(...s.obstacles.filter(o => o.lane === lane && !o.broken && (o.kind === 'block' || o.kind === 'train') && o.z + o.len > s.d - 1).map(o => o.z - s.d), 999)
  if (clear(s.lane) < s.speed * 1.2 + 6) {
    const best = [-1, 0, 1].reduce((a, b) => (clear(b) > clear(a) || (clear(b) === clear(a) && Math.abs(b - s.lane) < Math.abs(a - s.lane)) ? b : a))
    const toward = s.lane + Math.sign(best - s.lane)
    if (best !== s.lane && clear(toward) > 1.5) return toward < s.lane ? 'left' : 'right'
  }
  const next = s.obstacles.filter(o => o.lane === s.lane && !o.broken && o.z + o.len > s.d - 0.4).sort((a, b) => a.z - b.z)[0]
  if (next?.kind === 'low' && next.z - s.d < s.speed * 0.12 + 0.6 && s.y === 0) return 'jump'
  if (next?.kind === 'high' && next.z - s.d < s.speed * 0.1 + 1 && !s.sliding) return 'slide'
  return null
}

test('the same seed lays the same track', () => {
  assert.deepEqual(run(init(7), 600), run(init(7), 600))
  assert.notDeepEqual(init(7).obstacles, init(8).obstacles)
})

test('there is always a lane without a train or crates in it', () => {
  let s = init(3)
  for (let i = 0; i < 20; i++) {
    s = { ...s, d: s.d + 150, nextZ: s.nextZ }
    s = step(s)
    for (let z = s.d; z < s.d + 140; z += 0.5) {
      const solid = new Set(s.obstacles.filter(o => (o.kind === 'block' || o.kind === 'train') && o.z - 0.5 <= z && z <= o.z + o.len + 0.5).map(o => o.lane))
      assert.ok(solid.size < 3, `all lanes blocked at ${z}`)
    }
  }
})

test('jump a low barrier, or hit it', () => {
  const s = lone('low')
  assert.ok(run(s, 120).over)
  const jumped = run(run(s, ticksTo(s, 20 - 2)), 1, () => 'jump')
  assert.ok(!run(jumped, 120).over)
})

test('slide under a bar; jumping into it is a crash', () => {
  const s = lone('high')
  assert.ok(run(s, 120).over)
  const near = run(s, ticksTo(s, 20 - 1.5))
  assert.ok(!run(input(near, 'slide'), 120).over)
  assert.ok(run(input(near, 'jump'), 120).over)
})

test('change lanes around crates; clip one sideways and you stumble back, twice and you crash', () => {
  const s = lone('block')
  assert.ok(run(s, 120).over)
  assert.ok(!run(input(s, 'left'), 120).over)
  // Level with the crates in the next lane, then swerve into them.
  const beside = { ...lone('block', 1, 5), d: 5.5 }
  const bounced = run(input(beside, 'right'), 20)
  assert.equal(bounced.over, false)
  assert.equal(bounced.lane, 0)
  assert.ok(bounced.stumble > 0)
  const again = { ...bounced, obstacles: [{ id: 5, kind: 'block' as const, lane: 1, z: bounced.d - 0.2, len: 1.4 }] }
  assert.ok(run(input(again, 'right'), 20).over)
})

test('a shield takes one crash', () => {
  const s = { ...lone('block'), shield: 600 }
  const after = run(s, 120)
  assert.equal(after.over, false)
  assert.equal(after.shield, 0)
})

test('coins in your lane count; with the magnet, the next lanes’ do too', () => {
  const s = { ...lone('low', 1, 999), pickups: [{ id: 1, lane: 0, z: 10, y: 0.9 }, { id: 2, lane: -1, z: 12, y: 0.9 }] }
  assert.equal(run(s, 90).coins, 1)
  assert.equal(run({ ...s, magnet: 600 }, 90).coins, 2)
  assert.ok(run({ ...s, magnet: 600, double: 600 }, 90).score > run({ ...s, magnet: 600 }, 90).score)
})

test('a careful runner can get 3 km on any track: it is never impossible', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = run(init(seed * 101), 60 * 60 * 4, bot)
    assert.ok(!s.over || s.d > 3000, `seed ${seed}: crashed at ${Math.round(s.d)} m`)
  }
})

test('it speeds up, but not forever', () => {
  const s = run(init(2), 60 * 30, bot)
  assert.ok(s.speed > init(2).speed)
  assert.ok(s.speed < 33)
  assert.equal(Math.round(LANE_W * 10), 24)
})
