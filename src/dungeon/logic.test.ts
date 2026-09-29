import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FLOORS } from './data.ts'
import { fieldOfView } from './fov.ts'
import { DOOR, FLOOR, H, OPEN, Rng, STAIRS, W, WALL, distances, makeFloor, opaque } from './gen.ts'
import { here, itemName, newGame, step, travelStep, type Monster, type State } from './logic.ts'

// An open arena, walls only around the edge, with the player in the middle and nothing else.
function arena(seed = 1): State {
  const s = newGame(seed)
  s.tiles = Array.from({ length: W * H }, (_, i) => (i % W === 0 || i % W === W - 1 || i < W || i >= W * (H - 1) ? WALL : FLOOR))
  s.seen = Array(W * H).fill(1)
  ;[s.player.x, s.player.y] = [20, 15]
  s.monsters = []
  s.items = []
  s.log = []
  return step(s, { type: 'wait' }) // refresh what's visible
}
const monster = (s: State, kind: Monster['kind'], x: number, y: number, hp = 10): Monster => {
  const m: Monster = { id: s.nextId++, kind, x, y, hp, maxHp: hp, energy: 0, awake: true, noticed: true, target: -1, cooldown: 0 }
  s.monsters.push(m)
  return m
}

test('the same seed makes the same dungeon; another seed, another', () => {
  assert.deepEqual(newGame(42), newGame(42))
  assert.notDeepEqual(newGame(42).tiles, newGame(43).tiles)
})

test('every floor, rooms or caves, has a way from the start to the stairs', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = new Rng(seed)
    for (let depth = 1; depth <= FLOORS; depth++) {
      const f = makeFloor(rng, depth)
      assert.equal(f.tiles[f.stairs], STAIRS)
      assert.ok(f.stairs !== f.start)
      assert.ok(distances(f.tiles, f.start)[f.stairs] > 0, `seed ${seed} floor ${depth}`)
      // Nothing opens onto the outside.
      for (let x = 0; x < W; x++) assert.equal(f.tiles[x], WALL)
    }
  }
})

test('the last floor has the Amulet instead of stairs, and a dragon by it', () => {
  let s = newGame(7)
  for (let d = 2; d <= FLOORS; d++) {
    s.player.x = s.tiles.indexOf(STAIRS) % W
    s.player.y = Math.floor(s.tiles.indexOf(STAIRS) / W)
    s = step(s, { type: 'descend' })
    assert.equal(s.depth, d)
  }
  assert.equal(s.tiles.indexOf(STAIRS), -1)
  assert.ok(s.items.some(it => it.item.kind === 'amulet'))
  assert.ok(s.monsters.some(m => m.kind === 'dragon'))
})

test('walls and closed doors block sight; open doors don’t', () => {
  const tiles = Array(W * H).fill(FLOOR)
  const see = () => fieldOfView(W, H, i => opaque(tiles[i]), 5, 5, 8)
  assert.equal(see()[5 * W + 10], 1)
  tiles[5 * W + 7] = WALL
  assert.equal(see()[5 * W + 7], 1) // the wall itself is seen...
  assert.equal(see()[5 * W + 10], 0) // ...but not what's behind it
  tiles[5 * W + 7] = DOOR
  assert.equal(see()[5 * W + 10], 0)
  tiles[5 * W + 7] = OPEN
  assert.equal(see()[5 * W + 10], 1)
})

test('bumping a wall takes no time; a door opens on the first bump', () => {
  let s = arena()
  s.tiles[here(s) + 1] = WALL
  const bumped = step(s, { type: 'move', dx: 1, dy: 0 })
  assert.equal(bumped.clock, s.clock)
  s.tiles[here(s) + 1] = DOOR
  s = step(s, { type: 'move', dx: 1, dy: 0 })
  assert.equal(s.tiles[here(s) + 1], OPEN)
  assert.equal(s.player.x, 20)
  s = step(s, { type: 'move', dx: 1, dy: 0 })
  assert.equal(s.player.x, 21)
  // No diagonal steps out of (or into) a doorway.
  assert.equal(step(s, { type: 'move', dx: 1, dy: 1 }).clock, s.clock)
})

test('fighting: hits hurt, kills give experience, and enough of it levels you up', () => {
  const s = arena()
  s.player.str = 50 // one hit kills
  monster(s, 'orc', 21, 15)
  let next = s
  for (let i = 0; i < 5 && next.monsters.length; i++) next = step(next, { type: 'move', dx: 1, dy: 0 })
  assert.equal(next.monsters.length, 0)
  assert.equal(next.kills, 1)
  assert.equal(next.player.level, 2) // an orc is worth 12 xp; level 2 needs 10
  assert.ok(next.player.maxHp > s.player.maxHp)
})

test('an awake monster closes in and attacks', () => {
  let s = arena()
  monster(s, 'orc', 26, 15, 99)
  const hp = s.player.hp
  for (let i = 0; i < 12; i++) s = step(s, { type: 'wait' })
  const [m] = s.monsters
  assert.ok(Math.max(Math.abs(m.x - 20), Math.abs(m.y - 15)) === 1)
  assert.ok(s.player.hp < hp)
})

test('spiders are fast, slimes slow', () => {
  let s = arena()
  s.player.hp = s.player.maxHp = 999
  const spider = monster(s, 'spider', 26, 12, 99)
  const slime = monster(s, 'slime', 20, 21, 99)
  const gap = (id: number) => {
    const m = s.monsters.find(o => o.id === id)!
    return Math.max(Math.abs(m.x - 20), Math.abs(m.y - 15))
  }
  s = step(s, { type: 'wait' })
  assert.equal(gap(spider.id), 4) // two steps in one turn
  assert.equal(gap(slime.id), 6) // not yet
  s = step(s, { type: 'wait' })
  assert.equal(gap(slime.id), 5) // one step every other turn
})

test('potions are unknown until tried, then known by name', () => {
  let s = arena()
  s.player.pack = [{ item: { kind: 'potion', type: 'strength' }, count: 2 }]
  assert.match(itemName(s, s.player.pack[0].item), / potion$/)
  s = step(s, { type: 'use', index: 0 })
  assert.equal(s.player.str, 1)
  assert.equal(itemName(s, s.player.pack[0].item), 'potion of strength')
  // Healing heals, up to the maximum.
  s.player.hp = 5
  s.player.pack.push({ item: { kind: 'potion', type: 'healing' }, count: 1 })
  s = step(s, { type: 'use', index: 1 })
  assert.ok(s.player.hp > 5)
})

test('wielding swaps weapons through the pack; walking over items picks them up', () => {
  let s = arena()
  s.player.pack = []
  s.items.push({ at: here(s) + 1, item: { kind: 'weapon', index: 3, plus: 1 } }, { at: here(s) + 2, item: { kind: 'gold', amount: 30 } })
  s = step(s, { type: 'move', dx: 1, dy: 0 })
  s = step(s, { type: 'move', dx: 1, dy: 0 })
  assert.equal(s.gold, 30)
  assert.equal(itemName(s, s.player.pack[0].item), '+1 long sword')
  s = step(s, { type: 'use', index: 0 })
  assert.equal(s.player.weapon.index, 3)
  assert.equal(itemName(s, s.player.pack[0].item), 'dagger')
})

test('taking the Amulet wins; dying ends the game', () => {
  let s = arena()
  s.items.push({ at: here(s) + 1, item: { kind: 'amulet' } })
  s = step(s, { type: 'move', dx: 1, dy: 0 })
  assert.equal(s.over?.won, true)
  assert.equal(step(s, { type: 'wait' }), s)

  let d = arena()
  d.player.hp = 1
  monster(d, 'troll', 21, 15, 99)
  for (let i = 0; i < 30 && !d.over; i++) d = step(d, { type: 'wait' })
  assert.equal(d.over?.won, false)
  assert.match(d.over!.cause, /troll/)
})

test('travel finds a way around walls through explored squares', () => {
  const s = arena()
  for (let y = 5; y < 25; y++) s.tiles[y * W + 22] = WALL // a wall between here and there
  const target = 15 * W + 25
  let t = s
  for (let i = 0; i < 40 && here(t) !== target; i++) {
    const dir = travelStep(t, target)
    assert.ok(dir)
    t = step(t, { type: 'move', ...dir })
  }
  assert.equal(here(t), target)
})

test('replaying the same actions from the same seed gives the same game', () => {
  const play = () => {
    let s = newGame(99)
    const rng = new Rng(5)
    for (let i = 0; i < 300 && !s.over; i++) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
      const [dx, dy] = rng.pick(dirs)
      s = step(s, rng.chance(0.1) ? { type: 'wait' } : { type: 'move', dx, dy })
    }
    return s
  }
  assert.deepEqual(play(), play())
})
