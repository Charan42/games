// Dungeon: the rules. A game is plain data (State), and step(state, action) returns the next
// state, never changing the old one. All randomness comes from the seed in the state, so a
// seed and a list of actions always replay the same game, and today's dungeon is the same for
// everyone.
//
// Time runs in ticks: a normal action takes 10, a hasted one 5. Monsters gain energy at their
// speed and act whenever they have 10, so bats move twice for every step of yours and slimes
// every other step.
import {
  ARMORS, FLOORS, MONSTERS, POTIONS, POTION_LOOKS, SCROLLS, SYLLABLES, WEAPONS, xpFor,
  type Item, type MonsterKind, type PotionType, type ScrollType,
} from './data.ts'
import { fieldOfView } from './fov.ts'
import { DOOR, FLOOR, H, NEIGHBORS, OPEN, Rng, STAIRS, W, WALL, diagonalOk, distances, makeFloor, opaque, passable } from './gen.ts'

export interface Monster {
  id: number
  kind: MonsterKind
  x: number
  y: number
  hp: number
  maxHp: number
  energy: number
  awake: boolean
  noticed: boolean // the player has seen it at least once
  target: number // the square it's heading for (where it last saw you), or -1
  cooldown: number
  xp?: number // worth less than usual: a slime's halves share its experience
}
export interface Stack { item: Item; count: number }
export type Weapon = Extract<Item, { kind: 'weapon' }>
export type Armor = Extract<Item, { kind: 'armor' }>
export interface Player {
  x: number
  y: number
  hp: number
  maxHp: number
  level: number
  xp: number
  str: number // bonus damage from potions of strength
  weapon: Weapon
  armor: Armor | null
  pack: Stack[]
  haste: number // actions left, for each status
  blind: number
  poison: number
}
export type Tone = 'info' | 'good' | 'bad' | 'loot'
export interface Message { text: string; tone: Tone }
// What happened this step, for the renderer to animate. Squares are tile indices.
export type Event =
  | { type: 'hit'; at: number; amount: number; crit?: boolean }
  | { type: 'miss'; at: number }
  | { type: 'die'; at: number; color: string }
  | { type: 'shot'; from: number; to: number; color: string }
  | { type: 'burn'; at: number[] }
  | { type: 'heal'; at: number }
  | { type: 'level' }
  | { type: 'descend' }

export interface State {
  seed: number
  daily: string // the date, for today's dungeon; '' for a random one
  depth: number
  clock: number // ticks since the start
  tiles: number[]
  seen: number[] // 1 where the player remembers the map
  visible: number[] // 1 where the player can see right now
  player: Player
  monsters: Monster[]
  items: { at: number; item: Item }[]
  known: string[] // potion and scroll types tried so far, like 'potion:haste'
  looks: { potions: Record<PotionType, number>; scrolls: Record<ScrollType, string> }
  log: Message[]
  events: Event[]
  nextId: number
  kills: number
  gold: number
  over: null | { won: boolean; cause: string }
}

export type Action =
  | { type: 'move'; dx: number; dy: number } // also attacks, and opens doors
  | { type: 'wait' }
  | { type: 'descend' }
  | { type: 'use'; index: number } // drink, read, wield or wear from the pack
  | { type: 'drop'; index: number }

export const PACK_SIZE = 12
const SIGHT = 7
const at = (x: number, y: number) => y * W + x
const xy = (i: number): [number, number] => [i % W, Math.floor(i / W)]
export const here = (s: State) => at(s.player.x, s.player.y)
const an = (name: string) => (/^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`)
const cheb = (a: number, b: number) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)))

export function newGame(seed: number, daily = ''): State {
  const rng = new Rng(seed)
  const colors = POTION_LOOKS.map((_, i) => i)
  for (let i = colors.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[colors[i], colors[j]] = [colors[j], colors[i]]
  }
  const title = () => {
    const word = () => rng.pick(SYLLABLES) + rng.pick(SYLLABLES)
    return `${word()} ${word()}`.toUpperCase()
  }
  const s: State = {
    seed,
    daily,
    depth: 0,
    clock: 0,
    tiles: [],
    seen: [],
    visible: [],
    player: {
      x: 0, y: 0, hp: 30, maxHp: 30, level: 1, xp: 0, str: 0,
      weapon: { kind: 'weapon', index: 0, plus: 0 }, armor: null,
      pack: [{ item: { kind: 'potion', type: 'healing' }, count: 1 }],
      haste: 0, blind: 0, poison: 0,
    },
    monsters: [],
    items: [],
    known: ['potion:healing'], // you know the one you brought
    looks: {
      potions: Object.fromEntries(Object.keys(POTIONS).map((k, i) => [k, colors[i]])) as Record<PotionType, number>,
      scrolls: Object.fromEntries(Object.keys(SCROLLS).map(k => [k, title()])) as Record<ScrollType, string>,
    },
    log: [],
    events: [],
    nextId: 1,
    kills: 0,
    gold: 0,
    over: null,
  }
  enterFloor(s, rng, 1)
  say(s, `You enter the dungeon. The Amulet lies on floor ${FLOORS}.`)
  s.seed = rng.seed
  return s
}

// A date's dungeon: the same seed for everyone, all day.
export const dailySeed = (date: string) => [...date].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x5bd1e995) >>> 0, 0x2545f491)

export function step(prev: State, action: Action): State {
  if (prev.over) return prev
  const s = structuredClone(prev)
  s.events = []
  const rng = new Rng(s.seed)
  const cost = act(s, rng, action)
  if (cost) {
    look(s)
    passTime(s, rng, cost)
  }
  look(s)
  s.seed = rng.seed
  return s
}

function say(s: State, text: string, tone: Tone = 'info') {
  s.log.push({ text, tone })
  if (s.log.length > 60) s.log.shift()
}

// --- The player -------------------------------------------------------------------------------

function act(s: State, rng: Rng, a: Action): number {
  const p = s.player
  const cost = p.haste > 0 ? 5 : 10
  if (a.type === 'wait') return cost
  if (a.type === 'move') {
    const [nx, ny] = [p.x + a.dx, p.y + a.dy]
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || Math.max(Math.abs(a.dx), Math.abs(a.dy)) !== 1) return 0
    const i = at(nx, ny)
    const m = monsterAt(s, i)
    if (m && diagonalOk(s.tiles, p.x, p.y, a.dx, a.dy)) {
      attack(s, rng, m)
      return cost
    }
    if (m || !passable(s.tiles[i]) || !diagonalOk(s.tiles, p.x, p.y, a.dx, a.dy)) return 0
    if (s.tiles[i] === DOOR) {
      s.tiles[i] = OPEN
      return cost
    }
    ;[p.x, p.y] = [nx, ny]
    pickUp(s, i)
    if (s.tiles[i] === STAIRS && !s.over) say(s, 'Stairs lead down from here.')
    return cost
  }
  if (a.type === 'descend') {
    if (s.tiles[here(s)] !== STAIRS) {
      say(s, 'There are no stairs here.')
      return 0
    }
    enterFloor(s, rng, s.depth + 1)
    s.events.push({ type: 'descend' })
    say(s, s.depth === FLOORS ? 'The last floor. Something huge is breathing in the dark.' : `You descend to floor ${s.depth}.`)
    return 0 // a fresh floor: nobody has had a turn yet
  }
  const stack = p.pack[a.index]
  if (!stack) return 0
  if (a.type === 'drop') {
    if (s.items.some(it => it.at === here(s))) {
      say(s, 'There’s already something here.')
      return 0
    }
    s.items.push({ at: here(s), item: stack.item })
    say(s, `You drop ${itemName(s, stack.item)}.`)
    take(p, a.index)
    return cost
  }
  return use(s, rng, a.index) ? cost : 0
}

export const armorValue = (p: Player) => (p.armor ? ARMORS[p.armor.index].armor + p.armor.plus : 0)
export function damageRange(p: Player): [number, number] {
  const w = WEAPONS[p.weapon.index]
  const bonus = p.weapon.plus + p.str + Math.floor(p.level / 3)
  return [w.dmg[0] + bonus, w.dmg[1] + bonus]
}

function attack(s: State, rng: Rng, m: Monster) {
  const p = s.player
  const t = MONSTERS[m.kind]
  m.awake = true
  m.target = here(s)
  const chance = Math.min(97, Math.max(10, 80 + p.level * 2 + p.weapon.plus * 3 - t.armor * 2))
  if (!rng.chance(chance / 100)) {
    s.events.push({ type: 'miss', at: at(m.x, m.y) })
    say(s, `You miss the ${t.name}.`)
    return
  }
  const [lo, hi] = damageRange(p)
  const crit = rng.chance(0.08)
  const dmg = Math.max(1, rng.int(lo, hi) * (crit ? 2 : 1) - rng.int(0, t.armor))
  m.hp -= dmg
  s.events.push({ type: 'hit', at: at(m.x, m.y), amount: dmg, crit })
  if (m.hp <= 0) return kill(s, rng, m)
  say(s, crit ? `You hit the ${t.name} hard!` : `You hit the ${t.name}.`)
  if (t.splits && m.hp >= 4) {
    const spot = freeNear(s, at(m.x, m.y), false)
    if (spot >= 0) {
      const half = Math.floor(m.hp / 2)
      m.hp -= half
      m.maxHp = m.hp
      m.xp = Math.floor((m.xp ?? t.xp) / 2)
      const [x, y] = xy(spot)
      s.monsters.push({ ...m, id: s.nextId++, x, y, hp: half, maxHp: half, energy: 0 })
      say(s, `The ${t.name} splits in two!`, 'bad')
    }
  }
}

function kill(s: State, rng: Rng, m: Monster) {
  const t = MONSTERS[m.kind]
  const spot = at(m.x, m.y)
  s.monsters = s.monsters.filter(o => o !== m)
  s.events.push({ type: 'die', at: spot, color: t.color })
  say(s, `You kill the ${t.name}.`, 'good')
  s.kills++
  if (m.kind === 'dragon') {
    drop(s, spot, { kind: 'amulet' })
    say(s, 'The Amulet gleams where the dragon fell.', 'loot')
  } else if (rng.chance(0.16)) {
    drop(s, spot, randomItem(rng, s.depth))
  }
  gainXp(s, m.xp ?? t.xp)
}

function gainXp(s: State, xp: number) {
  const p = s.player
  p.xp += xp
  while (p.xp >= xpFor(p.level)) {
    p.level++
    p.maxHp += 7
    p.hp += 7
    s.events.push({ type: 'level' })
    say(s, `You reach level ${p.level}!`, 'good')
  }
}

function pickUp(s: State, i: number) {
  const found = s.items.find(it => it.at === i)
  if (!found) return
  const { item } = found
  const p = s.player
  if (item.kind === 'gold') {
    s.gold += item.amount
    say(s, `You pick up ${item.amount} gold.`, 'loot')
  } else if (item.kind === 'amulet') {
    s.over = { won: true, cause: `Took the Amulet on floor ${s.depth}` }
    say(s, 'You take the Amulet of the Deep. You win!', 'good')
  } else {
    const stack = p.pack.find(st => stacks(st.item, item))
    if (stack) stack.count++
    else if (p.pack.length >= PACK_SIZE) return say(s, `You see ${itemName(s, item)}, but your pack is full.`)
    else p.pack.push({ item, count: 1 })
    say(s, `You pick up ${itemName(s, item)}.`, 'loot')
  }
  s.items = s.items.filter(it => it !== found)
}

const stacks = (a: Item, b: Item) => (a.kind === 'potion' || a.kind === 'scroll') && a.kind === b.kind && a.type === (b as typeof a).type

function take(p: Player, index: number) {
  if (--p.pack[index].count <= 0) p.pack.splice(index, 1)
}

function use(s: State, rng: Rng, index: number) {
  const p = s.player
  const item = p.pack[index].item
  if (item.kind === 'weapon') {
    take(p, index)
    p.pack.push({ item: p.weapon, count: 1 })
    p.weapon = item
    say(s, `You wield ${itemName(s, item)}.`)
    return true
  }
  if (item.kind === 'armor') {
    take(p, index)
    if (p.armor) p.pack.push({ item: p.armor, count: 1 })
    p.armor = item
    say(s, `You put on ${itemName(s, item)}.`)
    return true
  }
  if (item.kind === 'potion') {
    take(p, index)
    identify(s, item)
    const heal = (n: number) => {
      p.hp = Math.min(p.maxHp, p.hp + n)
      s.events.push({ type: 'heal', at: here(s) })
    }
    switch (item.type) {
      case 'healing':
        heal(Math.max(12, Math.round(p.maxHp * 0.45)))
        p.poison = p.blind = 0
        say(s, 'You feel much better.', 'good')
        break
      case 'strength':
        p.str++
        say(s, 'You feel stronger!', 'good')
        break
      case 'haste':
        p.haste = 24
        say(s, 'Everything around you slows down.', 'good')
        break
      case 'toughness':
        p.maxHp += 5
        heal(5)
        say(s, 'You feel tougher.', 'good')
        break
      case 'blindness':
        p.blind = 18
        say(s, 'Darkness falls over your eyes!', 'bad')
        break
    }
    return true
  }
  if (item.kind === 'scroll') {
    take(p, index)
    identify(s, item)
    switch (item.type) {
      case 'teleport': {
        const spots = s.tiles.flatMap((t, i) => (t === FLOOR && !s.visible[i] && !monsterAt(s, i) ? [i] : []))
        if (spots.length) [p.x, p.y] = xy(rng.pick(spots))
        say(s, 'The world twists, and you are somewhere else.')
        break
      }
      case 'mapping':
        s.tiles.forEach((t, i) => {
          const [x, y] = xy(i)
          const nearOpen = NEIGHBORS.some(([dx, dy]) => passable(s.tiles[at(x + dx, y + dy)] ?? WALL))
          if (t !== WALL || nearOpen) s.seen[i] = 1
        })
        say(s, 'A map of this floor forms in your mind.', 'good')
        break
      case 'fire': {
        const targets = s.monsters.filter(m => s.visible[at(m.x, m.y)])
        s.events.push({ type: 'burn', at: targets.map(m => at(m.x, m.y)) })
        if (!targets.length) say(s, 'The scroll bursts into flames, harming nothing.')
        else say(s, 'Fire roars out from the scroll!', 'good')
        for (const m of targets) {
          const dmg = rng.int(9, 15)
          m.hp -= dmg
          m.awake = true
          s.events.push({ type: 'hit', at: at(m.x, m.y), amount: dmg })
          if (m.hp <= 0) kill(s, rng, m)
        }
        break
      }
      case 'enchant': {
        const target = p.armor && p.armor.plus < p.weapon.plus ? p.armor : p.weapon
        target.plus++
        say(s, `Your ${itemName(s, { ...target, plus: 0 })} glows blue for a moment.`, 'good')
        break
      }
    }
    return true
  }
  return false
}

function identify(s: State, item: Item & { type: string }) {
  const key = `${item.kind}:${item.type}`
  if (!s.known.includes(key)) {
    s.known.push(key)
    say(s, `It was ${an(itemName(s, item))}.`)
  }
}

export function itemName(s: State, item: Item, count = 1): string {
  const many = count > 1
  switch (item.kind) {
    case 'potion':
      if (s.known.includes(`potion:${item.type}`)) return `${many ? `${count} potions` : 'potion'} of ${POTIONS[item.type].name}`
      return `${many ? `${count} ` : ''}${POTION_LOOKS[s.looks.potions[item.type]].name} potion${many ? 's' : ''}`
    case 'scroll':
      if (s.known.includes(`scroll:${item.type}`)) return `${many ? `${count} scrolls` : 'scroll'} of ${SCROLLS[item.type].name}`
      return `${many ? `${count} scrolls` : 'scroll'} titled “${s.looks.scrolls[item.type]}”`
    case 'weapon':
      return `${item.plus ? `+${item.plus} ` : ''}${WEAPONS[item.index].name}`
    case 'armor':
      return `${item.plus ? `+${item.plus} ` : ''}${ARMORS[item.index].name}`
    case 'gold':
      return `${item.amount} gold`
    case 'amulet':
      return 'the Amulet of the Deep'
  }
}

// --- Time passing: monsters, poison, healing ---------------------------------------------------

const REGEN_TICKS = (level: number) => Math.max(30, 110 - level * 8)
const WANDER_TICKS = 1500

function passTime(s: State, rng: Rng, cost: number) {
  const p = s.player
  const before = s.clock
  s.clock += cost
  const crossed = (every: number) => Math.floor(s.clock / every) > Math.floor(before / every)

  const flow = distances(s.tiles, here(s))
  const sight = fieldOfView(W, H, i => opaque(s.tiles[i]), p.x, p.y, SIGHT + 1)
  for (const m of [...s.monsters]) {
    m.energy += (MONSTERS[m.kind].speed * cost) / 10
    while (m.energy >= 10 && m.hp > 0 && !s.over && s.monsters.includes(m)) {
      m.energy -= 10
      monsterTurn(s, rng, m, flow, sight)
    }
  }

  if (p.poison > 0) {
    p.poison--
    p.hp -= 1
    if (p.hp <= 0 && !s.over) die(s, `Died of poison on floor ${s.depth}`)
  } else if (crossed(REGEN_TICKS(p.level)) && p.hp < p.maxHp) p.hp++
  if (p.haste > 0 && --p.haste === 0) say(s, 'You slow down again.')
  if (p.blind > 0 && --p.blind === 0) say(s, 'You can see again.', 'good')

  // Now and then, something new wanders in from somewhere you can't see.
  if (crossed(WANDER_TICKS) && rng.chance(0.5) && s.monsters.length < 18) {
    const spots = s.tiles.flatMap((t, i) => (t === FLOOR && !sight[i] && !monsterAt(s, i) ? [i] : []))
    if (spots.length) spawn(s, rng, rng.pick(spots), pickKind(rng, s.depth), true)
  }
}

function die(s: State, cause: string) {
  s.player.hp = 0
  s.over = { won: false, cause }
  say(s, 'You die…', 'bad')
}

function monsterTurn(s: State, rng: Rng, m: Monster, flow: Int16Array, sight: Uint8Array) {
  const t = MONSTERS[m.kind]
  const p = s.player
  const me = at(m.x, m.y)
  const you = here(s)
  const sees = sight[me] === 1
  const d = cheb(me, you)
  if (!m.awake) {
    if (sees && rng.chance(d <= 2 ? 0.6 : 0.2)) {
      m.awake = true
      if (s.visible[me]) say(s, `The ${t.name} notices you.`)
    }
    return
  }
  if (sees) m.target = you
  if (t.regen && m.hp < m.maxHp) m.hp++
  if (m.cooldown > 0) m.cooldown--

  if (t.erratic && rng.chance(0.5)) return wander(s, rng, m)
  if (t.breath && sees && d >= 2 && d <= 6 && !m.cooldown && rng.chance(0.4)) {
    m.cooldown = 5
    const dmg = rng.int(10, 17)
    p.hp -= dmg
    s.events.push({ type: 'shot', from: me, to: you, color: '#fb923c' }, { type: 'burn', at: [you] }, { type: 'hit', at: you, amount: dmg })
    say(s, `The ${t.name} breathes fire! (${dmg})`, 'bad')
    if (p.hp <= 0) die(s, `Burned by the dragon on floor ${s.depth}`)
    return
  }
  if (t.ranged && sees && d >= 2 && d <= t.ranged && clearShot(s, me, you)) {
    s.events.push({ type: 'shot', from: me, to: you, color: '#fde68a' })
    return strike(s, rng, m, 'shoots')
  }
  if (d === 1 && diagonalOk(s.tiles, m.x, m.y, p.x - m.x, p.y - m.y)) return strike(s, rng, m, 'hits')
  if (m.target >= 0) {
    const field = m.target === you ? flow : distances(s.tiles, m.target)
    if (!stepAlong(s, m, field) || at(m.x, m.y) === m.target) {
      if (m.target !== you) m.target = -1 // got there, or can't: give up the chase
    }
    return
  }
  if (rng.chance(0.3)) wander(s, rng, m)
}

function strike(s: State, rng: Rng, m: Monster, verb: string) {
  const t = MONSTERS[m.kind]
  const p = s.player
  const you = here(s)
  const armor = armorValue(p)
  if (!rng.chance(Math.max(20, t.hit - armor * 3) / 100)) {
    s.events.push({ type: 'miss', at: you })
    return
  }
  const dmg = Math.max(1, rng.int(t.dmg[0], t.dmg[1]) - rng.int(0, armor))
  p.hp -= dmg
  s.events.push({ type: 'hit', at: you, amount: dmg })
  say(s, `The ${t.name} ${verb} you. (${dmg})`, 'bad')
  if (t.poison && rng.chance(0.4)) {
    p.poison = Math.min(12, p.poison + 4)
    say(s, 'You are poisoned!', 'bad')
  }
  if (t.drain) m.hp = Math.min(m.maxHp, m.hp + dmg)
  if (p.hp <= 0) die(s, `Killed by ${an(t.name)} on floor ${s.depth}`)
}

// One step downhill on a distance map, onto a free square; opening a door costs the step.
function stepAlong(s: State, m: Monster, field: Int16Array) {
  const me = at(m.x, m.y)
  let best = -1
  for (const [dx, dy] of NEIGHBORS) {
    const [nx, ny] = [m.x + dx, m.y + dy]
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
    const n = at(nx, ny)
    if (field[n] < 0 || field[n] >= field[me] || n === here(s) || monsterAt(s, n)) continue
    if (!diagonalOk(s.tiles, m.x, m.y, dx, dy)) continue
    if (best < 0 || field[n] < field[best]) best = n
  }
  if (best < 0) return false
  if (s.tiles[best] === DOOR) s.tiles[best] = OPEN
  else [m.x, m.y] = xy(best)
  return true
}

function wander(s: State, rng: Rng, m: Monster) {
  const [dx, dy] = rng.pick(NEIGHBORS)
  const n = at(m.x + dx, m.y + dy)
  if (passable(s.tiles[n]) && s.tiles[n] !== DOOR && n !== here(s) && !monsterAt(s, n) && diagonalOk(s.tiles, m.x, m.y, dx, dy)) {
    ;[m.x, m.y] = xy(n)
  }
}

// Nothing solid between two squares (walking a straight line from one to the other).
function clearShot(s: State, from: number, to: number) {
  let [x, y] = xy(from)
  const [tx, ty] = xy(to)
  const [dx, dy] = [Math.abs(tx - x), -Math.abs(ty - y)]
  const [sx, sy] = [x < tx ? 1 : -1, y < ty ? 1 : -1]
  let err = dx + dy
  while (x !== tx || y !== ty) {
    const e2 = 2 * err
    if (e2 >= dy) (err += dy), (x += sx)
    if (e2 <= dx) (err += dx), (y += sy)
    const i = at(x, y)
    if (i === to) return true
    if (opaque(s.tiles[i]) || monsterAt(s, i)) return false
  }
  return true
}

// --- Floors ----------------------------------------------------------------------------------

function enterFloor(s: State, rng: Rng, depth: number) {
  const f = makeFloor(rng, depth)
  s.depth = depth
  s.tiles = f.tiles
  s.seen = Array(W * H).fill(0)
  s.monsters = []
  s.items = []
  ;[s.player.x, s.player.y] = xy(f.start)
  const dist = distances(s.tiles, f.start)
  const open = s.tiles.flatMap((t, i) => (t === FLOOR && dist[i] > 5 ? [i] : []))

  if (depth === FLOORS) {
    // No way further down: the Amulet lies where the stairs would be, a dragon asleep beside it.
    s.tiles[f.stairs] = FLOOR
    s.items.push({ at: f.stairs, item: { kind: 'amulet' } })
    const lair = freeNear(s, f.stairs, false)
    spawn(s, rng, lair >= 0 ? lair : f.stairs, 'dragon', false)
  }
  // Caves are open ground where everything can reach you at once, so they hold fewer monsters.
  const count = Math.round(Math.min(14, 3 + depth + rng.int(0, 2)) * (f.rooms.length ? 1 : 0.7))
  for (let n = 0; n < count && open.length; n++) {
    const i = open.splice(rng.int(0, open.length - 1), 1)[0]
    if (!monsterAt(s, i)) spawn(s, rng, i, pickKind(rng, depth), rng.chance(0.35))
  }
  const loot = rng.int(4, 6)
  const floors = s.tiles.flatMap((t, i) => (t === FLOOR && i !== f.start ? [i] : []))
  for (let n = 0; n < loot; n++) {
    const i = rng.pick(floors)
    if (!s.items.some(it => it.at === i)) s.items.push({ at: i, item: randomItem(rng, depth) })
  }
  look(s)
}

function pickKind(rng: Rng, depth: number): MonsterKind {
  const kinds = (Object.keys(MONSTERS) as MonsterKind[]).filter(k => MONSTERS[k].depth[0] <= depth && depth <= MONSTERS[k].depth[1])
  // Newer arrivals are commoner than the stragglers from shallower floors.
  const weights = kinds.map(k => 1 + Math.max(0, 3 - (depth - MONSTERS[k].depth[0])))
  let r = rng.next() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < kinds.length; i++) if ((r -= weights[i]) < 0) return kinds[i]
  return kinds[0]
}

function spawn(s: State, rng: Rng, i: number, kind: MonsterKind, awake: boolean) {
  const t = MONSTERS[kind]
  const [x, y] = xy(i)
  const hp = t.hp + (kind === 'dragon' ? 0 : rng.int(0, Math.floor(t.hp / 4)))
  s.monsters.push({ id: s.nextId++, kind, x, y, hp, maxHp: hp, energy: rng.int(0, 9), awake, noticed: false, target: -1, cooldown: 0 })
}

function weighted<K extends string>(rng: Rng, table: Record<K, { weight: number }>): K {
  const keys = Object.keys(table) as K[]
  let r = rng.next() * keys.reduce((sum, k) => sum + table[k].weight, 0)
  for (const k of keys) if ((r -= table[k].weight) < 0) return k
  return keys[0]
}

export function randomItem(rng: Rng, depth: number): Item {
  const r = rng.next()
  const plus = () => (rng.chance(0.2 + depth * 0.03) ? (rng.chance(depth / 16) ? 2 : 1) : 0)
  // Gear: one of the two best kinds this floor allows.
  const tier = (list: readonly { depth: number }[]) => {
    const ok = list.flatMap((g, i) => (g.depth <= depth ? [i] : []))
    return ok[Math.max(0, ok.length - 1 - rng.int(0, 1))]
  }
  if (r < 0.38) return { kind: 'potion', type: weighted(rng, POTIONS) }
  if (r < 0.6) return { kind: 'scroll', type: weighted(rng, SCROLLS) }
  if (r < 0.8) return { kind: 'gold', amount: rng.int(4, 12) * (depth + 1) }
  if (r < 0.9) return { kind: 'weapon', index: Math.max(1, tier(WEAPONS)), plus: plus() }
  return { kind: 'armor', index: tier(ARMORS) ?? 0, plus: plus() }
}

function drop(s: State, near: number, item: Item) {
  const spot = freeNear(s, near, true)
  if (spot >= 0) s.items.push({ at: spot, item })
}

// The closest open floor square to `i` (itself included) with no monster, and no item if
// `forItem`. BFS outward, so it never lands behind a wall.
function freeNear(s: State, i: number, forItem: boolean) {
  const dist = distances(s.tiles, i)
  let best = -1
  for (let j = 0; j < W * H; j++) {
    if (dist[j] < 0 || s.tiles[j] === DOOR || s.tiles[j] === OPEN) continue
    if (forItem ? s.items.some(it => it.at === j) : monsterAt(s, j) || j === here(s) || j === i) continue
    if (best < 0 || dist[j] < dist[best]) best = j
  }
  return best
}

export const monsterAt = (s: State, i: number) => s.monsters.find(m => at(m.x, m.y) === i)

// What the player can see, and news of monsters seen for the first time.
function look(s: State) {
  const p = s.player
  const v = fieldOfView(W, H, i => opaque(s.tiles[i]), p.x, p.y, p.blind > 0 ? 1 : SIGHT)
  s.visible = Array.from(v)
  v.forEach((on, i) => on && (s.seen[i] = 1))
  for (const m of s.monsters) {
    if (!m.noticed && v[at(m.x, m.y)]) {
      m.noticed = true
      say(s, `You see ${an(MONSTERS[m.kind].name)}${m.awake ? '' : ' (asleep)'}.`)
    }
  }
}

// --- Helpers for the page -----------------------------------------------------------------------

export const visibleMonsters = (s: State) => s.monsters.filter(m => s.visible[at(m.x, m.y)])

// Which way to step to walk toward `target` through squares you've seen, or null if there's
// no known way (or you're there).
export function travelStep(s: State, target: number): { dx: number; dy: number } | null {
  const known = (i: number) => s.seen[i] === 1 && passable(s.tiles[i])
  if (!known(target) || target === here(s)) return null
  const field = distances(s.tiles, target, known)
  const p = s.player
  let best: [number, number] | null = null
  let bestD = field[here(s)]
  if (bestD < 0) return null
  for (const [dx, dy] of NEIGHBORS) {
    const n = at(p.x + dx, p.y + dy)
    if (p.x + dx < 0 || p.x + dx >= W || field[n] < 0 || field[n] >= bestD || monsterAt(s, n)) continue
    if (!diagonalOk(s.tiles, p.x, p.y, dx, dy)) continue
    ;[best, bestD] = [[dx, dy], field[n]]
  }
  return best && { dx: best[0], dy: best[1] }
}

export const stairsSeen = (s: State) => s.tiles.findIndex((t, i) => t === STAIRS && s.seen[i])

export function score(s: State) {
  return s.gold + s.kills * 5 + (s.depth - 1) * 60 + s.player.level * 20 + (s.over?.won ? 1000 : 0)
}
