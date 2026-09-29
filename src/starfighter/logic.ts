// Starfighter: the rules of a vertical bullet-hell shooter. The field is a fixed 360 × 640;
// positions are in field pixels and speeds in pixels per tick, at 60 ticks a second. All
// randomness comes from the seed in the state, so the same seed and inputs replay exactly.
//
// Your ship's hitbox is a tiny dot at its center, much smaller than the ship: bullets that
// pass close without touching it "graze" for points.
import { rand } from '../shared/rng.ts'

export const W = 360
export const H = 640
export const TICKS = 60
const HITBOX = 2.5
const GRAZE = 16
const PICKUP = 24
const MAX_MOVE = 14 // most pixels the ship covers in a tick, however fast the finger
const RESPAWN = 70
const INVULN = 150
const BOMB_TICKS = 100
const EXTEND_EVERY = 150_000

export type EnemyKind = 'drone' | 'swooper' | 'turret' | 'bomber' | 'boss'
export const ENEMIES: Record<EnemyKind, { hp: number; r: number; score: number; medals: number }> = {
  drone: { hp: 4, r: 12, score: 100, medals: 1 },
  swooper: { hp: 9, r: 14, score: 250, medals: 2 },
  turret: { hp: 34, r: 20, score: 800, medals: 4 },
  bomber: { hp: 90, r: 30, score: 2500, medals: 8 },
  boss: { hp: 1100, r: 46, score: 30000, medals: 30 },
}

export interface Enemy {
  id: number
  kind: EnemyKind
  x: number
  y: number
  hp: number
  maxHp: number
  t: number // ticks alive
  path: number // which way it flies, per kind
  x0: number
  dir: number
  cd: number // ticks until it fires
  spin: number // for rotating patterns
  flash: number // ticks of the hit flash
}
export interface Bullet { x: number; y: number; vx: number; vy: number; r: number; color: number; grazed?: boolean }
export interface Shot { x: number; y: number; vx: number; vy: number; dmg: number }
export type ItemKind = 'power' | 'bomb' | 'medal' | 'life'
export interface Item { x: number; y: number; vy: number; kind: ItemKind }
export type Event =
  | { type: 'explode'; x: number; y: number; size: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'graze'; x: number; y: number }
  | { type: 'pickup'; kind: ItemKind; x: number; y: number }
  | { type: 'death' | 'bomb' | 'extend' | 'boss' | 'clear' }

export interface Wave { at: number; kind: EnemyKind; count: number; path: number; x: number; gap: number }

export interface State {
  seed: number
  tick: number
  stage: number
  stageTick: number
  script: Wave[]
  phase: 'waves' | 'boss' | 'clear'
  clearTicks: number
  player: { x: number; y: number; lives: number; bombs: number; power: number; respawn: number; invuln: number; fire: number }
  bombing: number
  enemies: Enemy[]
  shots: Shot[]
  bullets: Bullet[]
  items: Item[]
  score: number
  graze: number
  chain: number // medals caught in a row: each is worth more
  nextExtend: number
  nextId: number
  over: boolean
  events: Event[]
}

export interface Controls { dx: number; dy: number; bomb: boolean }
export const idle: Controls = { dx: 0, dy: 0, bomb: false }

// A small random source over the seed in the state.
function rng(s: State) {
  return () => {
    const [v, next] = rand(s.seed)
    s.seed = next
    return v
  }
}

export function init(seed: number): State {
  const s: State = {
    seed, tick: 0, stage: 1, stageTick: 0, script: [], phase: 'waves', clearTicks: 0,
    player: { x: W / 2, y: H - 90, lives: 3, bombs: 2, power: 1, respawn: 0, invuln: 90, fire: 0 },
    bombing: 0, enemies: [], shots: [], bullets: [], items: [], score: 0, graze: 0, chain: 0,
    nextExtend: EXTEND_EVERY, nextId: 1, over: false, events: [],
  }
  s.script = makeScript(s)
  return s
}

// The waves of a stage: easy drones first, heavier ships as it goes, about 4 s apart.
function makeScript(s: State): Wave[] {
  const r = rng(s)
  const waves: Wave[] = []
  let at = 60
  const count = 12 + Math.min(6, s.stage)
  for (let i = 0; i < count; i++) {
    const roll = r()
    const late = i / count
    const kind: EnemyKind =
      i < 2 ? 'drone' : roll < 0.4 - late * 0.1 ? 'drone' : roll < 0.65 ? 'swooper' : roll < 0.85 || i < 6 ? 'turret' : 'bomber'
    const n = kind === 'drone' ? 5 + Math.floor(r() * 3) : kind === 'swooper' ? 3 + Math.floor(r() * 2) : kind === 'turret' ? 2 : 1
    waves.push({ at, kind, count: n, path: Math.floor(r() * 3), x: 60 + r() * (W - 120), gap: kind === 'drone' ? 14 : 26 })
    at += kind === 'bomber' ? 320 : 200 + Math.floor(r() * 60)
  }
  return waves
}

const toughness = (stage: number) => 1 + 0.3 * (stage - 1)
const bulletSpeed = (stage: number) => 1 + 0.07 * (stage - 1)

export function step(prev: State, c: Controls): State {
  if (prev.over) return prev
  const s: State = {
    ...prev,
    tick: prev.tick + 1,
    stageTick: prev.stageTick + 1,
    player: { ...prev.player },
    enemies: prev.enemies.map(e => ({ ...e })),
    shots: prev.shots.map(b => ({ ...b })),
    bullets: prev.bullets.map(b => ({ ...b })),
    items: prev.items.map(i => ({ ...i })),
    events: [],
  }
  const r = rng(s)
  const p = s.player

  // You: move, fire, bomb.
  if (p.respawn > 0) {
    if (--p.respawn === 0) Object.assign(p, { x: W / 2, y: H - 90, invuln: INVULN })
  } else {
    const len = Math.hypot(c.dx, c.dy)
    const k = len > MAX_MOVE ? MAX_MOVE / len : 1
    p.x = Math.max(10, Math.min(W - 10, p.x + c.dx * k))
    p.y = Math.max(24, Math.min(H - 16, p.y + c.dy * k))
    if (p.invuln > 0) p.invuln--
    if (--p.fire <= 0) {
      p.fire = 5
      fire(s)
    }
    if (c.bomb && p.bombs > 0 && s.bombing === 0) {
      p.bombs--
      s.bombing = BOMB_TICKS
      p.invuln = Math.max(p.invuln, BOMB_TICKS + 30)
      s.events.push({ type: 'bomb' })
    }
  }
  if (s.bombing > 0) {
    s.bombing--
    // The blast turns every enemy bullet into a medal and scorches everything on screen.
    for (const b of s.bullets) s.items.push({ x: b.x, y: b.y, vy: -1, kind: 'medal' })
    s.bullets = []
    if (s.bombing % 10 === 0) for (const e of s.enemies) if (e.y > 0) damage(s, e, e.kind === 'boss' ? 12 : 8)
  }

  spawnWaves(s)
  for (const e of s.enemies) fly(s, e, r)
  s.enemies = s.enemies.filter(e => e.hp > 0 && e.y < H + 60 && e.y > -200 && e.x > -80 && e.x < W + 80)

  for (const b of s.shots) (b.x += b.vx), (b.y += b.vy)
  s.shots = s.shots.filter(b => b.y > -20 && b.x > -20 && b.x < W + 20)
  for (const b of s.bullets) (b.x += b.vx), (b.y += b.vy)
  s.bullets = s.bullets.filter(b => b.y > -30 && b.y < H + 30 && b.x > -30 && b.x < W + 30)

  // Your shots against their ships.
  s.shots = s.shots.filter(b => {
    for (const e of s.enemies) {
      if (e.hp <= 0) continue
      const r = ENEMIES[e.kind].r
      if (Math.abs(b.x - e.x) < r && Math.abs(b.y - e.y) < r) {
        damage(s, e, b.dmg)
        s.events.push({ type: 'hit', x: b.x, y: b.y })
        return false
      }
    }
    return true
  })
  s.enemies = s.enemies.filter(e => e.hp > 0)

  // Their bullets (and ships) against you.
  if (p.respawn === 0) {
    for (const b of s.bullets) {
      const d = Math.hypot(b.x - p.x, b.y - p.y)
      if (d < b.r + HITBOX && p.invuln === 0) return die(s)
      if (d < b.r + GRAZE && !b.grazed) {
        b.grazed = true
        s.graze++
        s.score += 20
        s.events.push({ type: 'graze', x: b.x, y: b.y })
      }
    }
    if (p.invuln === 0 && s.enemies.some(e => Math.hypot(e.x - p.x, e.y - p.y) < ENEMIES[e.kind].r * 0.7)) return die(s)
  }

  // Items fall; near you they're drawn in.
  s.items = s.items.filter(it => {
    it.vy = Math.min(2.2, it.vy + 0.06)
    const d = Math.hypot(it.x - p.x, it.y - p.y)
    if (p.respawn === 0 && (d < 90 || s.bombing > 0)) {
      const pull = Math.max(4, 9 - d / 20)
      it.x += ((p.x - it.x) / (d || 1)) * pull
      it.y += ((p.y - it.y) / (d || 1)) * pull
    } else it.y += it.vy
    if (p.respawn === 0 && Math.hypot(it.x - p.x, it.y - p.y) < PICKUP) {
      collect(s, it)
      return false
    }
    if (it.y > H + 20) {
      if (it.kind === 'medal') s.chain = 0 // missed one: the chain starts over
      return false
    }
    return true
  })

  if (s.score >= s.nextExtend) {
    s.nextExtend += EXTEND_EVERY
    p.lives++
    s.events.push({ type: 'extend' })
  }

  // After the waves, the boss; after the boss, a breather, then the next stage.
  if (s.phase === 'waves' && s.script.every(w => w.at < s.stageTick - 400) && !s.enemies.length) {
    s.phase = 'boss'
    s.enemies.push(makeEnemy(s, 'boss', W / 2, -60, 0))
    s.events.push({ type: 'boss' })
  } else if (s.phase === 'boss' && !s.enemies.some(e => e.kind === 'boss')) {
    s.phase = 'clear'
    s.clearTicks = 180
    s.bullets = []
    s.events.push({ type: 'clear' })
  } else if (s.phase === 'clear' && --s.clearTicks <= 0) {
    s.stage++
    s.stageTick = 0
    s.phase = 'waves'
    s.script = makeScript(s)
  }
  return s
}

function fire(s: State) {
  const p = s.player
  const shot = (dx: number, angle: number, dmg = 1) =>
    s.shots.push({ x: p.x + dx, y: p.y - 14, vx: Math.sin(angle) * 13, vy: -Math.cos(angle) * 13, dmg })
  shot(-6, 0)
  shot(6, 0)
  if (p.power >= 2) shot(-12, -0.12), shot(12, 0.12)
  if (p.power >= 3) shot(-16, -0.26), shot(16, 0.26)
  if (p.power >= 4) shot(0, 0, 2)
  if (p.power >= 5) shot(-20, -0.4), shot(20, 0.4)
}

function damage(s: State, e: Enemy, n: number) {
  if (e.hp <= 0) return
  e.hp -= n
  e.flash = 3
  if (e.hp > 0) return
  const t = ENEMIES[e.kind]
  s.score += t.score * (e.kind === 'boss' ? s.stage : 1)
  s.events.push({ type: 'explode', x: e.x, y: e.y, size: t.r })
  const r = rng(s)
  for (let i = 0; i < t.medals; i++) s.items.push({ x: e.x + (r() - 0.5) * t.r * 2, y: e.y + (r() - 0.5) * t.r, vy: -1.5 - r() * 1.5, kind: 'medal' })
  // Bombers and bosses leave power; now and then something else drops.
  if (e.kind === 'bomber' || e.kind === 'boss' || (e.kind === 'turret' && r() < 0.35)) s.items.push({ x: e.x, y: e.y, vy: -2, kind: 'power' })
  if (e.kind === 'boss' || (e.kind === 'bomber' && r() < 0.5)) s.items.push({ x: e.x + 16, y: e.y, vy: -2.4, kind: 'bomb' })
  if (e.kind === 'boss' && s.stage % 2 === 0) s.items.push({ x: e.x - 16, y: e.y, vy: -2.4, kind: 'life' })
  if (e.kind === 'boss') s.bullets = []
}

function collect(s: State, it: Item) {
  const p = s.player
  s.events.push({ type: 'pickup', kind: it.kind, x: it.x, y: it.y })
  if (it.kind === 'medal') {
    s.chain++
    s.score += 100 + 10 * Math.min(s.chain, 200)
  } else if (it.kind === 'power') {
    if (p.power < 5) p.power++
    else s.score += 5000
  } else if (it.kind === 'bomb') p.bombs = Math.min(5, p.bombs + 1)
  else p.lives++
}

function die(s: State): State {
  const p = s.player
  s.events.push({ type: 'death' }, { type: 'explode', x: p.x, y: p.y, size: 30 })
  p.lives--
  s.chain = 0
  s.bullets = []
  if (p.lives < 0) {
    s.over = true
    return s
  }
  p.power = Math.max(1, p.power - 1)
  p.bombs = Math.max(p.bombs, 2)
  p.respawn = RESPAWN
  p.x = -100 // off the field until it comes back
  s.items.push({ x: W / 2, y: H / 2, vy: -3, kind: 'power' })
  return s
}

function spawnWaves(s: State) {
  for (const w of s.script) {
    for (let i = 0; i < w.count; i++) {
      if (s.stageTick !== w.at + i * w.gap) continue
      const spread = w.kind === 'drone' && w.path === 0 ? (i - (w.count - 1) / 2) * 34 : 0
      const side = i % 2 ? 1 : -1
      if (w.kind === 'swooper') s.enemies.push(makeEnemy(s, 'swooper', side < 0 ? -20 : W + 20, 70 + (w.path * 40), -side))
      else if (w.kind === 'turret') s.enemies.push(makeEnemy(s, 'turret', i ? W - w.x : w.x, -30, 1))
      else s.enemies.push(makeEnemy(s, w.kind, w.x + spread, -30 - Math.abs(spread) * 0.6, 1, w.path))
    }
  }
}

function makeEnemy(s: State, kind: EnemyKind, x: number, y: number, dir: number, path = 0): Enemy {
  const hp = Math.round(ENEMIES[kind].hp * toughness(s.stage))
  return { id: s.nextId++, kind, x, y, hp, maxHp: hp, t: 0, path, x0: x, dir, cd: 50 + (s.nextId % 40), spin: 0, flash: 0 }
}

// How each kind flies and fires. Fire rates speed up a little every stage.
function fly(s: State, e: Enemy, r: () => number) {
  e.t++
  if (e.flash > 0) e.flash--
  const p = s.player
  const v = bulletSpeed(s.stage)
  const aim = () => Math.atan2(p.y - e.y, p.x - e.x)
  const shoot = (angle: number, speed: number, color = 0, radius = 5) =>
    s.bullets.push({ x: e.x, y: e.y, vx: Math.cos(angle) * speed * v, vy: Math.sin(angle) * speed * v, r: radius, color })
  const fan = (n: number, width: number, speed: number, color = 0) => {
    const a = aim()
    for (let i = 0; i < n; i++) shoot(a + (n > 1 ? (i / (n - 1) - 0.5) * width : 0), speed, color)
  }
  // Later stages throw more at you: wider fans and denser rings.
  const more = (n: number, per: number, cap: number) => Math.min(cap, n + per * (s.stage - 1))
  const ready = (every: number) => {
    if (--e.cd > 0 || e.y < 10 || p.respawn > 0) return false
    e.cd = Math.round(every / (1 + 0.12 * (s.stage - 1)))
    return true
  }
  switch (e.kind) {
    case 'drone':
      // Straight down, weaving, or diving then veering toward you.
      e.y += 1.9
      if (e.path === 1) e.x = e.x0 + Math.sin(e.t / 22) * 60
      if (e.path === 2 && e.t > 60 && e.t < 120) e.x += Math.sign(p.x - e.x) * 1.6
      if (ready(100) && e.y < H * 0.6) fan(s.stage >= 2 ? 3 : 1, 0.35, 2.6)
      break
    case 'swooper':
      // Across the screen in an arc.
      e.x += e.dir * 2.4
      e.y = e.y + Math.cos(e.t / 60) * 1.4
      if (ready(80)) fan(more(3, 1, 7), 0.5 + 0.08 * (s.stage - 1), 2.8, 1)
      break
    case 'turret':
      // Down to a spot, hold there firing rings, then drift away.
      e.y += e.t < 70 ? 2 : e.t > 480 ? 1.5 : 0
      if (e.t > 70 && e.t < 480 && ready(65)) {
        e.spin += 0.2
        const n = more(12, 2, 24)
        for (let i = 0; i < n; i++) shoot(e.spin + (i / n) * Math.PI * 2, 2.1, 2, 6)
      }
      break
    case 'bomber':
      e.y += e.t < 90 ? 1.2 : 0.5
      e.x = e.x0 + Math.sin(e.t / 90) * 40
      if (ready(45)) fan(5, 0.9, 2.5, 1)
      if (e.t % 150 === 0) {
        const n = more(16, 4, 32)
        for (let i = 0; i < n; i++) shoot((i / n) * Math.PI * 2 + r() * 0.2, 1.8, 2, 6)
      }
      break
    case 'boss': {
      if (e.y < 130) e.y += 1.2
      else e.x = W / 2 + Math.sin(e.t / 110) * 110
      if (e.y < 100) break
      const life = e.hp / e.maxHp
      if (life > 0.66) {
        // Fans aimed at you, and straight lines from the wing guns.
        if (ready(38)) fan(7, 1.1, 3, 1)
        if (e.t % 24 === 0) for (const dx of [-34, 34]) s.bullets.push({ x: e.x + dx, y: e.y + 16, vx: 0, vy: 4.2 * v, r: 4, color: 0 })
      } else if (life > 0.33) {
        // A double spiral.
        if (e.t % 4 === 0) {
          e.spin += 0.19
          const arms = s.stage >= 3 ? 3 : 2
          for (let k = 0; k < arms; k++) shoot(e.spin + (k / arms) * Math.PI * 2, 2.4, 2)
        }
        if (ready(90)) fan(3, 0.3, 3.4, 0)
      } else {
        // Alternating rings, and aimed triples.
        if (e.t % 32 === 0) {
          const n = more(20, 4, 36)
          e.spin = e.spin ? 0 : Math.PI / n
          for (let i = 0; i < n; i++) shoot(e.spin + (i / n) * Math.PI * 2, 2.2, 2, 6)
        }
        if (ready(46)) fan(3, 0.4, 3.6, 1)
      }
      break
    }
  }
}
