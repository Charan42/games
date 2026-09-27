// Tower defense. Enemies walk a fixed path; towers built beside it shoot them. Each one that
// gets through costs lives. Waves come on a timer, or early for bonus gold. Fixed ticks at
// 60 a second, and no randomness: the same builds always play out the same way.
export const COLS = 9
export const ROWS = 13
export const TICKS_PER_SECOND = 60

// The path, as corners in cell coordinates. It enters off the left edge and leaves off the bottom.
const CORNERS: [number, number][] = [[-1, 1], [7, 1], [7, 4], [1, 4], [1, 7], [7, 7], [7, 10], [3, 10], [3, 13]]
const SEGMENTS = CORNERS.slice(1).map(([x, y], k) => {
  const [px, py] = CORNERS[k]
  return { x: px, y: py, dx: Math.sign(x - px), dy: Math.sign(y - py), length: Math.abs(x - px) + Math.abs(y - py) }
})
export const PATH_LENGTH = SEGMENTS.reduce((n, s) => n + s.length, 0)

// Where on the board (in cells, centers at +0.5) something is after walking d cells of path.
export function along(d: number): [number, number] {
  for (const s of SEGMENTS) {
    if (d <= s.length) return [s.x + s.dx * d + 0.5, s.y + s.dy * d + 0.5]
    d -= s.length
  }
  const [x, y] = CORNERS.at(-1)!
  return [x + 0.5, y + 0.5]
}

export const ON_PATH = new Set<number>()
for (let d = 0; d <= PATH_LENGTH; d++) {
  const [x, y] = along(d).map(Math.floor)
  if (x >= 0 && x < COLS && y >= 0 && y < ROWS) ON_PATH.add(y * COLS + x)
}

export type TowerKind = 'gun' | 'cannon' | 'frost' | 'sniper'
export const TOWERS: Record<TowerKind, { name: string; cost: number; range: number; damage: number; reload: number; blurb: string }> = {
  gun: { name: 'Gun', cost: 50, range: 2.5, damage: 9, reload: 14, blurb: 'Fast shots at one enemy' },
  cannon: { name: 'Cannon', cost: 90, range: 2.3, damage: 24, reload: 55, blurb: 'Slow shells that hit a whole group' },
  frost: { name: 'Frost', cost: 70, range: 2.1, damage: 3, reload: 26, blurb: 'Slows everything near its target' },
  sniper: { name: 'Sniper', cost: 130, range: 5, damage: 75, reload: 100, blurb: 'Long range, goes straight through armor' },
}
const SPLASH = { cannon: 1.1, frost: 0.9 }
const SLOW_TICKS = 90

export type EnemyKind = 'grunt' | 'runner' | 'tank' | 'boss'
export const ENEMIES: Record<EnemyKind, { hp: number; speed: number; armor: number; reward: number; lives: number }> = {
  grunt: { hp: 32, speed: 0.032, armor: 0, reward: 5, lives: 1 },
  runner: { hp: 20, speed: 0.06, armor: 0, reward: 4, lives: 1 },
  tank: { hp: 110, speed: 0.02, armor: 4, reward: 12, lives: 2 },
  boss: { hp: 700, speed: 0.016, armor: 6, reward: 80, lives: 10 },
}

export interface Enemy { id: number; kind: EnemyKind; hp: number; maxHp: number; armor: number; d: number; slow: number }
export interface Tower { cell: number; kind: TowerKind; level: number; spent: number; cooldown: number; angle: number }
export interface Shot { kind: TowerKind; from: [number, number]; to: [number, number]; t: number }

export interface State {
  tick: number
  gold: number
  lives: number
  wave: number // waves launched so far
  countdown: number // ticks until the next wave
  spawns: { kind: EnemyKind; at: number; hp: number; armor: number }[]
  enemies: Enemy[]
  towers: Tower[]
  shots: Shot[] // recent shots, for drawing
  nextId: number
  over: boolean
}

export const FIRST_WAVE = 10 * TICKS_PER_SECOND
export const WAVE_GAP = 25 * TICKS_PER_SECOND

export const init = (): State => ({
  tick: 0, gold: 150, lives: 20, wave: 0, countdown: FIRST_WAVE,
  spawns: [], enemies: [], towers: [], shots: [], nextId: 1, over: false,
})

// Who's in wave n: mostly grunts, runners on even waves, tanks from wave 3, a boss every 10th.
// They get tougher every wave, and better armored every sixth, which fast weak shots stop
// getting through: late waves need upgrades, cannons and snipers, not just more guns.
export function waveOf(n: number): EnemyKind[] {
  return Array.from({ length: 6 + Math.floor(n * 1.5) }, (_, i): EnemyKind =>
    n % 10 === 0 && i === 0 ? 'boss' : n >= 3 && i % 5 === 4 ? 'tank' : n % 2 === 0 && i % 3 === 1 ? 'runner' : 'grunt',
  )
}
const toughness = (n: number) => 1.12 ** (n - 1)

function launch(s: State): State {
  const n = s.wave + 1
  let at = s.tick
  const spawns = waveOf(n).map(kind => {
    at += kind === 'runner' ? 24 : 40
    return { kind, at, hp: Math.round(ENEMIES[kind].hp * toughness(n)), armor: ENEMIES[kind].armor + Math.floor((n - 1) / 6) * 2 }
  })
  return { ...s, wave: n, countdown: WAVE_GAP, spawns: [...s.spawns, ...spawns] }
}

// Call the next wave now; every second it would have waited pays a gold coin.
export function callWave(s: State): State {
  if (s.over) return s
  return launch({ ...s, gold: s.gold + Math.floor(s.countdown / TICKS_PER_SECOND) })
}
export const earlyBonus = (s: State) => Math.floor(s.countdown / TICKS_PER_SECOND)

// A tower's numbers at its level: each level up hits 60% harder, reaches a bit further and
// reloads a bit faster.
export function stats(kind: TowerKind, level: number) {
  const t = TOWERS[kind]
  return {
    range: t.range + 0.35 * (level - 1),
    damage: Math.round(t.damage * 1.6 ** (level - 1)),
    reload: Math.round(t.reload * 0.85 ** (level - 1)),
  }
}
export const MAX_LEVEL = 3
export const upgradeCost = (t: Tower) => (t.level >= MAX_LEVEL ? Infinity : Math.round(TOWERS[t.kind].cost * 0.8 * t.level))
export const refund = (t: Tower) => Math.floor(t.spent * 0.7)
export const towerAt = (s: State, cell: number) => s.towers.find(t => t.cell === cell)
export const canBuild = (s: State, cell: number, kind: TowerKind) =>
  !s.over && cell >= 0 && cell < COLS * ROWS && !ON_PATH.has(cell) && !towerAt(s, cell) && s.gold >= TOWERS[kind].cost

export function build(s: State, cell: number, kind: TowerKind): State {
  if (!canBuild(s, cell, kind)) return s
  const cost = TOWERS[kind].cost
  return { ...s, gold: s.gold - cost, towers: [...s.towers, { cell, kind, level: 1, spent: cost, cooldown: 0, angle: -Math.PI / 2 }] }
}

export function upgrade(s: State, cell: number): State {
  const t = towerAt(s, cell)
  if (!t || s.over || s.gold < upgradeCost(t)) return s
  const cost = upgradeCost(t)
  return { ...s, gold: s.gold - cost, towers: s.towers.map(o => (o === t ? { ...t, level: t.level + 1, spent: t.spent + cost } : o)) }
}

export function sell(s: State, cell: number): State {
  const t = towerAt(s, cell)
  if (!t || s.over) return s
  return { ...s, gold: s.gold + refund(t), towers: s.towers.filter(o => o !== t) }
}

export function step(s: State): State {
  if (s.over) return s
  let next: State = { ...s, tick: s.tick + 1, countdown: s.countdown - 1 }
  if (next.countdown <= 0) next = launch(next)
  const enemies = next.enemies.map(e => ({ ...e }))
  let { gold, lives, nextId } = next

  const due = next.spawns.filter(sp => sp.at <= next.tick)
  for (const sp of due) enemies.push({ id: nextId++, kind: sp.kind, hp: sp.hp, maxHp: sp.hp, armor: sp.armor, d: 0, slow: 0 })

  // Walk; anything reaching the end costs lives and is gone.
  for (const e of enemies) {
    e.d += ENEMIES[e.kind].speed * (e.slow > 0 ? 0.5 : 1)
    if (e.slow > 0) e.slow--
    if (e.d >= PATH_LENGTH) {
      lives -= ENEMIES[e.kind].lives
      e.hp = -Infinity // gone, but no reward
    }
  }

  // Fire: each loaded tower shoots the enemy furthest along the path within its range.
  const shots = next.shots.filter(sh => --sh.t > 0).map(sh => ({ ...sh }))
  const towers = next.towers.map(t => {
    const tower = { ...t, cooldown: t.cooldown - 1 }
    if (tower.cooldown > 0) return tower
    const { range, damage, reload } = stats(t.kind, t.level)
    const [tx, ty] = [(t.cell % COLS) + 0.5, Math.floor(t.cell / COLS) + 0.5]
    let target: Enemy | undefined
    for (const e of enemies) {
      if (e.hp <= 0) continue
      const [ex, ey] = along(e.d)
      if (Math.hypot(ex - tx, ey - ty) <= range && (!target || e.d > target.d)) target = e
    }
    if (!target) return tower
    const at = along(target.d)
    const hit = (e: Enemy) => {
      e.hp -= t.kind === 'sniper' ? damage : Math.max(1, damage - e.armor)
      if (t.kind === 'frost') e.slow = SLOW_TICKS
    }
    if (t.kind === 'cannon' || t.kind === 'frost') {
      for (const e of enemies) {
        const [ex, ey] = along(e.d)
        if (e.hp > 0 && Math.hypot(ex - at[0], ey - at[1]) <= SPLASH[t.kind]) hit(e)
      }
    } else hit(target)
    shots.push({ kind: t.kind, from: [tx, ty], to: at, t: t.kind === 'sniper' ? 14 : 8 })
    return { ...tower, cooldown: reload, angle: Math.atan2(at[1] - ty, at[0] - tx) }
  })

  const alive = enemies.filter(e => {
    if (e.hp > 0) return true
    if (e.hp > -Infinity) gold += ENEMIES[e.kind].reward
    return false
  })
  return {
    ...next,
    gold,
    lives: Math.max(0, lives),
    nextId,
    spawns: next.spawns.filter(sp => sp.at > next.tick),
    enemies: alive,
    towers,
    shots,
    over: lives <= 0,
  }
}
