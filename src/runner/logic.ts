// Runner: the rules. Three lanes, obstacles to jump, slide under or dodge, coins and power-ups.
// Fixed ticks at 60 a second and a seeded track, so a seed and the same inputs at the same
// ticks always replay the same run. The renderer (main.ts) only draws this.
//
// Distances are in meters along the track; x is sideways, y is up.
import { rand } from '../shared/rng.ts'

export const TICKS = 60
export const LANE_W = 2.4
export const START_SPEED = 13
export const MAX_SPEED = 32
const GRAVITY = 62
const JUMP_V = 17
const DIVE_V = -30 // swiping down in the air drops you fast
const LANE_SPEED = 15 // meters per second sideways
export const SLIDE_TICKS = 40
const STUMBLE_TICKS = 3 * TICKS // a second stumble within this is a crash
const AHEAD = 150 // how far ahead the track is laid out
const HALF = 0.35 // the runner's half width and half depth
const POWER_TICKS = { magnet: 10 * TICKS, shield: 15 * TICKS, double: 10 * TICKS }

export type ObstacleKind = 'low' | 'high' | 'block' | 'train'
export const SIZES: Record<ObstacleKind, { height: number; len: number }> = {
  low: { height: 1.0, len: 0.5 }, // a barrier to jump
  high: { height: 1.3, len: 0.5 }, // a bar overhead: its underside is at 1.3, slide under it
  block: { height: 2.6, len: 1.4 }, // crates: go around
  train: { height: 3.2, len: 0 }, // length varies
}
export type PowerKind = keyof typeof POWER_TICKS
export type Input = 'left' | 'right' | 'jump' | 'slide'

export interface Obstacle { id: number; kind: ObstacleKind; lane: number; z: number; len: number; broken?: boolean }
export interface Coin { id: number; lane: number; z: number; y: number }
export interface Power { id: number; kind: PowerKind; lane: number; z: number }
export type Event =
  | { type: 'coin'; id: number }
  | { type: 'power'; kind: PowerKind; id: number }
  | { type: 'jump' | 'land' | 'slide' | 'stumble' | 'crash' | 'shield' }

export interface State {
  seed: number
  tick: number
  d: number // meters run
  speed: number
  lane: number // where you're heading: -1, 0 or 1
  from: number // the lane you came from, to bounce back to after clipping something
  x: number
  y: number
  vy: number
  sliding: number // ticks of slide left
  stumble: number
  magnet: number
  shield: number
  double: number
  coins: number
  score: number
  obstacles: Obstacle[]
  pickups: Coin[]
  powers: Power[]
  nextZ: number // where the next stretch of track starts
  sinceBreak: number // meters since the last easy stretch
  sincePower: number
  nextId: number
  over: boolean
  events: Event[]
}

export const speedAt = (d: number) => START_SPEED + (MAX_SPEED - START_SPEED) * (1 - Math.exp(-d / 2500))

export function init(seed: number): State {
  const s: State = {
    seed, tick: 0, d: 0, speed: START_SPEED, lane: 0, from: 0, x: 0, y: 0, vy: 0, sliding: 0, stumble: 0,
    magnet: 0, shield: 0, double: 0, coins: 0, score: 0, obstacles: [], pickups: [], powers: [],
    nextZ: 40, sinceBreak: 0, sincePower: 0, nextId: 1, over: false, events: [],
  }
  // A coin line to run into while you get going.
  for (let z = 14; z < 38; z += 3) s.pickups.push({ id: s.nextId++, lane: 0, z, y: 0.9 })
  layTrack(s)
  return s
}

export function input(s: State, what: Input): State {
  if (s.over) return s
  const n: State = { ...s, events: [] }
  const grounded = n.y <= 0
  if (what === 'left' || what === 'right') {
    const lane = Math.max(-1, Math.min(1, n.lane + (what === 'left' ? -1 : 1)))
    if (lane !== n.lane) [n.from, n.lane] = [n.lane, lane]
  } else if (what === 'jump') {
    if (grounded) {
      n.vy = JUMP_V
      n.sliding = 0
      n.events = [{ type: 'jump' }]
    }
  } else if (grounded) {
    n.sliding = SLIDE_TICKS
    n.events = [{ type: 'slide' }]
  } else {
    n.vy = Math.min(n.vy, DIVE_V)
    n.sliding = SLIDE_TICKS // lands straight into a slide
  }
  return n
}

export function step(prev: State): State {
  if (prev.over) return prev
  const s: State = { ...prev, events: [], tick: prev.tick + 1 }
  const dt = 1 / TICKS
  s.speed = speedAt(s.d)
  const before = s.d
  s.d += s.speed * dt
  const mult = s.double > 0 ? 2 : 1
  s.score += s.speed * dt * mult

  // Sideways toward the lane, and up and down.
  const goal = s.lane * LANE_W
  s.x += Math.sign(goal - s.x) * Math.min(Math.abs(goal - s.x), LANE_SPEED * dt)
  if (s.y > 0 || s.vy > 0) {
    s.vy -= GRAVITY * dt
    s.y = Math.max(0, s.y + s.vy * dt)
    if (s.y === 0) {
      s.vy = 0
      s.events.push({ type: 'land' })
    }
  } else if (s.sliding > 0) s.sliding--
  for (const k of ['stumble', 'magnet', 'shield', 'double'] as const) if (s[k] > 0) s[k]--

  // Collisions. Overlapping something you were already level with means you clipped its side
  // while changing lanes: you bounce back and stumble. Running into its front is a crash.
  s.obstacles = prev.obstacles
  for (const o of s.obstacles) {
    if (o.broken || o.z > s.d + HALF || o.z + o.len < s.d - HALF) continue
    if (Math.abs(s.x - o.lane * LANE_W) > HALF + 0.9) continue
    if (!blocks(o, s)) continue
    const alongside = o.z <= before + HALF && o.z + o.len >= before - HALF
    if (alongside && s.lane !== s.from) {
      if (s.stumble > 0) return crash(s, o)
      s.stumble = STUMBLE_TICKS
      s.lane = s.from
      s.events.push({ type: 'stumble' })
      break
    }
    return crash(s, o)
  }

  // Coins and power-ups: touch them, or the magnet pulls in every coin just ahead.
  const cy = s.y + (s.sliding > 0 ? 0.4 : 0.9)
  const near = (lane: number, z: number, y: number) => Math.abs(s.x - lane * LANE_W) < 1 && Math.abs(z - s.d) < 0.8 && Math.abs(y - cy) < 1.3
  s.pickups = prev.pickups.filter(c => {
    if (c.z < s.d - 4) return false
    if (!near(c.lane, c.z, c.y) && !(s.magnet > 0 && c.z > s.d - 1 && c.z < s.d + 14)) return true
    s.coins++
    s.score += 5 * mult
    s.events.push({ type: 'coin', id: c.id })
    return false
  })
  s.powers = prev.powers.filter(p => {
    if (p.z < s.d - 4) return false
    if (!near(p.lane, p.z, 1)) return true
    s[p.kind] = POWER_TICKS[p.kind]
    s.events.push({ type: 'power', kind: p.kind, id: p.id })
    return false
  })
  s.obstacles = s.obstacles.filter(o => o.z + o.len > s.d - 12)
  if (s.nextZ < s.d + AHEAD) layTrack(s)
  return s
}

// Whether an obstacle stops the runner as they are now (standing, in the air, or sliding).
function blocks(o: Obstacle, s: State) {
  if (o.kind === 'low') return s.y < SIZES.low.height
  if (o.kind === 'high') return !(s.sliding > 0 && s.y < 0.2)
  return true
}

function crash(s: State, o: Obstacle): State {
  if (s.shield > 0) {
    // The shield takes the hit and smashes what you ran into.
    s.shield = 0
    s.obstacles = s.obstacles.map(x => (x === o ? { ...x, broken: true } : x))
    s.events.push({ type: 'shield' })
    return s
  }
  s.over = true
  s.events.push({ type: 'crash' })
  return s
}

// --- The track ahead ----------------------------------------------------------------------

function layTrack(s: State) {
  let seed = s.seed
  const r = () => {
    const [v, next] = rand(seed)
    seed = next
    return v
  }
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]
  const shuffled = () => {
    const lanes = [-1, 0, 1]
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[lanes[i], lanes[j]] = [lanes[j], lanes[i]]
    }
    return lanes
  }
  s.obstacles = [...s.obstacles]
  s.pickups = [...s.pickups]
  s.powers = [...s.powers]
  const add = (kind: ObstacleKind, lane: number, z: number, len = SIZES[kind].len) => s.obstacles.push({ id: s.nextId++, kind, lane, z, len })
  const coinLine = (lane: number, z0: number, z1: number) => {
    for (let z = z0; z <= z1; z += 2.5) s.pickups.push({ id: s.nextId++, lane, z, y: 0.9 })
  }
  // Coins in an arc over a barrier, showing where to jump.
  const coinArc = (lane: number, z: number) => {
    for (let k = -2; k <= 2; k++) s.pickups.push({ id: s.nextId++, lane, z: z + k * 1.6, y: 0.9 + 1.5 * (1 - (k * k) / 5) })
  }

  while (s.nextZ < s.d + AHEAD) {
    const z = s.nextZ
    const v = speedAt(z)
    const hard = Math.min(1, z / 4000) // 0 at the start, 1 from 4 km
    const gap = Math.max(14, v * 0.8) // about 0.8 s between rows, never less than 14 m
    let len = 0
    const roll = r()
    if (s.sinceBreak > 260 - hard * 100) {
      // A breather: coins zigzagging across the lanes.
      let lane = int(-1, 1)
      for (let k = 0; k < 4; k++) {
        coinLine(lane, z + k * 10, z + k * 10 + 7.5)
        lane = Math.max(-1, Math.min(1, lane + pick([-1, 1])))
      }
      len = 40
      s.sinceBreak = 0
    } else if (roll < 0.4) {
      // A row of barriers with at least one lane you can get through.
      const blocked = r() < 0.35 + hard * 0.4 ? 2 : 1
      const lanes = shuffled()
      for (const lane of lanes.slice(0, blocked)) {
        const kind = pick(['low', 'high', 'block'] as const)
        add(kind, lane, z)
        if (kind === 'low' && r() < 0.5) coinArc(lane, z)
      }
      coinLine(lanes[2], z - 6, z + 4)
      len = 2
    } else if (roll < 0.62) {
      // Trains in one or two lanes; coins down the clear one.
      const count = r() < 0.3 + hard * 0.4 ? 2 : 1
      const lanes = shuffled()
      len = int(12, 26)
      for (const lane of lanes.slice(0, count)) add('train', lane, z + (lane === lanes[0] ? 0 : int(0, 8)), len)
      coinLine(lanes[2], z, z + len)
      // Late on, a barrier in the clear lane too.
      if (hard > 0.4 && r() < hard * 0.5) add(pick(['low', 'high'] as const), lanes[2], z + len / 2)
      len += 8
    } else if (roll < 0.78) {
      // A gate across all three lanes: everyone jumps, or everyone slides.
      const kind = pick(['low', 'high'] as const)
      for (const lane of [-1, 0, 1]) add(kind, lane, z)
      if (kind === 'low') coinArc(int(-1, 1), z)
      len = 2
    } else if (roll < 0.9) {
      // Staggered crates: weave between them.
      let lane = int(-1, 1)
      const n = int(2, 3)
      for (let k = 0; k < n; k++) {
        add('block', lane, z + k * gap * 0.9)
        const next = lane === 0 ? pick([-1, 1]) : r() < 0.5 ? 0 : -lane
        coinLine(next, z + k * gap * 0.9 - 3, z + k * gap * 0.9 + 3)
        lane = next
      }
      len = (n - 1) * gap * 0.9 + 2
    } else {
      coinLine(int(-1, 1), z, z + 20)
      len = 20
    }
    if (s.sincePower > 420 && r() < 0.5) {
      const lanes = [-1, 0, 1].filter(l => !s.obstacles.some(o => o.lane === l && o.z + o.len > z - 20 && o.z < z + 4))
      if (lanes.length) {
        s.powers.push({ id: s.nextId++, kind: pick(['magnet', 'shield', 'double'] as const), lane: pick(lanes), z: z - 10 })
        s.sincePower = 0
      }
    }
    s.nextZ = z + len + gap
    s.sinceBreak += len + gap
    s.sincePower += len + gap
  }
  s.seed = seed
}
